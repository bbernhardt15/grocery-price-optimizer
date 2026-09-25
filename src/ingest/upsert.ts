import { formatUnitPrice, parsePackageSize } from "../packageSize";
import { mapToDepartment } from "../catalog/departments";
import { upcKey } from "../catalog/normalize";
import type { RawCatalogRecord } from "../catalog/types";
import { ingestConfig } from "./config";
import { CatalogMaster, CatalogOffer, type CatalogStatus } from "./models";

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

export function productKeyFor(record: RawCatalogRecord): string | null {
  const upc = upcKey(record.upc);
  if (upc) {
    return upc;
  }
  const itemId = record.retailerItemId?.trim() || record.productId?.trim();
  const store = record.storeName.trim().toLowerCase();
  if (!itemId || !store) {
    return null;
  }
  return `local:${store}:${itemId}`;
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
    const explicitId = record.departmentId?.trim();
    const mapped =
      fromPath.departmentId !== "other"
        ? fromPath
        : explicitId && explicitId !== "other"
          ? mapToDepartment(record.categories, name, {
              departmentId: explicitId,
              subcategory: record.subcategory,
            })
          : fromPath;
    const existing = await CatalogMaster.findOne({ key }).lean<CatalogMasterLean | null>();
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

type CatalogMasterLean = {
  name: string;
  brand?: string;
  imageUrls?: string[];
  categoryPaths?: string[];
  walmartItemId?: string;
  krogerProductId?: string;
};

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
