import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { walmartAddToCartUrl } from "../pricing/walmartCartLink";
import { priceSourceLabel as serverPriceLabel, STORE_HANDOFF_CONFIG } from "../storeHandoffConfig";
import {
  applyTripEdits,
  formatItemLine,
  formatTripText,
  groupForAisle,
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
  tierForStore,
  tripFingerprint,
  walmartCartUrl,
  writeCheck,
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
      url: "https://www.aldi.us/store/aldi/search?q=Whole+Milk",
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
      url: "https://www.aldi.us/store/aldi/search?q=White+Bread",
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
    assert.equal(walmart?.handoff.action.label, "Open Walmart cart");
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

  it("keeps a shop-list action for a link store", () => {
    const next = applyTripEdits(stores, { moves: { "1:bread": "Target" } }, {});
    const target = next.stores.find((store) => store.storeName === "Target");
    assert.equal(target?.handoff.tier, "link");
    assert.equal(target?.handoff.action.label, "Shop this list at Target");
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
    assert.equal(text, "Aldi\n2 Whole Milk, 1 gal\n\nTarget\n1 White Bread");
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
