import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COUPON_PAGES as serverPages, couponPageFor as serverPageFor, publicCouponLink } from "../coupons/pages";
import { STORE_HANDOFF_CONFIG } from "../storeHandoffConfig";
import {
  COUPON_PAGES,
  checklistSentence,
  couponChecklist,
  couponExpired,
  couponLineLabel,
  couponPageFor,
  couponSavingsSummary,
  couponsForStore,
  parseCouponForm,
  readClipped,
  readCoupons,
  removeCoupon,
  saleBadge,
  shopCouponHint,
  storeCouponMarkup,
  upsertCoupon,
  writeClipped,
} from "../../public/shopper/coupons.js";

function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

const kroger = {
  storeName: "Kroger",
  subtotal: 5,
  items: [
    { lineId: "0:oreo", name: "Oreo", price: 3, quantity: 1, itemTotal: 3 },
    { lineId: "1:cola", name: "Coca-Cola", price: 2, quantity: 1, itemTotal: 2 },
  ],
};

describe("shopper coupon pages", () => {
  it("matches the server coupon table", () => {
    assert.equal(COUPON_PAGES.length, serverPages.length);
    for (const page of serverPages) {
      const client = COUPON_PAGES.find((row) => row.storeName === page.storeName);
      assert.ok(client, page.storeName);
      assert.equal(client?.url, page.url);
      assert.equal(client?.label, page.label);
      assert.equal(client?.note, page.note);
      assert.equal(client?.kind, page.kind);
      for (const alias of page.aliases) {
        assert.equal(client?.aliases.includes(alias), true, `${page.storeName} ${alias}`);
      }
    }
    for (const store of STORE_HANDOFF_CONFIG) {
      assert.equal(couponPageFor(store.storeName)?.url, serverPageFor(store.storeName)?.url);
      assert.equal(couponPageFor(store.storeName)?.url, publicCouponLink(store.storeName)?.url);
    }
  });
});

describe("sale badge", () => {
  it("shows was-price and end date only when the line is already on sale", () => {
    assert.equal(saleBadge({ price: 2, regularPrice: 3 }), null);
    assert.deepEqual(saleBadge({ onSale: true, price: 2.14 }), { label: "On sale", was: "", ends: "" });
    assert.deepEqual(saleBadge({ onSale: true, price: 2.14, regularPrice: 2.14, saleEndsOn: "2026-11-08" }), {
      label: "On sale",
      was: "",
      ends: "ends Nov 8",
    });
    assert.equal(saleBadge({ onSale: true, price: 2.14, regularPrice: 2.64, saleEndsOn: "2026-11-08" })?.was, "was $2.64");
  });
});

