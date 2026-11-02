import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { demoBrowseProducts } from "../catalog/demoCatalog";
import { matchImportItems } from "../import/matchImport";
import { parseImportText } from "../import/parseImportText";
import type { BrowseProduct, CatalogOffer } from "../catalog/types";

const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
const profile = readFileSync(new URL("../../public/shopper/profileOnboardingUi.js", import.meta.url), "utf8");
const kroger = readFileSync(new URL("../../public/shopper/krogerReturn.js", import.meta.url), "utf8");

describe("seventh phone retest regressions", () => {
  it("bumps the shell cache to v30 and keeps the Walmart cart button", () => {
    assert.match(sw, /grocery-gitter-shell-v30/);
    assert.match(app, /data-walmart-cart/);
    assert.match(app, /Open in Walmart cart/);
    assert.match(app, /startsWith\("custom:"\)/);
  });

  it("shows an editable ZIP and explains the Kroger handoff before leaving", () => {
    assert.match(profile, /Not right\? Edit it/);
    assert.match(profile, /zipContinueDecision/);
    assert.match(kroger, /Kroger will ask you to sign in once, then bring you right back/);
    assert.match(app, /saveKrogerTrip/);
    assert.match(app, /emptyCheckedStoreHtml/);
    assert.match(app, /totalPhrase/);
  });

  it("still matches cream cheese, protein powder, and Cap'n Crunch", () => {
    const shelf = regressionShelf();
    const cream = matchImportItems([line("cream cheese")], shelf).items[0];
    const powder = matchImportItems([line("protein powder")], shelf).items[0];
    const crunch = matchImportItems([line("Captain Crunch cereal")], shelf).items[0];
    assert.notEqual(cream?.status, "missing");
    assert.match(`${cream?.choices[0]?.product.catalogName || ""} ${cream?.choices[0]?.product.name || ""}`, /cream cheese/i);
    assert.notEqual(powder?.status, "missing");
    assert.match(`${powder?.choices[0]?.product.name || ""} ${powder?.choices[0]?.product.catalogName || ""}`, /protein powder/i);
    assert.notEqual(crunch?.status, "missing");
    assert.match(`${crunch?.choices[0]?.product.name || ""} ${crunch?.choices[0]?.product.catalogName || ""}`, /cap'?n crunch/i);
  });

  it("finds Kellogg's Pop-Tarts in the catalog and still allows a custom add", () => {
    const tarts = demoBrowseProducts().filter((product) => /pop-tarts/i.test(product.name));
    assert.ok(tarts.some((product) => /cherry/i.test(product.name) && /kellogg/i.test(product.brand)));
    assert.ok(tarts.some((product) => /cinnamon/i.test(product.name) && /kellogg/i.test(product.brand)));
    const spoken = parseImportText("cherry pop-tarts");
    const matched = matchImportItems(spoken, demoBrowseProducts());
    assert.notEqual(matched.items[0]?.status, "missing");
  });
});

function line(name: string) {
  return { raw: name, name, quantity: 1 };
}

function offer(): CatalogOffer {
  return { storeName: "Kroger", price: 3, onSale: false, availability: "in_stock", priceSource: "seed" };
}

function regressionShelf(): BrowseProduct[] {
  const row = (id: string, name: string, brand: string, departmentId: string): BrowseProduct => ({
    id,
    name,
    brand,
    imageUrls: [],
    departmentId,
    departmentName: departmentId,
    sizeLabel: "12 oz",
    storeBrand: false,
    offers: [offer()],
    bestOffer: offer(),
    upc: id,
  });
  return [
    row("brownie", "Mini Red Velvet Brownies with Cream Cheese Frosting", "Little Debbie", "snacks"),
    row("philly", "Original Cream Cheese", "Philadelphia", "dairy-eggs"),
    row("milk", "Carnation Breakfast Essentials Milk", "Carnation", "beverages"),
    row("whey", "Gold Standard Whey Protein Powder", "Optimum Nutrition", "pantry"),
    row("capn", "Cap'n Crunch Cereal", "Quaker", "breakfast"),
    row("toast", "Cinnamon Toast Crunch Cereal", "General Mills", "breakfast"),
  ];
}
