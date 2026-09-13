import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { KrogerService } from "./krogerService";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.KROGER_CLIENT_ID;
  delete process.env.KROGER_CLIENT_SECRET;
  delete process.env.KROGER_MOCK_LOCATION_ID;
});

function mockFetch(handler: typeof fetch): void {
  globalThis.fetch = handler;
}

describe("KrogerService.getClosestStoreLocation", () => {
  it("GETs locations with zipCode.near, limit 1, and the cached bearer token", async () => {
    process.env.KROGER_CLIENT_ID = "client-id";
    process.env.KROGER_CLIENT_SECRET = "client-secret";

    const calls: Array<{ url: string; authorization: string | null }> = [];
    mockFetch(async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ url, authorization: headers.get("Authorization") });

      if (url.includes("/connect/oauth2/token")) {
        return Response.json({ access_token: "test-token", expires_in: 1800 });
      }

      return Response.json({
        data: [{ locationId: "01400441", name: "Kroger Cincinnati" }],
      });
    });

    const service = new KrogerService();
    const locationId = await service.getClosestStoreLocation("45202");

    assert.equal(locationId, "01400441");
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/v1\/connect\/oauth2\/token$/);
    assert.match(calls[1].url, /filter\.zipCode\.near=45202/);
    assert.match(calls[1].url, /filter\.limit=1/);
    assert.equal(calls[1].authorization, "Bearer test-token");

    const again = await service.getClosestStoreLocation("45209");
    assert.equal(again, "01400441");
    assert.equal(calls.length, 3);
    assert.equal(calls[2].authorization, "Bearer test-token");
  });

  it("returns the demo locationId when API credentials are not configured", async () => {
    delete process.env.KROGER_CLIENT_ID;
    delete process.env.KROGER_CLIENT_SECRET;
    delete process.env.KROGER_MOCK_LOCATION_ID;
    let called = false;
    mockFetch(async () => {
      called = true;
      return Response.json({ data: [] });
    });

    const service = new KrogerService();
    const locationId = await service.getClosestStoreLocation("45202");
    assert.equal(locationId, "01400441");
    assert.equal(called, false);
  });

  it("falls back to the demo locationId when the token request is rejected", async () => {
    process.env.KROGER_CLIENT_ID = "client-id";
    process.env.KROGER_CLIENT_SECRET = "client-secret";
    mockFetch(async () =>
      Response.json({ error: "invalid_client", error_description: "invalid credentials" }, { status: 401 })
    );

    const service = new KrogerService();
    const locationId = await service.getClosestStoreLocation("45202");
    assert.equal(locationId, "01400441");
  });

  it("rejects an invalid ZIP before calling the API", async () => {
    const service = new KrogerService();
    await assert.rejects(
      () => service.getClosestStoreLocation("nearby"),
      /Invalid ZIP code/
    );
  });
});

describe("KrogerService.searchProducts", () => {
  it("GETs products with filter.term, locationId, and the bearer token", async () => {
    process.env.KROGER_CLIENT_ID = "client-id";
    process.env.KROGER_CLIENT_SECRET = "client-secret";

    const calls: string[] = [];
    mockFetch(async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/connect/oauth2/token")) {
        return Response.json({ access_token: "test-token", expires_in: 1800 });
      }
      return Response.json({
        data: [
          {
            productId: "0001111041700",
            brand: "Kroger",
            description: "Kroger 2% Reduced Fat Milk",
            items: [{ size: "1 gal", price: { regular: 3.49, promo: 2.99 } }],
          },
        ],
      });
    });

    const service = new KrogerService();
    const products = await service.searchProducts("milk", "01400441");
    assert.equal(products.length, 1);
    assert.equal(products[0].name, "Kroger 2% Reduced Fat Milk");
    assert.equal(products[0].brand, "Kroger");
    assert.equal(products[0].price, 2.99);
    assert.equal(products[0].unit, "gal");
    assert.equal(products[0].locationId, "01400441");
    assert.match(calls[1], /\/v1\/products\?/);
    assert.match(calls[1], /filter\.term=milk/);
    assert.match(calls[1], /filter\.locationId=01400441/);
    assert.match(calls[1], /filter\.limit=10/);
  });

  it("returns an empty list when credentials are missing", async () => {
    const service = new KrogerService();
    const products = await service.searchProducts("milk", "01400441");
    assert.deepEqual(products, []);
  });
});
