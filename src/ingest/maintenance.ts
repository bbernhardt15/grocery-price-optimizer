import { randomUUID } from "node:crypto";
import { detectPriceDrops, type DetectResult } from "../alerts/detect";
import { mapToDepartment } from "../catalog/departments";
import { CatalogMaintenanceJob, CatalogMaster, CatalogOffer, IngestCheckpoint } from "./models";

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

const RECATEGORIZE_BATCH = 400;
const JOB_KIND = "recategorize";

type MasterRow = {
  key: string;
  name: string;
  categoryPaths?: string[];
  departmentId?: string;
  subcategory?: string;
};

export type RecategorizeJob = {
  jobId: string;
  status: "idle" | "running" | "completed" | "error";
  examined: number;
  updated: number;
  clearedExclusions: number;
  total: number;
  cursor: string;
  error: string;
  startedAt: Date | null;
  finishedAt: Date | null;
};

const IDLE_JOB: RecategorizeJob = {
  jobId: "",
  status: "idle",
  examined: 0,
  updated: 0,
  clearedExclusions: 0,
  total: 0,
  cursor: "",
  error: "",
  startedAt: null,
  finishedAt: null,
};

let recategorizeLoop: Promise<void> | null = null;

function presentJob(row: {
  jobId?: string;
  status?: string;
  examined?: number;
  updated?: number;
  clearedExclusions?: number;
  total?: number;
  cursor?: string;
  error?: string;
  startedAt?: Date;
  finishedAt?: Date;
} | null): RecategorizeJob {
  if (!row) {
    return IDLE_JOB;
  }
  const status = row.status === "running" || row.status === "completed" || row.status === "error" ? row.status : "idle";
  return {
    jobId: row.jobId ?? "",
    status,
    examined: row.examined ?? 0,
    updated: row.updated ?? 0,
    clearedExclusions: row.clearedExclusions ?? 0,
    total: row.total ?? 0,
    cursor: row.cursor ?? "",
    error: row.error ?? "",
    startedAt: row.startedAt ?? null,
    finishedAt: row.finishedAt ?? null,
  };
}

async function loadRecategorizeJob(): Promise<RecategorizeJob> {
  const row = await CatalogMaintenanceJob.findOne({ kind: JOB_KIND }).lean<{
    jobId?: string;
    status?: string;
    examined?: number;
    updated?: number;
    clearedExclusions?: number;
    total?: number;
    cursor?: string;
    error?: string;
    startedAt?: Date;
    finishedAt?: Date;
  } | null>();
  return presentJob(row);
}

/** Progress for the admin status route. Idle until the first confirmed POST. */
export async function recategorizeProgress(): Promise<RecategorizeJob> {
  return loadRecategorizeJob();
}

