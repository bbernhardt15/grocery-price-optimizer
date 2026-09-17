import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  addItemsToKrogerCart,
  buildKrogerAuthorizeUrl,
  exchangeAuthorizationCode,
  isKrogerCartOAuthConfigured,
  KrogerCartSessionStore,
  readKrogerOAuthConfig,
  toCartLines,
} from "./krogerCartAuth";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.KROGER_CLIENT_ID;
  delete process.env.KROGER_CLIENT_SECRET;
  delete process.env.KROGER_REDIRECT_URI;
  delete process.env.KROGER_CART_SCOPE;
});

describe("Kroger cart OAuth config", () => {
  it("is not configured from client-credentials alone", () => {
    process.env.KROGER_CLIENT_ID = "client-id";
    process.env.KROGER_CLIENT_SECRET = "client-secret";
    assert.equal(isKrogerCartOAuthConfigured(), false);
    assert.equal(readKrogerOAuthConfig(), null);
  });

  it("is configured when a redirect URI is also set", () => {
    process.env.KROGER_CLIENT_ID = "client-id";
    process.env.KROGER_CLIENT_SECRET = "client-secret";
    process.env.KROGER_REDIRECT_URI =
      "http://localhost:3000/api/kroger/oauth/callback";
    assert.equal(isKrogerCartOAuthConfigured(), true);
    const config = readKrogerOAuthConfig();
    assert.ok(config);
    assert.equal(config.scope, "cart.basic:write");
  });

  it("builds the authorization-code URL with cart scope and state", () => {
    const url = buildKrogerAuthorizeUrl(
      {
        clientId: "client-id",
        clientSecret: "secret",
        redirectUri: "http://localhost:3000/api/kroger/oauth/callback",
        scope: "cart.basic:write",
      },
      "state-1"
    );
    assert.match(url, /https:\/\/api\.kroger\.com\/v1\/connect\/oauth2\/authorize\?/);
    assert.match(url, /response_type=code/);
    assert.match(url, /client_id=client-id/);
    assert.match(url, /scope=cart\.basic%3Awrite/);
    assert.match(url, /state=state-1/);
  });
});

describe("toCartLines", () => {
  it("keeps only items with a UPC or productId", () => {
    assert.deepEqual(
      toCartLines([
        { quantity: 2, upc: "0001111041700" },
        { quantity: 1, productId: "0001111050101" },
        { quantity: 4 },
      ]),
      [
        { upc: "0001111041700", quantity: 2, modality: "PICKUP" },
        { upc: "0001111050101", quantity: 1, modality: "PICKUP" },
      ]
    );
  });
});

describe("addItemsToKrogerCart", () => {
  it("PUTs upc/quantity/modality and reports success only on HTTP 2xx", async () => {
    const bodies: unknown[] = [];
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "https://api.kroger.com/v1/cart/add");
      assert.equal(init?.method, "PUT");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("Authorization"), "Bearer shopper-token");
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 204 });
    };

    const result = await addItemsToKrogerCart("shopper-token", [
      { upc: "0001111041700", quantity: 2, modality: "PICKUP" },
    ]);
    assert.deepEqual(result, { ok: true, status: 204, added: 1 });
    assert.deepEqual(bodies, [
      {
        items: [{ upc: "0001111041700", quantity: 2, modality: "PICKUP" }],
      },
    ]);
  });

  it("does not invent a successful cart fill when Kroger rejects the write", async () => {
    globalThis.fetch = async () =>
      Response.json(
        { error: "access_denied", error_description: "insufficient scope" },
        { status: 403 }
      );

    const result = await addItemsToKrogerCart("shopper-token", [
      { upc: "0001111041700", quantity: 1, modality: "PICKUP" },
    ]);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.added, 0);
      assert.equal(result.status, 403);
      assert.match(result.error, /insufficient scope/);
    }
  });
});

describe("exchangeAuthorizationCode", () => {
  it("POSTs grant_type=authorization_code with the registered redirect URI", async () => {
    globalThis.fetch = async (input, init) => {
      assert.equal(
        String(input),
        "https://api.kroger.com/v1/connect/oauth2/token"
      );
      assert.equal(
        new URLSearchParams(String(init?.body)).get("grant_type"),
        "authorization_code"
      );
      return Response.json({ access_token: "shopper", expires_in: 1800 });
    };

    const token = await exchangeAuthorizationCode(
      {
        clientId: "id",
        clientSecret: "secret",
        redirectUri: "http://localhost:3000/api/kroger/oauth/callback",
        scope: "cart.basic:write",
      },
      "code-1"
    );
    assert.equal(token.accessToken, "shopper");
  });
});

describe("KrogerCartSessionStore", () => {
  it("returns pending carts once, then forgets them", () => {
    const store = new KrogerCartSessionStore(() => 1_000);
    store.savePending("abc", {
      items: [{ upc: "1", quantity: 1, modality: "PICKUP" }],
    });
    assert.equal(store.takePending("abc")?.items[0].upc, "1");
    assert.equal(store.takePending("abc"), undefined);
  });

  it("drops expired shopper tokens instead of reusing them", () => {
    let now = 1_000;
    const store = new KrogerCartSessionStore(() => now);
    store.saveShopper("sess", {
      accessToken: "tok",
      expiresAtMs: 2_000,
    });
    assert.equal(store.getShopper("sess")?.accessToken, "tok");
    now = 2_500;
    assert.equal(store.getShopper("sess"), undefined);
  });
});
