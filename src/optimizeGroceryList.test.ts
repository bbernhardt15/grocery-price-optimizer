import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoBrowseProducts } from "./catalog/demoCatalog";
import { pinnedRowsForSelections } from "./catalog/pinSelections";
import { optimizeGroceryList, optimizeSingleStore, type CatalogProduct } from "./optimizeGroceryList";

const catalog: CatalogProduct[] = [
  { name: "Whole Milk", brand: "Friendly Farms", storeName: "Aldi", price: 2.19, unit: "gal", normalizedUnit: "gal" },
  { name: "Whole Milk", brand: "Great Value", storeName: "Walmart", price: 2.48, unit: "gal", normalizedUnit: "gal" },
  { name: "White Bread", brand: "Great Value", storeName: "Walmart", price: 1.28, unit: "oz", normalizedUnit: "oz" },
  { name: "White Bread", brand: "L'oven Fresh", storeName: "Aldi", price: 1.79, unit: "oz", normalizedUnit: "oz" },
  { name: "Bananas", brand: "Fresh", storeName: "Aldi", price: 0.49, unit: "lbs", normalizedUnit: "lbs" },
  { name: "Bananas", brand: "Fresh", storeName: "Walmart", price: 0.58, unit: "lbs", normalizedUnit: "lbs" },
  { name: "Salted Butter", brand: "Good & Gather", storeName: "Target", price: 2.79, unit: "oz", normalizedUnit: "oz" },
  { name: "Salted Butter", brand: "Friendly Farms", storeName: "Aldi", price: 3.29, unit: "oz", normalizedUnit: "oz" },
];

