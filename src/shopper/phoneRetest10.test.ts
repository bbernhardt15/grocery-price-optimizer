import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { isChromeIos } from "../../public/shopper/chromeIos.js";
import { inStoreRoute, LAYOUT_NOTE } from "../../public/shopper/inStore.js";
import { dedupeReviewLines } from "../../public/shopper/reviewList.js";
import { dedupeTripLines, dedupeTripStores, inStoreSendHtml } from "../../public/shopper/tripLines.js";
import { armHandoff, createReturnWatch, dismissReturnChoice, MIN_AWAY_MS, returnPromptDecision } from "../../public/shopper/returnPrompt.js";
import { allowTabChange, armClickShield, clickShielded, createTabGuard, noteTabInteraction, settleTabBoot } from "../../public/shopper/tabGuard.js";
import { bootTab, handoffTripRecord, readHandoffTrip, richerTrip, writeHandoffTrip } from "../../public/shopper/handoffRestore.js";
import { openHandoffSheet, releaseDocumentScroll, scrollRestoreOffset } from "../../public/shopper/sheetScroll.js";
import { homeProxyShouldShow, homeTransition, placeHomeProxy } from "../../public/shopper/homeButton.js";

const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../../public/styles.css", import.meta.url), "utf8");
const handoffPage = readFileSync(new URL("../../public/handoff.html", import.meta.url), "utf8");
const handoffTab = readFileSync(new URL("../../public/shopper/handoffTab.js", import.meta.url), "utf8");

const CRIOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1";

