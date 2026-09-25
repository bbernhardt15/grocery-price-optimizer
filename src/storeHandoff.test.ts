import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StoreGroup } from "./optimizeGroceryList";
import {
  buildStoreHandoff,
  enrichOptimizeResult,
  formatTripSummary,
  krogerSearchUrl,
  targetSearchUrl,
  walmartSearchUrl,
  partnerSearchUrl,
  KROGER_CART_START_PATH,
} from "./storeHandoff";

const krogerMilk = {
  query: "milk",
  name: "Gallon of Milk",
  brand: "Kroger",
  storeName: "Kroger",
  price: 2.89,
  quantity: 2,
  itemTotal: 5.78,
  unit: "gal",
  normalizedUnit: "gal",
  locationId: "01400441",
  productId: "0001111041700",
  upc: "0001111041700",
};

const walmartBread = {
  query: "bread",
  name: "Loaf of Bread",
  brand: "Great Value",
  storeName: "Walmart",
  price: 1.28,
  quantity: 1,
  itemTotal: 1.28,
  unit: "count",
  normalizedUnit: "count",
};

const targetEggs = {
  query: "eggs",
  name: "Dozen Eggs",
  brand: "Good & Gather",
  storeName: "Target",
  price: 1.99,
  quantity: 1,
  itemTotal: 1.99,
  unit: "count",
  normalizedUnit: "count",
};

const aldiBananas = {
  query: "bananas",
  name: "Bananas",
  brand: "Fresh",
  storeName: "Aldi",
  price: 0.49,
  quantity: 3,
  itemTotal: 1.47,
  unit: "lbs",
  normalizedUnit: "lbs",
};

describe("store handoff URLs", () => {
  it("builds a Kroger search link from UPC when present", () => {
    assert.equal(
      krogerSearchUrl(krogerMilk),
      "https://www.kroger.com/search?query=0001111041700"
    );
  });

  it("falls back to the product name when Kroger has no UPC", () => {
    assert.equal(
      krogerSearchUrl({ name: "Gallon of Milk" }),
      "https://www.kroger.com/search?query=Gallon+of+Milk"
    );
  });

  it("builds Walmart and Target public search links", () => {
    assert.equal(
      walmartSearchUrl(walmartBread),
      "https://www.walmart.com/search?q=Loaf+of+Bread"
    );
    assert.equal(
      targetSearchUrl(targetEggs),
      "https://www.target.com/s?searchTerm=Dozen+Eggs"
    );
  });

  it("uses retailer product ids for Walmart and Target when live pricing returned them", () => {
    assert.equal(
      walmartSearchUrl({ name: "Whole Milk", productId: "554433" }),
      "https://www.walmart.com/ip/554433"
    );
    assert.equal(
      targetSearchUrl({ name: "Large Eggs", productId: "12345678" }),
      "https://www.target.com/p/-/A-12345678"
    );
  });
});

describe("formatTripSummary", () => {
  it("matches the 15 Kroger + 5 Walmart + 10 Target shape", () => {
    assert.equal(
      formatTripSummary([
        { storeName: "Kroger", itemCount: 15 },
        { storeName: "Walmart", itemCount: 5 },
        { storeName: "Target", itemCount: 10 },
      ]),
      "15 Kroger + 5 Walmart + 10 Target"
    );
  });

  it("describes an empty trip honestly", () => {
    assert.equal(formatTripSummary([]), "No stores matched this list.");
  });
});