describe("optimizeGroceryList", () => {
  it("maps each item to the cheapest store and groups the list by storeName", () => {
    const result = optimizeGroceryList(
      ["milk", "bread", "bananas", "butter"],
      ["Aldi", "Walmart", "Target"],
      catalog
    );

    assert.deepEqual(
      result.stores.map((store) => store.storeName),
      ["Aldi", "Target", "Walmart"]
    );

    const byStore = Object.fromEntries(
      result.stores.map((store) => [store.storeName, store])
    );

    assert.equal(byStore.Aldi.items[0].query, "milk");
    assert.equal(byStore.Aldi.items[0].price, 2.19);
    assert.equal(byStore.Aldi.items[0].quantity, 1);
    assert.equal(byStore.Aldi.items[0].itemTotal, 2.19);
    assert.equal(byStore.Aldi.items[1].query, "bananas");
    assert.equal(byStore.Aldi.subtotal, 2.68);

    assert.equal(byStore.Walmart.items[0].query, "bread");
    assert.equal(byStore.Walmart.items[0].price, 1.28);

    assert.equal(byStore.Target.items[0].query, "butter");
    assert.equal(byStore.Target.items[0].price, 2.79);

    assert.equal(result.total, 6.75);
    assert.deepEqual(result.unavailable, []);
    const milk = result.stores.find((store) => store.storeName === "Aldi")?.items.find((item) => item.query === "milk");
    assert.equal(milk?.lineId, "0:milk");
    assert.deepEqual(milk?.offers?.map((offer) => offer.storeName).sort(), ["Aldi", "Walmart"]);
    assert.equal(typeof milk?.department, "string");
  });

  it("only considers stores in the provided list", () => {
    const result = optimizeGroceryList(["milk"], ["Walmart"], catalog);

    assert.equal(result.stores.length, 1);
    assert.equal(result.stores[0].storeName, "Walmart");
    assert.equal(result.stores[0].items[0].price, 2.48);
  });

  it("records items that no in-scope store sells", () => {
    const result = optimizeGroceryList(
      ["milk", "saffron"],
      ["Aldi"],
      catalog
    );

    assert.deepEqual(result.unavailable, ["saffron"]);
    assert.equal(result.stores[0].items.length, 1);
  });

  it("breaks equal prices by store name so the pick is stable", () => {
    const tied: CatalogProduct[] = [
      { name: "Eggs", brand: "A", storeName: "Zed Mart", price: 2, unit: "count", normalizedUnit: "count" },
      { name: "Eggs", brand: "B", storeName: "Aisle 1", price: 2, unit: "count", normalizedUnit: "count" },
    ];

    const result = optimizeGroceryList(["eggs"], [], tied);
    assert.equal(result.stores[0].storeName, "Aisle 1");
  });

  it("returns an empty grouping for an empty grocery list", () => {
    const result = optimizeGroceryList([], ["Aldi"], catalog);
    assert.deepEqual(result, { stores: [], unavailable: [], total: 0 });
  });

  it("falls back to dropping Cereal before the first two words so Cheerios beats granola", () => {
    const cereal: CatalogProduct[] = [
      {
        name: "Honey Nut Cheerios",
        brand: "General Mills",
        storeName: "Kroger",
        price: 4.29,
        unit: "oz",
        normalizedUnit: "oz",
      },
      {
        name: "Honey Nut Granola",
        brand: "Kroger",
        storeName: "Kroger",
        price: 3.49,
        unit: "oz",
        normalizedUnit: "oz",
      },
    ];

    const result = optimizeGroceryList(
      ["Honey Nut Cheerios Cereal"],
      ["Kroger"],
      cereal
    );

    assert.equal(result.unavailable.length, 0);
    assert.equal(result.stores[0].items[0].name, "Honey Nut Cheerios");
    assert.equal(result.stores[0].items[0].query, "Honey Nut Cheerios Cereal");
    assert.equal(result.stores[0].items[0].price, 4.29);
  });

  it("falls back to the first two words when even the shortened FatSecret name is missing", () => {
    const cereal: CatalogProduct[] = [
      {
        name: "Honey Nut Granola",
        brand: "Kroger",
        storeName: "Kroger",
        price: 3.49,
        unit: "oz",
        normalizedUnit: "oz",
      },
    ];

    const result = optimizeGroceryList(
      ["Honey Nut Cheerios Cereal"],
      ["Kroger"],
      cereal
    );

    assert.equal(result.unavailable.length, 0);
    assert.equal(result.stores[0].items[0].name, "Honey Nut Granola");
    assert.equal(result.stores[0].items[0].price, 3.49);
  });

  it("matches FatSecret serving-size names to store bread without the (28g) token", () => {
    const bread: CatalogProduct[] = [
      {
        name: "Great Value White Sandwich Bread",
        brand: "Great Value",
        storeName: "Kroger",
        price: 1.29,
        unit: "oz",
        normalizedUnit: "oz",
      },
    ];

    const result = optimizeGroceryList(
      ["White Sandwich Bread (28g)"],
      ["Kroger"],
      bread
    );

    assert.deepEqual(result.unavailable, []);
    assert.equal(result.stores[0].items[0].name, "Great Value White Sandwich Bread");
    assert.equal(result.stores[0].items[0].price, 1.29);
  });

  it("prefers products that match every keyword before the two-word fallback", () => {
    const cereal: CatalogProduct[] = [
      {
        name: "Honey Nut Cheerios Cereal",
        brand: "General Mills",
        storeName: "Kroger",
        price: 4.99,
        unit: "oz",
        normalizedUnit: "oz",
      },
      {
        name: "Honey Nut Granola",
        brand: "Kroger",
        storeName: "Kroger",
        price: 3.49,
        unit: "oz",
        normalizedUnit: "oz",
      },
    ];

    const result = optimizeGroceryList(
      ["Honey Nut Cheerios Cereal"],
      ["Kroger"],
      cereal
    );

    assert.equal(result.stores[0].items[0].name, "Honey Nut Cheerios Cereal");
    assert.equal(result.stores[0].items[0].price, 4.99);
  });

  it("multiplies the cheapest unit price by the requested quantity", () => {
    const result = optimizeGroceryList(
      ["2 Milk", "Bread x2"],
      ["Aldi", "Walmart"],
      catalog
    );
    const byStore = Object.fromEntries(
      result.stores.map((store) => [store.storeName, store])
    );

    assert.equal(byStore.Aldi.items[0].quantity, 2);
    assert.equal(byStore.Aldi.items[0].price, 2.19);
    assert.equal(byStore.Aldi.items[0].itemTotal, 4.38);
    assert.equal(byStore.Aldi.subtotal, 4.38);

    assert.equal(byStore.Walmart.items[0].quantity, 2);
    assert.equal(byStore.Walmart.items[0].price, 1.28);
    assert.equal(byStore.Walmart.items[0].itemTotal, 2.56);

    assert.equal(result.total, 6.94);
  });

  it("picks plain honey over a cheaper honey-flavored food", () => {
    const honey: CatalogProduct[] = [
      {
        name: "Honey Nut Cheerios Cereal",
        brand: "General Mills",
        storeName: "Kroger",
        price: 3.49,
        unit: "oz",
        normalizedUnit: "oz",
        size: "12 oz",
      },
      {
        name: "Honey Roasted Peanuts",
        brand: "Planters",
        storeName: "Kroger",
        price: 2.99,
        unit: "oz",
        normalizedUnit: "oz",
        size: "16 oz",
      },
      {
        name: "Kroger Clover Honey",
        brand: "Kroger",
        storeName: "Kroger",
        price: 5.49,
        unit: "oz",
        normalizedUnit: "oz",
        size: "12 oz",
      },
      {
        name: "Great Value Honey",
        brand: "Great Value",
        storeName: "Walmart",
        price: 4,
        unit: "oz",
        normalizedUnit: "oz",
        size: "16 oz",
      },
    ];

    const result = optimizeGroceryList(["Honey"], ["Kroger", "Walmart"], honey);
    const pick = result.stores.flatMap((store) => store.items)[0];
    assert.equal(pick?.name, "Great Value Honey");
    assert.equal(pick?.storeName, "Walmart");
    assert.equal(pick?.price, 4);
    assert.equal(pick?.unitPriceText, "$4.00/lb");
  });

  it("compares milk by the gallon when the list does not name a size", () => {
    const milk: CatalogProduct[] = [
      {
        name: "Great Value Whole Milk",
        brand: "Great Value",
        storeName: "Walmart",
        price: 2,
        unit: "gal",
        normalizedUnit: "gal",
        size: "0.5 gal",
      },
      {
        name: "Kroger Vitamin D Whole Milk",
        brand: "Kroger",
        storeName: "Kroger",
        price: 3.5,
        unit: "gal",
        normalizedUnit: "gal",
        size: "1 gal",
      },
    ];

    const result = optimizeGroceryList(["milk"], ["Kroger", "Walmart"], milk);
    const pick = result.stores[0]?.items[0];
    assert.equal(pick?.name, "Kroger Vitamin D Whole Milk");
    assert.equal(pick?.price, 3.5);
    assert.equal(pick?.unitPriceText, "$3.50/gal");
    assert.equal(result.total, 3.5);
  });

  it("keeps the gallon when the shopper asked for one, even if the half gallon has a better unit price", () => {
    const milk: CatalogProduct[] = [
      {
        name: "Great Value Whole Milk",
        brand: "Great Value",
        storeName: "Walmart",
        price: 1.5,
        unit: "gal",
        normalizedUnit: "gal",
        size: "0.5 gal",
      },
      {
        name: "Kroger Vitamin D Whole Milk",
        brand: "Kroger",
        storeName: "Kroger",
        price: 3.5,
        unit: "gal",
        normalizedUnit: "gal",
        size: "1 gal",
      },
    ];

    const byUnit = optimizeGroceryList(["milk"], ["Kroger", "Walmart"], milk);
    assert.equal(byUnit.stores[0]?.items[0]?.name, "Great Value Whole Milk");
    assert.equal(byUnit.stores[0]?.items[0]?.unitPriceText, "$3.00/gal");

    const byRequest = optimizeGroceryList(
      ["gallon of milk"],
      ["Kroger", "Walmart"],
      milk
    );
    const pick = byRequest.stores[0]?.items[0];
    assert.equal(pick?.name, "Kroger Vitamin D Whole Milk");
    assert.equal(pick?.price, 3.5);
    assert.equal(pick?.unitPriceText, "$3.50/gal");
  });

  it("compares eggs per count, and respects a requested dozen", () => {
    const eggs: CatalogProduct[] = [
      {
        name: "Large Eggs",
        brand: "Great Value",
        storeName: "Walmart",
        price: 3,
        unit: "count",
        normalizedUnit: "count",
        size: "12 ct",
      },
      {
        name: "Large Eggs",
        brand: "Kroger",
        storeName: "Kroger",
        price: 3.6,
        unit: "count",
        normalizedUnit: "count",
        size: "18 ct",
      },
    ];

    const open = optimizeGroceryList(["eggs"], ["Kroger", "Walmart"], eggs);
    assert.equal(open.stores[0]?.items[0]?.storeName, "Kroger");
    assert.equal(open.stores[0]?.items[0]?.unitPriceText, "$0.20/ct");

    const dozen = optimizeGroceryList(["12 ct eggs"], ["Kroger", "Walmart"], eggs);
    const pick = dozen.stores[0]?.items[0];
    assert.equal(pick?.storeName, "Walmart");
    assert.equal(pick?.price, 3);
    assert.equal(pick?.unitPriceText, "$0.25/ct");
  });

  it("prefers chicken breast over cheaper chicken-flavored crackers", () => {
    const chicken: CatalogProduct[] = [
      {
        name: "Chicken Flavored Crackers",
        brand: "Kroger",
        storeName: "Kroger",
        price: 1.99,
        unit: "oz",
        normalizedUnit: "oz",
        size: "8 oz",
      },
      {
        name: "Boneless Skinless Chicken Breast",
        brand: "Simple Truth",
        storeName: "Kroger",
        price: 6.49,
        unit: "lbs",
        normalizedUnit: "lbs",
        size: "1 lb",
      },
    ];

    const result = optimizeGroceryList(["chicken"], ["Kroger"], chicken);
    assert.equal(result.stores[0]?.items[0]?.name, "Boneless Skinless Chicken Breast");
    assert.equal(result.stores[0]?.items[0]?.unitPriceText, "$6.49/lb");
  });

  it("prices the pinned browse product and can fill a missing store with a labeled substitute", () => {
    const products = demoBrowseProducts();
    const milk = products.find(
      (product) =>
        product.brand === "Dairy Pure" &&
        product.sizeLabel === "1 gal" &&
        product.name === "Whole Milk"
    );
    assert.ok(milk);
    const selection = [{ name: milk.name, quantity: 1, catalogId: milk.id, brand: milk.brand }];
    const exactOnly = optimizeGroceryList(
      ["1x Whole Milk"],
      [],
      pinnedRowsForSelections(selection, products, { allowSubstitutes: false })
    );
    assert.equal(exactOnly.stores[0]?.storeName, "Walmart");
    assert.equal(exactOnly.stores[0]?.items[0]?.matchKind, undefined);
    assert.equal(exactOnly.stores[0]?.items[0]?.price, 3.18);

    const withSubstitutes = optimizeGroceryList(
      ["1x Whole Milk"],
      [],
      pinnedRowsForSelections(selection, products, { allowSubstitutes: true })
    );
    const picked = withSubstitutes.stores.flatMap((store) => store.items);
    assert.equal(picked.length, 1);
    assert.equal(picked[0]?.storeName, "Walmart");
    assert.equal(picked[0]?.matchKind, undefined);
    assert.equal(picked[0]?.name, "Whole Milk");
    assert.equal(picked[0]?.brand, "Dairy Pure");
    assert.equal(picked[0]?.price, 3.18);
    assert.equal(picked[0]?.exactStore, "Walmart");
    const aldiMilk = picked[0]?.offers?.find((offer) => offer.storeName === "Aldi");
    assert.equal(aldiMilk?.matchKind, "swap");
    assert.equal(aldiMilk?.price, 2.19);
    assert.match(aldiMilk?.swapNote ?? "", /Swapped: Whole Milk is not sold at Aldi, using Whole Milk/);

    const pasta = products.find((product) => product.brand === "Barilla" && product.name === "Spaghetti Pasta");
    assert.ok(pasta);
    const pastaPlan = optimizeGroceryList(
      ["1x Spaghetti Pasta"],
      [],
      pinnedRowsForSelections(
        [{ name: pasta.name, quantity: 1, catalogId: pasta.id, brand: pasta.brand }],
        products,
        { allowSubstitutes: true }
      )
    );
    const pastaPick = pastaPlan.stores.flatMap((store) => store.items)[0];
    assert.equal(pastaPick?.storeName, "Walmart");
    assert.equal(pastaPick?.brand, "Barilla");
    assert.equal(pastaPick?.matchKind, undefined);
    assert.equal(pastaPick?.price, 1.48);
    const aldiPasta = pastaPick?.offers?.find((offer) => offer.storeName === "Aldi");
    assert.equal(aldiPasta?.matchKind, "swap");
    assert.equal(aldiPasta?.brand, "Reggano");
    assert.equal(aldiPasta?.price, 0.95);
  });

  it("keeps a selected product off a store that does not sell it when substitutes are off", () => {
    const products = demoBrowseProducts();
    const milk = products.find(
      (product) => product.brand === "Dairy Pure" && product.sizeLabel === "1 gal" && product.name === "Whole Milk"
    );
    assert.ok(milk);
    const rows = pinnedRowsForSelections(
      [{ name: milk.name, quantity: 1, catalogId: milk.id, brand: milk.brand }],
      products,
      { allowSubstitutes: false }
    );
    assert.equal(rows.some((row) => row.offerRole === "substitute"), false);
    const aldiOnly = optimizeGroceryList(["1x Whole Milk"], ["Aldi"], rows);
    assert.deepEqual(aldiOnly.unavailable, ["Whole Milk"]);
    assert.equal(aldiOnly.stores.length, 0);

    const withSwap = optimizeGroceryList(
      ["1x Whole Milk"],
      ["Aldi"],
      pinnedRowsForSelections(
        [{ name: milk.name, quantity: 1, catalogId: milk.id, brand: milk.brand }],
        products,
        { allowSubstitutes: true }
      )
    );
    const swapped = withSwap.stores[0]?.items[0];
    assert.equal(swapped?.storeName, "Aldi");
    assert.equal(swapped?.matchKind, "swap");
    assert.match(swapped?.swapNote ?? "", /Swapped: Whole Milk is not sold at Aldi, using /);
    assert.equal(swapped?.exactStore, undefined);
  });
});

