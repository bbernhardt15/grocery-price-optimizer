import { upcKey } from "./catalog/normalize";
import { mapToDepartment } from "./catalog/departments";
import { parsePackageSize } from "./packageSize";
import type { GroceryLine } from "./parseGroceryLine";
import { parseGroceryList } from "./parseGroceryLine";
import { compareProductOffers, unitPriceForProduct } from "./productMatch";
import {
  groceryWordTokens,
  matchTokenSets,
  nameContainsAllTokens,
} from "./productSearchQuery";

export type PriceSource = "live" | "cached_live" | "weekly_ad" | "seed";

export type CatalogProduct = {
  name: string;
  brand: string;
  storeName: string;
  locationId?: string;
  /** Retailer product id when known (Kroger Products API `productId`, typically the UPC). */
  productId?: string;
  /** UPC / GTIN when known. For Kroger this is usually the same as `productId`. */
  upc?: string;
  price: number;
  unit: string;
  normalizedUnit: string;
  lastUpdated?: Date;
  updatedAt?: Date;
  /** Retailer size text ("12 oz", "1 gal", "18 ct") when the API sent one. */
  size?: string;
  /** In-memory: the grocery line that fetched this row for this request. */
  sourceQuery?: string;
  /**
   * Browse checkout pins the shopper's chosen offers so a cheaper lookalike
   * in the seed catalog cannot replace the product they selected.
   */
  pinned?: boolean;
  /** Substitute rows compete only when the shopper allows them. */
  offerRole?: "exact" | "substitute";
  substitutedFor?: string;
  /** live = retailer API this request; cached_live = Mongo row from a live API; weekly_ad = flyer/circular; seed = demo catalog. */
  priceSource?: PriceSource;
  imageUrls?: string[];
  categories?: string[];
  onSale?: boolean;
  availability?: "in_stock" | "out_of_stock" | "unknown";
};

export type PickedItem = {
  query: string;
  name: string;
  brand: string;
  storeName: string;
  price: number;
  quantity: number;
  itemTotal: number;
  unit: string;
  normalizedUnit: string;
  /** Retailer package text ("1 gal", "16 oz", "12 ct") when the catalog had one. */
  size?: string;
  /** Package unit price rounded to cents, in the same units as `unitPriceText`. */
  unitPrice?: number;
  /** For example "$3.29/gal" or "$0.20/ct" when the package size was parsed. */
  unitPriceText?: string;
  locationId?: string;
  productId?: string;
  upc?: string;
  priceSource?: PriceSource;
  /**
   * `swap` only when the chosen item is not sold at any in-scope store and a
   * different pack is filling in. An exact UPC or variant is never a swap.
   */
  matchKind?: "exact" | "swap" | "substitute";
  /** "Swapped: X is not sold at Walmart, using Y" */
  swapNote?: string;
  substitutedFor?: string;
  /** Cheapest in-scope store that sells the chosen item, when one does. */
  exactStore?: string;
  /** Stable id for this grocery line, used to remember checks and moves. */
  lineId?: string;
  /** Department name when the catalog or the product name maps to one. */
  department?: string;
  /** Aisle or subcategory when one is known. */
  aisle?: string;
  /** Cheapest offer at each store that carries this line, including the winner. */
  offers?: ItemOffer[];
};

/** One store's price for a line, so the shopper can move it and re-total offline. */
export type ItemOffer = {
  storeName: string;
  name: string;
  brand: string;
  price: number;
  unit: string;
  normalizedUnit: string;
  size?: string;
  productId?: string;
  upc?: string;
  locationId?: string;
  priceSource?: PriceSource;
  department?: string;
  aisle?: string;
  /** Filled in when the trip is enriched with handoff links. */
  url?: string;
  /** `swap` when this store does not carry the chosen item. */
  matchKind?: "exact" | "swap" | "substitute";
  swapNote?: string;
  substitutedFor?: string;
};

export type StoreGroup = {
  storeName: string;
  items: PickedItem[];
  subtotal: number;
};

export type OptimizeResult = {
  stores: StoreGroup[];
  unavailable: string[];
  total: number;
};

/** split picks the cheapest store per item. single keeps the one store that fills the most, then the lowest total. */
export type TripMode = "split" | "single";

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function allowedStores(stores: string[]): Set<string> | null {
  const names = stores
    .map((store) => store.trim().toLowerCase())
    .filter((store) => store.length > 0);

  return names.length === 0 ? null : new Set(names);
}

