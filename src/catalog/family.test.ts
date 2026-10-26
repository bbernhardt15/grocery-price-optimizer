import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSavedListWrite } from "../auth/savedList";
import { parseItemWrite } from "../lists/sharedList";
import { demoBrowseProducts } from "./demoCatalog";
import {
  annotateBrowseProduct,
  chooseDefaultVariant,
  groupBrowseFamilies,
  groupingStats,
  identifyFamily,
  summarizeFamilyRows,
  type BrowseVariant,
} from "./family";
import { findBrowseProduct } from "./pinSelections";
import type { BrowseProduct, CatalogOffer } from "./types";

function offer(price: number, storeName: string, unitPrice?: number): CatalogOffer {
  return {
    storeName,
    price,
    onSale: false,
    availability: "in_stock",
    priceSource: "seed",
    ...(unitPrice != null ? { unitPrice, unitPriceText: `$${unitPrice.toFixed(2)}/gal` } : {}),
  };
}

function product(input: {
  id: string;
  name: string;
  brand: string;
  size?: string;
  price?: number;
  departmentId?: string;
  offers?: CatalogOffer[];
}): BrowseProduct {
  const offers = input.offers ?? [offer(input.price ?? 1, "Walmart")];
  const bestOffer = offers.slice().sort((a, b) => a.price - b.price)[0]!;
  return {
    id: input.id,
    name: input.name,
    brand: input.brand,
    imageUrls: [`/img/${input.id}.jpg`],
    departmentId: input.departmentId ?? "beverages",
    departmentName: "Beverages",
    ...(input.size ? { sizeLabel: input.size } : {}),
    storeBrand: false,
    offers,
    bestOffer,
  };
}

function keyOf(name: string, brand: string, size?: string, departmentId = "beverages"): string {
  return identifyFamily({ name, brand, size, departmentId }).familyKey;
}

