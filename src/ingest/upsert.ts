import { formatUnitPrice, parsePackageSize } from "../packageSize";
import { mapToDepartment } from "../catalog/departments";
import { upcKey } from "../catalog/normalize";
import type { RawCatalogRecord } from "../catalog/types";
import { ingestConfig } from "./config";
import { CatalogMaster, CatalogOffer, type CatalogStatus } from "./models";

type CatalogMasterLean = {
  name: string;
  brand?: string;
  imageUrls?: string[];
  categoryPaths?: string[];
  walmartItemId?: string;
  krogerProductId?: string;
};

export function freshnessStatus(lastSeenAt: Date, now: Date, staleDays: number, discontinueDays: number): CatalogStatus {
  const ageMs = now.getTime() - lastSeenAt.getTime();
  if (ageMs >= discontinueDays * 86_400_000) {
    return "discontinued";
  }
  if (ageMs >= staleDays * 86_400_000) {
    return "stale";
  }
  return "active";
}

export function localProductKey(record: RawCatalogRecord): string | null {
  const itemId = record.retailerItemId?.trim() || record.productId?.trim();
  const store = record.storeName.trim().toLowerCase();
  if (!itemId || !store) {
    return null;
  }
  return `local:${store}:${itemId}`;
}

export function productKeyFor(record: RawCatalogRecord): string | null {
  const upc = upcKey(record.upc);
  if (upc) {
    return upc;
  }
  return localProductKey(record);
}

/**
 * Move offers off a `local:` shadow onto the UPC key. A colliding offer
 * (same store and location) is dropped. Returns how many offer documents
 * were removed.
 */
async function rekeyLocalOffers(fromKey: string, toKey: string): Promise<number> {
  const offers = await CatalogOffer.find({ productKey: fromKey })
    .select("_id storeName locationId")
    .lean<Array<{ _id: unknown; storeName: string; locationId?: string }>>();
  let removed = 0;
  for (const offer of offers) {
    const locationId = offer.locationId ?? "";
    const clash = await CatalogOffer.exists({ productKey: toKey, storeName: offer.storeName, locationId });
    if (clash) {
      await CatalogOffer.deleteOne({ _id: offer._id });
      removed += 1;
    } else {
      await CatalogOffer.updateOne({ _id: offer._id }, { $set: { productKey: toKey } });
    }
  }
  return removed;
}

function unionCap(existing: string[] | undefined, incoming: string[] | undefined, cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [...(existing ?? []), ...(incoming ?? [])]) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= cap) {
      break;
    }
  }
  return out;
}

export type UpsertResult = {
  masters: number;
  offers: number;
  skippedByCap: number;
};

/**
 * Idempotent upsert. The same UPC from Walmart and Kroger shares one master.
 * A second write updates price and lastSeenAt and clears a stale flag.
 * New keys are refused once the configured caps are reached.
 * Renaming `local:walmart:{itemId}` onto a UPC is an in-place upgrade: it
 * does not count as a new product, including when the catalog is already full.
 */