export function productMatchesItem(
  product: CatalogProduct,
  item: string
): boolean {
  if (product.sourceQuery && product.sourceQuery === item) {
    return true;
  }

  return matchTokenSets(item).some((tokens) =>
    nameContainsAllTokens(product.name, tokens)
  );
}

function offerKey(product: CatalogProduct): string {
  return [
    product.storeName.trim().toLowerCase(),
    product.upc ?? "",
    product.name.trim().toLowerCase(),
    product.price,
    product.size ?? "",
  ].join("|");
}

function dedupeCandidates(products: CatalogProduct[]): CatalogProduct[] {
  const map = new Map<string, CatalogProduct>();
  for (const product of products) {
    const key = offerKey(product);
    const existing = map.get(key);
    if (!existing || (existing.offerRole === "substitute" && product.offerRole !== "substitute")) {
      map.set(key, product);
    }
  }
  return [...map.values()];
}

function productsMatchingQuery(
  catalog: CatalogProduct[],
  item: string
): CatalogProduct[] {
  const substitutes = catalog.filter(
    (product) => product.offerRole === "substitute" && product.sourceQuery === item
  );
  const pinned = catalog.filter(
    (product) => product.pinned && product.sourceQuery === item && product.offerRole !== "substitute"
  );
  if (pinned.length > 0) {
    return dedupeCandidates([...pinned, ...substitutes]);
  }

  let matches: CatalogProduct[] = [];
  for (const tokens of matchTokenSets(item)) {
    const found = catalog.filter((product) => nameContainsAllTokens(product.name, tokens));
    if (found.length > 0) {
      matches = found;
      break;
    }
  }

  if (matches.length === 0) {
    matches = catalog.filter(
      (product) => product.sourceQuery === item && product.offerRole !== "substitute"
    );
  }

  return dedupeCandidates([...matches, ...substitutes]);
}

function rankedMatches(line: GroceryLine, catalog: CatalogProduct[]): CatalogProduct[] {
  const matches = productsMatchingQuery(catalog, line.name);
  // Keep each row's real name. Rewriting a substitute to the grocery line made
  // a different pack look like an exact size match and let it beat a cheaper item.
  matches.sort((a, b) => compareProductOffers(line.name, a, b));
  return matches;
}

function storeKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Package used to decide "same variant". The title wins when the retailer
 * size field is only the single bottle inside a pack the title already names
 * ("16.9 fl oz" on a "6 Pack" of 16.9 fl oz bottles). Otherwise the retailer
 * size field wins, then the title.
 */
function identitySize(product: CatalogProduct): { dimension: string; amount: number } | null {
  const fromName = parsePackageSize(product.name);
  const fromField = product.size?.trim() ? parsePackageSize(product.size) : null;
  if (
    fromName &&
    fromField &&
    fromName.dimension === fromField.dimension &&
    fromField.amount > 0
  ) {
    const ratio = fromName.amount / fromField.amount;
    const rounded = Math.round(ratio);
    if (rounded >= 2 && Math.abs(ratio - rounded) < 0.08) {
      return { dimension: fromName.dimension, amount: fromName.amount };
    }
    return { dimension: fromField.dimension, amount: fromField.amount };
  }
  const size = fromField ?? fromName;
  return size ? { dimension: size.dimension, amount: size.amount } : null;
}

/** Same UPC, or the same brand + name + pack. Different packs stay apart. */
function variantKey(product: CatalogProduct): string | null {
  const name = groceryWordTokens(product.name).join(" ");
  if (!name) {
    return null;
  }
  const brand = product.brand.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  const size = identitySize(product);
  const sizeKey = size
    ? `${size.dimension}:${Math.round(size.amount * 10) / 10}`
    : "nosize";
  return `${brand}|${name}|${sizeKey}`;
}

function sameIdentity(a: CatalogProduct, b: CatalogProduct): boolean {
  const upcA = upcKey(a.upc);
  const upcB = upcKey(b.upc);
  if (upcA && upcB && upcA === upcB) {
    return true;
  }
  const left = variantKey(a);
  const right = variantKey(b);
  return Boolean(left && right && left === right);
}

