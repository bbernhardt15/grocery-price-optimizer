import { mapToDepartment } from "../catalog/departments";
import { CatalogMaster, CatalogOffer, IngestCheckpoint } from "./models";

/**
 * Zero the checkpoint call and upsert counters. Does not touch products,
 * offers, or the crawl position. Use this when an older build inflated
 * `calls` and `upserted` by adding the tick total on every page save.
 */
export async function resetRunCounters(): Promise<{ providers: string[] }> {
  const rows = await IngestCheckpoint.find().select("provider").lean<Array<{ provider: string }>>();
  await IngestCheckpoint.updateMany({}, { $set: { calls: 0, upserted: 0 } });
  return { providers: rows.map((row) => row.provider) };
}

/**
 * Remove `local:` masters that now have a UPC-keyed sibling with the same
 * Walmart item id or Kroger product id. Items that still have no UPC are left
 * in place. Offers for the removed masters are removed with them.
 */
export async function dropShadowLocalKeys(): Promise<{ masters: number; offers: number }> {
  let masters = 0;
  let offers = 0;
  for (const field of ["walmartItemId", "krogerProductId"] as const) {
    const owners = await CatalogMaster.find({
      key: { $not: /^local:/ },
      [field]: { $type: "string", $ne: "" },
    })
      .select(field)
      .lean<Array<Record<string, string>>>();
    const ids = [...new Set(owners.map((row) => row[field]).filter((id) => typeof id === "string" && id.length > 0))];
    if (ids.length === 0) {
      continue;
    }
    const shadows = await CatalogMaster.find({ key: /^local:/, [field]: { $in: ids } })
      .select("key")
      .lean<Array<{ key: string }>>();
    const keys = shadows.map((row) => row.key);
    if (keys.length === 0) {
      continue;
    }
    const offerResult = await CatalogOffer.deleteMany({ productKey: { $in: keys } });
    const masterResult = await CatalogMaster.deleteMany({ key: { $in: keys } });
    offers += offerResult.deletedCount ?? 0;
    masters += masterResult.deletedCount ?? 0;
  }
  return { masters, offers };
}

/**
 * Recompute departmentId from each master's stored category path and name.
 * Does not delete rows. A path that still maps to Other is left unchanged.
 */
export async function recategorizeCatalog(): Promise<{ examined: number; updated: number }> {
  const rows = await CatalogMaster.find()
    .select("key name categoryPaths departmentId subcategory")
    .lean<Array<{ key: string; name: string; categoryPaths?: string[]; departmentId?: string; subcategory?: string }>>();
  let updated = 0;
  for (const row of rows) {
    const mapped = mapToDepartment(row.categoryPaths, row.name);
    if (mapped.departmentId === "other") {
      continue;
    }
    const nextSubcategory = mapped.subcategory ?? "";
    const currentSubcategory = row.subcategory ?? "";
    if (mapped.departmentId === row.departmentId && nextSubcategory === currentSubcategory) {
      continue;
    }
    await CatalogMaster.updateOne(
      { key: row.key },
      {
        $set: {
          departmentId: mapped.departmentId,
          ...(mapped.subcategory ? { subcategory: mapped.subcategory } : {}),
        },
      }
    );
    updated += 1;
  }
  return { examined: rows.length, updated };
}
