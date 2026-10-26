import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, describe, it } from "node:test";
import app from "../app";

const originalFetch = globalThis.fetch;

describe("GET /api/geo/zip", () => {
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
  });

  it("refuses a missing or impossible point without calling Census", async () => {
    let called = false;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith(origin)) return originalFetch(input, init);
      called = true;
      throw new Error("census should not be called");
    };
    const response = await fetch(`${origin}/api/geo/zip?lat=99&lng=0`);
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /lat/);
    assert.equal(called, false);
  });

  it("returns the ZIP and does not echo the coordinates", async () => {
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith(origin)) return originalFetch(input, init);
      assert.match(url, /geocoding\.geo\.census\.gov/);
      return Response.json({
        result: { geographies: { "ZIP Code Tabulation Areas": [{ ZCTA5CE20: "10001" }] } },
      });
    };
    const response = await fetch(`${origin}/api/geo/zip?lat=40.75&lng=-73.99`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { zip: string; lat?: number };
    assert.equal(body.zip, "10001");
    assert.equal(body.lat, undefined);
  });

  it("says when the lookup fails", async () => {
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith(origin)) return originalFetch(input, init);
      return new Response("nope", { status: 503 });
    };
    const response = await fetch(`${origin}/api/geo/zip?lat=40.75&lng=-73.99`);
    assert.equal(response.status, 502);
  });
});