function preferShelf(current: CatalogProduct, candidate: CatalogProduct): CatalogProduct {
  if (candidate.price !== current.price) {
    return candidate.price < current.price ? candidate : current;
  }
  const candidateExact = candidate.offerRole !== "substitute";
  const currentExact = current.offerRole !== "substitute";
  if (candidateExact !== currentExact) {
    return candidateExact ? candidate : current;
  }
  const byStore = candidate.storeName.localeCompare(current.storeName);
  if (byStore !== 0) {
    return byStore < 0 ? candidate : current;
  }
  return candidate.name.localeCompare(current.name) < 0 ? candidate : current;
}

function cheapestPerStore(products: CatalogProduct[]): CatalogProduct[] {
  const byStore = new Map<string, CatalogProduct>();
  for (const product of products) {
    const key = storeKey(product.storeName);
    const existing = byStore.get(key);
    byStore.set(key, existing ? preferShelf(existing, product) : product);
  }
  return [...byStore.values()].sort((a, b) => {
    if (a.price !== b.price) {
      return a.price - b.price;
    }
    const byStore = a.storeName.localeCompare(b.storeName);
    return byStore !== 0 ? byStore : a.name.localeCompare(b.name);
  });
}

function bestRankedPerStore(products: CatalogProduct[], query: string): CatalogProduct[] {
  const groups = new Map<string, CatalogProduct[]>();
  for (const product of products) {
    const key = storeKey(product.storeName);
    const list = groups.get(key);
    if (list) {
      list.push(product);
    } else {
      groups.set(key, [product]);
    }
  }
  const chosen: CatalogProduct[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => compareProductOffers(query, a, b));
    if (group[0]) {
      chosen.push(group[0]);
    }
  }
  return chosen.sort(
    (a, b) => a.price - b.price || a.storeName.localeCompare(b.storeName)
  );
}

function replacementLabel(product: CatalogProduct, chosen: string): string {
  const name = product.name.trim();
  const size = product.size?.trim();
  const brand = product.brand.trim();
  if (name.toLowerCase() === chosen.trim().toLowerCase()) {
    const detail = [brand, size].filter(Boolean).join(", ");
    return detail ? `${name} (${detail})` : name;
  }
  if (size && !name.toLowerCase().includes(size.toLowerCase())) {
    return `${name}, ${size}`;
  }
  if (brand && !name.toLowerCase().includes(brand.toLowerCase())) {
    return `${brand} ${name}`;
  }
  return name;
}

function swapSentence(chosen: string, storeName: string, replacement: string): string {
  return `Swapped: ${chosen} is not sold at ${storeName}, using ${replacement}`;
}

function toItemOffer(
  product: CatalogProduct,
  extra?: { matchKind?: "swap"; swapNote?: string; substitutedFor?: string }
): ItemOffer {
  const mapped = mapToDepartment(product.categories, product.name);
  return {
    storeName: product.storeName,
    name: product.name,
    brand: product.brand,
    price: product.price,
    unit: product.unit,
    normalizedUnit: product.normalizedUnit,
    ...(product.size ? { size: product.size } : {}),
    ...(product.productId ? { productId: product.productId } : {}),
    ...(product.upc ? { upc: product.upc } : {}),
    ...(product.locationId ? { locationId: product.locationId } : {}),
    ...(product.priceSource ? { priceSource: product.priceSource } : {}),
    department: mapped.departmentName,
    ...(mapped.subcategory ? { aisle: mapped.subcategory } : {}),
    ...(extra?.matchKind ? { matchKind: extra.matchKind } : {}),
    ...(extra?.swapNote ? { swapNote: extra.swapNote } : {}),
    ...(extra?.substitutedFor ? { substitutedFor: extra.substitutedFor } : {}),
  };
}

function swapOffer(product: CatalogProduct, chosen: string): ItemOffer {
  const replacement = replacementLabel(product, chosen);
  return toItemOffer(product, {
    matchKind: "swap",
    swapNote: swapSentence(chosen, product.storeName, replacement),
    substitutedFor: chosen,
  });
}

/** First match per store wins because `matches` is already ranked best-first. */
function bestOfferPerStore(matches: CatalogProduct[]): ItemOffer[] {
  const seen = new Set<string>();
  const offers: ItemOffer[] = [];
  for (const product of matches) {
    const key = storeKey(product.storeName);
    if (seen.has(key)) continue;
    seen.add(key);
    offers.push(toItemOffer(product));
  }
  return offers;
}

