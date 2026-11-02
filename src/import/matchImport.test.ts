import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoBrowseProducts } from "../catalog/demoCatalog";
import type { BrowseProduct, CatalogOffer } from "../catalog/types";
import { matchImportItems } from "./matchImport";
import { reviewProductTitle } from "../../public/shopper/import.js";
import { parseImportText, type ParsedImportItem } from "./parseImportText";

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

  it("keeps cinnamon and cherry pop-tarts as different items", () => {
    const offer = (price: number): CatalogOffer => ({
      storeName: "Walmart",
      price,
      onSale: false,
      availability: "in_stock",
      priceSource: "seed",
    });
    const pastry = (id: string, name: string): BrowseProduct => ({
      id,
      name,
      brand: "Kellogg's",
      imageUrls: [],
      departmentId: "breakfast",
      departmentName: "Breakfast",
      sizeLabel: "8 ct",
      storeBrand: false,
      offers: [offer(3.48)],
      bestOffer: offer(3.48),
      upc: id,
    });
    const result = matchImportItems(
      [line({ name: "cinnamon pop-tarts" }), line({ name: "cherry pop-tarts" })],
      [pastry("cin", "Cinnamon Pop-Tarts"), pastry("che", "Cherry Pop-Tarts")]
    );
    assert.equal(result.total, 2);
    assert.equal(result.found, 2);
    assert.match(result.items[0]?.choices[0]?.product.catalogName || "", /cinnamon/i);
    assert.match(result.items[1]?.choices[0]?.product.catalogName || "", /cherry/i);
    assert.notEqual(result.items[0]?.selectedId, result.items[1]?.selectedId);
  });

  it("keeps the head noun and treats Captain Crunch as Cap'n Crunch", () => {
    const offer = (price: number): CatalogOffer => ({
      storeName: "Kroger",
      price,
      onSale: false,
      availability: "in_stock",
      priceSource: "seed",
    });
    const row = (id: string, name: string, brand: string, departmentId: string): BrowseProduct => ({
      id,
      name,
      brand,
      imageUrls: ["https://images.example/p.jpg"],
      departmentId,
      departmentName: departmentId,
      sizeLabel: "12 oz",
      storeBrand: false,
      offers: [offer(3)],
      bestOffer: offer(3),
      upc: id,
    });
    const shelf = [
      row("brownie", "Mini Red Velvet Brownies with Cream Cheese Frosting", "Little Debbie", "snacks"),
      row("philly", "Original Cream Cheese", "Philadelphia", "dairy-eggs"),
      row("milk", "Carnation Breakfast Essentials Milk", "Carnation", "beverages"),
      row("whey", "Gold Standard Whey Protein Powder", "Optimum Nutrition", "pantry"),
      row("simply", "Simply Juice", "Simply", "beverages"),
      row("oj", "Orange Juice", "Simply", "beverages"),
      row("apple", "Apple Juice", "Mott's", "beverages"),
      row("capn", "Cap'n Crunch Cereal", "Quaker", "breakfast"),
      row("toast", "Cinnamon Toast Crunch Cereal", "General Mills", "breakfast"),
      row("cherry", "Frosted Cherry Pop-Tarts", "Kellogg's", "breakfast"),
    ];
    const picked = (name: string) => {
      const result = matchImportItems([line({ name })], shelf);
      return result.items[0];
    };
    const cream = picked("cream cheese");
    assert.notEqual(cream?.status, "missing");
    assert.match(cream?.choices[0]?.product.catalogName || cream?.choices[0]?.product.name || "", /cream cheese/i);
    assert.doesNotMatch(cream?.choices[0]?.product.name || "", /brownie/i);
    const powder = picked("protein powder");
    assert.notEqual(powder?.status, "missing");
    assert.match(powder?.choices[0]?.product.name || "", /protein powder/i);
    assert.doesNotMatch(powder?.choices[0]?.product.name || "", /milk/i);
    const juice = picked("orange juice");
    assert.notEqual(juice?.status, "missing");
    assert.match(juice?.choices[0]?.product.catalogName || "", /orange/i);
    assert.match(reviewProductTitle(juice?.choices[0]?.product, "orange juice"), /orange/i);
    assert.doesNotMatch(reviewProductTitle({ familyName: "Simply Juice", catalogName: "Orange Juice", name: "Simply Juice" }, "orange juice"), /^Simply Juice$/i);
    const crunch = picked("Captain Crunch cereal");
    assert.notEqual(crunch?.status, "missing");
    assert.match(crunch?.choices[0]?.product.name || "", /cap'n crunch/i);
    const tart = picked("cinnamon pop-tarts");
    assert.notEqual(tart?.status, "missing");
    assert.match(tart?.choices[0]?.product.name || "", /pop-tarts/i);
  });

  it("matches the seventh phone list to Kellogg's, Graeter's, Kraft, and Velveeta", () => {
    const spoken = parseImportText(
      "cherry pop-tarts and cinnamon pop-tarts and black raspberry chip from Graters and let's get some Kraft macaroni and cheese and Velveeta Sheldon cheese"
    );
    const result = matchImportItems(spoken, products);
    assert.equal(result.total, 5);
    assert.equal(result.items.every((item) => item.status !== "missing" && item.choices.length > 0), true);
    const picked = (raw: RegExp) => result.items.find((item) => raw.test(item.raw || item.name));
    assert.match(picked(/cherry pop-tarts/i)?.choices[0]?.product.catalogName || "", /cherry pop-tarts/i);
    assert.match(picked(/cinnamon pop-tarts/i)?.choices[0]?.product.catalogName || "", /cinnamon pop-tarts/i);
    assert.equal(picked(/graeter/i)?.choices[0]?.product.brand, "Graeter's");
    assert.match(picked(/graeter/i)?.choices[0]?.product.name || "", /black raspberry/i);
    assert.equal(picked(/kraft/i)?.choices[0]?.product.brand, "Kraft");
    assert.equal(picked(/velveeta/i)?.choices[0]?.product.brand, "Velveeta");
    assert.match(picked(/velveeta/i)?.choices[0]?.product.name || "", /shells/i);
  });
});
