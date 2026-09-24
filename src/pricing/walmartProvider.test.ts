import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import { WALMART_AFFILIATE_BASE } from "./walmartAuth";
import { WALMART_SETUP_HINT, WalmartPricingProvider } from "./walmartProvider";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.WALMART_CONSUMER_ID;
  delete process.env.WALMART_PRIVATE_KEY;
  delete process.env.WALMART_PUBLISHER_ID;
  delete process.env.WALMART_KEY_VERSION;
});

function installWalmartKeys(): string {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  process.env.WALMART_CONSUMER_ID = "consumer-test";
  process.env.WALMART_PRIVATE_KEY = privateKey;
  process.env.WALMART_PUBLISHER_ID = "impact-123";
  return privateKey;
}

describe("WalmartPricingProvider", () => {
  it("is unconfigured without Affiliate credentials and does not invent a live catalog", () => {
    const provider = new WalmartPricingProvider();
    assert.equal(provider.isConfigured(), false);
    assert.match(provider.setupHint(), /Affiliate Marketing API/i);
    assert.match(provider.setupHint(), /WALMART_CONSUMER_ID/);
  });

  it("searches the documented Affiliate /search endpoint and maps salePrice", async () => {
    installWalmartKeys();
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/search")) {
        return Response.json({
          items: [
            {
              itemId: 554433,
              name: "Great Value Whole Milk, 1 gal",
              brandName: "Great Value",
              upc: "078742000012",
              salePrice: 2.44,
              size: "1 gal",
            },
          ],
        });
      }
      return Response.json({ stores: [] });
    };

    const provider = new WalmartPricingProvider();
    const products = await provider.searchProducts("milk", { zipCode: "45202" });

    assert.equal(products.length, 1);
    assert.equal(products[0].storeName, "Walmart");
    assert.equal(products[0].name, "Great Value Whole Milk, 1 gal");
    assert.equal(products[0].price, 2.44);
    assert.equal(products[0].productId, "554433");
    assert.equal(products[0].upc, "078742000012");
    assert.equal(products[0].priceSource, "live");
    assert.equal(products[0].unit, "gal");
    assert.ok(calls[0].startsWith(`${WALMART_AFFILIATE_BASE}/search?`));
    assert.match(calls[0], /query=milk/);
    assert.match(calls[0], /publisherId=impact-123/);
    assert.match(calls[0], /numItems=25/);
  });

  it("throws a structured HTTP error when the Affiliate API rejects the app", async () => {
    installWalmartKeys();
    globalThis.fetch = async () =>
      Response.json({ message: "Invalid consumer id" }, { status: 401 });

    const provider = new WalmartPricingProvider();
    await assert.rejects(
      () => provider.searchProducts("eggs"),
      (error: unknown) => {
        assert.equal((error as Error).message, "Invalid consumer id");
        return true;
      }
    );
  });

  it("setup hint stays honest about walmart.com catalog vs local shelves", () => {
    assert.match(WALMART_SETUP_HINT, /walmart\.com catalog/i);
    assert.match(WALMART_SETUP_HINT, /not in-aisle/i);
    assert.match(WALMART_SETUP_HINT, /no store-price filter/i);
    assert.match(WALMART_SETUP_HINT, /WALMART_PUBLISHER_ID/);
  });

  it("looks up the nearest store by ZIP, caches it, and does not scope search prices to that store", async () => {
    installWalmartKeys();
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/stores")) {
        return Response.json([
          {
            no: 2066,
            name: "WM Supercenter",
            streetAddress: "2727 DUNVALE RD",
            city: "HOUSTON",
            stateProvCode: "TX",
            zip: "77063",
          },
        ]);
      }
      return Response.json({
        items: [
          {
            itemId: 554433,
            name: "Great Value Whole Milk",
            salePrice: 2.44,
          },
        ],
      });
    };

    const provider = new WalmartPricingProvider();
    const first = await provider.getNearestStore("77063-1234");
    const second = await provider.getNearestStore("77063");
    const products = await provider.searchProducts("milk", { zipCode: "77063" });

    assert.equal(first?.storeId, "2066");
    assert.equal(first?.name, "WM Supercenter");
    assert.equal(first?.streetAddress, "2727 DUNVALE RD");
    assert.equal(first?.city, "HOUSTON");
    assert.equal(first?.state, "TX");
    assert.equal(first?.zip, "77063");
    assert.equal(second, first);
    assert.equal(products[0].productId, "554433");
    assert.equal(products[0].locationId, "2066");

    const storeCalls = calls.filter((url) => url.includes("/stores"));
    const searchCalls = calls.filter((url) => url.includes("/search"));
    assert.equal(storeCalls.length, 1);
    assert.match(storeCalls[0], /\/stores\?zip=77063$/);
    assert.equal(searchCalls.length, 1);
    assert.doesNotMatch(searchCalls[0], /store/i);
  });

  it("skips the store locator for a bad ZIP and does not cache a failed HTTP response", async () => {
    installWalmartKeys();
    let storeCalls = 0;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/stores")) {
        storeCalls += 1;
        return Response.json({ message: "no" }, { status: 500 });
      }
      return Response.json({ items: [] });
    };

    const provider = new WalmartPricingProvider();
    assert.equal(await provider.getNearestStore("abc"), undefined);
    assert.equal(storeCalls, 0);
    assert.equal(await provider.getNearestStore("45202"), undefined);
    assert.equal(await provider.getNearestStore("45202"), undefined);
    assert.equal(storeCalls, 2);
  });
});