describe("family identity", () => {
  it("puts Coca-Cola sizes and packs on one family and keeps flavors apart", () => {
    const classic = [
      ["Coca-Cola Classic 12 Pack 12 fl oz Cans", "12 pk 12 fl oz"],
      ["Coca-Cola 18 Pack 12 fl oz Cans", "18 pk 12 fl oz"],
      ["Coca-Cola Classic 8 Pack Mini Cans", "8 pk 7.5 fl oz"],
      ["Coca-Cola 2 Liter Bottle", "2 L"],
    ] as const;
    const keys = classic.map(([name, size]) => keyOf(name, "Coca-Cola", size));
    assert.equal(new Set(keys).size, 1);
    assert.notEqual(keys[0], keyOf("Diet Coke 12 Pack 12 fl oz Cans", "Coca-Cola", "12 pk 12 fl oz"));
    assert.notEqual(keys[0], keyOf("Coke Zero Sugar 12 Pack 12 fl oz Cans", "Coca-Cola", "12 pk 12 fl oz"));
    assert.notEqual(keys[0], keyOf("Cherry Coca-Cola 12 Pack 12 fl oz Cans", "Coca-Cola", "12 pk 12 fl oz"));
    assert.equal(
      keyOf("Coke Zero 12 Pack 12 fl oz Cans", "Coca-Cola", "12 pk 12 fl oz"),
      keyOf("Coca-Cola Zero Sugar 2 L Bottle", "Coca-Cola", "2 L")
    );
    assert.notEqual(
      keyOf("Coke Zero 12 Pack 12 fl oz Cans", "Coca-Cola"),
      keyOf("Diet Coke 12 Pack 12 fl oz Cans", "Coca-Cola")
    );

    const labels = classic.map(([name, size]) => identifyFamily({ name, brand: "Coca-Cola", size }).variant.label);
    assert.ok(labels.some((label) => label === "12 pk · 12 fl oz cans"));
    assert.ok(labels.some((label) => label === "18 pk · 12 fl oz cans"));
    assert.ok(labels.some((label) => label === "8 pk · 7.5 fl oz mini cans"));
    assert.ok(labels.some((label) => label === "2 L bottle"));
    assert.equal(identifyFamily({ name: classic[0][0], brand: "Coca-Cola", size: classic[0][1] }).familyName, "Coca-Cola");
    assert.equal(identifyFamily({ name: "Diet Coke 12 Pack 12 fl oz Cans", brand: "Coca-Cola" }).familyName, "Diet Coke");
    assert.equal(identifyFamily({ name: "Cherry Coca-Cola 2 L Bottle", brand: "Coca-Cola" }).familyName, "Cherry Coca-Cola");
  });

  it("keeps Pepsi 2 L and 2 x 1 L together without joining Coca-Cola", () => {
    const twoLiter = identifyFamily({ name: "Pepsi 2 L Bottle", brand: "Pepsi", size: "2 L", departmentId: "beverages" });
    const twin = identifyFamily({ name: "Pepsi 2 x 1 L Bottles", brand: "Pepsi", size: "2 x 1 L", departmentId: "beverages" });
    assert.equal(twoLiter.familyKey, twin.familyKey);
    assert.equal(twoLiter.variant.label, "2 L bottle");
    assert.equal(twin.variant.label, "2 pk · 1 L bottles");
    assert.notEqual(twoLiter.variant.signature, twin.variant.signature);
    assert.notEqual(twoLiter.familyKey, keyOf("Coca-Cola 2 Liter Bottle", "Coca-Cola", "2 L"));
    assert.notEqual(twoLiter.familyKey, keyOf("Diet Pepsi 2 L Bottle", "Pepsi", "2 L"));
  });

  it("groups Doritos Cool Ranch bag sizes and leaves Nacho Cheese alone", () => {
    const ranch = keyOf("Doritos Cool Ranch Tortilla Chips 9.25 oz Bag", "Doritos", "9.25 oz", "snacks");
    const party = keyOf("Doritos Cool Ranch Party Size 14.5 oz", "Doritos", "14.5 oz", "snacks");
    const nacho = keyOf("Doritos Nacho Cheese 9.25 oz Bag", "Doritos", "9.25 oz", "snacks");
    assert.equal(ranch, party);
    assert.notEqual(ranch, nacho);
    assert.equal(
      identifyFamily({ name: "Doritos Cool Ranch Tortilla Chips 9.25 oz Bag", brand: "Doritos", departmentId: "snacks" }).variant.label,
      "9.25 oz bag"
    );
    assert.match(
      identifyFamily({ name: "Doritos Cool Ranch Party Size 14.5 oz", brand: "Doritos", departmentId: "snacks" }).familyName,
      /Cool Ranch/
    );
    assert.doesNotMatch(
      identifyFamily({ name: "Doritos Cool Ranch Party Size 14.5 oz", brand: "Doritos", departmentId: "snacks" }).familyName,
      /Party/
    );
  });

  it("groups milk and eggs by fat or grade, not by the jug or the carton count", () => {
    const gallon = keyOf("Whole Milk", "Dairy Pure", "1 gal", "dairy-eggs");
    const half = keyOf("Whole Milk", "Dairy Pure", "0.5 gal", "dairy-eggs");
    const twoPercent = keyOf("2% Milk", "Dairy Pure", "1 gal", "dairy-eggs");
    const store = keyOf("Whole Milk", "Great Value", "1 gal", "dairy-eggs");
    const organic = keyOf("Organic Whole Milk", "Dairy Pure", "1 gal", "dairy-eggs");
    assert.equal(gallon, half);
    assert.notEqual(gallon, twoPercent);
    assert.notEqual(gallon, store);
    assert.notEqual(gallon, organic);
    assert.equal(identifyFamily({ name: "Whole Milk", brand: "Dairy Pure", size: "1 gal", departmentId: "dairy-eggs" }).variant.label, "1 gal");
    assert.equal(identifyFamily({ name: "Whole Milk", brand: "Dairy Pure", size: "0.5 gal", departmentId: "dairy-eggs" }).variant.label, "0.5 gal");

    const dozen = keyOf("Large White Eggs", "Eggland's Best", "12 ct", "dairy-eggs");
    const eighteen = keyOf("Large White Eggs, 18 Count", "Eggland's Best", "18 ct", "dairy-eggs");
    const brown = keyOf("Large Brown Eggs", "Eggland's Best", "12 ct", "dairy-eggs");
    const jumbo = keyOf("Jumbo Eggs", "Eggland's Best", "12 ct", "dairy-eggs");
    assert.equal(dozen, eighteen);
    assert.notEqual(dozen, brown);
    assert.notEqual(dozen, jumbo);
    assert.equal(
      identifyFamily({ name: "Large White Eggs", brand: "Eggland's Best", size: "12 ct", departmentId: "dairy-eggs" }).variant.label,
      "12 ct"
    );
    assert.equal(
      identifyFamily({ name: "Large White Eggs, 18 Count", brand: "Eggland's Best", size: "18 ct", departmentId: "dairy-eggs" }).variant.label,
      "18 ct"
    );
  });

  it("does not merge unrelated foods that share a brand or a package word", () => {
    assert.notEqual(
      keyOf("Honey Nut Cheerios 12.25 oz", "General Mills", "12.25 oz", "breakfast"),
      keyOf("Cheerios 12 oz", "General Mills", "12 oz", "breakfast")
    );
    assert.notEqual(
      keyOf("Club Soda 1 L Bottle", "Canada Dry", "1 L"),
      keyOf("Tonic Water 1 L Bottle", "Canada Dry", "1 L")
    );
    assert.match(identifyFamily({ name: "Club Soda 1 L Bottle", brand: "Canada Dry", size: "1 L" }).familyName, /Club Soda/);
    assert.match(identifyFamily({ name: "Baking Soda 1 lb", brand: "Arm & Hammer", size: "1 lb", departmentId: "pantry" }).familyName, /Baking Soda/);
    assert.notEqual(
      keyOf("Oreo Chocolate Sandwich Cookies 14.3 oz", "Oreo", "14.3 oz", "snacks"),
      keyOf("Oreo Mini Chocolate Sandwich Cookies 3 oz", "Oreo", "3 oz", "snacks")
    );
  });
});

