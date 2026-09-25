import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, describe, it } from "node:test";
import app from "../app";
import { INSTACART_DEV_BASE_URL } from "../instacartHandoff";

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

describe("Instacart shopping-list routes", () => {
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
    delete process.env.INSTACART_API_KEY;
    delete process.env.INSTACART_API_BASE_URL;
  });

  it("reports the handoff as off when env vars are unset", async () => {
    const response = await fetch(`${origin}/api/instacart/status`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { enabled: boolean };
    assert.equal(body.enabled, false);
    const listed = JSON.stringify(body);
    assert.equal(listed.includes("INSTACART_API_KEY"), false);
  });

  it("does not create a list when the key is missing", async () => {
    const response = await fetch(`${origin}/api/instacart/shopping-list`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        items: [{ name: "Whole Milk", quantity: 1, unit: "gal" }],
      }),
    });
    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /INSTACART_API_KEY/);
    assert.match(body.error, /INSTACART_API_BASE_URL/);
    assert.match(body.error, /connect\.dev\.instacart\.tools/);
  });

  it("rejects an empty item list", async () => {
    process.env.INSTACART_API_KEY = "keys.route-test";
    process.env.INSTACART_API_BASE_URL = INSTACART_DEV_BASE_URL;
    const response = await fetch(`${origin}/api/instacart/shopping-list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ quantity: 1 }] }),
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /product name/);
  });

  it("returns the products link and does not leak the bearer key", async () => {
    process.env.INSTACART_API_KEY = "keys.route-test";
    process.env.INSTACART_API_BASE_URL = `${INSTACART_DEV_BASE_URL}/`;
    let authorization = "";
    let linkback = "";
    globalThis.fetch = async (input, init) => {
      const url = requestUrl(input);
      if (url.startsWith(origin)) {
        return originalFetch(input, init);
      }
      authorization = new Headers(init?.headers).get("Authorization") ?? "";
      if (url.includes("/idp/v1/retailers")) {
        return new Response(JSON.stringify({ retailers: [] }), { status: 200 });
      }
      assert.match(url, /\/idp\/v1\/products\/products_link$/);
      const parsed = JSON.parse(String(init?.body)) as {
        landing_page_configuration?: { partner_linkback_url?: string };
      };
      linkback = parsed.landing_page_configuration?.partner_linkback_url ?? "";
      return new Response(
        JSON.stringify({
          products_link_url: "https://www.instacart.com/store/shopping_lists/route",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const response = await fetch(`${origin}/api/instacart/shopping-list`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": "grocery.example",
      },
      body: JSON.stringify({
        storeName: "Publix",
        postalCode: "33101",
        items: [{ name: "Large Eggs", quantity: 2, unit: "count", brand: "Publix" }],
      }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      productsLinkUrl: string;
      retailerPreselected: boolean;
      retailerNote: string;
    };
    assert.equal(
      body.productsLinkUrl,
      "https://www.instacart.com/store/shopping_lists/route"
    );
    assert.equal(body.retailerPreselected, false);
    assert.match(body.retailerNote, /Publix/);
    assert.equal(authorization, "Bearer keys.route-test");
    assert.equal(linkback, "https://grocery.example/");
    assert.equal(JSON.stringify(body).includes("keys.route-test"), false);

    const status = await fetch(`${origin}/api/instacart/status`);
    const statusBody = (await status.json()) as { enabled: boolean };
    assert.equal(statusBody.enabled, true);
  });

  it("returns a clear message when Instacart rejects the list", async () => {
    process.env.INSTACART_API_KEY = "keys.route-test";
    process.env.INSTACART_API_BASE_URL = "https://connect.instacart.com";
    globalThis.fetch = async (input, init) => {
      const url = requestUrl(input);
      if (url.startsWith(origin)) {
        return originalFetch(input, init);
      }
      return new Response(
        JSON.stringify({
          error: { message: "Sorry, an unexpected error occurred.", code: 5000 },
        }),
        { status: 500 }
      );
    };

    const response = await fetch(`${origin}/api/instacart/shopping-list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ name: "Bread", quantity: 1 }] }),
    });
    assert.equal(response.status, 502);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /HTTP 500/);
    assert.match(body.error, /unexpected error/);
    assert.equal(body.error.includes("keys.route-test"), false);
  });
});
