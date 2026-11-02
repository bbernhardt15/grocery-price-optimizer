import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { walmartAddToCartUrl } from "../pricing/walmartCartLink";
import { priceSourceLabel as serverPriceLabel, STORE_HANDOFF_CONFIG } from "../storeHandoffConfig";
import { couponSavingsSummary } from "../../public/shopper/coupons.js";
import {
  applyTripEdits,
  formatItemLine,
  formatTripText,
  groupForAisle,
  moveOptionLabel,
  priceSourceLabel,
  readChecks,
  readTripSnapshot,
  saveTripSnapshot,
  shareItemId,
  buildHandoff,
  segmentPriceLabel,
  consolidateStops,
  singleStoreSavings,
  tripStory,
  storeTiers,
  swapSentence,
  tierForStore,
  tripFingerprint,
  walmartCartUrl,
  writeCheck,
  writeItemCheck,
  readItemChecks,
  itemCheckKey,
  itemIsChecked,
  pruneStoresToList,
  numericWalmartId,
  emptyStoreNotes,
} from "../../public/shopper/tripPlan.js";

const milk = {
  query: "milk",
  lineId: "0:milk",
  name: "Whole Milk",
  brand: "Friendly Farms",
  storeName: "Aldi",
  price: 2.19,
  quantity: 2,
  itemTotal: 4.38,
  unit: "gal",
  normalizedUnit: "gal",
  size: "1 gal",
  department: "Dairy & Eggs",
  aisle: "Milk",
  priceSource: "weekly_ad",
  offers: [
    {
      storeName: "Aldi",
      name: "Whole Milk",
      brand: "Friendly Farms",
      price: 2.19,
      size: "1 gal",
      priceSource: "weekly_ad",
      department: "Dairy & Eggs",
      aisle: "Milk",
      url: "https://www.aldi.us/store/aldi/s?k=Whole+Milk",
    },
    {
      storeName: "Walmart",
      name: "Whole Milk",
      brand: "Great Value",
      price: 2.48,
      size: "1 gal",
      productId: "554433",
      priceSource: "live",
      department: "Dairy & Eggs",
      aisle: "Milk",
      url: "https://www.walmart.com/ip/554433",
    },
    {
      storeName: "Kroger",
      name: "Whole Milk",
      brand: "Kroger",
      price: 3.29,
      size: "1 gal",
      upc: "0001111041700",
      productId: "0001111041700",
      priceSource: "live",
      department: "Dairy & Eggs",
      aisle: "Milk",
      url: "https://www.kroger.com/search?query=0001111041700",
    },
  ],
};

const bread = {
  query: "bread",
  lineId: "1:bread",
  name: "White Bread",
  brand: "L'oven Fresh",
  storeName: "Aldi",
  price: 1.79,
  quantity: 1,
  itemTotal: 1.79,
  unit: "oz",
  normalizedUnit: "oz",
  department: "Bakery",
  aisle: "Bread",
  offers: [
    {
      storeName: "Aldi",
      name: "White Bread",
      brand: "L'oven Fresh",
      price: 1.79,
      department: "Bakery",
      aisle: "Bread",
      url: "https://www.aldi.us/store/aldi/s?k=White+Bread",
    },
    {
      storeName: "Target",
      name: "White Bread",
      brand: "Good & Gather",
      price: 1.99,
      department: "Bakery",
      aisle: "Bread",
      productId: "12345678",
      priceSource: "weekly_ad",
      url: "https://www.target.com/s?searchTerm=White+Bread",
    },
  ],
};

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

