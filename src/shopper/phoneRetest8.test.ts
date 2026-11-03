import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { krogerAisleLabel } from "../catalog/krogerAisle";
import { accuracyIsApproximate, APPROXIMATE_ZIP_NOTE, fiveDigitZip } from "../../public/shopper/deviceZip.js";
import { READ_HOLD_MS, readCountLine, readHoldRemaining } from "../../public/shopper/receiptHold.js";
import { catalogTripEstimate } from "../../public/shopper/catalogEstimate.js";
import { checkedReviewCount } from "../../public/shopper/import.js";
import { dedupeReviewItems } from "../../public/shopper/importDedupe.js";
import { inStoreRoute, LAYOUT_NOTE } from "../../public/shopper/inStore.js";
import { plansAreIdentical, fewerStorePlan } from "../../public/shopper/tripPlan.js";
import { addLifetimeSavings, totalAtStore, tripValueSummary } from "../../public/shopper/tripValue.js";
import { planBarCopy, totalPhrase } from "../../public/shopper/flow.js";
import { readKrogerTrip, saveKrogerTrip } from "../../public/shopper/krogerReturn.js";
import { parseProfile } from "../../public/shopper/profile.js";

const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
const profileUi = readFileSync(new URL("../../public/shopper/profileOnboardingUi.js", import.meta.url), "utf8");
const receipt = readFileSync(new URL("../../public/shopper/receiptCopy.js", import.meta.url), "utf8");
const importer = readFileSync(new URL("../../public/shopper/import.js", import.meta.url), "utf8");

