import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  FLIPP_FLYERS,
  FLIPP_FLYERKIT_BASE,
  clearFlippSearchCache,
  flippWeekKey,
  listWeeklyAdBanners,
  weeklyAdNameMatches,
} from "./flipp/client";
import {
  FlippDealsProvider,
  FLIPP_ENABLED_HINT,
  FLIPP_SETUP_HINT,
} from "./flipp/flippProvider";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env.FLIPP_MIN_INTERVAL_MS = "0";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearFlippSearchCache();
  delete process.env.FLIPP_ENABLED;
  delete process.env.FLIPP_ACCESS_TOKEN;
  delete process.env.FLIPP_MIN_INTERVAL_MS;
});

function flippItem(overrides: Record<string, unknown> = {}) {
  return {
    name: "Friendly Farms Lactose Free Whole or 2% Milk",
    current_price: 2.99,
    merchant_name: "ALDI",
    merchant_id: 2353,
    flyer_item_id: 1039529649,
    valid_to: "2099-12-31T00:00:00+00:00",
    post_price_text: "gal",
    ...overrides,
  };
}

describe("FlippDealsProvider", () => {
  it("stays off without FLIPP_ENABLED or a FlyerKit token and documents weekly ads vs shelf", () => {
    const provider = new FlippDealsProvider("Aldi");
    assert.equal(provider.isConfigured(), false);
    assert.match(provider.setupHint(), /weekly-ad/i);
    assert.match(FLIPP_SETUP_HINT, /FLIPP_ENABLED=true/);
    assert.match(FLIPP_SETUP_HINT, /not a full shelf catalog/i);
    assert.match(FLIPP_SETUP_HINT, /unofficial/i);
    assert.match(FLIPP_SETUP_HINT, /Do not scrape/i);
  });

  it("is configured from FLIPP_ENABLED alone and does not ask to set env vars", () => {
    process.env.FLIPP_ENABLED = "true";
    delete process.env.FLIPP_ACCESS_TOKEN;
    const provider = new FlippDealsProvider("Aldi");
    assert.equal(provider.isConfigured(), true);
    assert.equal(provider.setupHint(), FLIPP_ENABLED_HINT);
    assert.doesNotMatch(provider.setupHint(), /FLIPP_ENABLED=true/);
    assert.doesNotMatch(provider.setupHint(), /FLIPP_ACCESS_TOKEN/);
  });

  it("does not call Flipp when a ZIP is missing", async () => {
    process.env.FLIPP_ENABLED = "true";
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return Response.json({ items: [] });
    };
    const products = await new FlippDealsProvider("Aldi").searchProducts("milk");
    assert.deepEqual(products, []);
    assert.equal(calls, 0);
  });

  it("reads the Aldi circular for the ZIP instead of a merchant AND query", async () => {
    process.env.FLIPP_ENABLED = "true";
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith(`${FLIPP_FLYERS}?`)) {
        return Response.json({
          flyers: [{ id: 8136201, merchant: "ALDI", merchant_id: 2353, name: "Weekly Ad" }],
        });
      }
      if (url.startsWith(`${FLIPP_FLYERS}/8136201`)) {
        return Response.json({
          items: [
            flippItem({ current_price: null, price: "2.99" }),
            flippItem({
              name: "Fresh Antibiotic Free Family Pack Boneless Skinless Chicken Thighs",
              price: "2.49",
              current_price: null,
              flyer_item_id: 88,
              post_price_text: "Per Lb.",
            }),
            flippItem({
              name: "Milk-Bone Comfort Chews",
              price: "10.49",
              current_price: null,
              flyer_item_id: 89,
            }),
            flippItem({
              name: "Vital Farms eggs",
              current_price: null,
              price: null,
              pre_price_text: "BOGO 25% Off",
              flyer_item_id: 90,
            }),
          ],
        });
      }
      return Response.json({ items: [] });
    };

    const products = await new FlippDealsProvider("Aldi").searchProducts("milk", {
      zipCode: "45202-1234",
    });

    assert.equal(products.length, 1);
    assert.equal(products[0].storeName, "Aldi");
    assert.equal(products[0].price, 2.99);
    assert.equal(products[0].priceSource, "weekly_ad");
    assert.equal(products[0].onSale, true);
    assert.equal(products[0].regularPrice, undefined);
    assert.equal(products[0].saleEndsOn, "2099-12-31");
    assert.equal(products[0].locationId, "45202");
    assert.equal(products[0].productId, "1039529649");
    assert.equal(products[0].unit, "gal");
    assert.match(calls[0], /postal_code=45202/);
    assert.equal(calls.some((url) => url.includes("AND")), false);
    assert.equal(weeklyAdNameMatches("Milk-Bone Comfort Chews", "milk"), false);
  });

  it("keeps a flyer was-price and end date, and ignores BOGO text", async () => {
    process.env.FLIPP_ENABLED = "true";
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.startsWith(`${FLIPP_FLYERS}?`)) {
        return Response.json({
          flyers: [{ id: 77, merchant: "ALDI", merchant_id: 2353, name: "Weekly Ad" }],
        });
      }
      if (url.startsWith(`${FLIPP_FLYERS}/77`)) {
        return Response.json({
          items: [
            flippItem({
              name: "Oreo Cookies",
              current_price: 3.29,
              original_price: 4.19,
              valid_to: "2026-11-08T23:59:00-05:00",
              flyer_item_id: 1,
            }),
            flippItem({
              name: "Coca-Cola",
              current_price: 1.25,
              pre_price_text: "BOGO 25% Off",
              flyer_item_id: 2,
            }),
            flippItem({
              name: "Ritz Crackers",
              current_price: 2.5,
              pre_price_text: "2 for $5",
              flyer_item_id: 3,
            }),
            flippItem({
              name: "Chex Mix",
              current_price: 2.5,
              pre_price_text: "$3.49",
              flyer_item_id: 4,
            }),
          ],
        });
      }
      return Response.json({ items: [] });
    };

    const provider = new FlippDealsProvider("Aldi");
    const oreo = await provider.searchProducts("Oreo", { zipCode: "45202" });
    const cola = await provider.searchProducts("Coca-Cola", { zipCode: "45202" });
    const ritz = await provider.searchProducts("Ritz", { zipCode: "45202" });
    const chex = await provider.searchProducts("Chex", { zipCode: "45202" });
    assert.equal(oreo[0].onSale, true);
    assert.equal(oreo[0].regularPrice, 4.19);
    assert.equal(oreo[0].saleEndsOn, "2026-11-08");
    assert.equal(cola[0].onSale, true);
    assert.equal(cola[0].regularPrice, undefined);
    assert.equal(ritz[0].regularPrice, undefined);
    assert.equal(chex[0].regularPrice, 3.49);
  });

  it("maps Target circular hits and skips items without a numeric price", async () => {
    process.env.FLIPP_ENABLED = "true";
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.startsWith(`${FLIPP_FLYERS}?`)) {
        return Response.json({
          flyers: [{ id: 55, merchant: "Target", merchant_id: 2040, name: "Weekly Circular" }],
        });
      }
      if (url.startsWith(`${FLIPP_FLYERS}/55`)) {
        return Response.json({
          items: [
            {
              name: "Good & Gather Large Eggs",
              price: "1.79",
              id: 55,
              post_price_text: "dozen",
              cutout_image_url: "http://f.wishabi.net/page_items/eggs.jpg",
            },
            {
              name: "Vital Farms eggs",
              price: null,
              pre_price_text: "BOGO 25% Off",
              id: 56,
            },
          ],
        });
      }
      return Response.json({ items: [] });
    };

    const products = await new FlippDealsProvider("Target").searchProducts(
      "eggs",
      { zipCode: "30303" }
    );
    assert.equal(products.length, 1);
    assert.equal(products[0].storeName, "Target");
    assert.equal(products[0].price, 1.79);
    assert.equal(products[0].priceSource, "weekly_ad");
    assert.equal(products[0].imageUrls?.[0], "https://f.wishabi.net/page_items/eggs.jpg");
  });

  it("prefers documented FlyerKit when a token is set", async () => {
    process.env.FLIPP_ACCESS_TOKEN = "flyer-kit-token";
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith(FLIPP_FLYERKIT_BASE)) {
        return Response.json([
          {
            name: "Simple Truth Organic Milk",
            current_price: 3.49,
            merchant_name: "Kroger",
            merchant_id: 2707,
            id: 99,
          },
        ]);
      }
      return Response.json({ items: [] });
    };

    const products = await new FlippDealsProvider("Kroger").searchProducts(
      "milk",
      { zipCode: "45202" }
    );
    assert.equal(products[0].name, "Simple Truth Organic Milk");
    assert.equal(products[0].priceSource, "weekly_ad");
    assert.ok(calls[0].startsWith(`${FLIPP_FLYERKIT_BASE}/publications/kroger/products?`));
    assert.match(calls[0], /access_token=flyer-kit-token/);
    assert.match(calls[0], /postal_code=45202/);
    assert.match(calls[0], /keywords=milk/);
    assert.equal(calls.length, 1);
  });

  it("falls back to the opt-in consumer search when FlyerKit fails and FLIPP_ENABLED is set", async () => {
    process.env.FLIPP_ACCESS_TOKEN = "bad-token";
    process.env.FLIPP_ENABLED = "true";
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.startsWith(FLIPP_FLYERKIT_BASE)) {
        return Response.json({ message: "invalid token" }, { status: 401 });
      }
      return Response.json({
        items: [flippItem({ merchant_name: "Meijer", merchant_id: 2281, name: "Meijer Milk", current_price: 2.5 })],
      });
    };

    const products = await new FlippDealsProvider("Meijer").searchProducts(
      "milk",
      { zipCode: "45202" }
    );
    assert.equal(products[0].storeName, "Meijer");
    assert.equal(products[0].price, 2.5);
    assert.equal(products[0].priceSource, "weekly_ad");
  });

  it("keys the circular cache by America/New_York week", () => {
    assert.equal(flippWeekKey(new Date("2026-10-23T15:00:00Z")), "2026-W43");
    assert.equal(flippWeekKey(new Date("2026-10-26T03:00:00Z")), "2026-W43");
    assert.equal(flippWeekKey(new Date("2026-10-26T12:00:00Z")), "2026-W44");
  });

  it("reuses the ZIP flyer index for the week and does not search a banner that is absent", async () => {
    process.env.FLIPP_ENABLED = "true";
    let calls = 0;
    globalThis.fetch = async (input) => {
      calls += 1;
      const url = String(input);
      if (url.startsWith(`${FLIPP_FLYERS}?`)) {
        return Response.json({
          flyers: [{ id: 7, merchant: "ALDI", merchant_id: 2353, name: "Weekly Ad" }],
        });
      }
      if (url.startsWith(`${FLIPP_FLYERS}/7`)) {
        return Response.json({ items: [flippItem()] });
      }
      return Response.json({
        items: [flippItem({ name: "Should Not Search", merchant_name: "Publix", merchant_id: 2361 })],
      });
    };

    const first = await listWeeklyAdBanners("30303");
    const second = await listWeeklyAdBanners("30303");
    assert.deepEqual(
      first.map((banner) => banner.storeName),
      ["Aldi"]
    );
    assert.deepEqual(second, first);

    const publix = await new FlippDealsProvider("Publix").searchProducts("milk", {
      zipCode: "30303",
    });
    assert.deepEqual(publix, []);

    const aldi = await new FlippDealsProvider("Aldi").searchProducts("milk", {
      zipCode: "30303",
    });
    assert.equal(aldi.length, 1);
    assert.equal(aldi[0].priceSource, "weekly_ad");
    assert.equal(calls, 2);
  });
});