describe("handoff tiers stay aligned with config", () => {
  it("matches every configured store and tier", () => {
    const tiers = storeTiers();
    for (const row of STORE_HANDOFF_CONFIG) {
      assert.equal(tiers[row.storeName], row.tier);
      assert.equal(tierForStore(row.storeName), row.tier);
    }
    assert.equal(tierForStore("HEB"), "link");
    assert.equal(tierForStore("Giant Eagle"), "list");
    assert.equal(tierForStore("Some New Banner"), "list");
  });

  it("uses the same price-source words as the server", () => {
    for (const source of ["live", "cached_live", "weekly_ad", "cached_weekly_ad", "seed", "partner_feed", "mixed", undefined]) {
      assert.equal(priceSourceLabel(source), serverPriceLabel(source));
    }
    assert.equal(priceSourceLabel("live"), "Live shelf price");
    assert.equal(priceSourceLabel("weekly_ad"), "Weekly ad");
    assert.equal(
      segmentPriceLabel("Publix", [{ priceSource: "weekly_ad" }], { pricing: { source: "weekly_ad" } }),
      "Weekly ad, not shelf price"
    );
    assert.equal(segmentPriceLabel("Costco", [], {}), "Weekly ad, not shelf price");
    assert.equal(segmentPriceLabel("Aldi", [{ priceSource: "seed" }], { pricing: { source: "seed" } }), "Demo catalog");
    const rebuilt = buildHandoff(
      "Jewel-Osco",
      [{ name: "Milk", price: 3, quantity: 1, priceSource: "weekly_ad", url: "https://www.jewelosco.com/shop/search-results.html?q=Milk" }],
      {},
      { pricing: { source: "weekly_ad" } }
    );
    assert.equal(rebuilt.priceLabel, "Weekly ad, not shelf price");
    assert.equal(rebuilt.tier, "link");
  });
});