describe("buildStoreHandoff", () => {
  it("uses Open at Kroger search deeplinks when shopper OAuth is not configured", () => {
    const group: StoreGroup = {
      storeName: "Kroger",
      items: [krogerMilk],
      subtotal: 5.78,
    };
    const handoff = buildStoreHandoff(group);

    assert.equal(handoff.itemCount, 2);
    assert.equal(handoff.subtotal, 5.78);
    assert.equal(handoff.items[0].upc, "0001111041700");
    assert.equal(handoff.items[0].locationId, "01400441");
    assert.equal(handoff.action.type, "search_deeplink");
    assert.equal(handoff.action.label, "Open at Kroger");
    assert.equal(handoff.action.status, "ready");
    assert.equal(handoff.action.url, krogerSearchUrl(krogerMilk));
    assert.match(handoff.action.detail ?? "", /authorization-code/i);
  });

  it("offers kroger_cart only when OAuth is configured and a UPC exists", () => {
    const group: StoreGroup = {
      storeName: "Kroger",
      items: [krogerMilk],
      subtotal: 5.78,
    };
    const handoff = buildStoreHandoff(group, {
      krogerCartOAuthConfigured: true,
    });

    assert.equal(handoff.action.type, "kroger_cart");
    assert.equal(handoff.action.label, "Add to Kroger cart");
    assert.equal(handoff.action.status, "needs_shopper_login");
    assert.equal(handoff.action.url, KROGER_CART_START_PATH);
    assert.equal(handoff.action.fallbackUrl, krogerSearchUrl(krogerMilk));
    assert.match(handoff.action.detail ?? "", /shopper/i);
    assert.match(handoff.action.detail ?? "", /HTTP 2xx/i);
  });

  it("does not advertise kroger_cart when OAuth is configured but no UPC is present", () => {
    const group: StoreGroup = {
      storeName: "Kroger",
      items: [{ ...krogerMilk, productId: undefined, upc: undefined }],
      subtotal: 5.78,
    };
    const handoff = buildStoreHandoff(group, {
      krogerCartOAuthConfigured: true,
    });

    assert.equal(handoff.action.type, "search_deeplink");
    assert.match(handoff.action.detail ?? "", /UPC/i);
  });

  it("stubs Walmart and Target as search deeplinks, not fake cart fills", () => {
    const walmart = buildStoreHandoff({
      storeName: "Walmart",
      items: [walmartBread],
      subtotal: 1.28,
    });
    assert.equal(walmart.action.type, "search_deeplink");
    assert.equal(walmart.action.label, "Search at Walmart");
    assert.equal(walmart.action.url, walmartSearchUrl(walmartBread));
    assert.match(walmart.action.detail ?? "", /not a cart fill/i);
    assert.match(walmart.action.detail ?? "", /partner/i);

    const target = buildStoreHandoff({
      storeName: "Target",
      items: [targetEggs],
      subtotal: 1.99,
    });
    assert.equal(target.action.type, "search_deeplink");
    assert.equal(target.action.label, "Search at Target");
    assert.match(target.action.detail ?? "", /not a cart fill/i);
    assert.match(target.action.detail ?? "", /partner/i);
  });

  it("builds one Walmart add-to-cart link when every line has an affiliate item id", () => {
    const previous = process.env.WALMART_PUBLISHER_ID;
    delete process.env.WALMART_PUBLISHER_ID;
    const milk = {
      ...walmartBread,
      name: "Whole Milk",
      quantity: 2,
      itemTotal: 4.88,
      productId: "554433",
      priceSource: "live" as const,
    };
    const eggs = {
      ...walmartBread,
      name: "Large Eggs",
      quantity: 1,
      itemTotal: 2.14,
      productId: "998877",
      priceSource: "cached_live" as const,
    };
    const handoff = buildStoreHandoff({
      storeName: "Walmart",
      items: [milk, eggs],
      subtotal: 7.02,
    });
    if (previous === undefined) {
      delete process.env.WALMART_PUBLISHER_ID;
    } else {
      process.env.WALMART_PUBLISHER_ID = previous;
    }

    assert.equal(handoff.action.type, "walmart_cart");
    assert.equal(handoff.action.label, "Add 3 items to Walmart cart");
    assert.equal(handoff.action.status, "ready");
    const url = new URL(handoff.action.url ?? "");
    assert.equal(url.origin + url.pathname, "https://affil.walmart.com/cart/addToCart");
    assert.equal(url.searchParams.get("items"), "554433|2,998877|1");
    assert.match(handoff.action.fallbackUrl ?? "", /walmart\.com\/ip\/554433/);
    assert.match(handoff.action.detail ?? "", /WALMART_PUBLISHER_ID is unset/);
    assert.match(handoff.action.detail ?? "", /does not report the cart as filled/);
  });

  it("attributes the Walmart cart link when WALMART_PUBLISHER_ID is set", () => {
    const previous = process.env.WALMART_PUBLISHER_ID;
    process.env.WALMART_PUBLISHER_ID = "impact-42";
    const handoff = buildStoreHandoff({
      storeName: "Walmart",
      items: [
        {
          ...walmartBread,
          quantity: 1,
          productId: "554433",
          priceSource: "live",
        },
      ],
      subtotal: 1.28,
    });
    if (previous === undefined) {
      delete process.env.WALMART_PUBLISHER_ID;
    } else {
      process.env.WALMART_PUBLISHER_ID = previous;
    }

    assert.equal(handoff.action.label, "Add 1 item to Walmart cart");
    const url = new URL(handoff.action.url ?? "");
    assert.equal(url.origin, "https://goto.walmart.com");
    assert.match(url.pathname, /^\/c\/impact-42\/568844\/9383$/);
    const destination = new URL(url.searchParams.get("u") ?? "");
    assert.equal(destination.searchParams.get("items"), "554433|1");
  });

  it("keeps the search handoff when any Walmart line lacks an affiliate item id", () => {
    const handoff = buildStoreHandoff({
      storeName: "Walmart",
      items: [
        { ...walmartBread, productId: "554433", priceSource: "live" },
        { ...walmartBread, name: "Bananas", priceSource: "seed" },
      ],
      subtotal: 2,
    });
    assert.equal(handoff.action.type, "search_deeplink");
    assert.equal(handoff.action.label, "Search at Walmart");
    assert.match(handoff.action.detail ?? "", /not a cart fill/i);
  });

  it("does not treat a Flipp flyer id as a Walmart item id", () => {
    const handoff = buildStoreHandoff({
      storeName: "Walmart",
      items: [
        {
          ...walmartBread,
          productId: "883311",
          priceSource: "weekly_ad",
        },
      ],
      subtotal: 1.28,
    });
    assert.equal(handoff.action.type, "search_deeplink");
    assert.equal(handoff.action.label, "Search at Walmart");
  });

  it("marks Aldi as coming soon", () => {
    const handoff = buildStoreHandoff({
      storeName: "Aldi",
      items: [aldiBananas],
      subtotal: 1.47,
    });
    assert.equal(handoff.itemCount, 3);
    assert.equal(handoff.action.type, "coming_soon");
    assert.equal(handoff.action.label, "Coming soon");
    assert.equal(handoff.action.status, "coming_soon");
    assert.equal(handoff.action.url, undefined);
    assert.match(handoff.action.detail ?? "", /partner API/i);
  });

  it("uses public search deeplinks for partner banners and never fakes a cart fill", () => {
    const milk = {
      query: "milk",
      name: "Whole Milk",
      brand: "Publix",
      storeName: "Publix",
      price: 3.19,
      quantity: 1,
      itemTotal: 3.19,
      unit: "gal",
      normalizedUnit: "gal",
      upc: "041415000001",
    };

    const publix = buildStoreHandoff({
      storeName: "Publix",
      items: [milk],
      subtotal: 3.19,
    });
    assert.equal(publix.action.type, "search_deeplink");
    assert.equal(publix.action.label, "Search at Publix");
    assert.equal(publix.action.status, "ready");
    assert.equal(
      partnerSearchUrl("Publix", milk),
      "https://www.publix.com/search?searchTerm=041415000001"
    );
    assert.equal(publix.action.url, partnerSearchUrl("Publix", milk));
    assert.match(publix.action.detail ?? "", /not a cart fill/i);

    const costco = buildStoreHandoff({
      storeName: "Costco",
      items: [{ ...milk, storeName: "Costco", brand: "Kirkland" }],
      subtotal: 3.19,
    });
    assert.equal(costco.action.type, "search_deeplink");
    assert.match(costco.action.detail ?? "", /membership/i);
    assert.match(costco.action.detail ?? "", /cart-write is not available/i);
    assert.equal(costco.action.type, "search_deeplink");
  });
});

