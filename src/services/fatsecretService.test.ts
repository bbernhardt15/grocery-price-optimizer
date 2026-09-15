import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  FatSecretService,
  type FatSecretHttp,
} from "./fatsecretService";

afterEach(() => {
  delete process.env.FATSECRET_CLIENT_ID;
  delete process.env.FATSECRET_CLIENT_SECRET;
});

function parseForm(body: string | undefined): URLSearchParams {
  return new URLSearchParams(body ?? "");
}

describe("FatSecretService", () => {
  it("POSTs client credentials as form fields and searches foods.search.v3 with a cached bearer token", async () => {
    process.env.FATSECRET_CLIENT_ID = "fs-id";
    process.env.FATSECRET_CLIENT_SECRET = "fs-secret";

    const calls: Array<{
      method: string;
      url: string;
      authorization?: string;
      auth?: unknown;
      contentType?: string;
      params?: Record<string, unknown>;
      body?: string;
    }> = [];

    const http: FatSecretHttp = {
      async post(url, data, config) {
        const headers = config?.headers as Record<string, string> | undefined;
        calls.push({
          method: "POST",
          url,
          auth: config?.auth,
          contentType: headers?.["Content-Type"],
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
                  },
                  {
                    food_id: "1641",
                    food_name: "Chicken Breast",
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
    assert.equal(calls[0].contentType, "application/x-www-form-urlencoded");
    assert.equal(calls[0].auth, undefined);

    const form = parseForm(calls[0].body);
    assert.equal(form.get("grant_type"), "client_credentials");
    assert.equal(form.get("scope"), "premier");
    assert.equal(form.get("client_id"), "fs-id");
    assert.equal(form.get("client_secret"), "fs-secret");

    assert.equal(calls[1].method, "GET");
    assert.equal(calls[1].url, "https://platform.fatsecret.com/rest/server.api");
    assert.equal(calls[1].authorization, "Bearer fs-token");
    assert.equal(calls[1].params?.method, "foods.search.v3");
    assert.equal(calls[1].params?.search_expression, "cheerios");
    assert.equal(calls[1].params?.format, "json");

    assert.deepEqual(products, [
      {
        id: "50953",
        name: "Whole Grain Cheerios",
        brand: "General Mills",
      },
      {
        id: "1641",
        name: "Chicken Breast",
        brand: "Generic",
      },
    ]);

    await service.searchGlobalCatalog("milk");
    assert.equal(calls.filter((call) => call.method === "POST").length, 1);
    assert.equal(calls.filter((call) => call.method === "GET").length, 2);
    assert.equal(calls[2].authorization, "Bearer fs-token");
  });

  it("re-authenticates when the cached token is close to expiring", async () => {
    process.env.FATSECRET_CLIENT_ID = "fs-id";
    process.env.FATSECRET_CLIENT_SECRET = "fs-secret";

    let tokenPosts = 0;
    const http: FatSecretHttp = {
      async post() {
        tokenPosts += 1;
        return { data: { access_token: `token-${tokenPosts}`, expires_in: 30 } };
      },
      async get(_url, config) {
        const headers = config?.headers as Record<string, string> | undefined;
        return {
          data: {
            foods: {
              food: {
                food_id: "1",
                food_name: "Milk",
                brand_name: "Generic",
              },
            },
          },
          authorization: headers?.Authorization,
        };
      },
    };

    const service = new FatSecretService(http);
    await service.searchGlobalCatalog("milk");
    await service.searchGlobalCatalog("eggs");
    assert.equal(tokenPosts, 2);
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