describe("applyTripEdits", () => {
  const stores = [
    { storeName: "Aldi", items: [milk, bread], subtotal: 6.17 },
  ];

  it("moves one line and re-totals without moving the rest", () => {
    const next = applyTripEdits(stores, { moves: { "0:milk": "Walmart" } }, {});
    const walmart = next.stores.find((store) => store.storeName === "Walmart");
    const aldi = next.stores.find((store) => store.storeName === "Aldi");
    assert.equal(walmart?.items[0].name, "Whole Milk");
    assert.equal(walmart?.items[0].price, 2.48);
    assert.equal(walmart?.items[0].itemTotal, 4.96);
    assert.equal(walmart?.items[0].lineId, "0:milk");
    assert.equal(aldi?.items.length, 1);
    assert.equal(aldi?.items[0].name, "White Bread");
    assert.equal(next.total, 6.75);
    assert.equal(walmart?.handoff.action.type, "walmart_cart");
    assert.equal(walmart?.handoff.action.label, "Open in Walmart cart");
  });

  it("locks a store for every line that store can fill", () => {
    const next = applyTripEdits(stores, { lockedStore: "Kroger" }, { krogerCart: true });
    assert.equal(next.stores.length, 2);
    const kroger = next.stores.find((store) => store.storeName === "Kroger");
    assert.equal(kroger?.items.length, 1);
    assert.equal(kroger?.items[0].query, "milk");
    assert.equal(kroger?.subtotal, 6.58);
    assert.equal(kroger?.handoff.action.label, "Send to Kroger cart");
    assert.equal(kroger?.handoff.action.type, "kroger_cart");
    const aldi = next.stores.find((store) => store.storeName === "Aldi");
    assert.equal(aldi?.items[0].query, "bread");
  });

  it("lets an explicit move override the lock for that line", () => {
    const next = applyTripEdits(
      stores,
      { lockedStore: "Kroger", moves: { "0:milk": "Aldi" } },
      { krogerCart: true }
    );
    assert.equal(next.stores.length, 1);
    assert.equal(next.stores[0].storeName, "Aldi");
    assert.equal(next.total, 6.17);
  });

  it("keeps a sale on the store that has it and a coupon link on the handoff", () => {
    const eggs = {
      query: "eggs",
      lineId: "0:eggs",
      name: "Large Eggs",
      brand: "Great Value",
      storeName: "Walmart",
      price: 2.14,
      quantity: 1,
      itemTotal: 2.14,
      unit: "dozen",
      normalizedUnit: "dozen",
      onSale: true,
      regularPrice: 2.64,
      saleEndsOn: "2026-11-08",
      offers: [
        {
          storeName: "Walmart",
          name: "Large Eggs",
          brand: "Great Value",
          price: 2.14,
          onSale: true,
          regularPrice: 2.64,
          saleEndsOn: "2026-11-08",
          priceSource: "seed",
        },
        {
          storeName: "Aldi",
          name: "Large Eggs",
          brand: "Aldi",
          price: 1.89,
          regularPrice: 3,
          priceSource: "seed",
        },
      ],
    };
    const stayed = applyTripEdits([{ storeName: "Walmart", items: [eggs], subtotal: 2.14 }], {}, {});
    const walmartLine = stayed.stores[0].items[0];
    assert.equal(walmartLine.onSale, true);
    assert.equal(walmartLine.regularPrice, 2.64);
    assert.equal(walmartLine.saleEndsOn, "2026-11-08");
    assert.equal(stayed.stores[0].handoff.coupon?.url, "https://www.walmart.com/walmartcash");

    const moved = applyTripEdits(
      [{ storeName: "Walmart", items: [eggs], subtotal: 2.14 }],
      { moves: { "0:eggs": "Aldi" } },
      {}
    );
    const aldiLine = moved.stores[0].items[0];
    assert.equal(aldiLine.storeName, "Aldi");
    assert.equal(aldiLine.onSale, undefined);
    assert.equal(aldiLine.regularPrice, undefined);
    assert.equal(aldiLine.saleEndsOn, undefined);
    assert.equal(moved.stores[0].handoff.coupon?.url, "https://www.aldi.us/store/aldi/pages/weekly-specials");

    const lines = stayed.stores.flatMap((store) => store.items);
    const comparison = singleStoreSavings(lines);
    assert.equal(comparison.splitTotal, 2.14);
    assert.equal(comparison.singleStore?.storeName, "Aldi");
    assert.equal(comparison.savings, -0.25);
    const coupons = couponSavingsSummary(
      stayed.stores,
      [{ id: "c-eggs", storeName: "Walmart", lineId: "0:eggs", itemName: "Large Eggs", kind: "dollars", amount: 1 }],
      "2026-10-26"
    );
    assert.equal(coupons.savings, 1);
    assert.equal(singleStoreSavings(lines).splitTotal, comparison.splitTotal);
    assert.equal(singleStoreSavings(lines).savings, comparison.savings);
  });

  it("keeps a shop-list action for a link store", () => {
    const next = applyTripEdits(stores, { moves: { "1:bread": "Target" } }, {});
    const target = next.stores.find((store) => store.storeName === "Target");
    assert.equal(target?.handoff.tier, "link");
    assert.equal(target?.handoff.action.label, "Open Target list");
    assert.equal(target?.handoff.items[0].openLabel, "Open in Target");
    assert.match(target?.handoff.items[0].url ?? "", /target\.com/);
  });
});

