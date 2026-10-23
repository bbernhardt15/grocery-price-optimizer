import { detectPriceDrops, type DetectResult } from "../alerts/detect";
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
 * Kroger-sourced rows are included: their `categories` array is what was
 * saved on `categoryPaths`. Does not delete rows. Every department change
 * is written, including a move to Other for baby gear and other non-grocery
 * items. A row is left alone only when the department and subcategory already
 * match.
 */
export async function recategorizeCatalog(): Promise<{ examined: number; updated: number }> {
  const rows = await CatalogMaster.find()
    .select("key name categoryPaths departmentId subcategory")
    .lean<Array<{ key: string; name: string; categoryPaths?: string[]; departmentId?: string; subcategory?: string }>>();
  let updated = 0;
  for (const row of rows) {
    const mapped = mapToDepartment(row.categoryPaths, row.name);
    const nextSubcategory = mapped.subcategory ?? "";
    const currentSubcategory = row.subcategory ?? "";
    if (mapped.departmentId === row.departmentId && nextSubcategory === currentSubcategory) {
      continue;
    }
    await CatalogMaster.updateOne(
      { key: row.key },
      mapped.subcategory
        ? { $set: { departmentId: mapped.departmentId, subcategory: mapped.subcategory } }
        : { $set: { departmentId: mapped.departmentId }, $unset: { subcategory: "" } }
    );
    updated += 1;
  }
  return { examined: rows.length, updated };
}

/**
 * Mark offers for Other products that are still general merchandise so refresh
 * does not spend Walmart or Kroger calls on them. Grocery rows that the
 * current rules would move out of Other are left alone. Nothing is deleted.
 */
export async function excludeNongroceryFromRefresh(): Promise<{
  examined: number;
  masters: number;
  offers: number;
}> {
  const rows = await CatalogMaster.find({ departmentId: "other", status: { $ne: "discontinued" } })
    .select("key name categoryPaths")
    .lean<Array<{ key: string; name: string; categoryPaths?: string[] }>>();
  const keys: string[] = [];
  for (const row of rows) {
    const mapped = mapToDepartment(row.categoryPaths, row.name);
    if (mapped.departmentId === "other") {
      keys.push(row.key);
    }
  }
  let offers = 0;
  for (let index = 0; index < keys.length; index += 500) {
    const chunk = keys.slice(index, index + 500);
    const result = await CatalogOffer.updateMany({ productKey: { $in: chunk } }, { $set: { refreshExcluded: true } });
    offers += result.modifiedCount ?? 0;
  }
  return { examined: rows.length, masters: keys.length, offers };
}

/**
 * Compare opted-in saved lists with catalog offers. The ingest tick calls
 * this after prices refresh, so price alerts do not need their own service.
 * A failure is logged and does not stop the crawl.
 */
export async function scanPriceDropAlerts(now = new Date()): Promise<DetectResult> {
  try {
    const result = await detectPriceDrops(now);
    if (result.created > 0) {
      console.log(`Price-drop alerts: ${result.created} new (${result.pushed} sent by web push).`);
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Price-drop scan failed: ${message}`);
    return { examined: 0, created: 0, pushed: 0 };
  }
}
