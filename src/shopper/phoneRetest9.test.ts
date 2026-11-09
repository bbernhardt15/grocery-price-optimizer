import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { krogerAisleLabel } from "../catalog/krogerAisle";
import { accuracyIsApproximate } from "../../public/shopper/deviceZip.js";
import { planBarCopy } from "../../public/shopper/flow.js";
import { inStoreRoute, LAYOUT_NOTE } from "../../public/shopper/inStore.js";
import { mergeKeptStorePrices, planChecklist } from "../../public/shopper/planProgress.js";
import { mergePastTrips, reuseLines, savePastTrip, tripReceipt } from "../../public/shopper/pastTrips.js";
import { applyLearnedChoice, learnedSummaryHtml } from "../../public/shopper/receiptCopy.js";
import { categoryDetailHtml } from "../../public/shopper/categoryStage.js";
import { setCategoryPreference } from "../../public/shopper/categoryPreference.js";
import { emptyProfile } from "../../public/shopper/profile.js";
import { buildTripAddList, quantityLabel, splitPackedQuantity, tripAddTotal, tripQuantityDefault } from "../../public/shopper/tripAdd.js";
import { callbackCanClose, emptyMustNotReplace, returnScreenCopy, tripRecord } from "../../public/shopper/tripSync.js";
import { suggestZipChoices } from "../../public/shopper/zipSuggest.js";

const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
const profileUi = readFileSync(new URL("../../public/shopper/profileOnboardingUi.js", import.meta.url), "utf8");
const past = readFileSync(new URL("../../public/shopper/pastTrips.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../../public/styles.css", import.meta.url), "utf8");
const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
const coupons = readFileSync(new URL("../../public/shopper/coupons.js", import.meta.url), "utf8");

