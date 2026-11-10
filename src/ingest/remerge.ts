import { randomUUID } from "node:crypto";
import { gtinJoinKey } from "../catalog/gtin";
import { CatalogMaster, CatalogOffer, IngestLock } from "./models";

const BATCH = 400;
const LOCK_ID = "gtin-remerge";
const LOCK_MS = 10 * 60_000;
const DEFAULT_COOLDOWN_MS = 60_000;
const DEFAULT_PAUSE_MS = 50;

export class RemergeBusyError extends Error {
  readonly statusCode = 409;

  constructor(readonly reason: "locked" | "cooldown") {
    super(reason === "locked" ? "A GTIN remerge is already running." : "A GTIN remerge just finished. Wait for the cooldown.");
  }
}

export type RemergeSample = { from: string; to: string; name: string };

export type RemergeReport = {
  dryRun: boolean;
  examined: number;
  rekey: number;
  mergeGroups: number;
  mergeMasters: number;
  unchanged: number;
  unparsed: number;
  truncated: boolean;
  sample: RemergeSample[];
};

type MasterRow = {
  key: string;
  name?: string;
  upc?: string;
  krogerProductId?: string;
  walmartItemId?: string;
};

function targetKey(row: MasterRow): string | null {
  const fromKroger = row.krogerProductId
    ? gtinJoinKey(row.krogerProductId, { source: "kroger-product-id" })
    : null;
  const fromUpc = gtinJoinKey(row.upc);
  if (fromKroger && fromUpc && fromKroger !== fromUpc) {
    const upcDigits = row.upc?.replace(/\D/g, "") ?? "";
    const idDigits = row.krogerProductId?.replace(/\D/g, "") ?? "";
    if (upcDigits.length === 13 && upcDigits === idDigits) return fromKroger;
    if (row.key === fromKroger || row.key === fromUpc) return row.key;
    return fromUpc;
  }
  return fromKroger || fromUpc || gtinJoinKey(row.key);
}

async function acquireRemerge(now: Date): Promise<{ owner: string } | "locked" | "cooldown"> {
  const existing = await IngestLock.findById(LOCK_ID).lean<{ owner?: string; expiresAt?: Date } | null>();
  if (existing?.expiresAt && existing.expiresAt.getTime() > now.getTime()) {
    return existing.owner === "cooldown" ? "cooldown" : "locked";
  }
  const owner = randomUUID();
  const expiresAt = new Date(now.getTime() + LOCK_MS);
  const taken = await IngestLock.findOneAndUpdate(
    { _id: LOCK_ID, expiresAt: { $lte: now } },
    { $set: { owner, expiresAt } },
    { new: true }
  ).lean<{ owner?: string } | null>();
  if (taken?.owner === owner) return { owner };
  try {
    await IngestLock.create({ _id: LOCK_ID, owner, expiresAt });
    return { owner };
  } catch {
    return "locked";
  }
}

async function releaseRemerge(owner: string, now: Date, cooldownMs: number): Promise<void> {
  const expiresAt = new Date(now.getTime() + Math.max(0, cooldownMs));
  await IngestLock.updateOne({ _id: LOCK_ID, owner }, { $set: { owner: "cooldown", expiresAt } });
}

async function unlockRemerge(owner: string): Promise<void> {
  await IngestLock.updateOne({ _id: LOCK_ID, owner }, { $set: { expiresAt: new Date(0) } });
}

/**
 * Point masters that share a GTIN at one key. Dry-run counts only.
 * Apply moves offers and store ids, then deletes the duplicate masters.
 * A second apply finds nothing left to merge.
 */
