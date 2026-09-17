import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, describe, it } from "node:test";
import app from "../app";
import { krogerCartSessions } from "../krogerCartAuth";

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
    delete process.env.KROGER_CLIENT_ID;
    delete process.env.KROGER_CLIENT_SECRET;
    delete process.env.KROGER_REDIRECT_URI;
  });

  it("reports that shopper OAuth is required even when client-credentials exist", async () => {
    process.env.KROGER_CLIENT_ID = "id";
    process.env.KROGER_CLIENT_SECRET = "secret";
    const response = await fetch(`${origin}/api/kroger/auth-status`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      oauthConfigured: boolean;
      requiresShopperLogin: boolean;
    };
    assert.equal(body.oauthConfigured, false);
    assert.equal(body.requiresShopperLogin, true);
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
    process.env.KROGER_CLIENT_ID = "id";
    process.env.KROGER_CLIENT_SECRET = "secret";
    process.env.KROGER_REDIRECT_URI = `${origin}/api/kroger/oauth/callback`;
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

  it("returns a Kroger authorize URL that still requires shopper login", async () => {
    process.env.KROGER_CLIENT_ID = "id";
    process.env.KROGER_CLIENT_SECRET = "secret";
    process.env.KROGER_REDIRECT_URI = `${origin}/api/kroger/oauth/callback`;
    const response = await fetch(`${origin}/api/kroger/cart/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        items: [{ upc: "0001111041700", quantity: 2 }],
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
  });

  it("does not claim a cart fill when the OAuth callback has no pending items", async () => {
    process.env.KROGER_CLIENT_ID = "id";
    process.env.KROGER_CLIENT_SECRET = "secret";
    process.env.KROGER_REDIRECT_URI = `${origin}/api/kroger/oauth/callback`;
    krogerCartSessions.takePending("missing");
    const response = await fetch(
      `${origin}/api/kroger/oauth/callback?code=abc&state=missing`
    );
    assert.equal(response.status, 400);
    const html = await response.text();
    assert.match(html, /session expired/i);
    assert.doesNotMatch(html, /Added to your Kroger cart/);
  });
});