describe("single-store savings and list text", () => {
  it("compares the split with the cheapest store that has every line", () => {
    const view = applyTripEdits(
      [{ storeName: "Aldi", items: [milk, bread], subtotal: 6.17 }],
      {},
      {}
    );
    const comparison = singleStoreSavings(view.stores.flatMap((store) => store.items));
    assert.equal(comparison.singleStore?.storeName, "Aldi");
    assert.equal(comparison.savings, 0);
    assert.match(comparison.note, /Same total as shopping only at Aldi/);

    const moved = applyTripEdits(
      [{ storeName: "Aldi", items: [milk], subtotal: 4.38 }],
      { moves: { "0:milk": "Walmart" } },
      {}
    );
    const worse = singleStoreSavings(moved.stores.flatMap((store) => store.items));
    assert.equal(worse.singleStore?.storeName, "Aldi");
    assert.ok(worse.savings < 0);
    assert.match(worse.note, /more than shopping only at Aldi/);
  });

  it("drops a stop that saves under $2 and skips a store that cannot price the list", () => {
    const cookies = {
      lineId: "a",
      name: "Cookies",
      storeName: "Walmart",
      price: 5,
      quantity: 1,
      itemTotal: 5,
      offers: [
        { storeName: "Walmart", price: 5, name: "Cookies" },
        { storeName: "Kroger", price: 5.2, name: "Cookies" },
      ],
    };
    const milkLine = {
      lineId: "b",
      name: "Milk",
      storeName: "Kroger",
      price: 1,
      quantity: 1,
      itemTotal: 1,
      offers: [
        { storeName: "Kroger", price: 1, name: "Milk" },
        { storeName: "Walmart", price: 1.5, name: "Milk" },
      ],
    };
    const merged = consolidateStops(
      [
        { storeName: "Walmart", items: [cookies], subtotal: 5 },
        { storeName: "Kroger", items: [milkLine], subtotal: 1 },
      ],
      2
    );
    assert.equal(merged.stores.length, 1);
    assert.equal(merged.stores[0]?.storeName, "Walmart");

    const worthIt = consolidateStops(
      [
        { storeName: "Walmart", items: [cookies], subtotal: 5 },
        {
          storeName: "Kroger",
          items: [{ ...milkLine, offers: [
            { storeName: "Kroger", price: 1, name: "Milk" },
            { storeName: "Walmart", price: 4, name: "Milk" },
          ] }],
          subtotal: 1,
        },
      ],
      2
    );
    assert.equal(worthIt.stores.length, 1);
    assert.equal(worthIt.stores[0]?.storeName, "Kroger");

    const comparison = singleStoreSavings([
      { ...cookies, offers: [{ storeName: "Walmart", price: 5, name: "Cookies" }] },
      milkLine,
    ]);
    assert.ok(comparison.incompleteStores.some((store) => store.missing.includes("Cookies")));
    const story = tripStory(singleStoreSavings([cookies, milkLine]), { stops: 2 });
    assert.match(story.headline, /You saved/);
    assert.match(story.effort, /extra stop/);
  });

  it("pastes one item per line with quantity and size", () => {
    assert.equal(formatItemLine(milk), "2 Whole Milk, 1 gal");
    assert.equal(formatItemLine({ ...bread, size: "" }), "1 White Bread");
    const text = formatTripText(
      [
        { storeName: "Aldi", items: [milk] },
        { storeName: "Target", items: [bread] },
      ],
      { headed: true }
    );
    assert.equal(text, "Aldi list\n2 Whole Milk, 1 gal\n\nTarget list\n1 White Bread");
    assert.equal(formatTripText([{ storeName: "Aldi", items: [milk] }]), "2 Whole Milk, 1 gal");
  });
});