export async function remergeGtinCatalog(options?: {
  apply?: boolean;
  limit?: number;
  pauseMs?: number;
  cooldownMs?: number;
  now?: Date;
  /** Test hook. Runs after the apply lock is held and before the scan. */
  hold?: () => Promise<void>;
  pause?: (ms: number) => Promise<void>;
  batchSize?: number;
}): Promise<RemergeReport> {
  const apply = options?.apply === true;
  const limit = Math.max(1, Math.min(200_000, Math.floor(options?.limit ?? 200_000)));
  const pauseMs = Math.max(0, Math.floor(options?.pauseMs ?? DEFAULT_PAUSE_MS));
  const cooldownMs = Math.max(0, Math.floor(options?.cooldownMs ?? DEFAULT_COOLDOWN_MS));
  const now = options?.now ?? new Date();
  const batchSize = Math.max(1, Math.min(BATCH, Math.floor(options?.batchSize ?? BATCH)));
  let lockOwner = "";
  if (apply) {
    const gate = await acquireRemerge(now);
    if (gate === "locked" || gate === "cooldown") throw new RemergeBusyError(gate);
    lockOwner = gate.owner;
  }
  const pause = options?.pause ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  try {
  if (apply && options?.hold) await options.hold();
  const groups = new Map<string, MasterRow[]>();
  const report: RemergeReport = {
    dryRun: !apply,
    examined: 0,
    rekey: 0,
    mergeGroups: 0,
    mergeMasters: 0,
    unchanged: 0,
    unparsed: 0,
    truncated: false,
    sample: [],
  };
  let cursor = "";
  let lastFull = false;
  while (report.examined < limit) {
    const batch = Math.min(batchSize, limit - report.examined);
    const query = cursor ? { key: { $gt: cursor } } : {};
    const rows = await CatalogMaster.find(query)
      .sort({ key: 1 })
      .limit(batch)
      .select("key name upc krogerProductId walmartItemId")
      .lean<MasterRow[]>();
    if (rows.length === 0) break;
    lastFull = rows.length === batch;
    cursor = rows[rows.length - 1]?.key ?? cursor;
    for (const row of rows) {
      report.examined += 1;
      const target = targetKey(row);
      if (!target) {
        report.unparsed += 1;
        continue;
      }
      const list = groups.get(target) ?? [];
      list.push(row);
      groups.set(target, list);
    }
    if (rows.length < batch) break;
    if (apply) await pause(pauseMs);
  }
  report.truncated = lastFull && report.examined >= limit;

  for (const [target, rows] of groups) {
    const distinct = rows.filter((row, index) => rows.findIndex((other) => other.key === row.key) === index);
    if (distinct.length === 1 && distinct[0]?.key === target) {
      report.unchanged += 1;
      continue;
    }
    report.rekey += distinct.filter((row) => row.key !== target).length;
    if (distinct.length > 1) {
      report.mergeGroups += 1;
      report.mergeMasters += distinct.length;
      if (report.sample.length < 20) {
        const name = distinct.find((row) => row.name)?.name ?? "";
        report.sample.push({ from: distinct.map((row) => row.key).join(","), to: target, name });
      }
    } else if (report.sample.length < 20 && distinct[0] && distinct[0].key !== target) {
      report.sample.push({ from: distinct[0].key, to: target, name: distinct[0].name ?? "" });
    }
  }

  if (!apply) return report;
  let writes = 0;

  for (const [target, rows] of groups) {
    const distinct = rows.filter((row, index) => rows.findIndex((other) => other.key === row.key) === index);
    if (distinct.length === 1 && distinct[0]?.key === target) continue;
    const keeper = distinct.find((row) => row.key === target) ?? distinct[0];
    if (!keeper) continue;
    const walmartItemId = distinct.map((row) => row.walmartItemId?.trim()).find(Boolean);
    const krogerProductId = distinct.map((row) => row.krogerProductId?.trim()).find(Boolean);
    const upc = distinct.map((row) => row.upc?.trim()).find(Boolean);
    if (keeper.key !== target) {
      const clash = await CatalogMaster.exists({ key: target });
      if (!clash) {
        await CatalogMaster.updateOne({ key: keeper.key }, { $set: { key: target } });
        await CatalogOffer.updateMany({ productKey: keeper.key }, { $set: { productKey: target } });
        keeper.key = target;
      }
    }
    await CatalogMaster.updateOne(
      { key: keeper.key },
      {
        $set: {
          ...(upc ? { upc } : {}),
          ...(walmartItemId ? { walmartItemId } : {}),
          ...(krogerProductId ? { krogerProductId } : {}),
        },
      }
    );
    for (const row of distinct) {
      if (row.key === keeper.key) continue;
      const offers = await CatalogOffer.find({ productKey: row.key }).select("_id storeName locationId").lean<
        Array<{ _id: unknown; storeName: string; locationId?: string }>
      >();
      for (const offer of offers) {
        const locationId = offer.locationId ?? "";
        const clash = await CatalogOffer.exists({ productKey: keeper.key, storeName: offer.storeName, locationId });
        if (clash) await CatalogOffer.deleteOne({ _id: offer._id });
        else await CatalogOffer.updateOne({ _id: offer._id }, { $set: { productKey: keeper.key } });
      }
      await CatalogMaster.deleteOne({ key: row.key });
    }
    writes += 1;
    if (writes % batchSize === 0) await pause(pauseMs);
  }
  await releaseRemerge(lockOwner, now, cooldownMs);
  lockOwner = "";
  return report;
  } catch (error) {
    if (lockOwner) await unlockRemerge(lockOwner);
    throw error;
  }
}
