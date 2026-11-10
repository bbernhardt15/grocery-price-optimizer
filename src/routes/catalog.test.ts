import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import app from "../app";
import { fatSecretService } from "./catalog";

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

  it("returns FatSecret matches as a JSON array", async () => {
    fatSecretService.searchGlobalCatalog = async (query: string) => {
      assert.equal(query, "milk");
      return [
        {
          id: "50953",
          name: "Whole Milk",
          brand: "Friendly Farms",
        },
      ];
    };

    const response = await fetch(`${origin}/api/search-catalog?query=milk&zip=45202`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as Array<{
      id: string;
      name: string;
      brand: string;
    }>;
    assert.equal(Array.isArray(body), true);
    assert.equal(body[0].id, "50953");
    assert.equal(body[0].name, "Whole Milk");
    assert.equal(body[0].brand, "Friendly Farms");
    const dumped = JSON.stringify(body);
    assert.equal(/price|bestPrice|storeName|offers/i.test(dumped), false);
  });

  it("returns 400 when the query parameter is missing", async () => {
    let called = false;
    fatSecretService.searchGlobalCatalog = async () => {
      called = true;
      return [];
    };

    const response = await fetch(`${origin}/api/search-catalog`);
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /query/i);
    assert.equal(called, false);
  });

  it("returns 400 without a ZIP and 422 outside the service area", async () => {
    let called = false;
    fatSecretService.searchGlobalCatalog = async () => {
      called = true;
      return [{ id: "1", name: "Whole Milk", brand: "Friendly Farms" }];
    };
    const missing = await fetch(`${origin}/api/search-catalog?query=milk`);
    assert.equal(missing.status, 400);
    const missingBody = JSON.stringify(await missing.json());
    assert.equal(/typicalPrice|valuePer|Whole Milk|Friendly/.test(missingBody), false);
    const outside = await fetch(`${origin}/api/search-catalog?query=milk&zip=04101`);
    assert.equal(outside.status, 422);
    const outsideBody = (await outside.json()) as { code?: string };
    assert.equal(outsideBody.code, "not_in_service_area");
    assert.equal(/typicalPrice|valuePer|Whole Milk|Friendly/.test(JSON.stringify(outsideBody)), false);
    assert.equal(called, false);
  });

  it("returns demo catalog matches when FatSecret fails without crashing the server", async () => {
    fatSecretService.searchGlobalCatalog = async () => {
      throw new Error(
        "FatSecret API credentials are missing. Set FATSECRET_CLIENT_ID and FATSECRET_CLIENT_SECRET."
      );
    };

    const failed = await fetch(`${origin}/api/search-catalog?query=milk&zip=45202`);
    assert.equal(failed.status, 200);
    const failedBody = (await failed.json()) as Array<{ name: string; brand: string }>;
    assert.ok(failedBody.some((product) => /milk/i.test(product.name)));

    fatSecretService.searchGlobalCatalog = async () => [
      { id: "1", name: "Eggs", brand: "Generic" },
    ];
    const recovered = await fetch(`${origin}/api/search-catalog?query=eggs&zip=45202`);
    assert.equal(recovered.status, 200);
    const recoveredBody = (await recovered.json()) as Array<{ name: string }>;
    assert.equal(recoveredBody[0].name, "Eggs");
  });

  it("returns 500 when FatSecret fails and no demo matches exist", async () => {
    fatSecretService.searchGlobalCatalog = async () => {
      throw new Error("Invalid IP address detected");
    };

    const response = await fetch(`${origin}/api/search-catalog?query=zzzz-not-a-product&zip=45202`);
    assert.equal(response.status, 500);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /Invalid IP address detected/);
  });
});
