import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { TARGET_SETUP_HINT, TargetPricingProvider } from "./targetProvider";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.TARGET_PARTNER_BASE_URL;
  delete process.env.TARGET_PARTNER_API_KEY;
});

describe("TargetPricingProvider", () => {
  it("is unconfigured without a licensed partner feed and documents that RedSky is not used", () => {
    const provider = new TargetPricingProvider();
    assert.equal(provider.isConfigured(), false);
    assert.match(provider.setupHint(), /no public product\/price API/i);
    assert.match(provider.setupHint(), /TARGET_PARTNER_BASE_URL/);
    assert.match(provider.setupHint(), /RedSky/);
    assert.match(TARGET_SETUP_HINT, /demo catalog/i);
  });

  it("calls the documented partner feed contract when keys are set", async () => {
    process.env.TARGET_PARTNER_BASE_URL = "https://partner.example.test/v1/";
    process.env.TARGET_PARTNER_API_KEY = "partner-key";

    const calls: Array<{ url: string; authorization: string | null }> = [];
    globalThis.fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), authorization: headers.get("Authorization") });
      return Response.json({
        products: [
          {
            name: "Good & Gather Large Eggs",
            brand: "Good & Gather",
            price: 2.59,
            tcin: "12345678",
            upc: "084506123456",
            unit: "count",
          },
        ],
      });
    };

    const provider = new TargetPricingProvider();
    assert.equal(provider.isConfigured(), true);
    const products = await provider.searchProducts("eggs", { zipCode: "45202" });

    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "https://partner.example.test/v1/products?query=eggs&zip=45202"
    );
    assert.equal(calls[0].authorization, "Bearer partner-key");
    assert.equal(products[0].storeName, "Target");
    assert.equal(products[0].productId, "12345678");
    assert.equal(products[0].price, 2.59);
    assert.equal(products[0].priceSource, "live");
    assert.equal(products[0].locationId, "45202");
  });

  it("does not pretend live prices exist when the partner feed is down", async () => {
    process.env.TARGET_PARTNER_BASE_URL = "https://partner.example.test";
    process.env.TARGET_PARTNER_API_KEY = "partner-key";
    globalThis.fetch = async () =>
      Response.json({ error: "quota exceeded" }, { status: 429 });

    const provider = new TargetPricingProvider();
    await assert.rejects(
      () => provider.searchProducts("butter"),
      /Target partner feed failed \(429\)|quota exceeded/
    );
  });
});