describe("family tiles", () => {
  const coke12 = product({
    id: "upc:coke12",
    name: "Coca-Cola Classic 12 Pack 12 fl oz Cans",
    brand: "Coca-Cola",
    size: "12 pk 12 fl oz",
    price: 7.48,
  });
  const coke2 = product({
    id: "upc:coke2",
    name: "Coca-Cola 2 Liter Bottle",
    brand: "Coca-Cola",
    size: "2 L",
    price: 2.48,
  });
  const mini = product({
    id: "upc:cokemini",
    name: "Coca-Cola Classic 8 Pack Mini Cans",
    brand: "Coca-Cola",
    size: "8 pk 7.5 fl oz",
    price: 4.98,
  });
  const diet = product({
    id: "upc:diet",
    name: "Diet Coke 12 Pack 12 fl oz Cans",
    brand: "Coca-Cola",
    size: "12 pk 12 fl oz",
    price: 7.28,
  });

  it("returns one tile per family with a best-value default", () => {
    const tiles = groupBrowseFamilies([coke12, diet, coke2, mini]);
    assert.equal(tiles.length, 2);
    const classic = tiles.find((tile) => tile.familyName === "Coca-Cola");
    assert.ok(classic);
    assert.equal(classic?.variants.length, 3);
    assert.equal(classic?.defaultVariantId, "upc:coke2");
    assert.equal(classic?.variantLabel, "2 L bottle");
    assert.equal(classic?.id, "upc:coke2");
    assert.equal(classic?.priceFrom, 2.48);
    assert.equal(classic?.priceTo, 7.48);
    assert.deepEqual(
      classic?.variants.map((variant) => variant.id),
      ["upc:cokemini", "upc:coke2", "upc:coke12"]
    );
    const dietTile = tiles.find((tile) => tile.familyName === "Diet Coke");
    assert.equal(dietTile?.variants.length, 1);
    assert.equal(dietTile?.variants[0]?.id, "upc:diet");
  });

  it("keeps every master id so an older saved list still points at a variant", () => {
    const tiles = groupBrowseFamilies([coke12, coke2]);
    const ids = tiles.flatMap((tile) => tile.variants.map((variant) => variant.id));
    assert.deepEqual(ids.sort(), ["upc:coke12", "upc:coke2"]);
    const saved = parseSavedListWrite({
      listId: "savedlist1",
      items: [{ id: "upc:coke12", itemId: "upc:coke12", name: "Coca-Cola Classic 12 Pack 12 fl oz Cans", quantity: 2, sizeLabel: "12 fl oz" }],
    });
    assert.equal("error" in saved, false);
    if ("error" in saved) return;
    assert.equal(saved.items[0]?.id, "upc:coke12");
    assert.equal(saved.items[0]?.quantity, 2);
    const shared = parseItemWrite(
      {
        itemId: "upc:coke12",
        catalogId: "upc:coke12",
        name: "Coca-Cola Classic 12 Pack 12 fl oz Cans",
        quantity: 2,
        checked: false,
        writtenAt: Date.now(),
      },
      Date.now()
    );
    assert.equal("error" in shared, false);
    if ("error" in shared) return;
    assert.equal(shared.catalogId, "upc:coke12");
    const found = findBrowseProduct({ name: "Coca-Cola", quantity: 2, catalogId: "upc:coke12", brand: "Coca-Cola" }, [coke12, coke2]);
    assert.equal(found?.id, "upc:coke12");
    const annotated = annotateBrowseProduct(coke12);
    assert.equal(annotated.id, "upc:coke12");
    assert.equal(annotated.catalogName, coke12.name);
    assert.equal(annotated.variantLabel, "12 pk · 12 fl oz cans");
  });

  it("falls back to the common package when no size can be priced per unit", () => {
    const plain = (id: string, name: string): BrowseVariant => ({
      ...product({ id, name, brand: "Store", price: 3, departmentId: "pantry" }),
      label: name,
      count: null,
      unitSize: null,
      totalSize: null,
      container: null,
      sizeCode: null,
      price: 3,
      storeName: "Walmart",
    });
    const solo = plain("a", "Mystery");
    assert.equal(chooseDefaultVariant([solo]).id, "a");
  });
});

