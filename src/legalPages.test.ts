import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import app from "./app";

describe("public privacy and terms", () => {
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

  async function bodyOf(path: string): Promise<string> {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type") || "", /html/);
    return response.text();
  }

  it("serves /privacy and /terms from the website, not the shopper shell", async () => {
    for (const path of ["/privacy", "/privacy/", "/privacy.html", "/terms", "/terms/", "/terms.html"]) {
      const html = await bodyOf(path);
      assert.equal(html.includes("Browse the aisle"), false, path);
    }
    const privacy = (await bodyOf("/privacy")).replace(/\s+/g, " ");
    assert.match(privacy, /Privacy policy/);
    assert.match(privacy, /ZIP/);
    assert.match(privacy, /this device/);
    assert.match(privacy, /That request is not stored as your shopping list/);
    assert.match(privacy, /SHA-256 hashes of the share secret/);
    assert.match(privacy, /optional display name/i);
    assert.match(privacy, /Revoke link marks the list revoked/);
    assert.match(privacy, /does not delete the list/);
    assert.match(privacy, /baseline price/);
    assert.match(privacy, /target price/);
    assert.match(privacy, /latest 40/);
    assert.match(privacy, /VAPID keys/);
    assert.match(privacy, /p256dh and auth keys/);
    assert.match(privacy, /does not remove the subscription/);
    assert.match(privacy, /5-digit ZIP/);
    assert.match(privacy, /AES-256-GCM/);
    assert.match(privacy, /kroger_shopper/);
    assert.match(privacy, /Instacart/);
    assert.match(privacy, /does not include a third-party analytics/);
    assert.match(privacy, /do not sell personal information/i);
    assert.match(privacy, /\[CONTACT EMAIL\]/);
    assert.match(privacy, /\[LEGAL NAME\]/);
    assert.match(privacy, /\[MAILING ADDRESS\]/);
    assert.match(privacy, /Delete my data/);
    assert.match(privacy, /type DELETE/);
    assert.match(privacy, /\/api\/kroger\/logout/);
    assert.match(privacy, /not stored with your device id/);

    const terms = (await bodyOf("/terms")).replace(/\s+/g, " ");
    assert.match(terms, /Terms of use/);
    assert.match(terms, /do not sell the groceries/);
    assert.match(terms, /hashed share secrets/);
    assert.match(terms, /does not delete the stored list/);
    assert.match(terms, /baseline price and any target price/);
    assert.match(terms, /Web Push endpoint and keys/);
    assert.match(terms, /\[GOVERNING LAW\]/);
    assert.match(terms, /\[CONTACT EMAIL\]/);
    assert.match(terms, /href="\/privacy"/);
    assert.match(terms, /Delete my data/);
    assert.match(terms, /type DELETE/);
  });

  it("links privacy and terms from the shopper page", () => {
    const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    assert.match(html, /href="\/privacy"/);
    assert.match(html, /href="\/terms"/);
    assert.match(html, /class="site-footer"/);
    assert.match(html, /class="panel-legal"/);
  });
});
