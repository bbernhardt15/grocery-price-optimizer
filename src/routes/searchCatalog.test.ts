import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import app from "../app";
import { fatSecretService } from "../services/fatsecretService";

describe("GET /api/search-catalog", () => {
  let server: http.Server;
  let origin: string;
  const originalSearch = fatSecretService.searchGlobalCatalog.bind(fatSecretService);

  before(async () => {
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    fatSecretService.searchGlobalCatalog = originalSearch;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("returns FatSecret matches for a query", async () => {
    fatSecretService.searchGlobalCatalog = async (query: string) => {
      assert.equal(query, "cheerios");
      return [
        {
          name: "Whole Grain Cheerios",
          brand: "General Mills",
          foodId: "50953",
        },
      ];
    };

    const response = await fetch(`${origin}/api/search-catalog?query=cheerios`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      products: Array<{ name: string; brand: string; foodId: string }>;
    };
    assert.equal(body.products[0].name, "Whole Grain Cheerios");
    assert.equal(body.products[0].foodId, "50953");
  });

  it("returns an empty list for short queries", async () => {
    let called = false;
    fatSecretService.searchGlobalCatalog = async () => {
      called = true;
      return [];
    };
    const response = await fetch(`${origin}/api/search-catalog?query=m`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { products: unknown[] };
    assert.deepEqual(body.products, []);
    assert.equal(called, false);
  });

  it("falls back to the seeded catalog when FatSecret credentials are missing", async () => {
    fatSecretService.searchGlobalCatalog = async () => {
      throw new Error(
        "FatSecret API credentials are missing. Set FATSECRET_CLIENT_ID and FATSECRET_CLIENT_SECRET."
      );
    };

    const response = await fetch(`${origin}/api/search-catalog?query=milk`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      products: Array<{ name: string; foodId: string }>;
      source?: string;
    };
    assert.equal(body.source, "demo");
    assert.ok(body.products.some((product) => /milk/i.test(product.name)));
  });
});