describe("in-store checklist", () => {
  it("sorts by department and aisle and remembers checks offline", () => {
    const groups = groupForAisle([
      { name: "Chips", department: "Snacks", aisle: "Chips", lineId: "a" },
      { name: "Milk", department: "Dairy & Eggs", aisle: "Milk", lineId: "b" },
      { name: "Bread", department: "Bakery", aisle: "Bread", lineId: "c" },
      { name: "Yogurt", department: "Dairy & Eggs", aisle: "Yogurt", lineId: "d" },
    ]);
    assert.deepEqual(
      groups.map((group) => `${group.department}:${group.aisle}`),
      ["Dairy & Eggs:Milk", "Dairy & Eggs:Yogurt", "Bakery:Bread", "Snacks:Chips"]
    );

    const storage = memoryStorage();
    const tripId = tripFingerprint([{ items: [{ lineId: "b" }, { lineId: "c" }] }]);
    writeCheck(storage, tripId, "b", true);
    assert.equal(readChecks(storage, tripId).b, true);
    writeCheck(storage, tripId, "b", false);
    assert.equal(readChecks(storage, tripId).b, undefined);

    const aldiKey = itemCheckKey("Aldi", { name: "Friendly Farms Milk", query: "milk" });
    writeItemCheck(storage, aldiKey, true);
    assert.equal(readItemChecks(storage)[aldiKey], true);
    assert.equal(itemIsChecked({ name: "Friendly Farms Milk", query: "milk", lineId: "gone" }, "Aldi", {}, readItemChecks(storage)), true);
    assert.equal(
      itemIsChecked({ name: "Different Long Retailer Title", query: "milk", lineId: "9:milk", storeName: "Walmart" }, "Walmart", {}, readItemChecks(storage)),
      true
    );
    writeItemCheck(storage, itemCheckKey("Kroger", { query: "cinnamon pop-tarts", name: "Long Pop-Tart Title", lineId: "0:cinnamon pop-tarts" }), true);
    assert.equal(
      itemIsChecked({ query: "cinnamon pop-tarts", name: "Another Title", lineId: "4:cinnamon pop-tarts" }, "Target", {}, readItemChecks(storage)),
      true
    );
    writeItemCheck(storage, aldiKey, false);
    assert.equal(readItemChecks(storage)[aldiKey], undefined);
    assert.equal(numericWalmartId({ productId: "0099997200115", priceSource: "live" }), "");
    assert.equal(numericWalmartId({ productId: "10451234", priceSource: "live" }), "10451234");
    assert.deepEqual(
      emptyStoreNotes(["Kroger", "Walmart", "Target"], [{ storeName: "Kroger", items: [{ name: "Milk" }] }, { storeName: "Target", items: [] }]),
      ["Walmart: nothing cheapest here this trip", "Target: nothing cheapest here this trip"]
    );

    const pruned = pruneStoresToList(
      [
        { storeName: "Aldi", subtotal: 4.14, items: [{ name: "Milk", query: "milk", price: 2, quantity: 1, itemTotal: 2 }] },
        { storeName: "Walmart", subtotal: 13.26, items: [{ name: "Bread", query: "bread", price: 3, quantity: 1, itemTotal: 3 }] },
      ],
      []
    );
    assert.deepEqual(pruned, []);
    const kept = pruneStoresToList(
      [
        {
          storeName: "Aldi",
          subtotal: 9,
          items: [
            { name: "Milk", query: "milk", price: 2, quantity: 1, itemTotal: 2 },
            { name: "Chips", query: "chips", price: 4, quantity: 1, itemTotal: 4 },
          ],
        },
      ],
      [{ name: "milk", id: "m" }]
    );
    assert.equal(kept.length, 1);
    assert.equal(kept[0].items.length, 1);
    assert.equal(kept[0].items[0].query, "milk");
    assert.equal(kept[0].subtotal, 2);

    saveTripSnapshot(storage, { stores: [{ storeName: "Aldi", items: [milk] }] }, { lockedStore: "Aldi", moves: {} });
    const saved = readTripSnapshot(storage);
    assert.equal(saved.payload.stores[0].storeName, "Aldi");
    assert.equal(saved.edits.lockedStore, "Aldi");
  });

  it("builds a shared-list id the list API will accept", () => {
    assert.equal(shareItemId({ lineId: "0:whole milk" }, 0), "0:whole-milk");
    assert.match(shareItemId({ name: "Café latte!!" }, 3), /^caf-latte/);
  });
});

