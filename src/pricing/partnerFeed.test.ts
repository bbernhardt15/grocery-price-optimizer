import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  PartnerFeedProvider,
  parsePartnerStoreList,
  readPartnerFeedConfig,
  searchPartnerFeed,
  toPartnerCatalogProduct,
} from "./partnerFeed";
import {
  INSTACART_PARTNER_SETUP_HINT,
  NAMED_BANNER_FEEDS,
  partnerProvidersFromEnv,
  partnerStoreNamesFromEnv,
  SHELF_FEED_SETUP_HINT,
} from "./partnerProviders";

const originalFetch = globalThis.fetch;

const PARTNER_ENV_KEYS = [
  "SHELF_FEED_BASE_URL",
  "SHELF_FEED_API_KEY",
  "SHELF_FEED_STORES",
  "INSTACART_PARTNER_BASE_URL",
  "INSTACART_PARTNER_API_KEY",
  "INSTACART_PARTNER_STORES",
  "PUBLIX_PARTNER_BASE_URL",
  "PUBLIX_PARTNER_API_KEY",
  "HEB_PARTNER_BASE_URL",
  "HEB_PARTNER_API_KEY",
  "MEIJER_PARTNER_BASE_URL",
  "MEIJER_PARTNER_API_KEY",
] as const;

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of PARTNER_ENV_KEYS) {
    delete process.env[key];
  }
});

describe("partner feed config", () => {
  it("parses comma-separated banners and ignores blanks/duplicates", () => {
    assert.deepEqual(parsePartnerStoreList(""), []);
    assert.deepEqual(parsePartnerStoreList(undefined), []);
    assert.deepEqual(
      parsePartnerStoreList(" Publix, Meijer,Publix, ,H-E-B "),
      ["Publix", "Meijer", "H-E-B"]
    );
  });

  it("is unconfigured until both base URL and API key exist", () => {
    assert.equal(readPartnerFeedConfig("SHELF_FEED"), null);
    process.env.SHELF_FEED_BASE_URL = "https://shelf.example/v1/";
    assert.equal(readPartnerFeedConfig("SHELF_FEED"), null);
    process.env.SHELF_FEED_API_KEY = "key";
    assert.deepEqual(readPartnerFeedConfig("SHELF_FEED"), {
      baseUrl: "https://shelf.example/v1",
      apiKey: "key",
    });
  });

  it("maps partner JSON onto catalog rows and skips junk prices", () => {
    const row = toPartnerCatalogProduct(
      {
        name: "Publix Whole Milk",
        brand: "Publix",
        price: 3.19,
        upc: "041415000001",
        sku: "p-milk",
        unit: "gal",
      },
      "Publix",
      "30309"
    );
    assert.equal(row?.storeName, "Publix");
    assert.equal(row?.productId, "p-milk");
    assert.equal(row?.upc, "041415000001");
    assert.equal(row?.locationId, "30309");
    assert.equal(row?.priceSource, "live");
    assert.equal(toPartnerCatalogProduct({ name: "x", price: -1 }, "Publix"), null);
    assert.equal(toPartnerCatalogProduct({ price: 1.5 }, "Publix"), null);
  });
});

