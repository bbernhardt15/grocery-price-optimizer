import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoBrowseProducts } from "../catalog/demoCatalog";
import { matchImportItems } from "./matchImport";
import type { ParsedImportItem } from "./parseImportText";

const products = demoBrowseProducts();

function line(partial: Partial<ParsedImportItem> & { name: string }): ParsedImportItem {
  return { raw: partial.raw || partial.name, quantity: partial.quantity ?? 1, ...partial };
}

function selected(name: string, extra: Partial<ParsedImportItem> = {}) {
  const result = matchImportItems([line({ name, ...extra })], products);
  const item = result.items[0];
  assert.ok(item);
  const product = item.choices.find((choice) => choice.product.id === item.selectedId)?.product;
  return { item, product };
}

describe("matchImportItems", () => {
  it("keeps a gallon of milk on the gallon, not the half gallon", () => {
    const { item, product } = selected("milk", { size: "gallon" });
    assert.ok(item.status === "matched" || item.status === "ambiguous");
    assert.equal(item.accepted, true);
    assert.match(`${product?.sizeLabel || ""} ${product?.variantLabel || ""} ${product?.catalogName || ""}`, /1 gal|gallon/i);
    assert.doesNotMatch(`${product?.sizeLabel || ""} ${product?.catalogName || ""}`, /0\.5|half/i);
    assert.ok(item.choices.length <= 3);
  });

  it("keeps an 18 count egg when several brands exist", () => {
    const { item, product } = selected("eggs", { size: "18 ct" });
    assert.ok(item.status === "matched" || item.status === "ambiguous");
    assert.match(`${product?.sizeLabel || ""} ${product?.catalogName || ""} ${product?.variantLabel || ""}`, /18/);
    assert.ok(item.choices.length >= 1);
    assert.ok(item.choices.length <= 3);
  });

  it("keeps Diet Coke 12 pack instead of classic cola", () => {
    const { item, product } = selected("Diet Coke", { size: "12 pack" });
    assert.equal(item.status, "matched");
    assert.match(product?.catalogName || product?.name || "", /diet coke/i);
    assert.match(`${product?.sizeLabel || ""} ${product?.variantLabel || ""} ${product?.catalogName || ""}`, /12/);
  });

  it("matches Oreos to the cookie, not the ice cream", () => {
    const { item, product } = selected("Oreos");
    assert.equal(item.status, "matched");
    assert.match(product?.familyName || product?.name || "", /oreo/i);
    assert.doesNotMatch(`${product?.familyName || ""} ${product?.catalogName || ""}`, /ice cream/i);
  });

  it("matches bananas and a UPC exactly", () => {
    const bananas = selected("bananas");
    assert.equal(bananas.item.status, "matched");
    assert.match(bananas.product?.name || "", /banana/i);

    const byUpc = matchImportItems([line({ name: "mystery", upc: "0099990000018" })], products);
    assert.equal(byUpc.items[0]?.status, "matched");
    assert.match(byUpc.items[0]?.choices[0]?.product.catalogName || "", /banana/i);
  });

  it("does not swap a missing brand for a different bread", () => {
    const { item } = selected("bread", { brand: "Dave's Killer" });
    assert.equal(item.accepted, false);
    assert.match(item.shelfNote || "", /Dave's Killer/);
    assert.ok(item.status === "ambiguous" || item.status === "missing");
  });

  it("leaves chicken thighs unmatched when the shelf only has breast", () => {
    const { item } = selected("chicken thighs");
    assert.equal(item.status, "missing");
    assert.equal(item.choices.length, 0);
    assert.equal(item.accepted, false);
  });

  it("counts found items and does not put a price on the decision", () => {
    const result = matchImportItems(
      [line({ name: "bananas" }), line({ name: "milk", size: "gallon" }), line({ name: "dragon fruit" })],
      products
    );
    assert.equal(result.total, 3);
    assert.equal(result.found, 2);
    assert.equal(result.items[2]?.status, "missing");
  });
});
