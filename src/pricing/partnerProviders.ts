import { PARTNER_FEED_CONTRACT, PartnerFeedProvider, parsePartnerStoreList, readPartnerFeedConfig } from "./partnerFeed";
import type { StorePricingProvider } from "./types";

/**
 * Retailers that already have a first-party adapter. A partner feed must not
 * replace Kroger Products, Walmart Affiliate, or the Target partner stub.
 */
export const BUILTIN_PRICING_STORES = ["Kroger", "Walmart", "Target"] as const;

const BUILTIN_STORE_KEYS = new Set(
  BUILTIN_PRICING_STORES.map((store) => store.toLowerCase())
);

export const PARTNER_PLAYBOOK = "docs/PARTNER_INTEGRATIONS.md";

export const SHELF_FEED_SETUP_HINT =
  `Datasembly-class shelf prices (licensed). Set SHELF_FEED_BASE_URL, SHELF_FEED_API_KEY, and SHELF_FEED_STORES (comma-separated banners). ${PARTNER_FEED_CONTRACT} See ${PARTNER_PLAYBOOK}. This is not a public retailer API and is not a cart fill.`;

export const INSTACART_PARTNER_SETUP_HINT =
  `Instacart Connect/Platform-style adapter (licensed). Set INSTACART_PARTNER_BASE_URL, INSTACART_PARTNER_API_KEY, and INSTACART_PARTNER_STORES. ${PARTNER_FEED_CONTRACT} Do not call Instacart storefronts. Instacart prices often include markup vs in-store. Cart write stays Coming soon until a real Connect cart API is contracted. See ${PARTNER_PLAYBOOK}.`;

type NamedBannerFeed = {
  storeName: string;
  envPrefix: string;
  setupHint: string;
};

/**
 * Single-banner licensed feeds. Same HTTP contract as Target's partner stub.
 * Unset env vars mean the banner is not a live competitor (no fake catalog).
 */
export const NAMED_BANNER_FEEDS: readonly NamedBannerFeed[] = [
  {
    storeName: "Publix",
    envPrefix: "PUBLIX_PARTNER",
    setupHint:
      `Publix has no public product/price API. Live Publix prices need a licensed feed: PUBLIX_PARTNER_BASE_URL and PUBLIX_PARTNER_API_KEY. ${PARTNER_FEED_CONTRACT} See ${PARTNER_PLAYBOOK}.`,
  },
  {
    storeName: "H-E-B",
    envPrefix: "HEB_PARTNER",
    setupHint:
      `H-E-B has no public grocery price API. Live H-E-B prices need a licensed feed: HEB_PARTNER_BASE_URL and HEB_PARTNER_API_KEY. ${PARTNER_FEED_CONTRACT} See ${PARTNER_PLAYBOOK}.`,
  },
  {
    storeName: "Meijer",
    envPrefix: "MEIJER_PARTNER",
    setupHint:
      `Meijer has no public product/price API. Live Meijer prices need a licensed feed: MEIJER_PARTNER_BASE_URL and MEIJER_PARTNER_API_KEY. ${PARTNER_FEED_CONTRACT} See ${PARTNER_PLAYBOOK}.`,
  },
];

type MultiStoreFeed = {
  envPrefix: string;
  storesEnv: string;
  setupHint: string;
};

const MULTI_STORE_FEEDS: readonly MultiStoreFeed[] = [
  {
    envPrefix: "SHELF_FEED",
    storesEnv: "SHELF_FEED_STORES",
    setupHint: SHELF_FEED_SETUP_HINT,
  },
  {
    envPrefix: "INSTACART_PARTNER",
    storesEnv: "INSTACART_PARTNER_STORES",
    setupHint: INSTACART_PARTNER_SETUP_HINT,
  },
];

export function isBuiltinPricingStore(storeName: string): boolean {
  return BUILTIN_STORE_KEYS.has(storeName.trim().toLowerCase());
}

function hasProvider(
  providers: StorePricingProvider[],
  storeName: string
): boolean {
  const key = storeName.trim().toLowerCase();
  return providers.some((provider) => provider.storeName.toLowerCase() === key);
}

/**
 * Partner adapters that have credentials in env. Named banners win over the
 * generic shelf feed, which wins over Instacart (shelf prices beat markup).
 * Built-in Kroger/Walmart/Target adapters are never replaced.
 */
export function partnerProvidersFromEnv(
  env: NodeJS.ProcessEnv = process.env
): StorePricingProvider[] {
  const providers: StorePricingProvider[] = [];

  for (const banner of NAMED_BANNER_FEEDS) {
    if (!readPartnerFeedConfig(banner.envPrefix, env)) {
      continue;
    }
    if (isBuiltinPricingStore(banner.storeName)) {
      continue;
    }
    providers.push(
      new PartnerFeedProvider({
        storeName: banner.storeName,
        envPrefix: banner.envPrefix,
        setupHint: banner.setupHint,
        storeQueryValue: banner.storeName,
      })
    );
  }

  for (const feed of MULTI_STORE_FEEDS) {
    if (!readPartnerFeedConfig(feed.envPrefix, env)) {
      continue;
    }
    const stores = parsePartnerStoreList(env[feed.storesEnv]);
    for (const storeName of stores) {
      if (isBuiltinPricingStore(storeName) || hasProvider(providers, storeName)) {
        continue;
      }
      providers.push(
        new PartnerFeedProvider({
          storeName,
          envPrefix: feed.envPrefix,
          setupHint: feed.setupHint,
          storeQueryValue: storeName,
        })
      );
    }
  }

  return providers;
}

export function partnerStoreNamesFromEnv(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  return partnerProvidersFromEnv(env).map((provider) => provider.storeName);
}
