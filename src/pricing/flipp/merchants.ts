/**
 * Map Flipp flyer merchants (numeric id + display name) onto Grocery Gitter
 * `storeName` values. Weekly ads are not a full shelf catalog; this list is
 * only the banners we will price from circulars when Flipp is enabled.
 */

export type FlippMerchantMapping = {
  /** Grocery Gitter storeName. */
  storeName: string;
  /** Known Flipp merchant_id values (US). */
  merchantIds: number[];
  /** Lowercase Flipp `merchant_name` aliases. */
  nameAliases: string[];
  /** Token used in Flipp consumer search (`ALDI AND milk`). */
  searchName: string;
  /**
   * FlyerKit `merchant_identifier` slug. Only used with
   * `FLIPP_ACCESS_TOKEN` from a Flipp technical contact.
   */
  flyerKitSlug: string;
  /** When true, name aliases must match exactly (no prefix). */
  exactName?: boolean;
};

export const FLIPP_MERCHANT_MAPPINGS: FlippMerchantMapping[] = [
  {
    storeName: "Aldi",
    merchantIds: [2353],
    nameAliases: ["aldi"],
    searchName: "ALDI",
    flyerKitSlug: "aldi",
  },
  {
    storeName: "Target",
    merchantIds: [2040],
    nameAliases: ["target"],
    searchName: "Target",
    flyerKitSlug: "target",
  },
  {
    storeName: "Walmart",
    merchantIds: [2175],
    nameAliases: [
      "walmart",
      "walmart supercenter",
      "walmart neighborhood market",
    ],
    searchName: "Walmart",
    flyerKitSlug: "walmart",
  },
  {
    storeName: "Kroger",
    merchantIds: [2707, 2774],
    nameAliases: [
      "kroger",
      "ralphs",
      "fred meyer",
      "qfc",
      "king soopers",
      "smith's",
      "smiths",
      "dillons",
      "harris teeter",
      "food 4 less",
      "fry's",
      "frys",
      "mariano's",
      "marianos",
      "pick n save",
      "pick 'n save",
      "city market",
      "baker's",
      "gerbes",
      "pay less",
      "jayc",
      "owen's",
      "ruler foods",
      "foods co",
    ],
    searchName: "Kroger",
    flyerKitSlug: "kroger",
  },
  {
    storeName: "Publix",
    merchantIds: [2361],
    nameAliases: ["publix"],
    searchName: "Publix",
    flyerKitSlug: "publix",
    exactName: true,
  },
  {
    storeName: "Meijer",
    merchantIds: [2281],
    nameAliases: ["meijer"],
    searchName: "Meijer",
    flyerKitSlug: "meijer",
  },
  {
    storeName: "Food Lion",
    merchantIds: [],
    nameAliases: ["food lion"],
    searchName: "Food Lion",
    flyerKitSlug: "foodlion",
  },
  {
    storeName: "H-E-B",
    merchantIds: [],
    nameAliases: ["h-e-b", "heb"],
    searchName: "H-E-B",
    flyerKitSlug: "heb",
  },
  {
    storeName: "Safeway",
    merchantIds: [],
    nameAliases: ["safeway"],
    searchName: "Safeway",
    flyerKitSlug: "safeway",
  },
  {
    storeName: "Giant Eagle",
    merchantIds: [],
    nameAliases: ["giant eagle"],
    searchName: "Giant Eagle",
    flyerKitSlug: "gianteagle",
  },
  {
    storeName: "Costco",
    merchantIds: [2519],
    nameAliases: ["costco"],
    searchName: "Costco",
    flyerKitSlug: "costco",
  },
];

export function normalizeMerchantName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ");
}

function aliasMatches(
  merchantName: string,
  alias: string,
  exactName: boolean | undefined
): boolean {
  const name = normalizeMerchantName(merchantName);
  const key = normalizeMerchantName(alias);
  if (name === key) {
    return true;
  }
  if (exactName) {
    return false;
  }
  return name.startsWith(`${key} `);
}

export function mappingForStore(
  storeName: string
): FlippMerchantMapping | undefined {
  const key = normalizeMerchantName(storeName);
  return FLIPP_MERCHANT_MAPPINGS.find(
    (mapping) =>
      normalizeMerchantName(mapping.storeName) === key ||
      mapping.nameAliases.some((alias) => aliasMatches(storeName, alias, mapping.exactName))
  );
}

export function canonicalGroceryStoreName(storeName: string): string {
  return mappingForStore(storeName)?.storeName ?? storeName.trim();
}

export function groceryStoreNameForFlippMerchant(
  merchantName: string,
  merchantId?: number | null
): string | undefined {
  const id = typeof merchantId === "number" ? merchantId : undefined;
  for (const mapping of FLIPP_MERCHANT_MAPPINGS) {
    if (id != null && mapping.merchantIds.includes(id)) {
      return mapping.storeName;
    }
  }
  for (const mapping of FLIPP_MERCHANT_MAPPINGS) {
    if (
      mapping.nameAliases.some((alias) =>
        aliasMatches(merchantName, alias, mapping.exactName)
      )
    ) {
      return mapping.storeName;
    }
  }
  return undefined;
}

export function flippItemMatchesStore(
  storeName: string,
  merchantName: string,
  merchantId?: number | null
): boolean {
  const mapping = mappingForStore(storeName);
  if (!mapping) {
    return false;
  }
  const mapped = groceryStoreNameForFlippMerchant(merchantName, merchantId);
  return mapped === mapping.storeName;
}
