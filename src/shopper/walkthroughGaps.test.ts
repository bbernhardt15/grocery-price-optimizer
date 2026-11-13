import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { inStoreRoute } from "../../public/shopper/inStore.js";
import { learnedSummaryHtml, meatPreferenceHtml } from "../../public/shopper/receiptCopy.js";
import { reviewStoreCardHtml } from "../../public/shopper/reviewStoreCard.js";
import { sectionForEntry } from "../../public/shopper/listSections.js";
import { emptyBook, setOverride } from "../../public/shopper/themedLists.js";
import { detailHtml } from "../../public/shopper/themedListsUi.js";

describe("walkthrough gaps the audit still needed", () => {
  it("groups remembered eggs and milk by department", () => {
    assert.equal(sectionForEntry({ product: { name: "Large Eggs", familyName: "Large Eggs" } }), "Dairy & Eggs");
    assert.equal(sectionForEntry({ product: { name: "2% Milk", familyName: "2% Milk" } }), "Dairy & Eggs");
    assert.equal(sectionForEntry({ product: { name: "Bananas", familyName: "Bananas" } }), "Produce");
  });

  it("heads a Kroger walk with the department, and keeps the aisle", () => {
    const route = inStoreRoute(
      [
        {
          storeName: "Kroger",
          items: [
            { lineId: "milk", name: "Milk", department: "Dairy & Eggs", aisle: "Aisle 12", aisleKnown: true },
            { lineId: "apples", name: "Apples", department: "Produce", aisle: "Aisle 1", aisleKnown: true },
          ],
        },
      ],
      {}
    );
    assert.deepEqual(
      route[0].groups.map((group) => group.label),
      ["Dairy & Eggs · Aisle 12", "Produce · Aisle 1"]
    );
  });

  it("offers a cart popup button instead of only the accordion", () => {
    const html = reviewStoreCardHtml({
      name: "Kroger",
      countLabel: "1 line",
      total: "$2.19",
      actionHtml: "",
      itemsHtml: "<li>Eggs</li>",
    });
    assert.match(html, /data-cart-popup="Kroger"/);
    assert.match(html, /Open cart/);
    assert.match(html, /<details class="store-fold">/);
    assert.doesNotMatch(html, /<details class="store-fold" open/);
  });

  it("saves a themed line brand on that list", () => {
    const html = detailHtml({
      model: {
        id: "tailgate",
        title: "Football tailgate",
        mine: false,
        slots: [{ id: "burger-buns", label: "Buns", search: "buns", serves: 4, suggested: { name: "Buns", brand: "" } }],
      },
      book: emptyBook(),
      people: 4,
      quantities: {},
      confirmDelete: false,
      finder: "",
      escapeHtml: (value: string) => String(value),
    });
    assert.match(html, /data-slot-brand="burger-buns"/);
    assert.match(html, /Brand for this list/);
    const saved = setOverride(emptyBook(), "tailgate", "burger-buns", { name: "Buns", brand: "Martin's" }, 5);
    assert.equal(saved.overrides.tailgate["burger-buns"].brand, "Martin's");
  });

  it("lets a missing receipt department be saved instead of only described", () => {
    const html = learnedSummaryHtml([{ family: "eggs", label: "Eggs", mode: "brand", brand: "Eggland's" }], {});
    assert.doesNotMatch(html, /Not on this receipt/);
    assert.doesNotMatch(html, /data-missing-dept="produce"/);
    const meat = learnedSummaryHtml([{ family: "ground-beef", label: "Ground beef", mode: "cheapest" }], {
      lines: [{ name: "Ground Beef" }],
    });
    assert.doesNotMatch(meat, /Not on this receipt/);
    const prefs = meatPreferenceHtml("");
    assert.match(prefs, /data-meat-pref/);
    assert.match(prefs, /Use the lowest Meat &amp; Seafood price/);
    assert.match(prefs, /Leave Meat &amp; Seafood off/);
    assert.match(meatPreferenceHtml("never"), /Meat &amp; Seafood left off/);
    const css = readFileSync(new URL("../../public/styles.css", import.meta.url), "utf8");
    assert.match(css, /\.read-cart \{[\s\S]*transition: left 420ms linear/);
  });
});
