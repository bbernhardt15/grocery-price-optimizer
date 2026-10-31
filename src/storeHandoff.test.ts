import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { lockCartHandoffs } from "./billing/applyPlan";
import { STORE_HANDOFF_CONFIG } from "./storeHandoffConfig";
import { FLIPP_MERCHANT_MAPPINGS } from "./pricing/flipp/merchants";
import type { StoreGroup } from "./optimizeGroceryList";
import {
  buildStoreHandoff,
  enrichOptimizeResult,
  formatTripSummary,
  krogerSearchUrl,
  targetSearchUrl,
  walmartSearchUrl,
  aldiSearchUrl,
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
    assert.equal(handoff.action.type, "shop_list");
    assert.equal(handoff.tier, "cart");
    assert.equal(handoff.action.label, "Open Kroger list");
    assert.equal(handoff.action.status, "ready");
    assert.equal(handoff.action.url, krogerSearchUrl(krogerMilk));
    assert.match(handoff.action.detail ?? "", /authorization-code/i);
    assert.equal(handoff.coupon?.url, "https://www.kroger.com/savings/cl/coupons/");
    assert.equal(handoff.coupon?.label, "Kroger digital coupons");
  });

  it("falls back to a store homepage when a coupon page is not confirmed", () => {
    const handoff = buildStoreHandoff({
      storeName: "Food Lion",
      items: [{ query: "milk", name: "Milk", brand: "Food Lion", storeName: "Food Lion", price: 2.5, quantity: 1, itemTotal: 2.5, unit: "gal", normalizedUnit: "gal" }],
      subtotal: 2.5,
    });
    assert.equal(handoff.coupon?.url, "https://shop.foodlion.com/");
    assert.equal(handoff.coupon?.kind, "home");
  });

  it("keeps the coupon link when cart links are locked", () => {
    const handoff = buildStoreHandoff({
      storeName: "Kroger",
      items: [krogerMilk],
      subtotal: 5.78,
    });
    const locked = lockCartHandoffs({
      stores: [{ storeName: "Kroger", items: [{ name: "Milk", url: "https://www.kroger.com/search?query=milk" }], handoff }],
    });
    assert.equal(locked.stores[0].handoff?.action.type, "coming_soon");
    assert.equal(locked.stores[0].handoff?.coupon?.url, "https://www.kroger.com/savings/cl/coupons/");
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
    assert.equal(handoff.action.label, "Send to Kroger cart");
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

    assert.equal(handoff.action.type, "shop_list");
    assert.match(handoff.action.detail ?? "", /UPC/i);
  });

  it("stubs Walmart and Target as search deeplinks, not fake cart fills", () => {
    const walmart = buildStoreHandoff({
      storeName: "Walmart",
      items: [walmartBread],
      subtotal: 1.28,
    });
    assert.equal(walmart.action.type, "shop_list");
    assert.equal(walmart.action.label, "Open Walmart list");
    assert.equal(walmart.action.url, walmartSearchUrl(walmartBread));
    assert.match(walmart.action.detail ?? "", /not a cart fill/i);
    assert.match(walmart.action.detail ?? "", /partner/i);

    const target = buildStoreHandoff({
      storeName: "Target",
      items: [targetEggs],
      subtotal: 1.99,
    });
    assert.equal(target.action.type, "shop_list");
    assert.equal(target.tier, "link");
    assert.equal(target.action.label, "Open Target list");
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
    assert.equal(handoff.action.label, "Open in Walmart cart");
    assert.equal(handoff.action.status, "ready");
    const url = new URL(handoff.action.url ?? "");
    assert.equal(url.origin + url.pathname, "https://www.walmart.com/sc/cart/addToCart");
    assert.equal(url.searchParams.get("items"), "554433|2,998877");
    assert.equal(url.searchParams.get("storeId"), null);
    assert.equal(url.searchParams.get("ap"), null);
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

    assert.equal(handoff.action.label, "Open in Walmart cart");
    const url = new URL(handoff.action.url ?? "");
    assert.equal(url.origin, "https://goto.walmart.com");
    assert.match(url.pathname, /^\/c\/impact-42\/568844\/9383$/);
    const destination = new URL(url.searchParams.get("u") ?? "");
    assert.equal(destination.origin + destination.pathname, "https://www.walmart.com/sc/cart/addToCart");
    assert.equal(destination.searchParams.get("items"), "554433");
  });

  it("adds storeId and ap from the nearby Walmart when the locator sent them", () => {
    const handoff = buildStoreHandoff(
      {
        storeName: "Walmart",
        items: [
          {
            ...walmartBread,
            quantity: 2,
            productId: "554433",
            priceSource: "live",
          },
        ],
        subtotal: 2.56,
      },
      {
        walmartStore: {
          storeId: "100",
          fulfillmentStoreId: "2066",
          accessPointId: "6168c2e3-fc36-4827-98e6-d717d10af1d6",
          name: "WM Supercenter",
          streetAddress: "2727 DUNVALE RD",
          city: "HOUSTON",
          state: "TX",
          zip: "77063",
        },
      }
    );
    const url = new URL(handoff.action.url ?? "");
    assert.equal(url.searchParams.get("items"), "554433|2");
    assert.equal(url.searchParams.get("storeId"), "2066");
    assert.equal(url.searchParams.get("ap"), "6168c2e3-fc36-4827-98e6-d717d10af1d6");
  });

  it("passes the nearby store number and omits ap when the locator has no access point", () => {
    const handoff = buildStoreHandoff(
      {
        storeName: "Walmart",
        items: [
          {
            ...walmartBread,
            productId: "554433",
            priceSource: "live",
          },
        ],
        subtotal: 1.28,
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
    const url = new URL(handoff.action.url ?? "");
    assert.equal(url.searchParams.get("items"), "554433");
    assert.equal(url.searchParams.get("storeId"), "2066");
    assert.equal(url.searchParams.get("ap"), null);
  });

  it("links the valid Walmart lines and names the items left off the cart link", () => {
    const handoff = buildStoreHandoff({
      storeName: "Walmart",
      items: [
        { ...walmartBread, productId: "554433", priceSource: "live", quantity: 2 },
        { ...walmartBread, name: "Bananas", priceSource: "seed" },
      ],
      subtotal: 2,
    });
    assert.equal(handoff.action.type, "walmart_cart");
    assert.equal(handoff.action.label, "Open in Walmart cart");
    const url = new URL(handoff.action.url ?? "");
    assert.equal(url.origin + url.pathname, "https://www.walmart.com/sc/cart/addToCart");
    assert.equal(url.searchParams.get("items"), "554433|2");
    assert.match(handoff.action.detail ?? "", /Skipped 1 item \(Bananas\)/);
    assert.match(handoff.action.detail ?? "", /home page/);
  });

  it("does not turn a Flipp flyer id into a Target product page", () => {
    assert.equal(
      targetSearchUrl({
        name: "Good & Gather Large Eggs",
        productId: "1041810480",
        priceSource: "weekly_ad",
      }),
      "https://www.target.com/s?searchTerm=Good+%26+Gather+Large+Eggs"
    );
  });

  it("builds each banner URL for the sample term milk, with Meijer using text=", () => {
    const sample = {
      query: "milk",
      name: "milk",
      brand: "Store",
      price: 1,
      quantity: 1,
      itemTotal: 1,
      unit: "ea",
      normalizedUnit: "ea",
    };
    const expected: Record<string, string | undefined> = {
      Kroger: "https://www.kroger.com/search?query=milk",
      Walmart: "https://www.walmart.com/search?q=milk",
      Target: "https://www.target.com/s?searchTerm=milk",
      Aldi: "https://www.aldi.us/store/aldi/s?k=milk",
      Publix: "https://www.publix.com/search?searchTerm=milk",
      "H-E-B": "https://www.heb.com/search/?q=milk",
      Meijer: "https://www.meijer.com/shopping/search.html?text=milk",
      Safeway: "https://www.safeway.com/shop/search-results.html?q=milk",
      Albertsons: "https://www.albertsons.com/shop/search-results.html?q=milk",
      Vons: "https://www.vons.com/shop/search-results.html?q=milk",
      "Jewel-Osco": "https://www.jewelosco.com/shop/search-results.html?q=milk",
      Acme: "https://www.acmemarkets.com/shop/search-results.html?q=milk",
      "Tom Thumb": "https://www.tomthumb.com/shop/search-results.html?q=milk",
      Randalls: "https://www.randalls.com/shop/search-results.html?q=milk",
      Pavilions: "https://www.pavilions.com/shop/search-results.html?q=milk",
      "Food Lion": "https://shop.foodlion.com/search?search_term=milk",
      Giant: "https://giantfood.com/",
      "Stop & Shop": "https://stopandshop.com/",
      Sprouts: "https://shop.sprouts.com/",
      "Winn-Dixie": "https://www.winndixie.com/",
      Costco: "https://www.costco.com/CatalogSearch?keyword=milk",
      "Sam's Club": "https://www.samsclub.com/s/milk",
      "Whole Foods": "https://www.wholefoodsmarket.com/search?text=milk",
      "Amazon Fresh": "https://www.amazon.com/s?k=milk",
      "Giant Eagle": undefined,
    };

    for (const row of STORE_HANDOFF_CONFIG) {
      assert.ok(Object.hasOwn(expected, row.storeName), row.storeName);
      const handoff = buildStoreHandoff({
        storeName: row.storeName,
        items: [{ ...sample, storeName: row.storeName }],
        subtotal: 1,
      });
      assert.equal(handoff.items[0]?.url, expected[row.storeName], row.storeName);
    }

    assert.match(expected.Meijer ?? "", /[?&]text=milk$/);
    assert.equal((expected.Meijer ?? "").includes("query="), false);
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
    assert.equal(handoff.action.type, "shop_list");
    assert.equal(handoff.action.label, "Open Walmart list");
  });

  it("gives Aldi a checklist with a verified search link", () => {
    const handoff = buildStoreHandoff({
      storeName: "Aldi",
      items: [aldiBananas],
      subtotal: 1.47,
    });
    assert.equal(handoff.itemCount, 3);
    assert.equal(handoff.tier, "link");
    assert.equal(handoff.action.type, "shop_list");
    assert.equal(handoff.action.label, "Open Aldi list");
    assert.equal(handoff.action.status, "ready");
    assert.equal(aldiSearchUrl(aldiBananas), "https://www.aldi.us/store/aldi/s?k=Bananas");
    assert.equal(handoff.items[0].url, aldiSearchUrl(aldiBananas));
    assert.equal(handoff.items[0].openLabel, "Open in Aldi");
    assert.match(handoff.action.detail ?? "", /not a cart fill/i);
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
    assert.equal(publix.action.type, "shop_list");
    assert.equal(publix.action.label, "Open Publix list");
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
    assert.equal(costco.action.type, "shop_list");
    assert.equal(costco.tier, "link");
    assert.equal(costco.priceLabel, "Weekly ad, not shelf price");
    assert.match(costco.action.detail ?? "", /membership/i);
    assert.match(costco.action.detail ?? "", /cart-write is not available/i);
    assert.match(costco.action.detail ?? "", /weekly ad, not a shelf price/i);
  });

  it("sends circular banners to the store site and never a cart", () => {
    const milk = {
      query: "milk",
      name: "Whole Milk",
      brand: "Store",
      storeName: "Jewel-Osco",
      price: 3.19,
      quantity: 1,
      itemTotal: 3.19,
      unit: "gal",
      normalizedUnit: "gal",
      productId: "999001",
      upc: "041415000001",
      priceSource: "weekly_ad" as const,
    };
    const banners = [
      "Jewel-Osco",
      "Vons",
      "Acme",
      "Albertsons",
      "Tom Thumb",
      "Randalls",
      "Pavilions",
      "Stop & Shop",
      "Sprouts",
      "Winn-Dixie",
      "H-E-B",
      "Meijer",
    ];
    for (const storeName of banners) {
      const handoff = buildStoreHandoff({
        storeName,
        items: [{ ...milk, storeName }],
        subtotal: 3.19,
      });
      assert.equal(handoff.action.type, "shop_list", storeName);
      assert.equal(handoff.tier, "link", storeName);
      assert.equal(handoff.priceLabel, "Weekly ad, not shelf price", storeName);
      assert.equal(handoff.action.label, `Open ${storeName} list`, storeName);
      assert.notEqual(handoff.action.type, "kroger_cart");
      assert.notEqual(handoff.action.type, "walmart_cart");
      assert.match(handoff.action.detail ?? "", /not a cart fill/i, storeName);
      assert.match(handoff.action.detail ?? "", /weekly ad, not a shelf price/i, storeName);
      const homepage: Record<string, string> = {
        "Stop & Shop": "https://stopandshop.com/",
        Sprouts: "https://shop.sprouts.com/",
        "Winn-Dixie": "https://www.winndixie.com/",
      };
      if (homepage[storeName]) {
        assert.equal(handoff.action.url, homepage[storeName], storeName);
      } else {
        assert.match(handoff.action.url ?? "", /Whole%20Milk/, storeName);
      }
      if (storeName === "Meijer") {
        assert.match(handoff.action.url ?? "", /[?&]text=Whole%20Milk/);
        assert.equal((handoff.action.url ?? "").includes("query="), false);
      }
      assert.equal(handoff.items[0].openLabel, `Open in ${storeName}`, storeName);
      assert.equal((handoff.action.url ?? "").includes("999001"), false, storeName);
    }
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
    assert.equal(enriched.stores[0].handoff.action.type, "shop_list");
    assert.equal(enriched.stores[1].handoff.action.label, "Open Target list");
    assert.equal(enriched.stores[2].handoff.action.label, "Open Walmart list");
    assert.equal(enriched.capabilities.krogerCart, false);
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

describe("Flipp merchants have a handoff tier", () => {
  it("uses link when merchants.json has a search URL, and never invents a cart", () => {
    for (const mapping of FLIPP_MERCHANT_MAPPINGS) {
      const row = STORE_HANDOFF_CONFIG.find((config) => config.storeName === mapping.storeName);
      assert.ok(row, mapping.storeName);
      if (mapping.searchUrl) {
        assert.equal(row.tier, "link", mapping.storeName);
        const url = partnerSearchUrl(mapping.storeName, {
          name: "Milk",
          priceSource: "weekly_ad",
        });
        assert.equal(url, mapping.searchUrl.replaceAll("{q}", "Milk"), mapping.storeName);
        const handoff = buildStoreHandoff({
          storeName: mapping.storeName,
          items: [{ ...aldiBananas, storeName: mapping.storeName, priceSource: "weekly_ad" }],
          subtotal: 1.47,
        });
        assert.equal(handoff.priceLabel, "Weekly ad, not shelf price", mapping.storeName);
        assert.equal(handoff.action.type, "shop_list", mapping.storeName);
      } else {
        assert.ok(row.tier === "cart" || row.tier === "link", mapping.storeName);
      }
    }
  });
});

describe("store handoff doc", () => {
  it("lists every configured store, its tier, and the shelf-price research", () => {
    const doc = readFileSync(new URL("../docs/STORE_HANDOFFS.md", import.meta.url), "utf8");
    for (const row of STORE_HANDOFF_CONFIG) {
      const name = row.storeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.match(doc, new RegExp(`\\| ${name} \\|`));
      assert.match(doc, new RegExp(`\\| ${name} \\|[^\\n]*\\| ${row.tier} \\|`));
    }
    assert.match(doc, /Datasembly/);
    assert.match(doc, /Instacart Developer Platform/);
    assert.match(doc, /do not scrape/i);
  });
});
