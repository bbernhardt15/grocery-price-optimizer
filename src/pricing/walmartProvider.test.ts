import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import { WALMART_AFFILIATE_BASE } from "./walmartAuth";
import { StorePricingError } from "./types";
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
    assert.equal(products[0].onSale, undefined);
    assert.equal(products[0].regularPrice, undefined);
    assert.equal(products[0].unit, "gal");
    assert.equal(products[0].size, "1 gal");
    assert.ok(calls[0].startsWith(`${WALMART_AFFILIATE_BASE}/search?`));
    assert.match(calls[0], /query=milk/);
    assert.match(calls[0], /publisherId=impact-123/);
    assert.match(calls[0], /numItems=25/);
  });

  it("marks a rollback only when msrp is higher than the selling price", async () => {
    installWalmartKeys();
    globalThis.fetch = async () =>
      Response.json({
        items: [
          { itemId: 1, name: "Great Value Large Eggs", salePrice: 2.14, msrp: 2.64 },
          { itemId: 2, name: "Great Value Whole Milk", salePrice: 2.44, msrp: 2.44 },
        ],
      });
    const products = await new WalmartPricingProvider().searchProducts("eggs");
    const eggs = products.find((row) => row.name.includes("Eggs"));
    const milk = products.find((row) => row.name.includes("Milk"));
    assert.equal(eggs?.price, 2.14);
    assert.equal(eggs?.onSale, true);
    assert.equal(eggs?.regularPrice, 2.64);
    assert.equal(milk?.price, 2.44);
    assert.equal(milk?.onSale, undefined);
    assert.equal(milk?.regularPrice, undefined);
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

  it("keeps Retry-After, rate-limit headers, and the body on a 429", async () => {
    installWalmartKeys();
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: "rate limit" }), {
        status: 429,
        headers: {
          "retry-after": "900",
          "x-ratelimit-remaining": "0",
          "wm_sec.auth_signature": "do-not-store",
        },
      });
    const provider = new WalmartPricingProvider();
    await assert.rejects(
      () => provider.getJson("/paginated/items?category=milk&count=25"),
      (error: unknown) => {
        assert.ok(error instanceof StorePricingError);
        assert.equal(error.status, 429);
        assert.match(error.body ?? "", /rate limit/);
        assert.equal(error.headers?.["retry-after"], "900");
        assert.equal(error.headers?.["x-ratelimit-remaining"], "0");
        assert.equal(error.headers?.["wm_sec.auth_signature"], undefined);
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
    assert.equal(first?.accessPointId, undefined);
    assert.equal(first?.fulfillmentStoreId, undefined);
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

  it("captures accessPointId and fulfillmentStoreId when the locator sends them", async () => {
    installWalmartKeys();
    globalThis.fetch = async () =>
      Response.json([
        {
          no: 2066,
          name: "WM Supercenter",
          streetAddress: "2727 DUNVALE RD",
          city: "HOUSTON",
          stateProvCode: "TX",
          zip: "77063",
          accessPoints: [
            {
              accessPointId: "delivery-point",
              fulfillmentStoreId: "9999",
              accessType: "DELIVERY_ADDRESS",
            },
            {
              id: "6168c2e3-fc36-4827-98e6-d717d10af1d6",
              fulfillmentStoreId: "2066",
              accessType: "PICKUP_CURBSIDE",
            },
          ],
        },
      ]);

    const provider = new WalmartPricingProvider();
    const store = await provider.getNearestStore("77063");
    assert.equal(store?.storeId, "2066");
    assert.equal(store?.accessPointId, "6168c2e3-fc36-4827-98e6-d717d10af1d6");
    assert.equal(store?.fulfillmentStoreId, "2066");
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

  it("looks up an item by UPC on the Affiliate /items endpoint", async () => {
    installWalmartKeys();
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return Response.json({
        items: [{ itemId: 99, name: "Coca-Cola", salePrice: 1.25, upc: "049000042566", brandName: "Coca-Cola" }],
      });
    };
    const provider = new WalmartPricingProvider();
    const payload = (await provider.lookupByUpc("049000042566")) as { items: Array<{ itemId: number }> };
    assert.equal(payload.items[0]?.itemId, 99);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /\/items\?/);
    assert.match(calls[0], /upc=049000042566/);
    assert.match(calls[0], /publisherId=impact-123/);
  });

  it("sends several UPCs in one Affiliate /items call", async () => {
    installWalmartKeys();
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return Response.json({ items: [] });
    };
    const provider = new WalmartPricingProvider();
    await provider.lookupByUpcs(["049000042566", "016000275287", "not-a-code", "049000042566"]);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /\/items\?/);
    assert.match(decodeURIComponent(calls[0]), /upc=049000042566,016000275287/);
  });

  it("sends up to 20 item ids in one Affiliate /items call", async () => {
    installWalmartKeys();
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return Response.json({ items: [] });
    };
    const ids = Array.from({ length: 21 }, (_, index) => String(100000 + index));
    const provider = new WalmartPricingProvider();
    await provider.lookupByIds(ids);
    assert.equal(calls.length, 1);
    const query = decodeURIComponent(calls[0]);
    assert.match(query, /\/items\?/);
    assert.match(query, /ids=100000,100001/);
    const sent = new URL(calls[0]).searchParams.get("ids")?.split(",") ?? [];
    assert.equal(sent.length, 20);
    assert.equal(sent.includes("100020"), false);
  });
});