describe("enrichOptimizeResult", () => {
  it("attaches tripPlan and per-store handoff without dropping optimizer fields", () => {
    const enriched = enrichOptimizeResult({
      stores: [
        { storeName: "Kroger", items: [krogerMilk], subtotal: 5.78 },
        { storeName: "Target", items: [targetEggs], subtotal: 1.99 },
        { storeName: "Walmart", items: [walmartBread], subtotal: 1.28 },
      ],
      unavailable: ["saffron"],
      total: 9.05,
    });

    assert.equal(enriched.total, 9.05);
    assert.deepEqual(enriched.unavailable, ["saffron"]);
    assert.equal(enriched.tripPlan.summary, "2 Kroger + 1 Target + 1 Walmart");
    assert.equal(enriched.tripPlan.itemCount, 4);
    assert.equal(enriched.tripPlan.storeCount, 3);
    assert.equal(enriched.stores[0].items[0].name, "Gallon of Milk");
    assert.equal(enriched.stores[0].handoff.action.type, "search_deeplink");
    assert.equal(enriched.stores[1].handoff.action.label, "Search at Target");
    assert.equal(enriched.stores[2].handoff.action.label, "Search at Walmart");
    assert.equal(enriched.stores[2].nearbyStore, undefined);
  });

  it("attaches the nearest Walmart store only on the Walmart card", () => {
    const enriched = enrichOptimizeResult(
      {
        stores: [
          { storeName: "Kroger", items: [krogerMilk], subtotal: 5.78 },
          { storeName: "Walmart", items: [walmartBread], subtotal: 1.28 },
        ],
        unavailable: [],
        total: 7.06,
      },
      {
        walmartStore: {
          storeId: "2066",
          name: "WM Supercenter",
          streetAddress: "2727 DUNVALE RD",
          city: "HOUSTON",
          state: "TX",
          zip: "77063",
        },
      }
    );
    assert.equal(enriched.stores[0].nearbyStore, undefined);
    assert.equal(enriched.stores[1].nearbyStore?.name, "WM Supercenter");
    assert.equal(enriched.stores[1].nearbyStore?.storeId, "2066");
  });
});
