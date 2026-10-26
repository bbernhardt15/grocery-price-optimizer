import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, describe, it } from "node:test";
import app from "../app";
import {
  KROGER_SHOPPER_COOKIE,
  readKrogerOAuthConfig,
  sealShopperToken,
  signCartState,
  verifyCartState,
} from "../krogerCartAuth";

const originalFetch = globalThis.fetch;

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

type RawResponse = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
};

/** Does not follow redirects, and does not add an Accept header. */
function rawRequest(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<RawResponse> {
  const target = new URL(url);
  const headers = { ...(init.headers ?? {}) };
  if (init.body !== undefined && headers["Content-Length"] === undefined && headers["content-length"] === undefined) {
    headers["Content-Length"] = String(Buffer.byteLength(init.body));
  }
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: init.method ?? "GET",
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    req.on("error", reject);
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}

function appReturn(html: string): { kind: string; message: string } {
  const match = html.match(/location\.replace\(("(?:\\.|[^"\\])*")\)/);
  assert.ok(match, "callback should send the shopper back to the app");
  const path = JSON.parse(match[1]) as string;
  const url = new URL(path, "https://grocery.example");
  assert.equal(url.origin, "https://grocery.example");
  assert.equal(url.pathname, "/");
  return {
    kind: url.searchParams.get("kroger") ?? "",
    message: url.searchParams.get("message") ?? "",
  };
}

describe("Kroger cart handoff routes", () => {
  let server: http.Server;
  let origin: string;

  before(async () => {
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.KROGER_CLIENT_ID;
    delete process.env.KROGER_CLIENT_SECRET;
    delete process.env.KROGER_REDIRECT_URI;
    delete process.env.KROGER_CART_SCOPE;
    delete process.env.KROGER_CART_MODALITY;
  });

  function enableOAuth(): void {
    process.env.KROGER_CLIENT_ID = "id";
    process.env.KROGER_CLIENT_SECRET = "secret";
    process.env.KROGER_REDIRECT_URI = `${origin}/api/kroger/oauth/callback`;
  }

  it("reports that shopper OAuth is required even when client-credentials exist", async () => {
    process.env.KROGER_CLIENT_ID = "id";
    process.env.KROGER_CLIENT_SECRET = "secret";
    const response = await fetch(`${origin}/api/kroger/auth-status`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      oauthConfigured: boolean;
      requiresShopperLogin: boolean;
      redirectUri: string | null;
    };
    assert.equal(body.oauthConfigured, false);
    assert.equal(body.requiresShopperLogin, true);
    assert.equal(body.redirectUri, null);
  });

  it("does not start a cart fill when redirect URI is missing", async () => {
    const response = await fetch(`${origin}/api/kroger/cart/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        items: [{ upc: "0001111041700", quantity: 1 }],
      }),
    });
    assert.equal(response.status, 501);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /KROGER_REDIRECT_URI/);
  });

  it("refuses cart start when items have no UPC", async () => {
    enableOAuth();
    const response = await fetch(`${origin}/api/kroger/cart/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        items: [{ name: "Gallon of Milk", quantity: 1 }],
      }),
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /UPC/);
  });

  it("returns a Kroger authorize URL whose state round-trips the cart payload", async () => {
    enableOAuth();
    const response = await fetch(`${origin}/api/kroger/cart/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        items: [{ upc: "1111041700", quantity: 2, name: "Whole Milk" }],
        locationId: "01400441",
      }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      authorizeUrl: string;
      status: string;
      itemCount: number;
    };
    assert.equal(body.status, "needs_shopper_login");
    assert.equal(body.itemCount, 1);
    assert.match(body.authorizeUrl, /connect\/oauth2\/authorize/);
    assert.match(body.authorizeUrl, /response_type=code/);

    const authorize = new URL(body.authorizeUrl);
    const state = authorize.searchParams.get("state");
    assert.ok(state);
    const config = readKrogerOAuthConfig();
    assert.ok(config);
    const pending = verifyCartState(config, state);
    assert.ok(pending);
    assert.equal(pending.items[0].upc, "0001111041700");
    assert.equal(pending.items[0].quantity, 2);
    assert.equal(pending.items[0].name, "Whole Milk");
    assert.equal(pending.locationId, "01400441");
  });

  it("returns JSON authorizeUrl for a JSON POST with no Accept header", async () => {
    enableOAuth();
    const items = [{ upc: "1111041700", quantity: 2, name: "Whole Milk" }];
    const response = await rawRequest(`${origin}/api/kroger/cart/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, locationId: "01400441" }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.location, undefined);
    assert.match(String(response.headers["content-type"] ?? ""), /application\/json/);
    const body = JSON.parse(response.body) as {
      authorizeUrl: string;
      status: string;
      itemCount: number;
    };
    assert.equal(body.status, "needs_shopper_login");
    assert.equal(body.itemCount, 1);
    assert.match(body.authorizeUrl, /connect\/oauth2\/authorize/);
    const state = new URL(body.authorizeUrl).searchParams.get("state");
    assert.ok(state);
    const config = readKrogerOAuthConfig();
    assert.ok(config);
    const pending = verifyCartState(config, state);
    assert.equal(pending?.items[0]?.upc, "0001111041700");
    assert.equal(pending?.locationId, "01400441");

    const htmlAccept = await rawRequest(`${origin}/api/kroger/cart/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/html,application/xhtml+xml",
      },
      body: JSON.stringify({ items }),
    });
    assert.equal(htmlAccept.status, 200);
    const htmlBody = JSON.parse(htmlAccept.body) as { authorizeUrl: string; status: string };
    assert.equal(htmlBody.status, "needs_shopper_login");
    assert.match(htmlBody.authorizeUrl, /connect\/oauth2\/authorize/);
  });

  it("keeps the Kroger redirect for a non-JSON browser form post", async () => {
    enableOAuth();
    const response = await rawRequest(`${origin}/api/kroger/cart/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "text/html",
      },
      body: new URLSearchParams({
        items: JSON.stringify([{ upc: "1111041700", quantity: 1, name: "Milk" }]),
      }).toString(),
    });
    assert.equal(response.status, 302);
    const location = String(response.headers.location ?? "");
    assert.match(location, /^https:\/\/api\.kroger\.com\/v1\/connect\/oauth2\/authorize\?/);
    assert.match(location, /response_type=code/);
    assert.doesNotMatch(response.body, /authorizeUrl/);
  });

  it("does not claim a cart fill when the OAuth callback has no pending items", async () => {
    enableOAuth();
    const response = await fetch(
      `${origin}/api/kroger/oauth/callback?code=abc&state=missing`
    );
    assert.equal(response.status, 400);
    const html = await response.text();
    assert.match(html, /session expired/i);
    assert.match(html, /Grocery Gitter/);
    assert.doesNotMatch(html, /Added to your Kroger cart/);
    const back = appReturn(html);
    assert.equal(back.kind, "error");
    assert.match(back.message, /session expired/i);
    assert.doesNotMatch(back.message, /accepted/i);
  });

  it("falls back to Open at Kroger when the shopper cancels login", async () => {
    enableOAuth();
    const config = readKrogerOAuthConfig();
    assert.ok(config);
    const state = signCartState(config, {
      items: [{ upc: "0001111041700", quantity: 1, modality: "PICKUP", name: "Milk" }],
    });
    const response = await fetch(
      `${origin}/api/kroger/oauth/callback?error=access_denied&error_description=user+denied&state=${encodeURIComponent(state)}`
    );
    assert.equal(response.status, 400);
    const html = await response.text();
    assert.match(html, /login was not completed/i);
    assert.match(html, /kroger\.com\/search/);
    assert.doesNotMatch(html, /Added to your Kroger cart/);
    const back = appReturn(html);
    assert.equal(back.kind, "error");
    assert.match(back.message, /login was not completed/i);
    assert.match(back.message, /Open at Kroger/i);
    assert.doesNotMatch(back.message, /accepted \d+ item/i);
  });

  it("exchanges the code and reports success only after Kroger cart add 2xx", async () => {
    enableOAuth();
    const config = readKrogerOAuthConfig();
    assert.ok(config);
    const state = signCartState(config, {
      items: [
        { upc: "0001111041700", quantity: 2, modality: "PICKUP", name: "Milk" },
      ],
    });

    const calls: Array<{ url: string; method?: string; body: string }> = [];
    globalThis.fetch = async (input, init) => {
      const url = requestUrl(input);
      if (url.startsWith(origin)) {
        return originalFetch(input, init);
      }
      calls.push({ url, method: init?.method, body: String(init?.body ?? "") });
      if (url.includes("/connect/oauth2/token")) {
        return Response.json({
          access_token: "shopper-access",
          refresh_token: "shopper-refresh",
          expires_in: 1800,
        });
      }
      if (url.endsWith("/cart/add")) {
        assert.equal(init?.method, "PUT");
        const payload = JSON.parse(String(init?.body)) as {
          items: Array<{ upc: string; name?: string }>;
        };
        assert.equal(payload.items[0].upc, "0001111041700");
        assert.equal(payload.items[0].name, undefined);
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const response = await fetch(
      `${origin}/api/kroger/oauth/callback?code=auth-code&state=${encodeURIComponent(state)}`
    );
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Added to your Kroger cart/);
    assert.match(html, /accepted 2 items/i);
    assert.match(html, /kroger\.com\/cart/);
    const back = appReturn(html);
    assert.equal(back.kind, "added");
    assert.match(back.message, /accepted 2 items/i);
    assert.match(back.message, /kroger\.com/i);
    assert.equal(calls.length, 2);
    assert.match(calls[0].body, /grant_type=authorization_code/);
    assert.doesNotMatch(calls[0].body, /client_credentials/);
    const cookie = response.headers.get("set-cookie") ?? "";
    assert.match(cookie, new RegExp(`${KROGER_SHOPPER_COOKIE}=`));
  });

  it("does not claim a cart fill when Kroger cart add returns 403", async () => {
    enableOAuth();
    const config = readKrogerOAuthConfig();
    assert.ok(config);
    const state = signCartState(config, {
      items: [{ upc: "0001111041700", quantity: 1, modality: "PICKUP" }],
    });

    globalThis.fetch = async (input, init) => {
      const url = requestUrl(input);
      if (url.startsWith(origin)) {
        return originalFetch(input, init);
      }
      if (url.includes("/connect/oauth2/token")) {
        return Response.json({ access_token: "shopper-access", expires_in: 1800 });
      }
      return Response.json(
        { error_description: "insufficient scope" },
        { status: 403 }
      );
    };

    const response = await fetch(
      `${origin}/api/kroger/oauth/callback?code=auth-code&state=${encodeURIComponent(state)}`
    );
    assert.equal(response.status, 403);
    const html = await response.text();
    assert.match(html, /did not add items/i);
    assert.match(html, /insufficient scope/);
    assert.match(html, /kroger\.com\/search/);
    assert.doesNotMatch(html, /Added to your Kroger cart/);
    const back = appReturn(html);
    assert.equal(back.kind, "error");
    assert.match(back.message, /did not add/i);
    assert.match(back.message, /insufficient scope/);
    assert.doesNotMatch(back.message, /accepted \d+ item/i);
  });

  it("reuses a shopper cookie to PUT cart/add without starting OAuth again", async () => {
    enableOAuth();
    const sealed = sealShopperToken("secret", {
      accessToken: "cookie-shopper",
      expiresAtMs: Date.now() + 60_000,
    });

    let cartCalls = 0;
    globalThis.fetch = async (input, init) => {
      const url = requestUrl(input);
      if (url.startsWith(origin)) {
        return originalFetch(input, init);
      }
      assert.equal(url, "https://api.kroger.com/v1/cart/add");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("Authorization"), "Bearer cookie-shopper");
      cartCalls += 1;
      return new Response(null, { status: 204 });
    };

    const response = await fetch(`${origin}/api/kroger/cart/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: `${KROGER_SHOPPER_COOKIE}=${encodeURIComponent(sealed)}`,
      },
      body: JSON.stringify({
        items: [{ upc: "0001111041700", quantity: 1 }],
      }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      status: string;
      added: number;
      krogerCartUrl: string;
    };
    assert.equal(body.status, "added");
    assert.equal(body.added, 1);
    assert.equal(body.krogerCartUrl, "https://www.kroger.com/cart");
    assert.equal(cartCalls, 1);
  });

  it("does not claim added when a reused shopper cookie gets a non-2xx cart write", async () => {
    enableOAuth();
    const sealed = sealShopperToken("secret", {
      accessToken: "cookie-shopper",
      expiresAtMs: Date.now() + 60_000,
    });
    globalThis.fetch = async (input, init) => {
      const url = requestUrl(input);
      if (url.startsWith(origin)) {
        return originalFetch(input, init);
      }
      return Response.json({ message: "UPC not found" }, { status: 400 });
    };

    const response = await fetch(`${origin}/api/kroger/cart/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: `${KROGER_SHOPPER_COOKIE}=${encodeURIComponent(sealed)}`,
      },
      body: JSON.stringify({
        items: [{ upc: "0001111041700", quantity: 1, name: "Milk" }],
      }),
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as {
      error: string;
      searchLinks: Array<{ url: string }>;
    };
    assert.match(body.error, /UPC not found/);
    assert.match(body.searchLinks[0].url, /kroger\.com\/search/);
  });

  it("starts Kroger connect without cart items and does not call the Cart API", async () => {
    const missing = await fetch(`${origin}/api/kroger/connect`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    assert.equal(missing.status, 501);

    enableOAuth();
    const response = await fetch(`${origin}/api/kroger/connect`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { status: string; authorizeUrl: string };
    assert.equal(body.status, "needs_shopper_login");
    const state = new URL(body.authorizeUrl).searchParams.get("state");
    assert.ok(state);
    const config = readKrogerOAuthConfig();
    assert.ok(config);
    const pending = verifyCartState(config, state);
    assert.ok(pending);
    assert.equal(pending.purpose, "connect");
    assert.equal(pending.items.length, 0);

    const calls: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = requestUrl(input);
      if (url.startsWith(origin)) return originalFetch(input, init);
      calls.push(url);
      if (url.includes("/connect/oauth2/token")) {
        return Response.json({ access_token: "shopper-access", expires_in: 1800 });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    const callback = await fetch(
      `${origin}/api/kroger/oauth/callback?code=auth-code&state=${encodeURIComponent(state)}`
    );
    assert.equal(callback.status, 200);
    const html = await callback.text();
    assert.match(html, /Kroger is connected/);
    assert.doesNotMatch(html, /Added to your Kroger cart/);
    assert.equal(calls.length, 1);
    assert.match(callback.headers.get("set-cookie") ?? "", new RegExp(`${KROGER_SHOPPER_COOKIE}=`));
  });

  it("reports an existing shopper cookie as connected and skips a new login", async () => {
    enableOAuth();
    const sealed = sealShopperToken("secret", {
      accessToken: "cookie-shopper",
      expiresAtMs: Date.now() + 60_000,
    });
    const headers = { Accept: "application/json", Cookie: `${KROGER_SHOPPER_COOKIE}=${encodeURIComponent(sealed)}` };
    const status = await fetch(`${origin}/api/kroger/auth-status`, { headers });
    assert.equal(status.status, 200);
    const statusBody = (await status.json()) as { oauthConfigured: boolean; connected: boolean };
    assert.equal(statusBody.oauthConfigured, true);
    assert.equal(statusBody.connected, true);

    const response = await fetch(`${origin}/api/kroger/connect`, { method: "POST", headers });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { status: string; authorizeUrl?: string };
    assert.equal(body.status, "connected");
    assert.equal(body.authorizeUrl, undefined);
  });
});
