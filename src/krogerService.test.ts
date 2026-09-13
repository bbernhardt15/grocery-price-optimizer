import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { KrogerService } from "./krogerService";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.KROGER_CLIENT_ID;
  delete process.env.KROGER_CLIENT_SECRET;
  delete process.env.KROGER_MOCK_LOCATION_ID;
});

function mockFetch(handler: typeof fetch): void {
  globalThis.fetch = handler;
}

describe("KrogerService.getClosestStoreLocation", () => {
  it("GETs locations with zipCode.near, limit 1, and the cached bearer token", async () => {
    process.env.KROGER_CLIENT_ID = "client-id";
    process.env.KROGER_CLIENT_SECRET = "client-secret";

    const calls: Array<{ url: string; authorization: string | null }> = [];
    mockFetch(async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ url, authorization: headers.get("Authorization") });

      if (url.includes("/connect/oauth2/token")) {
        return Response.json({ access_token: "test-token", expires_in: 1800 });
      }

      return Response.json({
        data: [{ locationId: "01400441", name: "Kroger Cincinnati" }],
      });
    });

    const service = new KrogerService();
    const locationId = await service.getClosestStoreLocation("45202");

    assert.equal(locationId, "01400441");
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/v1\/connect\/oauth2\/token$/);
    assert.match(calls[1].url, /filter\.zipCode\.near=45202/);
    assert.match(calls[1].url, /filter\.limit=1/);
    assert.equal(calls[1].authorization, "Bearer test-token");

    const again = await service.getClosestStoreLocation("45209");
    assert.equal(again, "01400441");
    assert.equal(calls.length, 3);
    assert.equal(calls[2].authorization, "Bearer test-token");
  });

  it("returns the demo locationId when API credentials are not configured", async () => {
    delete process.env.KROGER_CLIENT_ID;
    delete process.env.KROGER_CLIENT_SECRET;
    delete process.env.KROGER_MOCK_LOCATION_ID;
    let called = false;
    mockFetch(async () => {
      called = true;
      return Response.json({ data: [] });
    });

    const service = new KrogerService();
    const locationId = await service.getClosestStoreLocation("45202");
    assert.equal(locationId, "01400441");
    assert.equal(called, false);
  });

  it("rejects an invalid ZIP before calling the API", async () => {
    const service = new KrogerService();
    await assert.rejects(
      () => service.getClosestStoreLocation("nearby"),
      /Invalid ZIP code/
    );
  });
});
