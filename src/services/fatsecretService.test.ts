import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  FatSecretService,
  type FatSecretHttp,
} from "./fatsecretService";

afterEach(() => {
  delete process.env.FATSECRET_CLIENT_ID;
  delete process.env.FATSECRET_CLIENT_SECRET;
  delete process.env.FATSECRET_SCOPE;
});

describe("FatSecretService", () => {
  it("POSTs client-credentials with basic auth and searches foods with the cached bearer token", async () => {
    process.env.FATSECRET_CLIENT_ID = "fs-id";
    process.env.FATSECRET_CLIENT_SECRET = "fs-secret";

    const calls: Array<{
      method: string;
      url: string;
      authorization?: string;
      auth?: { username: string; password: string };
      params?: Record<string, unknown>;
      body?: string;
    }> = [];

    const http: FatSecretHttp = {
      async post(url, data, config) {
        calls.push({
          method: "POST",
          url,
          auth: config?.auth as { username: string; password: string },
          body: String(data),
        });
        return {
          data: { access_token: "fs-token", expires_in: 86400 },
        };
      },
      async get(url, config) {
        const headers = config?.headers as Record<string, string> | undefined;
        calls.push({
          method: "GET",
          url,
          authorization: headers?.Authorization,
          params: config?.params as Record<string, unknown>,
        });
        return {
          data: {
            foods_search: {
              results: {
                food: [
                  {
                    food_id: "50953",
                    food_name: "Whole Grain Cheerios",
                    brand_name: "General Mills",
                    food_type: "Brand",
                  },
                  {
                    food_id: "1641",
                    food_name: "Chicken Breast",
                    food_type: "Generic",
                  },
                ],
              },
            },
          },
        };
      },
    };

    const service = new FatSecretService(http);
    const products = await service.searchGlobalCatalog("cheerios");

    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].url, "https://oauth.fatsecret.com/connect/token");
    assert.deepEqual(calls[0].auth, { username: "fs-id", password: "fs-secret" });
    assert.match(String(calls[0].body), /grant_type=client_credentials/);

    assert.equal(calls[1].method, "GET");
    assert.equal(
      calls[1].url,
      "https://platform.fatsecret.com/rest/foods/search/v5"
    );
    assert.equal(calls[1].authorization, "Bearer fs-token");
    assert.equal(calls[1].params?.search_expression, "cheerios");
    assert.equal(calls[1].params?.format, "json");

    assert.deepEqual(products, [
      {
        name: "Whole Grain Cheerios",
        brand: "General Mills",
        foodId: "50953",
      },
      {
        name: "Chicken Breast",
        brand: "Generic",
        foodId: "1641",
      },
    ]);

    await service.searchGlobalCatalog("milk");
    assert.equal(calls.filter((call) => call.method === "POST").length, 1);
    assert.equal(calls.filter((call) => call.method === "GET").length, 2);
    assert.equal(calls[2].authorization, "Bearer fs-token");
  });

  it("returns an empty array for a blank query without calling the API", async () => {
    let called = false;
    const http: FatSecretHttp = {
      async post() {
        called = true;
        return { data: {} };
      },
      async get() {
        called = true;
        return { data: {} };
      },
    };

    const service = new FatSecretService(http);
    assert.deepEqual(await service.searchGlobalCatalog("  "), []);
    assert.equal(called, false);
  });

  it("throws when FatSecret credentials are missing", async () => {
    const service = new FatSecretService({
      async post() {
        return { data: {} };
      },
      async get() {
        return { data: {} };
      },
    });
    await assert.rejects(
      () => service.searchGlobalCatalog("milk"),
      /FATSECRET_CLIENT_ID/
    );
  });
});
