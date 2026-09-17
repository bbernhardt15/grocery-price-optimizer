import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  FLIPP_CONSUMER_SEARCH,
  FLIPP_FLYERKIT_BASE,
  clearFlippSearchCache,
} from "./flipp/client";
import { FlippDealsProvider, FLIPP_SETUP_HINT } from "./flipp/flippProvider";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearFlippSearchCache();
  delete process.env.FLIPP_ENABLED;
  delete process.env.FLIPP_ACCESS_TOKEN;
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

  it("searches the consumer flyer endpoint when FLIPP_ENABLED and maps Aldi weekly-ad prices", async () => {
    process.env.FLIPP_ENABLED = "true";
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return Response.json({
        items: [
          flippItem(),
          flippItem({
            name: "Vital Farms 12 ct. Grade A large eggs",
            current_price: null,
            pre_price_text: "BOGO 25% Off",
            merchant_name: "Target",
            merchant_id: 2040,
          }),
        ],
      });
    };

    const products = await new FlippDealsProvider("Aldi").searchProducts("milk", {
      zipCode: "45202",
    });

    assert.equal(products.length, 1);
    assert.equal(products[0].storeName, "Aldi");
    assert.equal(products[0].price, 2.99);
    assert.equal(products[0].priceSource, "weekly_ad");
    assert.equal(products[0].locationId, "45202");
    assert.equal(products[0].productId, "1039529649");
    assert.equal(products[0].unit, "gal");
    assert.ok(calls[0].startsWith(`${FLIPP_CONSUMER_SEARCH}?`));
    assert.match(calls[0], /postal_code=45202/);
    assert.match(calls[0], /q=ALDI\+AND\+milk/);
  });

  it("maps Target flyer hits and skips items without a numeric price", async () => {
    process.env.FLIPP_ENABLED = "true";
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("Target+AND+eggs")) {
        return Response.json({
          items: [
            flippItem({
              name: "Good & Gather Large Eggs",
              current_price: 1.79,
              merchant_name: "Target",
              merchant_id: 2040,
              flyer_item_id: 55,
              post_price_text: "dozen",
            }),
            flippItem({
              name: "Vital Farms eggs",
              current_price: null,
              pre_price_text: "BOGO 25% Off",
              merchant_name: "Target",
              merchant_id: 2040,
            }),
          ],
        });
      }
      return Response.json({ items: [] });
    };

    const products = await new FlippDealsProvider("Target").searchProducts(
      "eggs",
      { zipCode: "45202" }
    );
    assert.equal(products.length, 1);
    assert.equal(products[0].storeName, "Target");
    assert.equal(products[0].price, 1.79);
    assert.equal(products[0].priceSource, "weekly_ad");
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
});
