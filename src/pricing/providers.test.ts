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
  delete process.env.SHELF_FEED_BASE_URL;
  delete process.env.SHELF_FEED_API_KEY;
  delete process.env.SHELF_FEED_STORES;
  delete process.env.INSTACART_PARTNER_BASE_URL;
  delete process.env.INSTACART_PARTNER_API_KEY;
  delete process.env.INSTACART_PARTNER_STORES;
  delete process.env.PUBLIX_PARTNER_BASE_URL;
  delete process.env.PUBLIX_PARTNER_API_KEY;
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

  it("treats Walmart/Target/Aldi as configured when FLIPP_ENABLED is true without a FlyerKit token", () => {
    process.env.FLIPP_ENABLED = "true";
    delete process.env.FLIPP_ACCESS_TOKEN;
    assert.equal(providerForStore("Aldi")?.isConfigured(), true);
    assert.equal(providerForStore("Walmart")?.isConfigured(), true);
    assert.equal(providerForStore("Target")?.isConfigured(), true);
    assert.doesNotMatch(providerForStore("Walmart")?.setupHint() ?? "", /FLIPP_ENABLED=true/);
    assert.doesNotMatch(providerForStore("Aldi")?.setupHint() ?? "", /FLIPP_ACCESS_TOKEN/);
  });

  it("adds licensed partner banners to the default trip only when keys exist", () => {
    process.env.SHELF_FEED_BASE_URL = "https://shelf.example";
    process.env.SHELF_FEED_API_KEY = "key";
    process.env.SHELF_FEED_STORES = "Publix,Meijer";
    process.env.INSTACART_PARTNER_BASE_URL = "https://ic.example";
    process.env.INSTACART_PARTNER_API_KEY = "ic";
    process.env.INSTACART_PARTNER_STORES = "Aldi";

    assert.equal(providerForStore("Publix")?.feedKind, "partner_feed");
    assert.equal(providerForStore("Meijer")?.storeName, "Meijer");
    assert.equal(providerForStore("Aldi")?.storeName, "Aldi");
    assert.equal(providerForStore("Target")?.storeName, "Target");
    assert.deepEqual(competingStoreNames([]), [
      "Kroger",
      "Walmart",
      "Target",
      "Aldi",
      "Publix",
      "Meijer",
    ]);
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

  it("labels licensed partner hits as Partner feed, not a fake retailer API", () => {
    const publix = emptyAccumulator("Publix");
    publix.configured = true;
    publix.attempted = true;
    publix.liveHits = 1;
    publix.feedKind = "partner_feed";

    const cached = emptyAccumulator("Meijer");
    cached.configured = true;
    cached.cachedHits = 1;
    cached.feedKind = "partner_feed";

    const reports = [finalizeStoreReport(publix), finalizeStoreReport(cached)];
    assert.equal(reports[0].source, "partner_feed");
    assert.equal(reports[0].label, "Partner feed");
    assert.equal(reports[0].ok, true);
    assert.match(reports[0].detail, /licensed partner feed/i);
    assert.equal(reports[1].source, "cached_live");
    assert.equal(reports[1].label, "Cached partner feed");
  });

  it("does not treat a Flipp miss as missing FLIPP_ENABLED", () => {
    const walmart = emptyAccumulator("Walmart");
    walmart.configured = true;
    walmart.attempted = true;
    const report = finalizeStoreReport(
      walmart,
      "Weekly-ad prices use Flipp. production must opt in with FLIPP_ENABLED=true."
    );
    assert.equal(report.source, "unavailable");
    assert.equal(report.label, "Unavailable");
    assert.equal(report.configured, true);
    assert.doesNotMatch(report.detail, /FLIPP_ENABLED=true/);
    assert.match(report.detail, /not a full shelf catalog/i);
    assert.match(report.detail, /Walmart/);
  });

  it("still shows Flipp setup instructions when weekly ads are off", () => {
    const aldi = emptyAccumulator("Aldi");
    const hint =
      "Aldi has no public product API. Weekly-ad prices use Flipp. production must opt in with FLIPP_ENABLED=true.";
    const report = finalizeStoreReport(aldi, hint);
    assert.equal(report.source, "unavailable");
    assert.equal(report.configured, false);
    assert.match(report.detail, /FLIPP_ENABLED=true/);
  });

  it("asks for a ZIP when Flipp is on but was not attempted", () => {
    const target = emptyAccumulator("Target");
    target.configured = true;
    const report = finalizeStoreReport(target, "FLIPP_ENABLED=true");
    assert.equal(report.source, "unavailable");
    assert.match(report.detail, /5-digit ZIP/i);
    assert.doesNotMatch(report.detail, /FLIPP_ENABLED=true/);
  });
});