describe("PartnerFeedProvider", () => {
  it("stays dark without credentials and documents the licensed-feed path", () => {
    const provider = new PartnerFeedProvider({
      storeName: "Publix",
      envPrefix: "PUBLIX_PARTNER",
      setupHint: NAMED_BANNER_FEEDS[0].setupHint,
    });
    assert.equal(provider.isConfigured(), false);
    assert.equal(provider.feedKind, "partner_feed");
    assert.match(provider.setupHint(), /no public product\/price API/i);
    assert.match(provider.setupHint(), /PUBLIX_PARTNER_BASE_URL/);
  });

  it("calls the documented partner contract when keys are set", async () => {
    process.env.SHELF_FEED_BASE_URL = "https://shelf.example/v1/";
    process.env.SHELF_FEED_API_KEY = "shelf-key";

    const calls: Array<{ url: string; authorization: string | null }> = [];
    globalThis.fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), authorization: headers.get("Authorization") });
      return Response.json({
        products: [
          {
            name: "Meijer Large Eggs",
            brand: "Meijer",
            price: 2.29,
            upc: "708820123456",
            unit: "count",
          },
        ],
      });
    };

    const products = await searchPartnerFeed(
      {
        storeName: "Meijer",
        envPrefix: "SHELF_FEED",
        setupHint: SHELF_FEED_SETUP_HINT,
        storeQueryValue: "Meijer",
      },
      "eggs",
      { zipCode: "49503" }
    );

    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "https://shelf.example/v1/products?query=eggs&zip=49503&store=Meijer"
    );
    assert.equal(calls[0].authorization, "Bearer shelf-key");
    assert.equal(products[0].storeName, "Meijer");
    assert.equal(products[0].price, 2.29);
    assert.equal(products[0].priceSource, "live");
  });

  it("does not invent live prices when the partner feed is down", async () => {
    process.env.INSTACART_PARTNER_BASE_URL = "https://instacart-proxy.example";
    process.env.INSTACART_PARTNER_API_KEY = "ic-key";
    globalThis.fetch = async () =>
      Response.json({ error: "forbidden" }, { status: 403 });

    await assert.rejects(
      () =>
        searchPartnerFeed(
          {
            storeName: "Aldi",
            envPrefix: "INSTACART_PARTNER",
            setupHint: INSTACART_PARTNER_SETUP_HINT,
            storeQueryValue: "Aldi",
          },
          "butter"
        ),
      /Aldi partner feed failed \(403\)|forbidden/
    );
  });
});

describe("partnerProvidersFromEnv", () => {
  it("registers nothing until credentials exist", () => {
    assert.deepEqual(partnerProvidersFromEnv(), []);
    assert.deepEqual(partnerStoreNamesFromEnv(), []);
  });

  it("builds one provider per SHELF_FEED store and skips Kroger/Walmart/Target", () => {
    process.env.SHELF_FEED_BASE_URL = "https://shelf.example";
    process.env.SHELF_FEED_API_KEY = "key";
    process.env.SHELF_FEED_STORES = "Publix, Kroger, Meijer, Target";

    const names = partnerStoreNamesFromEnv();
    assert.deepEqual(names, ["Publix", "Meijer"]);
  });

  it("lets a named Publix feed win over Instacart for the same banner", () => {
    process.env.PUBLIX_PARTNER_BASE_URL = "https://publix-feed.example";
    process.env.PUBLIX_PARTNER_API_KEY = "publix-key";
    process.env.INSTACART_PARTNER_BASE_URL = "https://ic.example";
    process.env.INSTACART_PARTNER_API_KEY = "ic-key";
    process.env.INSTACART_PARTNER_STORES = "Publix,Aldi";

    const providers = partnerProvidersFromEnv();
    assert.deepEqual(
      providers.map((provider) => provider.storeName),
      ["Publix", "Aldi"]
    );
    const publix = providers.find((provider) => provider.storeName === "Publix");
    assert.match(publix?.setupHint() ?? "", /PUBLIX_PARTNER_BASE_URL/);
    const aldi = providers.find((provider) => provider.storeName === "Aldi");
    assert.match(aldi?.setupHint() ?? "", /Instacart/i);
  });

  it("prefers shelf feed over Instacart when both list the same store", () => {
    process.env.SHELF_FEED_BASE_URL = "https://shelf.example";
    process.env.SHELF_FEED_API_KEY = "shelf";
    process.env.SHELF_FEED_STORES = "H-E-B";
    process.env.INSTACART_PARTNER_BASE_URL = "https://ic.example";
    process.env.INSTACART_PARTNER_API_KEY = "ic";
    process.env.INSTACART_PARTNER_STORES = "H-E-B,Aldi";

    const providers = partnerProvidersFromEnv();
    const heb = providers.find((provider) => provider.storeName === "H-E-B");
    assert.match(heb?.setupHint() ?? "", /SHELF_FEED/);
    assert.equal(providers.some((provider) => provider.storeName === "Aldi"), true);
  });
});