describe("selected Coca-Cola packs", () => {
  const sixPack = "Coca-Cola Zero Sugar Soda Pop Bottles, 16.9 fl oz, 6 Pack";
  const cans = "Coca-Cola Zero Sugar Soda Pop Cans, 12 fl oz, 24 Pack";
  const twoLiter = "Coca-Cola Soda Pop Bottle, 2 Liters";

  function coke(partial: CatalogProduct): CatalogProduct {
    return {
      brand: "Coca-Cola",
      unit: "floz",
      normalizedUnit: "floz",
      ...partial,
    };
  }

  it("puts the same UPC at the cheaper store even when size text disagrees", () => {
    const result = optimizeGroceryList(
      [`1x ${sixPack}`],
      ["Kroger", "Walmart"],
      [
        coke({
          name: sixPack,
          storeName: "Kroger",
          price: 2.89,
          upc: "0004900004256",
          size: "16.9 fl oz",
          pinned: true,
          offerRole: "exact",
          sourceQuery: sixPack,
        }),
        coke({
          name: sixPack,
          storeName: "Walmart",
          price: 5.52,
          upc: "049000042566",
          size: "16.9 fl oz, 6 Pack",
          pinned: true,
          offerRole: "exact",
          sourceQuery: sixPack,
        }),
      ]
    );
    const pick = result.stores.flatMap((store) => store.items)[0];
    assert.equal(pick?.storeName, "Kroger");
    assert.equal(pick?.price, 2.89);
    assert.equal(pick?.name, sixPack);
    assert.equal(pick?.matchKind, undefined);
    assert.equal(pick?.swapNote, undefined);
    assert.deepEqual(
      pick?.offers?.map((offer) => ({ store: offer.storeName, price: offer.price, kind: offer.matchKind ?? "exact" })),
      [
        { store: "Kroger", price: 2.89, kind: "exact" },
        { store: "Walmart", price: 5.52, kind: "exact" },
      ]
    );
  });

  it("does not tag the same 6-pack as a substitute or lose it to a pricier Walmart row", () => {
    const lines = [
      { name: sixPack, kroger: 2.89, walmart: 5.52, krogerSize: "16.9 fl oz", walmartSize: "16.9 fl oz, 6 Pack", upc: "049000042566" },
      { name: cans, kroger: 8.99, walmart: 15.52, krogerSize: "12 fl oz", walmartSize: "12 fl oz, 24 Pack", upc: "049000028911" },
      { name: twoLiter, kroger: 1.67, walmart: 2.97, krogerSize: "2 L", walmartSize: "2 Liters", upc: "049000028904" },
    ];
    const catalog = lines.flatMap((line) => [
      coke({
        name: line.name,
        storeName: "Kroger",
        price: line.kroger,
        upc: `000${line.upc.slice(0, -1)}`,
        size: line.krogerSize,
        pinned: true,
        offerRole: "exact",
        sourceQuery: line.name,
      }),
      coke({
        name: line.name,
        storeName: "Walmart",
        price: line.walmart,
        upc: line.upc,
        size: line.walmartSize,
        offerRole: "substitute",
        substitutedFor: line.name,
        sourceQuery: line.name,
      }),
    ]);
    const result = optimizeGroceryList(
      lines.map((line) => `1x ${line.name}`),
      ["Kroger", "Walmart"],
      catalog
    );
    const picks = result.stores.flatMap((store) => store.items);
    assert.equal(picks.length, 3);
    for (const pick of picks) {
      assert.equal(pick.storeName, "Kroger", pick.name);
      assert.equal(pick.matchKind, undefined, pick.name);
      assert.equal(pick.swapNote, undefined, pick.name);
      const walmart = pick.offers?.find((offer) => offer.storeName === "Walmart");
      assert.equal(walmart?.matchKind, undefined, pick.name);
      assert.ok((walmart?.price ?? 0) > pick.price);
    }
    assert.equal(picks.find((pick) => pick.name === sixPack)?.price, 2.89);
    assert.equal(picks.find((pick) => pick.name === cans)?.price, 8.99);
    assert.equal(picks.find((pick) => pick.name === twoLiter)?.price, 1.67);
  });

  it("keeps a different pack out of the winning slot and labels it as a swap", () => {
    const result = optimizeGroceryList(
      [`1x ${sixPack}`],
      ["Kroger", "Walmart"],
      [
        coke({
          name: sixPack,
          storeName: "Walmart",
          price: 5.52,
          upc: "049000042566",
          size: "16.9 fl oz, 6 Pack",
          pinned: true,
          offerRole: "exact",
          sourceQuery: sixPack,
        }),
        coke({
          name: twoLiter,
          storeName: "Kroger",
          price: 2.89,
          upc: "049000028904",
          size: "2 L",
          offerRole: "substitute",
          substitutedFor: sixPack,
          sourceQuery: sixPack,
        }),
        coke({
          name: cans,
          storeName: "Walmart",
          price: 15.52,
          upc: "049000028911",
          size: "12 fl oz, 24 Pack",
          offerRole: "substitute",
          substitutedFor: sixPack,
          sourceQuery: sixPack,
        }),
      ]
    );
    const pick = result.stores.flatMap((store) => store.items)[0];
    assert.equal(pick?.storeName, "Walmart");
    assert.equal(pick?.name, sixPack);
    assert.equal(pick?.price, 5.52);
    assert.equal(pick?.matchKind, undefined);
    assert.equal(pick?.exactStore, "Walmart");
    const kroger = pick?.offers?.find((offer) => offer.storeName === "Kroger");
    assert.equal(kroger?.name, twoLiter);
    assert.equal(kroger?.price, 2.89);
    assert.equal(kroger?.matchKind, "swap");
    assert.equal(
      kroger?.swapNote,
      `Swapped: ${sixPack} is not sold at Kroger, using ${twoLiter}`
    );
    assert.equal(
      pick?.offers?.some((offer) => offer.storeName === "Walmart" && offer.name === cans),
      false
    );
  });

  it("uses a different pack only when the chosen item is not sold in scope", () => {
    const rows = [
      coke({
        name: sixPack,
        storeName: "Kroger",
        price: 2.89,
        upc: "049000042566",
        size: "16.9 fl oz, 6 Pack",
        pinned: true,
        offerRole: "exact",
        sourceQuery: sixPack,
      }),
      coke({
        name: cans,
        storeName: "Walmart",
        price: 15.52,
        upc: "049000028911",
        size: "12 fl oz, 24 Pack",
        offerRole: "substitute",
        substitutedFor: sixPack,
        sourceQuery: sixPack,
      }),
    ];
    const missing = optimizeGroceryList([`1x ${sixPack}`], ["Walmart"], rows);
    const swap = missing.stores[0]?.items[0];
    assert.equal(swap?.storeName, "Walmart");
    assert.equal(swap?.name, cans);
    assert.equal(swap?.price, 15.52);
    assert.equal(swap?.matchKind, "swap");
    assert.equal(
      swap?.swapNote,
      `Swapped: ${sixPack} is not sold at Walmart, using ${cans}`
    );
    assert.equal(swap?.offers?.[0]?.matchKind, "swap");

    const stocked = optimizeGroceryList([`1x ${sixPack}`], ["Kroger", "Walmart"], rows);
    const exact = stocked.stores.flatMap((store) => store.items)[0];
    assert.equal(exact?.storeName, "Kroger");
    assert.equal(exact?.price, 2.89);
    assert.equal(exact?.matchKind, undefined);
  });
});

describe("optimizeSingleStore", () => {
  it("picks the store that fills the most lines, then the lower total", () => {
    const full = optimizeSingleStore(["milk", "bread", "bananas", "butter"], ["Aldi", "Walmart", "Target"], catalog);
    assert.equal(full.stores.length, 1);
    assert.equal(full.stores[0]?.storeName, "Aldi");
    assert.equal(full.stores[0]?.items.length, 4);
    assert.equal(full.stores[0]?.items[0]?.lineId, "0:milk");
    assert.equal(full.total, 7.76);

    const tie = optimizeSingleStore(["milk", "bread"], ["Aldi", "Walmart"], catalog);
    assert.equal(tie.stores[0]?.storeName, "Walmart");
    assert.equal(tie.total, 3.76);
  });

  it("leaves every line unavailable when the catalog is empty", () => {
    const result = optimizeSingleStore(["milk"], ["Aldi"], []);
    assert.deepEqual(result.stores, []);
    assert.deepEqual(result.unavailable, ["milk"]);
    assert.equal(result.total, 0);
  });
});
