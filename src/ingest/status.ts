import { timingSafeEqual } from "node:crypto";
import { DEPARTMENTS } from "../catalog/departments";
import { estimateStorageBytes, ingestConfig } from "./config";
import { utcDay } from "./budget";
import { IngestBudget, IngestCheckpoint, CatalogMaster, CatalogOffer, ShopperZip } from "./models";

export function adminTokenConfigured(): boolean {
  return Boolean(process.env.ADMIN_TOKEN?.trim());
}

export function adminAuthorized(header: string | undefined): boolean {
  const expected = process.env.ADMIN_TOKEN?.trim() ?? "";
  if (!expected || !header) {
    return false;
  }
  const presented = header.replace(/^Bearer\s+/i, "").trim();
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export async function catalogStatus() {
  const config = ingestConfig();
  const now = new Date();
  const day = utcDay(now);
  const [products, offers, stale, discontinued, byStore, byDepartment, checkpoints, budgets, zips] = await Promise.all([
    CatalogMaster.countDocuments(),
    CatalogOffer.countDocuments(),
    CatalogOffer.countDocuments({ status: "stale" }),
    CatalogOffer.countDocuments({ status: "discontinued" }),
    CatalogOffer.aggregate<{ _id: string; count: number }>([
      { $match: { status: { $ne: "discontinued" } } },
      { $group: { _id: "$storeName", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    CatalogMaster.aggregate<{ _id: string; count: number }>([
      { $match: { status: { $ne: "discontinued" } } },
      { $group: { _id: "$departmentId", count: { $sum: 1 } } },
    ]),
    IngestCheckpoint.find().lean(),
    IngestBudget.find({ day }).lean<Array<{ provider: string; calls: number }>>(),
    ShopperZip.find().sort({ lastSeenAt: -1 }).limit(config.shopperZipLimit).lean(),
  ]);
  const departmentCounts = Object.fromEntries(DEPARTMENTS.map((department) => [department.id, 0]));
  for (const row of byDepartment) {
    departmentCounts[row._id] = row.count;
  }
  const used = Object.fromEntries(budgets.map((row) => [row.provider, row.calls]));
  const bytes = estimateStorageBytes(products, offers);
  return {
    enabled: config.enabled,
    dbFirst: config.dbFirst,
    day,
    counts: {
      products,
      offers,
      staleOffers: stale,
      discontinuedOffers: discontinued,
      byStore: Object.fromEntries(byStore.map((row) => [row._id, row.count])),
      byDepartment: departmentCounts,
    },
    caps: {
      maxProducts: config.maxProducts,
      maxOffers: config.maxOffers,
      productsRemaining: Math.max(0, config.maxProducts - products),
      offersRemaining: Math.max(0, config.maxOffers - offers),
    },
    storage: {
      estimatedBytes: bytes,
      estimatedMegabytes: Math.round((bytes / 1_000_000) * 10) / 10,
      note: "Estimate is about 1.2 KB per product master and 0.4 KB per offer, before indexes. Indexes are often about the same size again.",
    },
    budget: {
      walmart: { used: used.walmart ?? 0, limit: config.walmartDailyBudget, remaining: Math.max(0, config.walmartDailyBudget - (used.walmart ?? 0)) },
      kroger: { used: used.kroger ?? 0, limit: config.krogerDailyBudget, remaining: Math.max(0, config.krogerDailyBudget - (used.kroger ?? 0)) },
      krogerLocations: {
        used: used["kroger-locations"] ?? 0,
        limit: config.locationDailyBudget,
        remaining: Math.max(0, config.locationDailyBudget - (used["kroger-locations"] ?? 0)),
      },
    },
    runs: checkpoints.map((row) => ({
      provider: row.provider,
      status: row.status,
      calls: row.calls,
      upserted: row.upserted,
      cycles: row.cycles,
      lastStartedAt: row.lastStartedAt,
      lastFinishedAt: row.lastFinishedAt,
      lastError: row.lastError,
      errors: row.recentErrors,
      checkpoint: row.checkpoint,
    })),
    shopperZips: zips.map((row) => ({
      zip: row.zip,
      hits: row.hits,
      lastSeenAt: row.lastSeenAt,
      locationId: row.locationId,
    })),
    seedZips: config.seedZips,
  };
}
