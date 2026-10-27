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
  rankProductImages,
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
  imageUrls?: string[];
  offers?: CatalogOffer[];
}): BrowseProduct {
  const offers = input.offers ?? [offer(input.price ?? 1, "Walmart")];
  const bestOffer = offers.slice().sort((a, b) => a.price - b.price)[0]!;
  return {
    id: input.id,
    name: input.name,
    brand: input.brand,
    imageUrls: input.imageUrls ?? [`/img/${input.id}.jpg`],
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

  it("groups Doritos chips and keeps Cool Ranch and Nacho Cheese as flavors", () => {
    const ranch = identifyFamily({
      name: "Doritos Cool Ranch Tortilla Chips 9.25 oz Bag",
      brand: "Doritos",
      size: "9.25 oz",
      departmentId: "snacks",
    });
    const party = identifyFamily({
      name: "Doritos Cool Ranch Party Size 14.5 oz",
      brand: "Doritos",
      size: "14.5 oz",
      departmentId: "snacks",
    });
    const nacho = identifyFamily({
      name: "Doritos Nacho Cheese 9.25 oz Bag",
      brand: "Doritos",
      size: "9.25 oz",
      departmentId: "snacks",
    });
    assert.equal(ranch.familyKey, party.familyKey);
    assert.equal(ranch.familyKey, nacho.familyKey);
    assert.equal(ranch.flavor, party.flavor);
    assert.notEqual(ranch.flavor, nacho.flavor);
    assert.equal(ranch.flavorLabel, "Cool Ranch");
    assert.equal(nacho.flavorLabel, "Nacho Cheese");
    assert.equal(ranch.variant.label, "9.25 oz bag");
    assert.equal(party.variant.label, "14.5 oz · Party size");
    assert.match(party.familyName, /Cool Ranch/);
    assert.doesNotMatch(party.familyName, /Party/);
  });

  it("groups milk and eggs by fat or grade, not by the jug or the carton count", () => {
    const gallon = keyOf("Whole Milk", "Dairy Pure", "1 gal", "dairy-eggs");
    const half = keyOf("Whole Milk", "Dairy Pure", "0.5 gal", "dairy-eggs");
    const twoPercent = keyOf("2% Milk", "Dairy Pure", "1 gal", "dairy-eggs");
    const store = keyOf("Whole Milk", "Great Value", "1 gal", "dairy-eggs");
    const organic = keyOf("Organic Whole Milk", "Dairy Pure", "1 gal", "dairy-eggs");
    assert.equal(gallon, half);
    assert.equal(gallon, twoPercent);
    assert.equal(gallon, organic);
    assert.notEqual(gallon, store);
    assert.notEqual(
      identifyFamily({ name: "Whole Milk", brand: "Dairy Pure", size: "1 gal", departmentId: "dairy-eggs" }).flavor,
      identifyFamily({ name: "2% Milk", brand: "Dairy Pure", size: "1 gal", departmentId: "dairy-eggs" }).flavor
    );
    assert.equal(
      identifyFamily({ name: "Organic Whole Milk", brand: "Dairy Pure", size: "1 gal", departmentId: "dairy-eggs" }).flavorLabel,
      "Organic Whole"
    );
    assert.equal(identifyFamily({ name: "Whole Milk", brand: "Dairy Pure", size: "1 gal", departmentId: "dairy-eggs" }).variant.label, "1 gal");
    assert.equal(identifyFamily({ name: "Whole Milk", brand: "Dairy Pure", size: "0.5 gal", departmentId: "dairy-eggs" }).variant.label, "0.5 gal");

    const dozen = keyOf("Large White Eggs", "Eggland's Best", "12 ct", "dairy-eggs");
    const eighteen = keyOf("Large White Eggs, 18 Count", "Eggland's Best", "18 ct", "dairy-eggs");
    const brown = keyOf("Large Brown Eggs", "Eggland's Best", "12 ct", "dairy-eggs");
    const jumbo = keyOf("Jumbo Eggs", "Eggland's Best", "12 ct", "dairy-eggs");
    assert.equal(dozen, eighteen);
    assert.equal(dozen, brown);
    assert.equal(dozen, jumbo);
    assert.notEqual(
      identifyFamily({ name: "Large White Eggs", brand: "Eggland's Best", size: "12 ct", departmentId: "dairy-eggs" }).flavor,
      identifyFamily({ name: "Large Brown Eggs", brand: "Eggland's Best", size: "12 ct", departmentId: "dairy-eggs" }).flavor
    );
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
    const original = identifyFamily({
      name: "Oreo Chocolate Sandwich Cookies 14.3 oz",
      brand: "Oreo",
      size: "14.3 oz",
      departmentId: "snacks",
    });
    const mini = identifyFamily({
      name: "Oreo Mini Chocolate Sandwich Cookies 3 oz",
      brand: "Oreo",
      size: "3 oz",
      departmentId: "snacks",
    });
    assert.equal(original.familyKey, mini.familyKey);
    assert.equal(original.flavorLabel, "Original");
    assert.equal(mini.flavorLabel, "Mini");
    assert.notEqual(
      original.familyKey,
      keyOf("Oreo Ice Cream Cookies and Cream", "Oreo", "1.5 qt", "frozen")
    );
    assert.notEqual(original.familyKey, keyOf("Oreo O's Cereal", "Oreo", "17 oz", "breakfast"));
  });

  it("collapses the Oreo cookie wall into one family and keeps flavors as chips", () => {
    const names = [
      ["OREO Double Stuf Chocolate Sandwich Cookies, King Size Snack Pack, 4.1 oz", "4.1 oz", "Double Stuf"],
      ["OREO Double Stuf Chocolate Sandwich Cookies, 14.03 oz", "14.03 oz", "Double Stuf"],
      ["OREO Double Stuf Chocolate Sandwich Cookies, 15.35 oz", "15.35 oz", "Double Stuf"],
      ["OREO Double Stuf Golden Sandwich Cookies, 14.03 oz", "14.03 oz", "Double Stuf Golden"],
      ["OREO Double Stuf Gluten Free Chocolate Sandwich Cookies", "12.47 oz", "Double Stuf Gluten Free"],
      ["OREO Zero Sugar Chocolate Sandwich Cookies", "12.8 oz", "Zero Sugar"],
      ["OREO Chocolate Sandwich Cookies", "13.29 oz", "Original"],
      ["OREO Mint Chocolate Sandwich Cookies", "13.2 oz", "Mint"],
      ["OREO Thins Chocolate Sandwich Cookies", "10.1 oz", "Thins"],
      ["OREO Mini Chocolate Sandwich Cookies", "3 oz", "Mini"],
    ] as const;
    const keys = names.map(([name, size]) => keyOf(name, "Oreo", size, "snacks"));
    assert.equal(new Set(keys).size, 1);
    const flavors = names.map(([name, size]) => identifyFamily({ name, brand: "Oreo", size, departmentId: "snacks" }).flavorLabel);
    for (const expected of ["Double Stuf", "Double Stuf Golden", "Double Stuf Gluten Free", "Zero Sugar", "Original", "Mint", "Thins", "Mini"]) {
      assert.ok(flavors.includes(expected), expected);
    }
    const tiles = groupBrowseFamilies(
      names.map(([name, size], index) =>
        product({
          id: `upc:oreo${index}`,
          name,
          brand: "Oreo",
          size,
          price: 3 + index,
          departmentId: "snacks",
        })
      )
    );
    assert.equal(tiles.length, 1);
    assert.equal(tiles[0]?.familyName, "Oreo Cookies");
    assert.ok((tiles[0]?.flavors.length ?? 0) >= 8);
    assert.equal(
      identifyFamily({
        name: "OREO Double Stuf Chocolate Sandwich Cookies, King Size Snack Pack, 4.1 oz",
        brand: "Oreo",
        size: "4.1 oz",
        departmentId: "snacks",
      }).variant.label,
      "4.1 oz · King size"
    );
    assert.equal(
      identifyFamily({
        name: "OREO Double Stuf Chocolate Sandwich Cookies Family Size",
        brand: "Oreo",
        size: "1.11 lb",
        departmentId: "snacks",
      }).variant.label,
      "1.11 lb · Family size"
    );
    assert.equal(
      identifyFamily({
        name: "OREO Double Stuf Chocolate Sandwich Cookies Family Size",
        brand: "Oreo",
        size: "1.11 lb",
        departmentId: "snacks",
      }).flavorLabel,
      "Double Stuf"
    );
    const ice = product({
      id: "upc:oreoice",
      name: "OREO Ice Cream Cookies and Cream",
      brand: "Oreo",
      size: "1.5 qt",
      departmentId: "frozen",
    });
    const cereal = product({
      id: "upc:oreocereal",
      name: "OREO O's Cereal",
      brand: "Oreo",
      size: "17 oz",
      departmentId: "breakfast",
    });
    const split = groupBrowseFamilies([
      product({ id: "upc:oreocookie", name: names[6][0], brand: "Oreo", size: names[6][1], departmentId: "snacks" }),
      ice,
      cereal,
    ]);
    assert.equal(split.length, 3);
    assert.equal(new Set(split.map((tile) => tile.familyKey)).size, 3);
    assert.ok(split.some((tile) => tile.line === "cookies"));
    assert.equal(split.find((tile) => tile.line === "ice cream")?.familyName, "Oreo Ice Cream");
    assert.ok(split.some((tile) => tile.line === "cereal"));
    const shouted = groupBrowseFamilies([
      product({
        id: "upc:shout",
        name: "OREO Chocolate Sandwich Cookies",
        brand: "OREO",
        size: "13.29 oz",
        departmentId: "snacks",
      }),
      product({
        id: "upc:shout2",
        name: "OREO Mint Chocolate Sandwich Cookies",
        brand: "OREO",
        size: "13.2 oz",
        departmentId: "snacks",
      }),
    ]);
    assert.equal(shouted[0]?.familyName, "Oreo Cookies");
  });

  it("puts Gerber juice flavors on one tile and clothing sizes on one sweater", () => {
    const plain = identifyFamily({
      name: "Gerber Gerber Juice, 4 oz",
      brand: "Gerber",
      size: "4 oz",
      departmentId: "baby",
    });
    const pear = identifyFamily({
      name: "GERBER Pear Juice, 4 fl oz",
      brand: "GERBER",
      size: "4 fl oz",
      departmentId: "baby",
    });
    assert.equal(plain.familyKey, pear.familyKey);
    assert.equal(plain.line, "juice");
    assert.equal(plain.flavorLabel, "Original");
    assert.equal(pear.flavorLabel, "Pear");
    assert.equal(plain.variant.label, "4 oz");
    assert.equal(pear.variant.label, "4 fl oz");
    const juice = groupBrowseFamilies([
      product({ id: "upc:juice", name: "Gerber Gerber Juice, 4 oz", brand: "Gerber", size: "4 oz", price: 0.68, departmentId: "baby" }),
      product({ id: "upc:pear", name: "GERBER Pear Juice, 4 fl oz", brand: "GERBER", size: "4 fl oz", price: 0.72, departmentId: "baby" }),
    ]);
    assert.equal(juice.length, 1);
    assert.equal(juice[0]?.familyName, "Gerber Juice");
    assert.deepEqual(
      juice[0]?.flavors.map((flavor) => flavor.label).sort(),
      ["Original", "Pear"]
    );

    const xs = identifyFamily({
      name: "Way To Celebrate Dog Sweater, Orange Leafy Pumpkin, (XS)",
      brand: "Way To Celebrate",
      size: "XS",
      departmentId: "pet",
    });
    const medium = identifyFamily({
      name: "Way To Celebrate Dog Sweater, Orange Leafy Pumpkin, (Medium)",
      brand: "Way To Celebrate",
      size: "Medium",
      departmentId: "pet",
    });
    const dress = identifyFamily({
      name: "Way To Celebrate Dog Dress, Orange & Black Polka Dot Pumpkin Face, (XS)",
      brand: "Way To Celebrate",
      size: "XS",
      departmentId: "pet",
    });
    assert.equal(xs.familyKey, medium.familyKey);
    assert.notEqual(xs.familyKey, dress.familyKey);
    assert.equal(xs.variant.label, "XS");
    assert.equal(medium.variant.label, "Medium");
    assert.equal(xs.flavor, medium.flavor);
    const pets = groupBrowseFamilies([
      product({
        id: "upc:xs",
        name: "Way To Celebrate Dog Sweater, Orange Leafy Pumpkin, (XS)",
        brand: "Way To Celebrate",
        size: "XS",
        price: 0.75,
        departmentId: "pet",
      }),
      product({
        id: "upc:med",
        name: "Way To Celebrate Dog Sweater, Orange Leafy Pumpkin, (Medium)",
        brand: "Way To Celebrate",
        size: "Medium",
        price: 0.75,
        departmentId: "pet",
      }),
      product({
        id: "upc:dress",
        name: "Way To Celebrate Dog Dress, Orange & Black Polka Dot Pumpkin Face, (XS)",
        brand: "Way To Celebrate",
        size: "XS",
        price: 0.75,
        departmentId: "pet",
      }),
    ]);
    assert.equal(pets.length, 2);
    const sweater = pets.find((tile) => tile.variants.length === 2);
    assert.deepEqual(sweater?.variants.map((variant) => variant.label).sort(), ["Medium", "XS"]);
  });

  it("uses a front-of-pack photo and skips a nutrition panel for the same flavor", () => {
    const front = "https://www.kroger.com/product/images/xlarge/front/0004400003111";
    const nutrition = "https://www.kroger.com/product/images/xlarge/nutrition/0004400003111";
    const banner = "https://cdn.example/banner/oreo-sale.jpg";
    const ranked = rankProductImages([nutrition, banner, front]);
    assert.equal(ranked[0], front);
    const tiles = groupBrowseFamilies([
      product({
        id: "upc:king",
        name: "OREO Double Stuf Chocolate Sandwich Cookies, King Size Snack Pack, 4.1 oz",
        brand: "Oreo",
        size: "4.1 oz",
        price: 0.99,
        departmentId: "snacks",
        imageUrls: [nutrition],
      }),
      product({
        id: "upc:bag",
        name: "OREO Double Stuf Chocolate Sandwich Cookies, 14.03 oz",
        brand: "Oreo",
        size: "14.03 oz",
        price: 4.48,
        departmentId: "snacks",
        imageUrls: [front],
      }),
      product({
        id: "upc:golden",
        name: "OREO Double Stuf Golden Sandwich Cookies, 14.03 oz",
        brand: "Oreo",
        size: "14.03 oz",
        price: 4.48,
        departmentId: "snacks",
        imageUrls: ["https://www.kroger.com/product/images/xlarge/front/golden"],
      }),
    ]);
    assert.equal(tiles.length, 1);
    assert.equal(tiles[0]?.imageUrls[0], front);
    const golden = tiles[0]?.variants.find((variant) => variant.flavorLabel === "Double Stuf Golden");
    assert.match(golden?.imageUrls[0] ?? "", /golden/);
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
    const doritos = tiles.find((tile) => tile.brand === "Doritos" && tile.familyName === "Doritos Chips");
    assert.ok(doritos);
    assert.ok(doritos?.flavors.some((flavor) => flavor.label === "Cool Ranch"));
    assert.ok(doritos?.flavors.some((flavor) => flavor.label === "Nacho Cheese"));
    assert.equal(doritos?.variants.filter((variant) => variant.flavorLabel === "Cool Ranch").length, 2);
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