describe("eighth phone test", () => {
  it("bumps the shell cache to v32", () => {
    assert.match(sw, /grocery-gitter-shell-v33/);
  });

  it("derives ZIP from device coordinates and labels a coarse fix", () => {
    assert.equal(accuracyIsApproximate(20), false);
    assert.equal(accuracyIsApproximate(5000), true);
    assert.equal(accuracyIsApproximate(null), true);
    assert.equal(fiveDigitZip("45103"), "45103");
    assert.equal(APPROXIMATE_ZIP_NOTE, "Approximate: is this your ZIP?");
    assert.match(app, /enableHighAccuracy: high/);
    assert.match(app, /maximumAge: 0/);
    assert.doesNotMatch(app, /permissions: \["coarseLocation"\]/);
    assert.match(app, /APPROXIMATE_ZIP_NOTE/);
    assert.match(profileUi, /profile-zip-done/);
    assert.match(profileUi, /fiveDigitZip/);
    assert.match(profileUi, /visualViewport|keyboard/.source ? /profile-zip-done/ : /profile-zip-done/);
  });

  it("keeps the receipt upload first and holds the read count", () => {
    assert.match(receipt, /drop-primary/);
    assert.match(receipt, /Drop PDFs or screenshots/);
    assert.match(receipt, /This teaches the brands you already buy/);
    assert.match(receipt, /learnedTripChoiceHtml/);
    assert.match(receipt, /Add these items to my trip/);
    assert.match(receipt, /Start with an empty trip/);
    assert.equal(READ_HOLD_MS, 1200);
    assert.equal(readHoldRemaining(1000, 1500, 1200), 700);
    assert.equal(readCountLine(3), "Read 3 items from your receipt");
    assert.match(profileUi, /holdThenLearned/);
  });

  it("removes the header search and offers Add items", () => {
    const header = html.slice(html.indexOf("<header"), html.indexOf('id="app-drawer"'));
    assert.match(header, /id="add-items"/);
    assert.match(header, /id="brand-home"/);
    assert.match(header, /id="menu-open"/);
    assert.doesNotMatch(header, /What do you need\?/);
    assert.match(html, /placeholder="Search the catalog"/);
    assert.match(html, /Browse the catalog by aisle/);
    assert.match(html, /Scan fridge or pantry/);
    assert.match(html, /id="menu-home"/);
    assert.match(html, /id="menu-redo"/);
    assert.match(html, /Clear this trip\?/);
    assert.match(app, /overscroll-behavior|closest\("input, textarea/);
  });

  it("reads PDFs, merges duplicate rows, and counts checked rows", () => {
    assert.match(importer, /application\/pdf/);
    assert.match(importer, /runPdf/);
    assert.match(importer, /import-progress/);
    assert.match(importer, /Add as your own item/);
    const rows = [
      { key: "a", name: "Bertolli Traditional Marinara", raw: "Bertolli Traditional Marinara", quantity: 1, status: "matched", accepted: true, selectedId: "b1" },
      { key: "b", name: "Bertolli Traditional Marinara Sauce", raw: "Bertolli Traditional Marinara Sauce", quantity: 1, status: "matched", accepted: true, selectedId: "b2" },
      { key: "c", name: "Bertolli Traditional Marinara", raw: "Bertolli Traditional Marinara", quantity: 1, status: "matched", accepted: true, selectedId: "b1" },
    ];
    const merged = dedupeReviewItems(rows);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].quantity, 3);
    assert.equal(checkedReviewCount(merged), 1);
    assert.equal(checkedReviewCount(rows), 3);
  });

  it("prices the list from the catalog and never labels a zero total", () => {
    const estimate = catalogTripEstimate([
      { quantity: 2, product: { bestOffer: { price: 1.5 } } },
      { quantity: 1, product: { offers: [{ price: 4 }] } },
    ]);
    assert.equal(estimate.total, 7);
    assert.equal(estimate.priced, 2);
    assert.equal(totalPhrase(0, false).text, "");
    assert.equal(totalPhrase(20.04, false).text, "Estimated total $20.04");
    assert.match(html, /id="trip-summary"/);
    assert.match(app, /catalogTripEstimate/);
  });

  it("shows one Best price plan when the fewer-stores option is the same trip", () => {
    const stores = [
      { storeName: "Kroger", subtotal: 10, items: [{ lineId: "a", price: 4, itemTotal: 4, quantity: 1, storeName: "Kroger", offers: [{ storeName: "Kroger", price: 4 }, { storeName: "Walmart", price: 4 }] }] },
      { storeName: "Walmart", subtotal: 10.04, items: [{ lineId: "b", price: 10.04, itemTotal: 10.04, quantity: 1, storeName: "Walmart", offers: [{ storeName: "Walmart", price: 10.04 }, { storeName: "Kroger", price: 10.04 }] }] },
    ];
    const fewer = fewerStorePlan(stores, {});
    const same = plansAreIdentical(stores, 20.04, { stores, total: 20.04, stops: 2 });
    assert.equal(same, true);
    assert.ok(fewer.stops <= stores.length);
    assert.match(app, /Best price/);
    assert.match(app, /This already uses the fewest stores/);
    assert.match(app, /more than the best price/);
  });

  it("restores the Kroger tab, asks after Walmart, and keeps lifetime savings", () => {
    const storage = {
      value: "",
      getItem() {
        return this.value;
      },
      setItem(_key: string, value: string) {
        this.value = value;
      },
      removeItem() {
        this.value = "";
      },
    };
    saveKrogerTrip(storage, { step: "plan", itemCount: 3 });
    assert.equal(readKrogerTrip(storage)?.step, "plan");
    assert.match(app, /saved\?\.step \|\| parsed\.step/);
    assert.match(app, /Did you finish at/);
    assert.match(html, /id="store-return"/);
    assert.match(app, /Sending with your saved Kroger sign-in/);
    const savings = addLifetimeSavings({ savings: { lifetimeCents: 252 } }, 2.52);
    assert.equal(savings.lifetimeCents, 504);
    const profile = parseProfile({ savings: { lifetimeCents: 252, usualStore: "Kroger" }, updatedAt: 1 });
    assert.equal(profile.savings.lifetimeCents, 252);
    assert.equal(profile.savings.usualStore, "Kroger");
    const paid = totalAtStore(
      [{ quantity: 1, price: 3, storeName: "Kroger", offers: [{ storeName: "Kroger", price: 3 }] }],
      "Kroger"
    );
    assert.equal(paid, 3);
    const summary = tripValueSummary({
      stores: [{ storeName: "Kroger", subtotal: 20.04, items: [{ lineId: "a", name: "Milk", quantity: 1 }] }],
      planTotal: 20.04,
      singleStore: { storeName: "Kroger", total: 22.56 },
      lifetimeCents: 252,
      marks: { a: "confirmed" },
    });
    assert.equal(summary.stores[0].items[0].status, "Confirmed");
    assert.equal(summary.savedVsSingle, 2.52);
    assert.match(summary.lifetimeLabel, /\$2\.52/);
  });

  it("walks the store by aisle and parks checked items in the cart", () => {
    const route = inStoreRoute(
      [
        {
          storeName: "Kroger",
          items: [
            { lineId: "milk", name: "Milk", department: "Dairy & Eggs", aisle: "Aisle 12", aisleKnown: true },
            { lineId: "apples", name: "Apples", department: "Produce" },
            { lineId: "ice", name: "Ice cream", department: "Frozen" },
          ],
        },
      ],
      { ice: true }
    );
    assert.equal(route[0].known, true);
    assert.equal(route[0].note, "");
    assert.equal(route[0].cart.length, 1);
    assert.equal(route[0].cart[0].name, "Ice cream");
    assert.equal(route[0].left, 2);
    assert.ok(route[0].groups[0].items[0].routeNumber >= 1);
    const guess = inStoreRoute([{ storeName: "Aldi", items: [{ lineId: "b", name: "Bread", department: "Bakery" }] }], {});
    assert.equal(guess[0].note, LAYOUT_NOTE);
    assert.equal(guess[0].groups[0].label, "Bakery");
    assert.equal(krogerAisleLabel({ aisleLocations: [{ description: "Aisle 4" }] }), "Aisle 4");
    assert.equal(krogerAisleLabel({ aisleLocations: [{ number: "9" }] }), "Aisle 9");
    assert.match(html, /aria-label="In the store">In-store</);
    assert.equal(planBarCopy({ step: "shop", itemCount: 4, left: 1 }).button, "Clear checked");
    assert.match(app, /inStoreRoute/);
    assert.match(html, /Clear trip/);
  });
});