export async function upsertCatalogRecords(
  records: RawCatalogRecord[],
  seenAt = new Date()
): Promise<UpsertResult> {
  const config = ingestConfig();
  let masters = 0;
  let offers = 0;
  let skippedByCap = 0;
  let productCount = await CatalogMaster.countDocuments();
  let offerCount = await CatalogOffer.countDocuments();

  for (const record of records) {
    const key = productKeyFor(record);
    const name = record.name.trim();
    const storeName = record.storeName.trim();
    if (!key || !name || !storeName || !Number.isFinite(record.price) || record.price < 0) {
      continue;
    }
    const fromPath = mapToDepartment(record.categories, name);
    const nameOnly = mapToDepartment(undefined, name);
    const explicitId = record.departmentId?.trim();
    const categoryIsSpecific = fromPath.signal === "specific";
    const nameKnows = nameOnly.departmentId !== "other";
    const useExplicit = Boolean(
      explicitId &&
        explicitId !== "other" &&
        fromPath.signal !== "excluded" &&
        !categoryIsSpecific &&
        !nameKnows &&
        (fromPath.signal === "broad" || fromPath.signal === "none" || fromPath.departmentId === "other")
    );
    const mapped = useExplicit
      ? mapToDepartment(record.categories, name, {
          departmentId: explicitId,
          subcategory: record.subcategory,
        })
      : fromPath;
    let existing = await CatalogMaster.findOne({ key }).lean<CatalogMasterLean | null>();
    const shadowKey = localProductKey(record);
    if (shadowKey && shadowKey !== key) {
      const shadow = await CatalogMaster.findOne({ key: shadowKey }).lean<CatalogMasterLean | null>();
      if (shadow) {
        const removedOffers = await rekeyLocalOffers(shadowKey, key);
        offerCount = Math.max(0, offerCount - removedOffers);
        if (existing) {
          await CatalogMaster.deleteOne({ key: shadowKey });
          productCount = Math.max(0, productCount - 1);
        } else {
          await CatalogMaster.updateOne({ key: shadowKey }, { $set: { key } });
          existing = shadow;
        }
      }
    }
    if (!existing && productCount >= config.maxProducts) {
      skippedByCap += 1;
      continue;
    }
    const brand = record.brand.trim() || storeName;
    const images = unionCap(existing?.imageUrls, record.imageUrls, 4);
    const paths = unionCap(existing?.categoryPaths, record.categories, 8);
    const walmartItemId =
      storeName.toLowerCase() === "walmart"
        ? record.retailerItemId?.trim() || record.productId?.trim() || existing?.walmartItemId
        : existing?.walmartItemId;
    const krogerProductId =
      storeName.toLowerCase() === "kroger"
        ? record.productId?.trim() || record.retailerItemId?.trim() || existing?.krogerProductId
        : existing?.krogerProductId;
    await CatalogMaster.updateOne(
      { key },
      {
        $set: {
          key,
          ...(upcKey(record.upc) ? { upc: record.upc?.replace(/\D/g, "") } : {}),
          name: !existing || name.length >= existing.name.length ? name : existing.name,
          brand: !existing || brand.length >= (existing.brand?.length ?? 0) ? brand : existing.brand,
          imageUrls: images,
          departmentId: mapped.departmentId,
          ...(mapped.subcategory ? { subcategory: mapped.subcategory } : {}),
          categoryPaths: paths,
          ...(record.size?.trim() ? { size: record.size.trim() } : {}),
          ...(walmartItemId ? { walmartItemId } : {}),
          ...(krogerProductId ? { krogerProductId } : {}),
          lastSeenAt: seenAt,
          status: "active",
        },
      },
      { upsert: true }
    );
    if (!existing) {
      productCount += 1;
    }
    masters += 1;

    const locationId = record.locationId?.trim() || "";
    const offerFilter = { productKey: key, storeName, locationId };
    const existingOffer = await CatalogOffer.exists(offerFilter);
    if (!existingOffer && offerCount >= config.maxOffers) {
      skippedByCap += 1;
      continue;
    }
    const parsed = parsePackageSize(record.size) ?? parsePackageSize(name);
    const unit = parsed ? formatUnitPrice(record.price, parsed) : null;
    const priceSource = record.priceSource === "seed" ? "seed" : "live";
    await CatalogOffer.updateOne(
      offerFilter,
      {
        $set: {
          productKey: key,
          storeName,
          locationId,
          zip: record.zip?.trim() || "",
          price: Math.round(record.price * 100) / 100,
          ...(unit ? { unitPrice: unit.unitPrice, unitPriceText: unit.unitPriceText } : {}),
          ...(record.size?.trim() ? { size: record.size.trim() } : {}),
          onSale: Boolean(record.onSale),
          availability: record.availability ?? "unknown",
          ...(record.retailerItemId?.trim() || record.productId?.trim()
            ? { retailerItemId: record.retailerItemId?.trim() || record.productId?.trim() }
            : {}),
          ...(record.productUrl?.trim() ? { productUrl: record.productUrl.trim() } : {}),
          priceSource,
          lastSeenAt: seenAt,
          status: "active",
        },
      },
      { upsert: true }
    );
    if (!existingOffer) {
      offerCount += 1;
    }
    offers += 1;
  }

  return { masters, offers, skippedByCap };
}

export async function markStaleCatalog(now = new Date()): Promise<{ stale: number; discontinued: number }> {
  const config = ingestConfig();
  const staleBefore = new Date(now.getTime() - config.staleDays * 86_400_000);
  const goneBefore = new Date(now.getTime() - config.discontinueDays * 86_400_000);
  const offersGone = await CatalogOffer.updateMany(
    { lastSeenAt: { $lt: goneBefore }, status: { $ne: "discontinued" } },
    { $set: { status: "discontinued" } }
  );
  const offersStale = await CatalogOffer.updateMany(
    { lastSeenAt: { $lt: staleBefore, $gte: goneBefore }, status: "active" },
    { $set: { status: "stale" } }
  );
  const mastersGone = await CatalogMaster.updateMany(
    { lastSeenAt: { $lt: goneBefore }, status: { $ne: "discontinued" } },
    { $set: { status: "discontinued" } }
  );
  const mastersStale = await CatalogMaster.updateMany(
    { lastSeenAt: { $lt: staleBefore, $gte: goneBefore }, status: "active" },
    { $set: { status: "stale" } }
  );
  return {
    stale: (offersStale.modifiedCount ?? 0) + (mastersStale.modifiedCount ?? 0),
    discontinued: (offersGone.modifiedCount ?? 0) + (mastersGone.modifiedCount ?? 0),
  };
}