describe("coupon checklist and savings", () => {
  it("lists the items on that store", () => {
    assert.deepEqual(couponChecklist(kroger.items), ["Oreo", "Coca-Cola"]);
    assert.equal(checklistSentence(["Oreo", "Coca-Cola"]), "Look for coupons on: Oreo and Coca-Cola.");
    assert.equal(checklistSentence([]), "Nothing on this store’s list yet.");
    assert.equal(shopCouponHint(kroger.items), "Look for coupons on: Oreo and Coca-Cola.");
  });

  it("keeps the typed coupon form behind Add a coupon", () => {
    const summary = couponSavingsSummary(
      [kroger],
      [{ id: "c1", storeName: "Kroger", lineId: "0:oreo", itemName: "Oreo", kind: "dollars" as const, amount: 1 }],
      "2026-10-26"
    );
    const html = storeCouponMarkup(kroger, {
      page: couponPageFor("Kroger"),
      rows: summary.byStore[0].rows,
      storeSummary: summary.byStore[0],
      canEnter: true,
      open: false,
    });
    assert.match(html, /Add a coupon/);
    assert.match(html, /coupon-form-wrap" hidden/);
    assert.match(html, /Check Kroger coupons before you shop/);
    assert.match(html, /Your coupon · Oreo · \$1\.00 off/);
    assert.ok(html.indexOf("your-coupon") < html.indexOf("<details"));
    assert.doesNotMatch(html, /<details[^>]* open/);
  });

  it("applies one coupon per line and never goes below zero", () => {
    const storage = memoryStorage();
    const first = parseCouponForm({
      storeName: "Kroger",
      lineId: "0:oreo",
      itemName: "Oreo",
      kind: "dollars",
      amount: "10",
      id: "c-oreo",
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    upsertCoupon(storage, first.coupon);
    const percent = parseCouponForm({
      storeName: "Kroger",
      lineId: "1:cola",
      itemName: "Coca-Cola",
      kind: "percent",
      amount: "50",
      id: "c-cola",
    });
    assert.equal(percent.ok, true);
    if (!percent.ok) return;
    upsertCoupon(storage, percent.coupon);
    const replaced = parseCouponForm({
      storeName: "Kroger",
      lineId: "0:oreo",
      itemName: "Oreo",
      kind: "dollars",
      amount: "1",
      id: "c-oreo-2",
    });
    assert.equal(replaced.ok, true);
    if (!replaced.ok) return;
    const saved = upsertCoupon(storage, replaced.coupon);
    assert.equal(saved.filter((row) => row.lineId === "0:oreo").length, 1);
    assert.equal(saved.find((row) => row.lineId === "0:oreo")?.amount, 1);

    const summary = couponSavingsSummary([kroger], readCoupons(storage), "2026-10-26");
    assert.equal(summary.savings, 2);
    assert.equal(summary.estimatedTotal, 3);
    assert.equal(summary.shelf, 5);
    const rows = couponsForStore(kroger, readCoupons(storage), "2026-10-26");
    assert.match(couponLineLabel(rows.find((row) => row.coupon.lineId === "0:oreo")), /Your coupon · Oreo · \$1\.00 off/);
    assert.match(couponLineLabel(rows.find((row) => row.coupon.lineId === "1:cola")), /50% off/);
  });

  it("leaves an expired coupon off the estimate", () => {
    const coupon = {
      id: "c-old",
      storeName: "Kroger",
      lineId: "0:oreo",
      itemName: "Oreo",
      kind: "dollars" as const,
      amount: 1,
      expiresOn: "2026-10-01",
    };
    assert.equal(couponExpired(coupon, "2026-10-26"), true);
    const summary = couponSavingsSummary([kroger], [coupon], "2026-10-26");
    assert.equal(summary.savings, 0);
    assert.equal(summary.estimatedTotal, 5);
    assert.match(couponLineLabel(summary.byStore[0].rows[0]), /expired Oct 1/);
  });

  it("accepts a trip line id that includes the item words", () => {
    const parsed = parseCouponForm({
      storeName: "Walmart",
      lineId: "0:large eggs",
      itemName: "Large Eggs",
      kind: "dollars",
      amount: "1",
      id: "c-eggs",
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.coupon.lineId, "0:large eggs");
  });

  it("rejects a blank amount and a percent over 100", () => {
    assert.equal(parseCouponForm({ storeName: "Kroger", lineId: "0:oreo", itemName: "Oreo", amount: "0" }).ok, false);
    assert.equal(
      parseCouponForm({ storeName: "Kroger", lineId: "0:oreo", itemName: "Oreo", kind: "percent", amount: "150" }).ok,
      false
    );
  });
});

describe("clipped reminder", () => {
  it("remembers the checkbox for one trip and one store", () => {
    const storage = memoryStorage();
    writeClipped(storage, "trip-a", "Kroger", true);
    writeClipped(storage, "trip-a", "Aldi", false);
    assert.equal(readClipped(storage, "trip-a").kroger, true);
    assert.equal(readClipped(storage, "trip-b").kroger, undefined);
    const left = removeCoupon(memoryStorage(), "missing");
    assert.deepEqual(left, []);
  });
});