describe("demo shelf grouping", () => {
  it("collapses the demo Coca-Cola, Doritos, milk, and egg duplicates", () => {
    const tiles = groupBrowseFamilies(demoBrowseProducts());
    const coke = tiles.find((tile) => tile.brand === "Coca-Cola" && tile.familyName === "Coca-Cola");
    assert.ok(coke);
    assert.ok((coke?.variants.length ?? 0) >= 4);
    assert.ok(coke?.variants.some((variant) => variant.label === "12 pk · 12 fl oz cans"));
    assert.equal(tiles.filter((tile) => tile.brand === "Coca-Cola" && tile.familyName === "Diet Coke").length, 1);
    const ranch = tiles.find((tile) => tile.familyName.includes("Cool Ranch"));
    assert.equal(ranch?.variants.length, 2);
    const milk = tiles.find((tile) => tile.brand === "Dairy Pure" && tile.familyName === "Whole Milk");
    assert.equal(milk?.variants.length, 2);
    const eggs = tiles.find((tile) => tile.brand === "Eggland's Best" && tile.familyName === "Large Eggs");
    assert.equal(eggs?.variants.length, 2);
    const stats = groupingStats(tiles);
    assert.ok(stats.groupedFamilies >= 4);
    assert.ok(stats.groupedShare > 0 && stats.groupedShare < 1);
    assert.equal(stats.products, demoBrowseProducts().length);
  });
});

describe("family sample summary", () => {
  it("counts multi-variant families without merging flavors", () => {
    const summary = summarizeFamilyRows(
      [
        { key: "a", name: "Coca-Cola Classic 12 Pack 12 fl oz Cans", brand: "Coca-Cola", size: "12 pk 12 fl oz", departmentId: "beverages" },
        { key: "b", name: "Coca-Cola 2 Liter Bottle", brand: "Coca-Cola", size: "2 L", departmentId: "beverages" },
        { key: "c", name: "Diet Coke 12 Pack 12 fl oz Cans", brand: "Coca-Cola", size: "12 pk 12 fl oz", departmentId: "beverages" },
      ],
      10
    );
    assert.equal(summary.scanned, 3);
    assert.equal(summary.families, 2);
    assert.equal(summary.groupedFamilies, 1);
    assert.equal(summary.groupedProducts, 2);
    assert.equal(summary.groupedShare, 2 / 3);
    const classic = summary.groups.find((group) => group.familyName === "Coca-Cola");
    assert.equal(classic?.count, 2);
    assert.equal(classic?.variants.length, 2);
  });
});
