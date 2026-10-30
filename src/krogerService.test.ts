import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { KrogerPricingError, KrogerService } from "./krogerService";

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

  it("returns null from the strict lookup when the locations call fails", async () => {
    process.env.KROGER_CLIENT_ID = "client-id";
    process.env.KROGER_CLIENT_SECRET = "client-secret";
    mockFetch(async (input) => {
      const url = String(input);
      if (url.includes("/connect/oauth2/token")) {
        return Response.json({ access_token: "test-token", expires_in: 1800 });
      }
      return Response.json({ error: "bad zip" }, { status: 400 });
    });
    const service = new KrogerService();
    assert.equal(await service.getClosestStoreLocationStrict("45202"), null);
    assert.equal(await service.getClosestStoreLocation("45202"), "01400441");
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
    assert.equal(products[0].onSale, true);
    assert.equal(products[0].regularPrice, 3.49);
    assert.equal(products[0].unit, "gal");
    assert.equal(products[0].locationId, "01400441");
    assert.equal(products[0].productId, "0001111041700");
    assert.equal(products[0].upc, "0001111041700");
    assert.match(calls[1], /\/v1\/products\?/);
    assert.match(calls[1], /filter\.term=milk/);
    assert.match(calls[1], /filter\.locationId=01400441/);
    assert.match(calls[1], /filter\.limit=25/);
  });

  it("uses a later item when the first SKU has no price", async () => {
    process.env.KROGER_CLIENT_ID = "client-id";
    process.env.KROGER_CLIENT_SECRET = "client-secret";
    mockFetch(async (input) => {
      const url = String(input);
      if (url.includes("/connect/oauth2/token")) {
        return Response.json({ access_token: "test-token", expires_in: 1800 });
      }
      return Response.json({
        data: [
          {
            productId: "cheerios",
            brand: "General Mills",
            description: "Honey Nut Cheerios Cereal",
            items: [
              { size: "12 oz" },
              { size: "12 oz", price: { regular: 4.29, promo: 0 } },
            ],
          },
        ],
      });
    });

    const service = new KrogerService();
    const products = await service.searchProducts("Cheerios", "01400441");
    assert.equal(products.length, 1);
    assert.equal(products[0].name, "Honey Nut Cheerios Cereal");
    assert.equal(products[0].price, 4.29);
    assert.equal(products[0].onSale, undefined);
    assert.equal(products[0].regularPrice, undefined);
  });

  it("falls back to nationalPrice when location prices are missing", async () => {
    process.env.KROGER_CLIENT_ID = "client-id";
    process.env.KROGER_CLIENT_SECRET = "client-secret";
    mockFetch(async (input) => {
      const url = String(input);
      if (url.includes("/connect/oauth2/token")) {
        return Response.json({ access_token: "test-token", expires_in: 1800 });
      }
      if (url.includes("filter.locationId")) {
        return Response.json({
          data: [
            {
              productId: "honey",
              brand: "Sue Bee",
              description: "Sue Bee Clover Honey",
              items: [{ size: "12 oz" }],
            },
          ],
        });
      }
      return Response.json({
        data: [
          {
            productId: "honey",
            brand: "Sue Bee",
            description: "Sue Bee Clover Honey",
            items: [{ size: "12 oz", nationalPrice: { regular: 5.49 } }],
          },
        ],
      });
    });

    const service = new KrogerService();
    const products = await service.searchProducts("Honey", "01400441");
    assert.equal(products.length, 1);
    assert.equal(products[0].price, 5.49);
    assert.equal(products[0].locationId, "01400441");
  });

  it("throws when credentials are missing instead of pretending the catalog is empty", async () => {
    const service = new KrogerService();
    await assert.rejects(
      () => service.searchProducts("milk", "01400441"),
      (error: unknown) => {
        assert.ok(error instanceof KrogerPricingError);
        assert.equal(error.code, "missing_credentials");
        assert.match(error.message, /KROGER_CLIENT_ID/);
        return true;
      }
    );
  });

  it("omits filter.start on the first page and refuses a start above 250", async () => {
    process.env.KROGER_CLIENT_ID = "client-id";
    process.env.KROGER_CLIENT_SECRET = "client-secret";
    const urls: string[] = [];
    mockFetch(async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/connect/oauth2/token")) {
        return Response.json({ access_token: "test-token", expires_in: 1800 });
      }
      return Response.json({ data: [] });
    });
    const service = new KrogerService();
    await service.searchProductsPage({ term: "milk", start: 0, limit: 50 });
    const firstPage = urls.find((url) => url.includes("/products"));
    assert.ok(firstPage);
    assert.equal(firstPage.includes("filter.start"), false);
    await service.searchProductsPage({ term: "milk", start: 250, limit: 50 });
    const paged = urls.filter((url) => url.includes("/products")).at(-1) ?? "";
    assert.match(paged, /filter\.start=250/);
    await assert.rejects(
      () => service.searchProductsPage({ term: "body wash", start: 300, limit: 50 }),
      (error: unknown) => {
        assert.ok(error instanceof KrogerPricingError);
        assert.equal(error.status, 400);
        assert.match(error.message, /was not sent/);
        return true;
      }
    );
    assert.equal(urls.some((url) => url.includes("filter.start=300")), false);
  });

  it("attaches the response body when Products returns 400", async () => {
    process.env.KROGER_CLIENT_ID = "client-id";
    process.env.KROGER_CLIENT_SECRET = "client-secret";
    mockFetch(async (input) => {
      const url = String(input);
      if (url.includes("/connect/oauth2/token")) {
        return Response.json({ access_token: "test-token", expires_in: 1800 });
      }
      return new Response(JSON.stringify({ errors: [{ reason: "filter.start out of range" }] }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    });
    const service = new KrogerService();
    await assert.rejects(
      () => service.searchProductsPage({ term: "milk", locationId: "01400902", start: 250, limit: 50 }),
      (error: unknown) => {
        assert.ok(error instanceof KrogerPricingError);
        assert.equal(error.status, 400);
        assert.match(error.body ?? "", /filter\.start/);
        return true;
      }
    );
  });

  it("throws when the products request is rejected", async () => {
    process.env.KROGER_CLIENT_ID = "client-id";
    process.env.KROGER_CLIENT_SECRET = "client-secret";
    mockFetch(async (input) => {
      const url = String(input);
      if (url.includes("/connect/oauth2/token")) {
        return Response.json({ access_token: "test-token", expires_in: 1800 });
      }
      return Response.json({ error: "access_denied" }, { status: 403 });
    });

    const service = new KrogerService();
    await assert.rejects(
      () => service.searchProducts("Cheerios", "01400441"),
      /Kroger products request failed \(403\)/
    );
  });

  it("looks up one product by filter.productId and does not send filter.term", async () => {
    process.env.KROGER_CLIENT_ID = "client-id";
    process.env.KROGER_CLIENT_SECRET = "client-secret";
    const urls: string[] = [];
    mockFetch(async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/connect/oauth2/token")) {
        return Response.json({ access_token: "test-token", expires_in: 1800 });
      }
      return Response.json({
        data: [
          {
            productId: "0004900004256",
            upc: "0004900004256",
            brand: "Coca-Cola",
            description: "Coca-Cola Classic",
            categories: ["Beverages"],
            items: [{ price: { regular: 1.25 }, size: "12 fl oz" }],
          },
        ],
      });
    });
    const service = new KrogerService();
    const page = await service.productsById("0004900004256", "01400431");
    assert.equal(page.returned, 1);
    assert.equal(page.products[0]?.productId, "0004900004256");
    const productUrl = urls.find((url) => url.includes("/products"));
    assert.ok(productUrl);
    assert.match(productUrl, /filter\.productId=0004900004256/);
    assert.match(productUrl, /filter\.locationId=01400431/);
    assert.equal(productUrl.includes("filter.term"), false);

    const padded = await service.productsById("070708200500", "01400431");
    assert.equal(padded.returned, 1);
    const paddedUrl = urls.filter((url) => url.includes("/products")).at(-1) ?? "";
    assert.match(paddedUrl, /filter\.productId=0007070820050/);
    const numeric = await service.productsById("70708200500");
    assert.equal(numeric.returned, 1);
    const numericUrl = urls.filter((url) => url.includes("/products")).at(-1) ?? "";
    assert.match(numericUrl, /filter\.productId=0007070820050/);
  });
});
