/**
 * Handoff tier for each banner.
 *
 * cart — push the lines into the store cart (Kroger OAuth write, Walmart add-to-cart URL).
 * link — no cart write; each item opens on the store's site or app.
 * list — no item link; the shopper gets the checklist only.
 *
 * Unknown banners stay on `list` so a new Flipp weekly-ad name is still actionable
 * without inventing a URL.
 */

export type HandoffTier = "cart" | "link" | "list";

export type StoreHandoffConfig = {
  storeName: string;
  tier: HandoffTier;
  /** Where prices for this banner come from. Not a promise of a full shelf. */
  priceSource: string;
  /** Public URL pattern. Omitted when the tier is `list`. */
  linkFormat?: string;
  aliases: readonly string[];
};

export const STORE_HANDOFF_CONFIG: readonly StoreHandoffConfig[] = [
  {
    storeName: "Kroger",
    tier: "cart",
    priceSource: "Kroger Products API (live shelf at the shopper's store), with weekly ad as a fallback",
    linkFormat:
      "Cart: PUT /v1/cart/add after shopper OAuth. Search: https://www.kroger.com/search?query={upc|name}",
    aliases: ["kroger"],
  },
  {
    storeName: "Walmart",
    tier: "cart",
    priceSource: "Walmart Affiliate catalog (walmart.com, not in-aisle) or weekly ad",
    linkFormat:
      "Cart: https://www.walmart.com/sc/cart/addToCart?items={itemId}|{qty}. Item: https://www.walmart.com/ip/{itemId}. Search: https://www.walmart.com/search?q={query}",
    aliases: ["walmart"],
  },
  {
    storeName: "Target",
    tier: "link",
    priceSource: "Weekly ad, or a licensed partner feed when TARGET_PARTNER_* is set",
    linkFormat:
      "Product by TCIN: https://www.target.com/p/-/A-{tcin}. Search: https://www.target.com/s?searchTerm={query}",
    aliases: ["target"],
  },
  {
    storeName: "Aldi",
    tier: "link",
    priceSource: "Weekly ad or the demo catalog. Aldi has no shelf API",
    linkFormat: "Search: https://www.aldi.us/store/aldi/s?k={query}",
    aliases: ["aldi"],
  },
  {
    storeName: "Publix",
    tier: "link",
    priceSource: "Weekly ad, not a shelf price",
    linkFormat: "Search: https://www.publix.com/search?searchTerm={query}",
    aliases: ["publix"],
  },
  {
    storeName: "H-E-B",
    tier: "link",
    priceSource: "Weekly ad, not a shelf price",
    linkFormat: "Search: https://www.heb.com/search/?q={query}",
    aliases: ["h e b", "heb"],
  },
  {
    storeName: "Meijer",
    tier: "link",
    priceSource: "Weekly ad, not a shelf price",
    linkFormat: "Search: https://www.meijer.com/shopping/search.html?text={query}",
    aliases: ["meijer"],
  },
  {
    storeName: "Safeway",
    tier: "link",
    priceSource: "Weekly ad or a licensed partner feed",
    linkFormat: "Search: https://www.safeway.com/shop/search-results.html?q={query}",
    aliases: ["safeway"],
  },
  {
    storeName: "Albertsons",
    tier: "link",
    priceSource: "Weekly ad, not a shelf price",
    linkFormat: "Search: https://www.albertsons.com/shop/search-results.html?q={query}",
    aliases: ["albertsons"],
  },
  {
    storeName: "Vons",
    tier: "link",
    priceSource: "Weekly ad, not a shelf price",
    linkFormat: "Search: https://www.vons.com/shop/search-results.html?q={query}",
    aliases: ["vons"],
  },
  {
    storeName: "Jewel-Osco",
    tier: "link",
    priceSource: "Weekly ad, not a shelf price",
    linkFormat: "Search: https://www.jewelosco.com/shop/search-results.html?q={query}",
    aliases: ["jewel osco"],
  },
  {
    storeName: "Acme",
    tier: "link",
    priceSource: "Weekly ad, not a shelf price",
    linkFormat: "Search: https://www.acmemarkets.com/shop/search-results.html?q={query}",
    aliases: ["acme", "acme markets"],
  },
  {
    storeName: "Tom Thumb",
    tier: "link",
    priceSource: "Weekly ad, not a shelf price",
    linkFormat: "Search: https://www.tomthumb.com/shop/search-results.html?q={query}",
    aliases: ["tom thumb"],
  },
  {
    storeName: "Randalls",
    tier: "link",
    priceSource: "Weekly ad, not a shelf price",
    linkFormat: "Search: https://www.randalls.com/shop/search-results.html?q={query}",
    aliases: ["randalls"],
  },
  {
    storeName: "Pavilions",
    tier: "link",
    priceSource: "Weekly ad, not a shelf price",
    linkFormat: "Search: https://www.pavilions.com/shop/search-results.html?q={query}",
    aliases: ["pavilions"],
  },
  {
    storeName: "Food Lion",
    tier: "link",
    priceSource: "Weekly ad",
    linkFormat: "Search: https://shop.foodlion.com/search?search_term={query}",
    aliases: ["food lion"],
  },
  {
    storeName: "Giant",
    tier: "link",
    priceSource: "Weekly ad",
    linkFormat: "Homepage: https://giantfood.com/ (no verified search URL)",
    aliases: ["giant", "giant food"],
  },
  {
    storeName: "Stop & Shop",
    tier: "link",
    priceSource: "Weekly ad, not a shelf price",
    linkFormat: "Homepage: https://stopandshop.com/ (no verified search URL)",
    aliases: ["stop and shop"],
  },
  {
    storeName: "Sprouts",
    tier: "link",
    priceSource: "Weekly ad, not a shelf price",
    linkFormat: "Homepage: https://shop.sprouts.com/ (no verified search URL)",
    aliases: ["sprouts", "sprouts farmers market"],
  },
  {
    storeName: "Winn-Dixie",
    tier: "link",
    priceSource: "Weekly ad, not a shelf price",
    linkFormat: "Homepage: https://www.winndixie.com/ (no verified search URL)",
    aliases: ["winn dixie"],
  },
  {
    storeName: "Costco",
    tier: "link",
    priceSource: "Weekly ad, not a shelf price. Warehouse prices can require a membership",
    linkFormat: "Search: https://www.costco.com/CatalogSearch?keyword={query}",
    aliases: ["costco"],
  },
  {
    storeName: "Sam's Club",
    tier: "link",
    priceSource: "No shelf feed. Club prices can require a membership",
    linkFormat: "Search: https://www.samsclub.com/s/{query}",
    aliases: ["sams club"],
  },
  {
    storeName: "Whole Foods",
    tier: "link",
    priceSource: "No shelf feed",
    linkFormat: "Search: https://www.wholefoodsmarket.com/search?text={query}",
    aliases: ["whole foods", "whole foods market"],
  },
  {
    storeName: "Amazon Fresh",
    tier: "link",
    priceSource: "No shelf feed",
    linkFormat: "Search: https://www.amazon.com/s?k={query}",
    aliases: ["amazon fresh"],
  },
  {
    storeName: "Giant Eagle",
    tier: "list",
    priceSource: "Weekly ad",
    aliases: ["giant eagle"],
  },
];