function sliceFn(source: string, name: string, next: string) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${next}`);
  assert.ok(start >= 0 && end > start, `${name} before ${next}`);
  return source.slice(start, end);
}

describe("tenth phone test", () => {
  it("shows the finish sheet once after a real CriOS handoff, not on scroll, touch, focus, or while cart-ready is open", () => {
    assert.equal(isChromeIos(CRIOS), true);
    let state = armHandoff(createReturnWatch(), { store: "Kroger", kind: "cart", at: 1_000 });
    for (const source of ["scroll", "touch", "focus", "pageshow", "storage", "message"]) {
      const decision = returnPromptDecision(state, {
        source,
        visibility: "visible",
        now: 5_000,
        cartReadyOpen: true,
      });
      assert.equal(decision.show, false, source);
      state = decision.state;
    }
    const flicker = returnPromptDecision(
      returnPromptDecision(state, { source: "visibility", visibility: "hidden", now: 6_000 }).state,
      { source: "visibility", visibility: "visible", now: 6_000 + MIN_AWAY_MS - 1, cartReadyOpen: false }
    );
    assert.equal(flicker.show, false);
    state = flicker.state;
    const reading = returnPromptDecision(
      returnPromptDecision(state, { source: "visibility", visibility: "hidden", now: 10_000 }).state,
      { source: "visibility", visibility: "visible", now: 20_000, cartReadyOpen: true, returnScreenOpen: true }
    );
    assert.equal(reading.show, false);
    assert.equal(reading.state.promptedAt, reading.state.armedAt);
    state = armHandoff(createReturnWatch(), { store: "Kroger", kind: "store", at: 30_000 });
    const back = returnPromptDecision(
      returnPromptDecision(state, { source: "visibility", visibility: "hidden", now: 31_000 }).state,
      { source: "visibility", visibility: "visible", now: 40_000, cartReadyOpen: false }
    );
    assert.equal(back.show, true);
    assert.equal(back.store, "Kroger");
    const again = returnPromptDecision(back.state, {
      source: "visibility",
      visibility: "visible",
      now: 50_000,
    });
    assert.equal(again.show, false);
    const open = sliceFn(app, "openStoreHandoff", "publishHandoff");
    assert.match(open, /armHandoff/);
    assert.doesNotMatch(open, /showStoreReturn/);
    assert.doesNotMatch(app, /addEventListener\("focus", \(\) => \{\s*if \(document\.visibilityState === "hidden"\) return;/);
    assert.doesNotMatch(app, /addEventListener\("pageshow", \(\) => \{\s*if \(sawAppHidden\) showWalmartReturn/);
    assert.match(app, /maybeShowReturnPrompt\("visibility"\)/);
    assert.match(app, /source: "visibility"/);
    const cart = sliceFn(app, "openCartReady", "shortenForSearch");
    assert.match(cart, /presentHandoffSheet/);
    assert.doesNotMatch(cart, /showModal/);
  });

  it("Not yet closes the sheet and later restores cannot move the tab", () => {
    assert.equal(dismissReturnChoice().step, null);
    assert.equal(dismissReturnChoice().close, true);
    const handler = app.slice(app.indexOf('$("store-return-no")'), app.indexOf('$("store-return-trip")'));
    assert.match(handler, /dismissReturnChoice\(\)/);
    assert.doesNotMatch(handler, /showStep/);
    let guard = createTabGuard();
    const boot = allowTabChange(guard, "boot");
    assert.equal(boot.allow, true);
    assert.equal(allowTabChange(boot.state, "handoff").allow, true);
    guard = noteTabInteraction(boot.state);
    guard = armClickShield(guard, 1_000);
    assert.equal(clickShielded(guard, 1_000 + 100), true);
    assert.equal(allowTabChange(guard, "restore").allow, false);
    assert.equal(allowTabChange(guard, "boot").allow, false);
    assert.equal(allowTabChange(guard, "handoff").allow, true);
    assert.equal(allowTabChange(guard, "user").allow, true);
    assert.equal(allowTabChange(settleTabBoot(createTabGuard()), "restore").allow, false);
    assert.match(sliceFn(app, "rehydrateTrip", "listenForTripTabs"), /flowStep === "plan"/);
    assert.doesNotMatch(sliceFn(app, "rehydrateTrip", "listenForTripTabs"), /flowStep = step/);
    assert.match(sliceFn(app, "showStep", "paintPlanBar"), /allowTabChange/);
    assert.match(app, /showStep\(landing, "handoff"\)/);
    assert.match(app, /showStep\("shop", "restore"\)/);
  });

  it("in-store checklist drops send actions and duplicate Head & Shoulders", () => {
    assert.equal(inStoreSendHtml(), "");
    const tripLines = readFileSync(new URL("../../public/shopper/tripLines.js", import.meta.url), "utf8");
    assert.match(tripLines, /dedupeReviewLines/);
    assert.equal(dedupeReviewLines(
      [
        { lineId: "a", name: "Head & Shoulders Classic Clean", upc: "190000000001", quantity: 1 },
        { lineId: "b", name: "Head & Shoulders Classic Clean Shampoo", upc: "190000000001", quantity: 1 },
      ],
      (item) => String(item.name)
    ).length, 1);
    const lines = dedupeTripLines(
      [
        { lineId: "a", name: "Head & Shoulders Classic Clean Shampoo", brand: "Head & Shoulders", size: "12.5 oz", quantity: 1, department: "Personal Care" },
        { lineId: "b", name: "Head & Shoulders Classic Clean", brand: "Head & Shoulders", size: "12.5 oz", quantity: 1, department: "Personal Care" },
        { lineId: "c", name: "Head & Shoulders Clinical Strength", brand: "Head & Shoulders", size: "8.5 oz", quantity: 1, department: "Personal Care" },
      ],
      { b: true }
    );
    assert.equal(lines.length, 2);
    const classic = lines.find((line) => String(line.name).includes("Classic"));
    assert.equal(classic?.quantity, 2);
    assert.equal(classic?.lineId, "b");
    const stores = dedupeTripStores(
      [{ storeName: "Kroger", items: lines, handoff: { action: { type: "kroger_cart", label: "Send to Kroger cart" } } }],
      { b: true }
    );
    const route = inStoreRoute(stores, { b: true });
    assert.equal(route[0].cart.length, 1);
    assert.equal(route[0].cart[0].name.includes("Classic"), true);
    assert.equal(route[0].groups.some((group) => group.items.some((item) => String(item.name).includes("Clinical"))), true);
    assert.equal(route[0].note, LAYOUT_NOTE);
    const known = inStoreRoute(
      [
        {
          storeName: "Kroger",
          items: [{ lineId: "milk", name: "Milk", department: "Dairy", aisle: "Aisle 12", aisleKnown: true }],
        },
      ],
      {}
    );
    assert.equal(known[0].groups[0].label, "Dairy · Aisle 12");
    assert.equal(known[0].note, "");
    const shop = sliceFn(app, "renderShop", "paintShopChrome");
    assert.match(shop, /dedupeTripStores/);
    assert.match(shop, /inStoreSendHtml\(\)/);
    assert.match(shop, /section\.note/);
    assert.doesNotMatch(shop, /primaryAction/);
    assert.doesNotMatch(shop, /krogerBannerHtml/);
    assert.doesNotMatch(shop, /Send to Kroger/);
    assert.doesNotMatch(shop, /data-kroger|data-walmart-cart|handoff-btn/);
  });

  it("the G mark is a home button with a pressed state that closes sheets", () => {
    const home = homeTransition(["store-return", "cart-ready", "settings-dialog", "profile-onboard"]);
    assert.deepEqual(home.closeDialogIds, ["store-return", "cart-ready", "settings-dialog", "profile-onboard"]);
    assert.equal(home.step, "add");
    assert.equal(home.reason, "user");
    assert.equal(homeProxyShouldShow(0), false);
    assert.equal(homeProxyShouldShow(2), false);
    const button = { style: {} as Record<string, string> };
    assert.equal(placeHomeProxy(button, { top: 12.4, left: 20.2, width: 40, height: 40 }), true);
    assert.equal(button.style.top, "12px");
    assert.equal(button.style.width, "42px");
    let guard = settleTabBoot(createTabGuard());
    assert.equal(allowTabChange(guard, "user").allow, true);
    assert.match(html, /id="brand-home"/);
    assert.doesNotMatch(html, /id="brand-home-proxy"/);
    assert.match(html, /Grocery Gitter home/);
    assert.match(sliceFn(app, "goHome", "syncHomeProxy"), /homeTransition/);
    assert.match(sliceFn(app, "goHome", "syncHomeProxy"), /dialog\[open\]/);
    assert.match(app, /\$\("brand-home"\)\?\.addEventListener\("click", \(\) => \{\s*goHome\(\);/);
    assert.match(sliceFn(app, "syncHomeProxy", "bindBrandPress"), /data-sheet-home/);
    assert.match(sliceFn(app, "syncHomeProxy", "bindBrandPress"), /goHome\(\)/);
    assert.match(css, /\.brand-home\.is-pressed \.brand-mark/);
    assert.match(css, /\.brand-home:active \.brand-mark/);
    assert.match(css, /scale\(0\.94\)/);
    assert.match(css, /\.sheet-brand/);
  });

  it("a lost tab restores the same Kroger, Walmart, and coupon trip once without a scroll jump", () => {
    const cases = [
      { store: "Kroger", kind: "cart" as const, step: "plan" as const },
      { store: "Kroger", kind: "store" as const, step: "plan" as const },
      { store: "Walmart", kind: "cart" as const, step: "shop" as const },
      { store: "Kroger", kind: "coupons" as const, step: "plan" as const },
    ];
    for (const sample of cases) {
      const bag = new Map<string, string>();
      const storage = {
        getItem: (key: string) => bag.get(key) ?? null,
        setItem: (key: string, value: string) => {
          bag.set(key, value);
        },
      };
      const record = handoffTripRecord({
        items: [{ id: "hs", name: "Head & Shoulders", quantity: 1 }],
        plan: { stores: [{ storeName: sample.store, items: [{ name: "Head & Shoulders" }] }] },
        step: sample.step,
        scroll: 220,
        store: sample.store,
        kind: sample.kind,
        at: 5_000,
      });
      assert.equal(writeHandoffTrip(storage, record), true);
      const restored = readHandoffTrip(storage, 6_000);
      assert.equal(restored?.store, sample.store);
      assert.equal(restored?.kind, sample.kind);
      assert.equal(restored?.step, sample.step);
      assert.equal(restored?.items[0].name, "Head & Shoulders");
      const kept = richerTrip(restored, { items: [], step: "add", savedAt: 9_000, handoff: { store: sample.store } });
      assert.equal(kept?.items.length, 1);
      assert.equal(kept?.step, sample.step);
      assert.equal(
        bootTab({ krogerStep: sample.kind === "cart" && sample.store === "Kroger" ? sample.step : "", handoffStep: sample.step, hasHandoff: true, storedStep: "add" }),
        sample.step
      );
    }
    let guard = createTabGuard();
    const first = allowTabChange(guard, "boot");
    assert.equal(first.allow, true);
    assert.equal(allowTabChange(first.state, "boot").allow, false);
    assert.equal(scrollRestoreOffset(220, 0, { touching: true }), null);
    assert.equal(scrollRestoreOffset(220, 0, { sheetOpen: true }), null);
    assert.equal(scrollRestoreOffset(220, 220, {}), null);
    assert.equal(scrollRestoreOffset(220, 0, {}), 220);
    let y = 80;
    let released = false;
    const dialog = {
      open: false,
      classList: { add() {} },
      show() {
        this.open = true;
        y = 0;
      },
    };
    assert.equal(
      openHandoffSheet(dialog, {
        readScroll: () => y,
        writeScroll: (next) => {
          y = next;
        },
        releaseScroll: () => {
          released = true;
        },
      }),
      true
    );
    assert.equal(y, 80);
    assert.equal(released, true);
    const doc = {
      body: { style: { overflow: "hidden", position: "fixed", top: "-80px", width: "100%" } },
      documentElement: { style: { overflow: "hidden", position: "fixed" } },
    };
    releaseDocumentScroll(doc);
    assert.equal(doc.body.style.overflow, "");
    assert.equal(doc.documentElement.style.overflow, "");
    assert.match(handoffPage, /overscroll-behavior-y: auto/);
    assert.doesNotMatch(handoffPage, /overflow:\s*hidden/);
    assert.doesNotMatch(handoffTab, /items:\s*\[\]/);
    assert.doesNotMatch(handoffTab, /visualViewport/);
    assert.match(css, /dialog\.handoff-sheet\[open\] \.sheet-body/);
    assert.match(css, /overscroll-behavior: contain/);
    assert.match(css, /html:has\(body\[data-handoff-sheet="open"\]\)/);
    assert.match(app, /scrollRestoreOffset/);
    assert.match(app, /richerTrip/);
    assert.match(sliceFn(app, "chooseBootStep", "goHome"), /bootTab/);
  });
});
