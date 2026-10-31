import mongoose from "mongoose";
import type { CatalogProduct } from "../optimizeGroceryList";
import { parseGroceryUnit } from "../pricing/parseGroceryUnit";
import type { RawCatalogRecord } from "../catalog/types";
import { escapeRegex } from "../escapeRegex";
import { ingestConfig } from "./config";
import { CatalogMaster, CatalogOffer, type CatalogMasterDoc, type CatalogOfferDoc } from "./models";

function tokensOf(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

function matchesTokens(name: string, brand: string, tokens: string[]): boolean {
  const haystack = `${name} ${brand}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

/** Shopper browse and search omit Other unless that aisle was asked for. */
function departmentClause(departmentId?: string): Record<string, unknown> {
  if (departmentId && departmentId !== "all") {
    return { departmentId };
  }
  return { departmentId: { $ne: "other" } };
}

async function findMasters(scope: { departmentId?: string; query?: string }): Promise<CatalogMasterDoc[]> {
  const config = ingestConfig();
  const tokens = tokensOf(scope.query ?? "");
  const status = { $ne: "discontinued" };
  const department = departmentClause(scope.departmentId);
  if (tokens.length > 0) {
    try {
      const found = await CatalogMaster.find(
        {
          $text: { $search: tokens.join(" ") },
          status,
          ...department,
        },
        { score: { $meta: "textScore" } }
      )
        .sort({ score: { $meta: "textScore" } })
        .limit(config.browseScan)
        .lean<CatalogMasterDoc[]>();
      const narrowed = found.filter((master) => matchesTokens(master.name, master.brand, tokens));
      if (narrowed.length > 0) {
        return narrowed;
      }
    } catch {
      // Text index may still be building. Regex below is the fallback.
    }
    const clauses = tokens.map((token) => {
      const pattern = new RegExp(escapeRegex(token), "i");
      return { $or: [{ name: pattern }, { brand: pattern }] };
    });
    return CatalogMaster.find({
      status,
      $and: clauses,
      ...department,
    })
      .limit(config.browseScan)
      .lean<CatalogMasterDoc[]>();
  }
  return CatalogMaster.find({ ...department, status })
    .sort(scope.departmentId && scope.departmentId !== "all" ? { name: 1 } : { lastSeenAt: -1 })
    .limit(config.browseScan)
    .lean<CatalogMasterDoc[]>();
}

function recordFrom(master: CatalogMasterDoc, offer: CatalogOfferDoc): RawCatalogRecord {
  return {
    name: master.name,
    brand: master.brand,
    storeName: offer.storeName,
    price: offer.price,
    priceSource: offer.priceSource === "seed" ? "seed" : "live",
    ...(master.upc ? { upc: master.upc } : {}),
    ...(offer.retailerItemId ? { productId: offer.retailerItemId, retailerItemId: offer.retailerItemId } : {}),
    ...(offer.locationId ? { locationId: offer.locationId } : {}),
    ...(offer.zip ? { zip: offer.zip } : {}),
    ...(offer.size || master.size ? { size: offer.size || master.size } : {}),
    ...(master.imageUrls?.length ? { imageUrls: master.imageUrls } : {}),
    departmentId: master.departmentId,
    ...(master.subcategory ? { subcategory: master.subcategory } : {}),
    ...(master.categoryPaths?.length ? { categories: master.categoryPaths } : {}),
    ...(offer.onSale ? { onSale: true } : {}),
    availability: offer.availability,
    ...(offer.productUrl ? { productUrl: offer.productUrl } : {}),
  };
}

/** Catalog rows whose stored UPC is one of these codes. */
export async function readRecordsByUpc(upcs: string[]): Promise<RawCatalogRecord[]> {
  if (mongoose.connection.readyState !== 1) return [];
  const codes = [...new Set(upcs.map((upc) => upc.replace(/\D/g, "")).filter((upc) => upc.length >= 8 && upc.length <= 14))].slice(0, 80);
  if (!codes.length) return [];
  const masters = await CatalogMaster.find({ upc: { $in: codes }, status: { $ne: "discontinued" } })
    .limit(80)
    .lean<CatalogMasterDoc[]>();
  if (!masters.length) return [];
  const offers = await CatalogOffer.find({
    productKey: { $in: masters.map((master) => master.key) },
    status: { $ne: "discontinued" },
  }).lean<CatalogOfferDoc[]>();
  const records: RawCatalogRecord[] = [];
  for (const master of masters) {
    for (const offer of offers) {
      if (offer.productKey === master.key) records.push(recordFrom(master, offer));
    }
  }
  return records;
}

export async function readStoredRecords(scope: {
  departmentId?: string;
  query?: string;
  zipCode?: string;
  locationId?: string;
}): Promise<{ records: RawCatalogRecord[]; warnings: string[]; storeNames: string[] }> {
  if (mongoose.connection.readyState !== 1) {
    return { records: [], warnings: [], storeNames: [] };
  }
  const masters = await findMasters(scope);
  if (masters.length === 0) {
    return { records: [], warnings: [], storeNames: [] };
  }
  const keys = masters.map((master) => master.key);
  const offers = await CatalogOffer.find({
    productKey: { $in: keys },
    status: { $ne: "discontinued" },
  }).lean<CatalogOfferDoc[]>();
  const zip = scope.zipCode?.trim().slice(0, 5) ?? "";
  const locationId = scope.locationId?.trim() ?? "";
  const kroger = offers.filter((offer) => offer.storeName.toLowerCase() === "kroger");
  const krogerHere = kroger.filter(
    (offer) => (locationId && offer.locationId === locationId) || (zip && offer.zip === zip)
  );
  let krogerPool = krogerHere;
  const warnings: string[] = [];
  if (kroger.length > 0 && krogerHere.length === 0) {
    const seedZip = ingestConfig().seedZips[0];
    krogerPool = seedZip ? kroger.filter((offer) => offer.zip === seedZip) : kroger;
    if (krogerPool.length === 0) {
      krogerPool = kroger.filter((offer) => offer.locationId === kroger[0]?.locationId);
    }
    warnings.push(
      zip
        ? `Kroger prices are for a seeded store, not ZIP ${zip} yet. The ingestion job prices a new ZIP on its next pass.`
        : "Kroger prices are for a seeded store. Enter a ZIP so that store can be refreshed."
    );
  }
  const other = offers.filter((offer) => offer.storeName.toLowerCase() !== "kroger");
  const chosen = [...other, ...krogerPool];
  const byKey = new Map(masters.map((master) => [master.key, master]));
  const records: RawCatalogRecord[] = [];
  const storeNames = new Set<string>();
  for (const offer of chosen) {
    const master = byKey.get(offer.productKey);
    if (!master) {
      continue;
    }
    records.push(recordFrom(master, offer));
    storeNames.add(offer.storeName);
  }
  return { records, warnings, storeNames: [...storeNames] };
}

export async function readStoredById(id: string): Promise<RawCatalogRecord[]> {
  if (mongoose.connection.readyState !== 1) {
    return [];
  }
  const key = id.startsWith("upc:") ? id.slice(4) : id;
  const master = await CatalogMaster.findOne({ key, status: { $ne: "discontinued" } }).lean<CatalogMasterDoc | null>();
  if (!master) {
    return [];
  }
  const offers = await CatalogOffer.find({ productKey: key, status: { $ne: "discontinued" } }).lean<CatalogOfferDoc[]>();
  return offers.map((offer) => recordFrom(master, offer));
}

export async function storedLineProducts(
  line: string,
  storeName: string,
  locationId?: string
): Promise<CatalogProduct[]> {
  if (mongoose.connection.readyState !== 1) {
    return [];
  }
  const tokens = tokensOf(line);
  if (tokens.length === 0) {
    return [];
  }
  const masters = await findMasters({ query: line });
  const matched = masters.filter((master) => matchesTokens(master.name, master.brand, tokens)).slice(0, 25);
  if (matched.length === 0) {
    return [];
  }
  const offers = await CatalogOffer.find({
    productKey: { $in: matched.map((master) => master.key) },
    storeName,
    status: { $ne: "discontinued" },
    ...(storeName.toLowerCase() === "kroger" && locationId ? { locationId } : {}),
  }).lean<CatalogOfferDoc[]>();
  const byKey = new Map(matched.map((master) => [master.key, master]));
  const products: CatalogProduct[] = [];
  for (const offer of offers) {
    const master = byKey.get(offer.productKey);
    if (!master) {
      continue;
    }
    const unit = parseGroceryUnit(offer.size || master.size);
    products.push({
      name: master.name,
      brand: master.brand,
      storeName: offer.storeName,
      price: offer.price,
      unit,
      normalizedUnit: unit,
      priceSource: offer.priceSource === "seed" ? "seed" : "live",
      ...(master.upc ? { upc: master.upc } : {}),
      ...(offer.retailerItemId ? { productId: offer.retailerItemId } : {}),
      ...(offer.locationId ? { locationId: offer.locationId } : {}),
      ...(offer.size || master.size ? { size: offer.size || master.size } : {}),
      ...(master.imageUrls?.length ? { imageUrls: master.imageUrls } : {}),
      ...(master.categoryPaths?.length ? { categories: master.categoryPaths } : {}),
      ...(offer.onSale ? { onSale: true } : {}),
      availability: offer.availability,
    });
  }
  return products;
}
