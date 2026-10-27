import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { freeLimits, proLimits, withinCap } from "./limits";
import { isProAccount } from "./entitlement";
import { entitlementPayload, lockCartHandoffs } from "./applyPlan";
import { eventAction, presentedSecret, secretsEqual, targetsFor } from "./webhook";

describe("plan limits", () => {
  it("defaults free to one list and leaves the multi-store split and alerts off", () => {
    const previous = {
      PLAN_FREE_SAVED_LISTS: process.env.PLAN_FREE_SAVED_LISTS,
      PLAN_FREE_SHARED_LISTS: process.env.PLAN_FREE_SHARED_LISTS,
      PLAN_FREE_PRICE_ALERTS: process.env.PLAN_FREE_PRICE_ALERTS,
      PLAN_FREE_MULTI_STORE: process.env.PLAN_FREE_MULTI_STORE,
      PLAN_FREE_CART_HANDOFFS: process.env.PLAN_FREE_CART_HANDOFFS,
      PLAN_PRO_SHARED_LISTS: process.env.PLAN_PRO_SHARED_LISTS,
    };
    delete process.env.PLAN_FREE_SAVED_LISTS;
    delete process.env.PLAN_FREE_SHARED_LISTS;
    delete process.env.PLAN_FREE_PRICE_ALERTS;
    delete process.env.PLAN_FREE_MULTI_STORE;
    delete process.env.PLAN_FREE_CART_HANDOFFS;
    delete process.env.PLAN_PRO_SHARED_LISTS;
    try {
      const free = freeLimits();
      assert.equal(free.savedLists, 1);
      assert.equal(free.sharedLists, 1);
      assert.equal(free.priceAlerts, false);
      assert.equal(free.multiStore, false);
      assert.equal(free.cartHandoffs, false);
      assert.equal(free.ownCoupons, false);
      assert.equal(proLimits().ownCoupons, true);
      assert.equal(proLimits().sharedLists, 0);
      assert.equal(proLimits().multiStore, true);
      assert.equal(withinCap(1, 1), false);
      assert.equal(withinCap(4, 0), true);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("treats a future pro expiry as active and a past one as free", () => {
    assert.equal(isProAccount({ entitlement: "free" }), false);
    assert.equal(isProAccount({ entitlement: "pro", entitlementExpiresAt: null }), true);
    assert.equal(isProAccount({ entitlement: "pro", entitlementExpiresAt: new Date(Date.now() + 60_000) }), true);
    assert.equal(isProAccount({ entitlement: "pro", entitlementExpiresAt: new Date(Date.now() - 60_000) }), false);
  });
});

describe("cart handoff lock", () => {
  it("replaces checkout links with a Pro paywall action", () => {
    const locked = lockCartHandoffs({
      stores: [
        {
          storeName: "Kroger",
          items: [
            {
              name: "Milk",
              url: "https://www.kroger.com/search?query=milk",
              openLabel: "Open in Kroger",
              offers: [{ storeName: "Walmart", url: "https://www.walmart.com/search?q=milk" }],
            },
          ],
          handoff: {
            items: [{ name: "Milk", url: "https://www.kroger.com/search?query=milk", openLabel: "Open in Kroger" }],
            action: { type: "kroger_cart", label: "Add to Kroger", url: "https://www.kroger.com/cart", status: "ready" },
          },
        },
      ],
    });
    const line = locked.stores[0].items[0] as { url?: string; openLabel?: string; offers?: Array<{ url?: string }> };
    assert.equal("url" in line, false);
    assert.equal("openLabel" in line, false);
    assert.equal("url" in (line.offers?.[0] ?? {}), false);
    assert.equal(locked.stores[0].handoff?.action.type, "coming_soon");
    assert.equal("url" in (locked.stores[0].handoff?.action ?? {}), false);
    const withCoupon = lockCartHandoffs({
      stores: [
        {
          storeName: "Kroger",
          items: [],
          handoff: {
            action: { type: "kroger_cart", label: "Add to Kroger", url: "https://www.kroger.com/cart" },
            coupon: { url: "https://www.kroger.com/savings/cl/coupons/", label: "Kroger digital coupons" },
          },
        },
      ],
    });
    const kept = withCoupon.stores[0].handoff?.coupon as { url?: string } | undefined;
    assert.equal(kept?.url, "https://www.kroger.com/savings/cl/coupons/");
  });

  it("names own coupons as a free-plan limit only when billing is on", () => {
    const open = entitlementPayload({
      enforced: false,
      plan: "free",
      pro: false,
      limits: { savedLists: 0, sharedLists: 0, priceAlerts: true, multiStore: true, cartHandoffs: true, ownCoupons: true },
    });
    assert.equal(open, null);
    const free = entitlementPayload({
      enforced: true,
      plan: "free",
      pro: false,
      limits: freeLimits(),
    });
    assert.ok(free?.limited.includes("ownCoupons"));
    assert.ok(free?.limited.includes("cartHandoffs"));
  });
});

describe("RevenueCat events", () => {
  it("reads a bearer secret and a raw authorization header", () => {
    assert.equal(presentedSecret("Bearer secret-value"), "secret-value");
    assert.equal(presentedSecret("secret-value"), "secret-value");
    assert.equal(secretsEqual("secret-value", "secret-value"), true);
    assert.equal(secretsEqual("nope", "secret-value"), false);
  });

  it("grants, keeps a cancellation, and ignores a different entitlement", () => {
    assert.equal(eventAction({ type: "INITIAL_PURCHASE" }, "pro"), "grant");
    assert.equal(eventAction({ type: "CANCELLATION", expiration_at_ms: Date.now() + 1000 }, "pro"), "cancellation");
    assert.equal(eventAction({ type: "EXPIRATION" }, "pro"), "revoke");
    assert.equal(eventAction({ type: "RENEWAL", entitlement_ids: ["plus"] }, "pro"), "ignore");
    assert.equal(eventAction({ type: "RENEWAL", entitlement_ids: [] }, "pro"), "grant");
    assert.deepEqual(targetsFor({ type: "TRANSFER", transferred_to: ["new"], transferred_from: ["old"] }), {
      grant: ["new"],
      revoke: ["old"],
    });
  });
});
