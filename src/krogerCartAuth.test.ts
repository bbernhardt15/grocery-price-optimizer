import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  addItemsToKrogerCart,
  buildKrogerAuthorizeUrl,
  cartAddPayload,
  exchangeAuthorizationCode,
  isKrogerCartOAuthConfigured,
  KrogerCartSessionStore,
  normalizeKrogerUpc,
  readCartModality,
  readKrogerOAuthConfig,
  refreshShopperToken,
  sealShopperToken,
  signCartState,
  toCartLines,
  unsealShopperToken,
  verifyCartState,
} from "./krogerCartAuth";

const originalFetch = globalThis.fetch;

const config = {
  clientId: "client-id",
  clientSecret: "secret",
  redirectUri: "http://localhost:3000/api/kroger/oauth/callback",
  scope: "cart.basic:write",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.KROGER_CLIENT_ID;
  delete process.env.KROGER_CLIENT_SECRET;
  delete process.env.KROGER_REDIRECT_URI;
  delete process.env.KROGER_CART_SCOPE;
  delete process.env.KROGER_CART_MODALITY;
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
    const oauth = readKrogerOAuthConfig();
    assert.ok(oauth);
    assert.equal(oauth.scope, "cart.basic:write");
  });

  it("reads PICKUP/DELIVERY modality from env and defaults to PICKUP", () => {
    assert.equal(readCartModality(), "PICKUP");
    process.env.KROGER_CART_MODALITY = "delivery";
    assert.equal(readCartModality(), "DELIVERY");
    process.env.KROGER_CART_MODALITY = "DRIVE_THRU";
    assert.equal(readCartModality(), "PICKUP");
  });

  it("builds the authorization-code URL with cart scope and state", () => {
    const url = buildKrogerAuthorizeUrl(config, "state-1");
    assert.match(url, /https:\/\/api\.kroger\.com\/v1\/connect\/oauth2\/authorize\?/);
    assert.match(url, /response_type=code/);
    assert.match(url, /client_id=client-id/);
    assert.match(url, /scope=cart\.basic%3Awrite/);
    assert.match(url, /state=state-1/);
    assert.match(url, /redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fkroger%2Foauth%2Fcallback/);
  });
});

describe("normalizeKrogerUpc + toCartLines", () => {
  it("pads numeric UPCs to 13 digits and drops junk", () => {
    assert.equal(normalizeKrogerUpc("1111041700"), "0001111041700");
    assert.equal(normalizeKrogerUpc("0001111041700"), "0001111041700");
    assert.equal(normalizeKrogerUpc("upc: 000-11110-40101"), "0001111040101");
    assert.equal(normalizeKrogerUpc("abc"), undefined);
    assert.equal(normalizeKrogerUpc("123"), undefined);
  });

  it("keeps only items with a UPC or productId and shapes cart lines", () => {
    process.env.KROGER_CART_MODALITY = "DELIVERY";
    assert.deepEqual(
      toCartLines([
        { quantity: 2, upc: "0001111041700", name: "Whole Milk" },
        { quantity: 1, productId: "1111050101" },
        { quantity: 4 },
      ]),
      [
        {
          upc: "0001111041700",
          quantity: 2,
          modality: "DELIVERY",
          name: "Whole Milk",
        },
        { upc: "0001111050101", quantity: 1, modality: "DELIVERY" },
      ]
    );
  });

  it("strips item names from the PUT /v1/cart/add payload", () => {
    assert.deepEqual(
      cartAddPayload([
        {
          upc: "0001111041700",
          quantity: 2,
          modality: "PICKUP",
          name: "Whole Milk",
        },
      ]),
      {
        items: [{ upc: "0001111041700", quantity: 2, modality: "PICKUP" }],
      }
    );
  });
});

describe("signed OAuth cart state", () => {
  const cart = {
    items: [
      { upc: "0001111041700", quantity: 2, modality: "PICKUP", name: "Milk" },
    ],
    locationId: "01400441",
  };

  it("round-trips pending cart items through HMAC-signed state", () => {
    const now = 1_700_000_000_000;
    const state = signCartState(config, cart, now);
    const verified = verifyCartState(config, state, now + 1_000);
    assert.ok(verified);
    assert.equal(verified.locationId, "01400441");
    assert.deepEqual(verified.items, cart.items);
    assert.equal(verified.exp, now + 15 * 60 * 1000);
  });

  it("rejects tampered state and expired state", () => {
    const now = 1_700_000_000_000;
    const state = signCartState(config, cart, now);
    assert.equal(verifyCartState(config, `${state}x`, now), null);
    assert.equal(verifyCartState(config, state, now + 16 * 60 * 1000), null);
    const otherSecret = { ...config, clientSecret: "other" };
    assert.equal(verifyCartState(otherSecret, state, now), null);
  });
});

describe("shopper cookie seal", () => {
  it("encrypts and decrypts a shopper token without writing it to disk", () => {
    const token = {
      accessToken: "shopper-access",
      refreshToken: "shopper-refresh",
      expiresAtMs: Date.now() + 60_000,
    };
    const sealed = sealShopperToken("secret", token);
    assert.notEqual(sealed, token.accessToken);
    assert.doesNotMatch(sealed, /shopper-access/);
    assert.deepEqual(unsealShopperToken("secret", sealed), token);
    assert.equal(unsealShopperToken("other", sealed), undefined);
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
      { upc: "0001111041700", quantity: 2, modality: "PICKUP", name: "Milk" },
    ]);
    assert.deepEqual(result, { ok: true, status: 204, added: 2 });
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
      const params = new URLSearchParams(String(init?.body));
      assert.equal(params.get("grant_type"), "authorization_code");
      assert.equal(
        params.get("redirect_uri"),
        "http://localhost:3000/api/kroger/oauth/callback"
      );
      assert.equal(params.get("code"), "code-1");
      const headers = new Headers(init?.headers);
      assert.match(headers.get("Authorization") ?? "", /^Basic /);
      return Response.json({
        access_token: "shopper",
        refresh_token: "refresh-1",
        expires_in: 1800,
      });
    };

    const token = await exchangeAuthorizationCode(config, "code-1");
    assert.equal(token.accessToken, "shopper");
    assert.equal(token.refreshToken, "refresh-1");
  });

  it("refreshes a shopper token with grant_type=refresh_token, not client_credentials", async () => {
    globalThis.fetch = async (_input, init) => {
      const params = new URLSearchParams(String(init?.body));
      assert.equal(params.get("grant_type"), "refresh_token");
      assert.equal(params.get("refresh_token"), "refresh-1");
      assert.equal(params.get("grant_type") === "client_credentials", false);
      return Response.json({ access_token: "shopper-2", expires_in: 1800 });
    };

    const token = await refreshShopperToken(config, "refresh-1");
    assert.equal(token.accessToken, "shopper-2");
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