describe("move menu and swap labels", () => {
  const sixPack = "Coca-Cola Zero Sugar Soda Pop Bottles, 16.9 fl oz, 6 Pack";
  const twoLiter = "Coca-Cola Soda Pop Bottle, 2 Liters";
  const coke = {
    query: sixPack,
    lineId: "0:coke",
    name: sixPack,
    brand: "Coca-Cola",
    storeName: "Walmart",
    price: 5.52,
    quantity: 1,
    itemTotal: 5.52,
    unit: "floz",
    normalizedUnit: "floz",
    size: "16.9 fl oz, 6 Pack",
    exactStore: "Walmart",
    offers: [
      {
        storeName: "Walmart",
        name: sixPack,
        brand: "Coca-Cola",
        price: 5.52,
        size: "16.9 fl oz, 6 Pack",
      },
      {
        storeName: "Kroger",
        name: twoLiter,
        brand: "Coca-Cola",
        price: 2.89,
        size: "2 L",
        matchKind: "swap",
        substitutedFor: sixPack,
        swapNote: `Swapped: ${sixPack} is not sold at Kroger, using ${twoLiter}`,
      },
    ],
  };

  it("shows the savings against the current store and labels a different pack", () => {
    assert.equal(moveOptionLabel(coke.offers[1], 5.52), "Kroger · $2.89 swap (save $2.63)");
    assert.equal(moveOptionLabel(coke.offers[0], 5.52), "Walmart · $5.52");
    assert.equal(moveOptionLabel({ storeName: "Kroger", price: 2.89 }, 5.52), "Kroger · $2.89 (save $2.63)");
    assert.equal(moveOptionLabel({ storeName: "Walmart", price: 5.52 }, 2.89), "Walmart · $5.52 ($2.63 more)");
    assert.equal(
      swapSentence(sixPack, "Walmart", "Coca-Cola Zero Sugar Soda Pop Cans, 12 fl oz, 24 Pack"),
      "Swapped: Coca-Cola Zero Sugar Soda Pop Bottles, 16.9 fl oz, 6 Pack is not sold at Walmart, using Coca-Cola Zero Sugar Soda Pop Cans, 12 fl oz, 24 Pack"
    );
  });

  it("keeps the swap sentence after a move and can switch back to the exact item", () => {
    const moved = applyTripEdits([{ storeName: "Walmart", items: [coke], subtotal: 5.52 }], { moves: { "0:coke": "Kroger" } }, {});
    const line = moved.stores.find((store) => store.storeName === "Kroger")?.items[0];
    assert.equal(line?.name, twoLiter);
    assert.equal(line?.price, 2.89);
    assert.equal(line?.matchKind, "swap");
    assert.match(line?.swapNote ?? "", /is not sold at Kroger, using Coca-Cola Soda Pop Bottle, 2 Liters/);
    assert.equal(line?.exactStore, "Walmart");

    const back = applyTripEdits([{ storeName: "Walmart", items: [coke], subtotal: 5.52 }], { moves: {} }, {});
    const exact = back.stores[0]?.items[0];
    assert.equal(exact?.storeName, "Walmart");
    assert.equal(exact?.name, sixPack);
    assert.equal(exact?.matchKind, undefined);
    assert.equal(exact?.swapNote, undefined);
    assert.equal(exact?.exactStore, "Walmart");
  });

  it("does not treat a labeled swap as the store carrying the chosen item", () => {
    const comparison = singleStoreSavings([coke, bread]);
    assert.equal(comparison.singleStore, null);
  });
});

describe("walmart cart url", () => {
  it("matches the server builder", () => {
    const lines = [
      { itemId: "554433", quantity: 2 },
      { itemId: "998877", quantity: 1 },
    ];
    assert.equal(walmartCartUrl(lines), walmartAddToCartUrl(lines));
    assert.equal(
      walmartCartUrl(lines, "impact-42", { storeId: "2066", accessPointId: "6168c2e3-fc36-4827-98e6-d717d10af1d6" }),
      walmartAddToCartUrl(lines, "impact-42", {
        storeId: "2066",
        accessPointId: "6168c2e3-fc36-4827-98e6-d717d10af1d6",
      })
    );
  });
});