describe("ninth phone test", () => {
  it("bumps the shell cache to v76", () => {
    assert.match(sw, /grocery-gitter-shell-v76/);
  });

  it("suggests nearby ZIPs and does not trust one census code", () => {
    assert.equal(accuracyIsApproximate(20), false);
    assert.equal(accuracyIsApproximate(500), true);
    const atLoveland = suggestZipChoices({ lat: 39.0916, lng: -84.1437, zip: "45202", approximate: true });
    assert.equal(atLoveland.zip, "45103");
    assert.ok(atLoveland.choices.includes("45103"));
    assert.ok(atLoveland.choices.length >= 2);
    assert.ok(atLoveland.choices.length <= 4);
    assert.match(profileUi, /suggestZipChoices/);
    assert.match(app, /approximate: true/);
    assert.match(profileUi, /id="profile-zip-choices"/);
    assert.match(css, /data-zip-typing="1"/);
    assert.match(css, /position: static/);
  });

  it("keeps the Teach Gitter drop card high contrast", () => {
    assert.match(css, /\.drop-zone\.drop-primary[\s\S]*background: #0e7a45/);
    assert.match(css, /\.drop-zone\.drop-primary \.drop-title,\s*\.drop-zone\.drop-primary \.muted \{ color: #ffffff; \}/);
    assert.match(css, /data-resolved="dark"\] \.drop-zone\.drop-primary[\s\S]*background: #d8ffe8/);
    assert.match(css, /color: #102117/);
  });

  it("offers Cheapest of my picks when several brands are selected", () => {
    const rows = [{ family: "cereal", label: "Cereal", mode: "cheapestPicks", brand: "Cheerios", brands: ["Cheerios", "Kellogg's"] }];
    const htmlRows = learnedSummaryHtml(rows, { editingFamily: "cereal", brandsByFamily: { cereal: ["Cheerios", "Kellogg's"] } });
    assert.match(htmlRows, /Cheapest of my picks/);
    assert.match(htmlRows, /Cheapest overall/);
    assert.match(htmlRows, /data-learned-mode="cheapestPicks"/);
    const kept = applyLearnedChoice(rows, { family: "cereal", mode: "cheapestPicks", brands: ["Cheerios", "Kellogg's"] });
    assert.equal(kept[0].mode, "cheapestPicks");
    const detail = categoryDetailHtml({
      category: { id: "cereal", label: "Cereal" },
      index: 0,
      total: 1,
      mode: "cheapestPicks",
      brand: "Cheerios",
      selectedBrands: ["Cheerios", "Kellogg's"],
      attributes: [],
      attributeChoices: [],
      brands: [{ brand: "Cheerios" }, { brand: "Kellogg's" }],
      askBrand: true,
      produce: false,
    });
    assert.match(detail, /data-buy="cheapestPicks"/);
    assert.match(detail, /Cheapest of my picks/);
    const profile = setCategoryPreference(emptyProfile(), { family: "cereal", mode: "cheapestPicks", brands: ["Cheerios", "Kellogg's"] });
    assert.equal(profile.categoryPreferences.cereal.mode, "cheapestPicks");
    assert.deepEqual(profile.categoryPreferences.cereal.brands, ["Cheerios", "Kellogg's"]);
  });

  it("adds a receipt as a selectable list with a typical quantity", () => {
    assert.equal(quantityLabel("Tampons", 6), "Tampons x6");
    assert.equal(tripQuantityDefault(6), 1);
    assert.equal(tripQuantityDefault(1), 1);
    const rows = buildTripAddList([
      { name: "Tampons", brand: "U by Kotex", quantity: 6, price: 12, family: "tampons", label: "Personal care" },
      { name: "Mystery", quantity: 4, price: 20, family: "" },
    ]);
    assert.equal(rows[0].label, "U by Kotex Tampons x6");
    assert.equal(rows[0].quantity, 1);
    assert.equal(rows[0].selected, false);
    assert.equal(rows[1].selected, false);
    const packed = splitPackedQuantity("Bloom Shirley Temple x2", 1);
    assert.equal(packed.name, "Bloom Shirley Temple");
    assert.equal(packed.quantity, 2);
    const shirley = buildTripAddList([{ name: "Bloom Shirley Temple x2", quantity: 1, price: 3 }]);
    assert.equal(shirley[0].name, "Bloom Shirley Temple");
    assert.equal(shirley[0].quantity, 2);
    assert.match(shirley[0].label, /x2/);
    assert.equal(tripAddTotal(rows), 0);
    assert.match(profileUi, /finish\(Date\.now\(\)\)/);
    assert.match(profileUi, /data-trip-pick/);
  });

  it("moves Add items to the right and hides the Review shop button", () => {
    const header = html.slice(html.indexOf("<header"), html.indexOf('id="app-drawer"'));
    assert.ok(header.indexOf('id="add-items"') > header.indexOf('id="brand-home"'));
    assert.match(header, /class="top-actions"/);
    assert.equal(planBarCopy({ step: "plan", itemCount: 4, hasPlan: true }).showButton, false);
    assert.match(css, /\.top-actions \{ margin-left: auto/);
  });

  it("names themed lists without blurbs and stacks sheets on a solid background", () => {
    const lists = readFileSync(new URL("../../public/shopper/themedListsUi.js", import.meta.url), "utf8");
    assert.match(lists, /themeIcon/);
    assert.doesNotMatch(lists.slice(lists.indexOf("export function listCardHtml"), lists.indexOf("export function myListCardHtml")), /list\.blurb/);
    assert.match(css, /dialog\.sheet, dialog\.list-sheet, dialog\.shelf-sheet \{ background: var\(--bg\)/);
    assert.match(css, /body\[data-browse="open"\] #start-here/);
  });

  it("shows a per-store price checklist and keeps a store's prices", () => {
    const checks = planChecklist(["Kroger", "Walmart"], { Kroger: { checked: 10, total: 10, done: true } });
    assert.equal(checks[0].done, true);
    assert.equal(checks[1].done, false);
    const merged = mergeKeptStorePrices(
      [{ storeName: "Kroger", subtotal: 40, items: [{ name: "Milk", query: "milk", price: 4, quantity: 1, itemTotal: 4 }] }],
      [{ storeName: "Walmart", subtotal: 3, items: [{ name: "Bread", query: "bread", price: 3, quantity: 1, itemTotal: 3 }] }],
      ["milk", "bread"]
    );
    assert.equal(merged.find((store) => store.storeName === "Kroger")?.subtotal, 4);
    assert.equal(merged.find((store) => store.storeName === "Walmart")?.subtotal, 3);
    assert.match(app, /planChecklistHtml/);
    assert.match(app, /Catalog estimate/);
  });

  it("syncs tabs and tells a handoff tab to return", () => {
    assert.equal(emptyMustNotReplace(3, 0, false), true);
    assert.equal(emptyMustNotReplace(3, 0, true), false);
    assert.equal(callbackCanClose({}), true);
    assert.equal(callbackCanClose(null), false);
    assert.match(returnScreenCopy("Kroger", "coupons").title, /Return to Grocery Gitter/);
    assert.equal(tripRecord([{ id: "milk" }], null, "plan", null).step, "plan");
    assert.match(app, /BroadcastChannel/);
    assert.match(app, /hydrateListFromStorage/);
    assert.match(app, /window\.opener\.postMessage/);
    assert.match(html, /id="handoff-return"/);
    assert.match(html, /id="cart-ready-trip"/);
    assert.match(app, /Did you finish clipping\?/);
  });

  it("says coupon clipping cannot be automated", () => {
    assert.match(coupons, /public developer API has no coupon or clip method/);
    assert.match(coupons, /does not offer a coupon-clip API/);
    assert.match(coupons, /data-leave-kind="coupons"/);
    assert.doesNotMatch(app, /clipAll|autoClip|scrapeCoupon/);
  });

  it("stores a receipt and can shop it again", () => {
    const storage = {
      value: "",
      getItem() {
        return this.value;
      },
      setItem(_key: string, value: string) {
        this.value = value;
      },
    };
    const receipt = tripReceipt({
      stores: [{ storeName: "Kroger", subtotal: 12.5, items: [{ name: "Milk", quantity: 1 }] }],
      total: 12.5,
      savedCents: 150,
      at: Date.UTC(2026, 10, 3),
    });
    savePastTrip(storage, receipt);
    const again = reuseLines(readFrom(storage));
    assert.equal(again[0].name, "Milk");
    assert.equal(again[0].quantity, 1);
    const merged = mergePastTrips([receipt], [receipt]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].stores[0].storeName, "Kroger");
    assert.match(html, /id="menu-past"/);
    assert.match(html, /id="past-trips-home"/);
    assert.match(past, /Reuse this list/);
    assert.match(app, /reuseTrip/);
  });

  it("walks known Kroger aisles and parks checked items", () => {
    const sample = {
      description: "Bananas",
      items: [{ aisleLocations: [{ description: "12", number: "12", side: "R" }] }],
    };
    assert.equal(krogerAisleLabel(sample), "Aisle 12");
    assert.equal(krogerAisleLabel({ aisleLocations: [{ aisleNumber: "4", aisleDescription: "Aisle 4" }] }), "Aisle 4");
    const route = inStoreRoute(
      [
        {
          storeName: "Kroger",
          items: [
            { lineId: "bananas", name: "Bananas", department: "Produce", aisle: "Aisle 1", aisleKnown: true },
            { lineId: "milk", name: "Milk", department: "Dairy", aisle: "Aisle 12", aisleKnown: true },
          ],
        },
        { storeName: "Walmart", items: [{ lineId: "bread", name: "Bread", department: "Bakery" }] },
      ],
      { bananas: true }
    );
    assert.equal(route[0].cart[0].name, "Bananas");
    assert.equal(route[0].groups[0].label, "Dairy · Aisle 12");
    assert.equal(route[0].note, "");
    assert.equal(route[1].note, LAYOUT_NOTE);
    assert.equal(route[1].groups[0].label, "Bakery");
    const mixed = inStoreRoute(
      [
        {
          storeName: "Walmart",
          items: [
            { lineId: "pasta", name: "Pasta", department: "Pantry" },
            { lineId: "soap", name: "Soap", department: "Personal Care" },
          ],
        },
      ],
      {}
    );
    assert.deepEqual(
      mixed[0].groups.map((group) => group.label),
      ["Pantry", "Personal Care"]
    );
    assert.equal(mixed[0].groups.some((group) => group.label === "Center store"), false);
    assert.match(app, /shopChecked/);
    assert.match(css, /#toast-action/);
    assert.match(css, /background: #fffdfb; color: #1c1917/);
    assert.match(html, /id="brand-home"/);
    assert.match(html, /id="menu-open"/);
    assert.match(app, /openTripSummary/);
  });
});

function readFrom(storage: { getItem(): string }) {
  const rows = JSON.parse(storage.getItem() || "[]");
  return rows[0];
}