async function saveJob(patch: Partial<RecategorizeJob> & { status: RecategorizeJob["status"] }): Promise<void> {
  await CatalogMaintenanceJob.updateOne(
    { kind: JOB_KIND },
    {
      $set: {
        kind: JOB_KIND,
        ...patch,
        ...(patch.finishedAt === null ? { finishedAt: null } : {}),
      },
    },
    { upsert: true }
  );
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

async function clearRefreshExclusions(keys: string[]): Promise<number> {
  let cleared = 0;
  for (let index = 0; index < keys.length; index += 500) {
    const chunk = keys.slice(index, index + 500);
    const result = await CatalogOffer.updateMany(
      { productKey: { $in: chunk }, refreshExcluded: true },
      { $set: { refreshExcluded: false } }
    );
    cleared += result.modifiedCount ?? 0;
  }
  return cleared;
}

/**
 * Walk masters in key order and remap departments from the stored path.
 * A product that leaves Other has refreshExcluded cleared on its offers.
 * The cursor is saved after each batch so a restarted process resumes.
 */
async function runRecategorize(jobId: string): Promise<void> {
  const existing = await loadRecategorizeJob();
  const resume = existing.jobId === jobId && existing.status === "running" && existing.cursor.length > 0;
  let examined = resume ? existing.examined : 0;
  let updated = resume ? existing.updated : 0;
  let clearedExclusions = resume ? existing.clearedExclusions : 0;
  let cursor = resume ? existing.cursor : "";
  const total = await CatalogMaster.countDocuments();
  await saveJob({
    jobId,
    status: "running",
    examined,
    updated,
    clearedExclusions,
    total,
    cursor,
    error: "",
    ...(resume ? {} : { startedAt: new Date(), finishedAt: null }),
  });
  try {
    for (;;) {
      const rows = await CatalogMaster.find(cursor ? { key: { $gt: cursor } } : {})
        .sort({ key: 1 })
        .limit(RECATEGORIZE_BATCH)
        .select("key name categoryPaths departmentId subcategory")
        .lean<MasterRow[]>();
      if (rows.length === 0) {
        break;
      }
      const writes: Array<{
        updateOne: {
          filter: { key: string };
          update: { $set: { departmentId: string; subcategory?: string }; $unset?: { subcategory: "" } };
        };
      }> = [];
      const clearKeys: string[] = [];
      for (const row of rows) {
        const mapped = mapToDepartment(row.categoryPaths, row.name);
        const nextSubcategory = mapped.subcategory ?? "";
        const currentSubcategory = row.subcategory ?? "";
        if (mapped.departmentId !== row.departmentId || nextSubcategory !== currentSubcategory) {
          writes.push({
            updateOne: {
              filter: { key: row.key },
              update: mapped.subcategory
                ? { $set: { departmentId: mapped.departmentId, subcategory: mapped.subcategory } }
                : { $set: { departmentId: mapped.departmentId }, $unset: { subcategory: "" } },
            },
          });
          updated += 1;
        }
        if (mapped.departmentId !== "other") {
          clearKeys.push(row.key);
        }
      }
      if (writes.length > 0) {
        await CatalogMaster.bulkWrite(writes, { ordered: false });
      }
      clearedExclusions += await clearRefreshExclusions(clearKeys);
      examined += rows.length;
      cursor = rows[rows.length - 1]?.key ?? cursor;
      await saveJob({
        jobId,
        status: "running",
        examined,
        updated,
        clearedExclusions,
        total,
        cursor,
        error: "",
      });
      await yieldEventLoop();
    }
    await saveJob({
      jobId,
      status: "completed",
      examined,
      updated,
      clearedExclusions,
      total,
      cursor,
      error: "",
      finishedAt: new Date(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await saveJob({
      jobId,
      status: "error",
      examined,
      updated,
      clearedExclusions,
      total,
      cursor,
      error: message,
      finishedAt: new Date(),
    });
  }
}

/**
 * Start a recategorize pass and return immediately. A pass already running
 * in this process is left alone. A pass left "running" by a restart resumes
 * from its cursor. Nothing is deleted.
 */
export async function startRecategorizeJob(): Promise<RecategorizeJob> {
  const current = await loadRecategorizeJob();
  if (recategorizeLoop) {
    return current;
  }
  const resume = current.status === "running" && current.jobId.length > 0;
  const jobId = resume ? current.jobId : randomUUID();
  if (!resume) {
    await saveJob({
      jobId,
      status: "running",
      examined: 0,
      updated: 0,
      clearedExclusions: 0,
      total: 0,
      cursor: "",
      error: "",
      startedAt: new Date(),
      finishedAt: null,
    });
  }
  recategorizeLoop = runRecategorize(jobId).finally(() => {
    recategorizeLoop = null;
  });
  return loadRecategorizeJob();
}

/**
 * Run recategorize to completion. Tests and scripts use this. The admin
 * route uses {@link startRecategorizeJob} so a large catalog does not hold
 * the HTTP request open.
 */
export async function recategorizeCatalog(): Promise<{
  examined: number;
  updated: number;
  clearedExclusions: number;
  jobId: string;
  status: RecategorizeJob["status"];
}> {
  await startRecategorizeJob();
  if (recategorizeLoop) {
    await recategorizeLoop;
  }
  const job = await loadRecategorizeJob();
  return {
    examined: job.examined,
    updated: job.updated,
    clearedExclusions: job.clearedExclusions,
    jobId: job.jobId,
    status: job.status,
  };
}

/**
 * Mark offers for Other products that are still general merchandise so refresh
 * does not spend Walmart or Kroger calls on them. Grocery rows that the
 * current rules would move out of Other have the flag cleared, including
 * offers excluded before recategorize finished. Running this again leaves
 * the same offers excluded. Nothing is deleted.
 */
export async function excludeNongroceryFromRefresh(): Promise<{
  examined: number;
  masters: number;
  offers: number;
  cleared: number;
}> {
  let examined = 0;
  let masters = 0;
  let offers = 0;
  let cleared = 0;
  let cursor = "";
  for (;;) {
    const rows = await CatalogMaster.find({
      departmentId: "other",
      status: { $ne: "discontinued" },
      ...(cursor ? { key: { $gt: cursor } } : {}),
    })
      .sort({ key: 1 })
      .limit(RECATEGORIZE_BATCH)
      .select("key name categoryPaths")
      .lean<Array<{ key: string; name: string; categoryPaths?: string[] }>>();
    if (rows.length === 0) {
      break;
    }
    cursor = rows[rows.length - 1]?.key ?? cursor;
    examined += rows.length;
    const keep: string[] = [];
    const release: string[] = [];
    for (const row of rows) {
      const mapped = mapToDepartment(row.categoryPaths, row.name);
      if (mapped.departmentId === "other") {
        keep.push(row.key);
      } else {
        release.push(row.key);
      }
    }
    masters += keep.length;
    for (let index = 0; index < keep.length; index += 500) {
      const chunk = keep.slice(index, index + 500);
      const result = await CatalogOffer.updateMany({ productKey: { $in: chunk } }, { $set: { refreshExcluded: true } });
      offers += result.matchedCount ?? result.modifiedCount ?? 0;
    }
    cleared += await clearRefreshExclusions(release);
  }
  const flagged = await CatalogOffer.distinct("productKey", { refreshExcluded: true });
  if (flagged.length > 0) {
    const stillOther = await CatalogMaster.find({
      key: { $in: flagged },
      departmentId: "other",
      status: { $ne: "discontinued" },
    })
      .select("key name categoryPaths")
      .lean<Array<{ key: string; name: string; categoryPaths?: string[] }>>();
    const allow = new Set<string>();
    for (const row of stillOther) {
      if (mapToDepartment(row.categoryPaths, row.name).departmentId === "other") {
        allow.add(row.key);
      }
    }
    const drop = flagged.filter((key) => typeof key === "string" && !allow.has(key));
    cleared += await clearRefreshExclusions(drop);
  }
  return { examined, masters, offers, cleared };
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