function toPicked(
  line: GroceryLine,
  best: CatalogProduct,
  offers: ItemOffer[],
  extra: {
    matchKind?: "swap";
    swapNote?: string;
    substitutedFor?: string;
    exactStore?: string;
  } = {}
): PickedItem {
  const unitPrice = unitPriceForProduct(best.price, best.name, best.size);
  const mapped = mapToDepartment(best.categories, best.name);
  return {
    query: line.name,
    name: best.name,
    brand: best.brand,
    storeName: best.storeName,
    price: best.price,
    quantity: line.quantity,
    itemTotal: roundMoney(best.price * line.quantity),
    unit: best.unit,
    normalizedUnit: best.normalizedUnit,
    ...(best.size ? { size: best.size } : {}),
    ...(unitPrice ?? {}),
    ...(best.locationId ? { locationId: best.locationId } : {}),
    ...(best.productId ? { productId: best.productId } : {}),
    ...(best.upc ? { upc: best.upc } : {}),
    ...(best.priceSource ? { priceSource: best.priceSource } : {}),
    department: mapped.departmentName,
    ...(mapped.subcategory ? { aisle: mapped.subcategory } : {}),
    offers,
    ...(extra.exactStore ? { exactStore: extra.exactStore } : {}),
    ...(extra.matchKind
      ? {
          matchKind: extra.matchKind,
          ...(extra.swapNote ? { swapNote: extra.swapNote } : {}),
          ...(extra.substitutedFor ? { substitutedFor: extra.substitutedFor } : {}),
        }
      : {}),
  };
}

function lineAnchors(line: GroceryLine, catalog: CatalogProduct[]): CatalogProduct[] {
  return catalog.filter(
    (product) =>
      product.pinned && product.sourceQuery === line.name && product.offerRole !== "substitute"
  );
}

function lineSubstitutes(line: GroceryLine, catalog: CatalogProduct[]): CatalogProduct[] {
  return catalog.filter(
    (product) => product.offerRole === "substitute" && product.sourceQuery === line.name
  );
}

function chosenName(
  line: GroceryLine,
  anchors: CatalogProduct[],
  subs: CatalogProduct[]
): string {
  return (
    anchors[0]?.name ||
    subs.find((product) => product.substitutedFor)?.substitutedFor ||
    line.name
  );
}

/**
 * The shopper picked one product. Compare that UPC / variant on shelf price.
 * A different pack is only the assignment when no in-scope store sells it.
 */
function pickSelected(
  line: GroceryLine,
  catalog: CatalogProduct[],
  anchors: CatalogProduct[],
  subs: CatalogProduct[]
): PickedItem | null {
  const chosen = chosenName(line, anchors, subs);
  const pool =
    anchors.length > 0
      ? catalog.filter((product) => anchors.some((anchor) => sameIdentity(anchor, product)))
      : [];
  if (pool.length > 0) {
    const exacts = cheapestPerStore(pool);
    const best = exacts[0];
    if (!best) {
      return null;
    }
    const covered = new Set(exacts.map((product) => storeKey(product.storeName)));
    const swaps = bestRankedPerStore(
      subs.filter(
        (product) =>
          !covered.has(storeKey(product.storeName)) &&
          !exacts.some((exact) => sameIdentity(exact, product))
      ),
      line.name
    );
    return toPicked(
      line,
      best,
      [...exacts.map((product) => toItemOffer(product)), ...swaps.map((product) => swapOffer(product, chosen))],
      { exactStore: best.storeName }
    );
  }
  if (subs.length === 0) {
    return null;
  }
  const ranked = bestRankedPerStore(subs, line.name);
  const best = ranked[0];
  if (!best) {
    return null;
  }
  const offers = ranked.map((product) => swapOffer(product, chosen));
  const winner = offers.find((offer) => storeKey(offer.storeName) === storeKey(best.storeName));
  return toPicked(line, best, offers, {
    matchKind: "swap",
    ...(winner?.swapNote ? { swapNote: winner.swapNote } : {}),
    substitutedFor: chosen,
  });
}

function pickGeneric(line: GroceryLine, catalog: CatalogProduct[]): PickedItem | null {
  const matches = rankedMatches(line, catalog);
  if (matches.length === 0) {
    return null;
  }
  return toPicked(line, matches[0], bestOfferPerStore(matches));
}

