import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { krogerService } from "../krogerService";
import { KrogerPricingProvider } from "./krogerProvider";
import { competingStoreNames, providerForStore } from "./providers";
import {
  emptyAccumulator,
  finalizeStoreReport,
  pricingWarningFromReports,
} from "./reports";

afterEach(() => {
  delete process.env.KROGER_CLIENT_ID;
  delete process.env.KROGER_CLIENT_SECRET;
  delete process.env.FLIPP_ENABLED;
  delete process.env.FLIPP_ACCESS_TOKEN;
});

describe("pricing providers registry", () => {
  it("exposes Kroger, Walmart, Target, and Flipp-backed Aldi (off until FLIPP_ENABLED)", () => {
    assert.equal(providerForStore("Kroger")?.storeName, "Kroger");
    assert.equal(providerForStore("walmart")?.storeName, "Walmart");
    assert.equal(providerForStore("Target")?.storeName, "Target");
    assert.equal(providerForStore("Aldi")?.storeName, "Aldi");
    assert.equal(providerForStore("Aldi")?.isConfigured(), false);
    assert.equal(providerForStore("Publix")?.storeName, "Publix");
    assert.deepEqual(competingStoreNames([]), [
      "Kroger",
      "Walmart",
      "Target",
      "Aldi",
    ]);
    assert.deepEqual(competingStoreNames(["Target", "Target", "Kroger"]), [
      "Target",
      "Kroger",
    ]);
    assert.deepEqual(competingStoreNames(["ralphs"]), ["Kroger"]);
  });
});

describe("KrogerPricingProvider", () => {
  it("is configured only when client-credentials exist", () => {
    const provider = new KrogerPricingProvider();
    assert.equal(provider.isConfigured(), false);
    process.env.KROGER_CLIENT_ID = "id";
    process.env.KROGER_CLIENT_SECRET = "secret";
    assert.equal(provider.isConfigured(), true);
  });

  it("tags live Kroger rows and keeps the existing Products API path", async () => {
    process.env.KROGER_CLIENT_ID = "id";
    process.env.KROGER_CLIENT_SECRET = "secret";
    const original = krogerService.searchProducts.bind(krogerService);
    krogerService.searchProducts = async (term, locationId) => {
      assert.equal(term, "milk");
      assert.equal(locationId, "01400441");
      return [
        {
          name: "Kroger Milk",
          brand: "Kroger",
          storeName: "Kroger",
          locationId,
          price: 2.99,
          unit: "gal",
          normalizedUnit: "gal",
        },
      ];
    };

    try {
      const products = await new KrogerPricingProvider().searchProducts("milk", {
        locationId: "01400441",
      });
      assert.equal(products[0].priceSource, "live");
      assert.equal(products[0].storeName, "Kroger");
    } finally {
      krogerService.searchProducts = original;
    }
  });
});

describe("pricing reports", () => {
  it("labels seed fallback vs live and only banners Kroger missing keys or live failures", () => {
    const kroger = emptyAccumulator("Kroger");
    kroger.errors.push("Set KROGER_CLIENT_ID");
    kroger.seedHits = 1;

    const walmart = emptyAccumulator("Walmart");
    walmart.errors.push("Set WALMART_CONSUMER_ID");
    walmart.seedHits = 1;

    const targetLive = emptyAccumulator("Target");
    targetLive.configured = true;
    targetLive.attempted = true;
    targetLive.liveHits = 1;
    targetLive.fetchedAt = new Date("2026-09-17T00:00:00.000Z");

    const aldiWeekly = emptyAccumulator("Aldi");
    aldiWeekly.configured = true;
    aldiWeekly.attempted = true;
    aldiWeekly.weeklyAdHits = 1;

    const reports = [
      finalizeStoreReport(kroger, "Kroger hint"),
      finalizeStoreReport(walmart, "Walmart hint"),
      finalizeStoreReport(targetLive),
      finalizeStoreReport(aldiWeekly),
    ];

    assert.equal(reports[0].source, "seed");
    assert.equal(reports[0].label, "Demo catalog");
    assert.equal(reports[1].source, "seed");
    assert.equal(reports[1].label, "Demo catalog");
    assert.equal(reports[2].source, "live");
    assert.equal(reports[2].label, "Live prices");
    assert.equal(reports[2].ok, true);
    assert.equal(reports[3].source, "weekly_ad");
    assert.equal(reports[3].label, "Weekly ad");
    assert.match(reports[3].detail, /not a full live shelf catalog/i);

    const warning = pricingWarningFromReports(reports);
    assert.match(warning ?? "", /Kroger: Set KROGER_CLIENT_ID/);
    assert.doesNotMatch(warning ?? "", /WALMART_CONSUMER_ID/);
  });
});