const BY_ALIAS = new Map<string, StoreHandoffConfig>();
for (const config of STORE_HANDOFF_CONFIG) {
  for (const alias of config.aliases) {
    BY_ALIAS.set(alias, config);
  }
}

/** Lowercase key used to match a trip's storeName onto a config row. */
export function normalizeStoreKey(storeName: string): string {
  return storeName
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Config for a banner. Unknown names are `list` so the shopper still gets a
 * checklist and no invented link.
 */
export function resolveStoreHandoff(storeName: string): StoreHandoffConfig {
  const key = normalizeStoreKey(storeName);
  const found = BY_ALIAS.get(key);
  if (found) {
    return found;
  }
  const display = storeName.trim() || "Store";
  return {
    storeName: display,
    tier: "list",
    priceSource: "No shelf feed is configured for this banner.",
    aliases: key ? [key] : [],
  };
}

export function handoffTierFor(storeName: string): HandoffTier {
  return resolveStoreHandoff(storeName).tier;
}

/** Shopper-facing price label. Live shelf and weekly ad stay distinct. */
export function priceSourceLabel(source: string | undefined): string {
  switch (source) {
    case "live":
    case "cached_live":
      return "Live shelf price";
    case "weekly_ad":
    case "cached_weekly_ad":
      return "Weekly ad";
    case "partner_feed":
      return "Partner feed";
    case "seed":
      return "Demo catalog";
    case "mixed":
      return "Mixed prices";
    case "unavailable":
      return "Price unavailable";
    default:
      return "Price";
  }
}