function pickForLine(line: GroceryLine, catalog: CatalogProduct[]): PickedItem | null {
  const anchors = lineAnchors(line, catalog);
  const subs = lineSubstitutes(line, catalog);
  if (anchors.length > 0 || subs.length > 0) {
    return pickSelected(line, catalog, anchors, subs);
  }
  return pickGeneric(line, catalog);
}

/**
 * Maps each grocery item to one in-scope product, multiplies that shelf price
 * by the requested quantity, then groups by storeName.
 *
 * A pinned selection is one product. Every store that sells that UPC or the
 * same brand, name, and pack is compared on shelf price, and the cheapest
 * store gets the line. A different pack is used only when that item is not
 * sold at any in-scope store, and then it is labeled as a swap.
 *
 * A typed line (no pinned product) still uses the strongest keyword set, then
 * the product itself over a flavor, then the closest requested size or the
 * lower unit price. See `productMatch.ts`.
 */
function catalogFor(stores: string[], products: CatalogProduct[]): CatalogProduct[] {
  const storeFilter = allowedStores(stores);
  if (storeFilter === null) return products;
  return products.filter((product) => storeFilter.has(product.storeName.trim().toLowerCase()));
}

/**
 * One store for the whole list. The store that can fill the most lines wins.
 * A tie goes to the lower total, then the store name.
 */
export function optimizeSingleStore(
  groceryList: string[],
  stores: string[],
  products: CatalogProduct[]
): OptimizeResult {
  const items = parseGroceryList(groceryList);
  const catalog = catalogFor(stores, products);
  const storeNames = [...new Set(catalog.map((product) => product.storeName))].sort((a, b) => a.localeCompare(b));
  let best: { storeName: string; picks: PickedItem[]; unavailable: string[] } | null = null;

  for (const storeName of storeNames) {
    const shelf = catalog.filter((product) => product.storeName === storeName);
    const picks: PickedItem[] = [];
    const unavailable: string[] = [];
    items.forEach((line, index) => {
      const pick = pickForLine(line, shelf);
      if (!pick) unavailable.push(line.name);
      else picks.push({ ...pick, lineId: `${index}:${line.name.trim().toLowerCase()}` });
    });
    if (picks.length === 0) continue;
    const total = roundMoney(picks.reduce((sum, item) => sum + item.itemTotal, 0));
    const bestTotal = best ? roundMoney(best.picks.reduce((sum, item) => sum + item.itemTotal, 0)) : Number.POSITIVE_INFINITY;
    const better =
      !best ||
      picks.length > best.picks.length ||
      (picks.length === best.picks.length && total < bestTotal) ||
      (picks.length === best.picks.length && total === bestTotal && storeName.localeCompare(best.storeName) < 0);
    if (better) best = { storeName, picks, unavailable };
  }

  if (!best) {
    return { stores: [], unavailable: items.map((line) => line.name), total: 0 };
  }
  const subtotal = roundMoney(best.picks.reduce((sum, item) => sum + item.itemTotal, 0));
  return {
    stores: [{ storeName: best.storeName, items: best.picks, subtotal }],
    unavailable: best.unavailable,
    total: subtotal,
  };
}

export function optimizeGroceryList(
  groceryList: string[],
  stores: string[],
  products: CatalogProduct[],
  mode: TripMode = "split"
): OptimizeResult {
  if (mode === "single") return optimizeSingleStore(groceryList, stores, products);
  const items = parseGroceryList(groceryList);
  const catalog = catalogFor(stores, products);

  const picks: PickedItem[] = [];
  const unavailable: string[] = [];

  items.forEach((line, index) => {
    const pick = pickForLine(line, catalog);
    if (!pick) {
      unavailable.push(line.name);
      return;
    }

    picks.push({
      ...pick,
      lineId: `${index}:${line.name.trim().toLowerCase()}`,
    });
  });

  const grouped = new Map<string, PickedItem[]>();
  for (const pick of picks) {
    const existing = grouped.get(pick.storeName);
    if (existing) {
      existing.push(pick);
    } else {
      grouped.set(pick.storeName, [pick]);
    }
  }

  const storeGroups: StoreGroup[] = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([storeName, storeItems]) => ({
      storeName,
      items: storeItems,
      subtotal: roundMoney(
        storeItems.reduce((sum, item) => sum + item.itemTotal, 0)
      ),
    }));

  return {
    stores: storeGroups,
    unavailable,
    total: roundMoney(
      storeGroups.reduce((sum, group) => sum + group.subtotal, 0)
    ),
  };
}
