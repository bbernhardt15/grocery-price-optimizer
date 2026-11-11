import { randomUUID } from "node:crypto";
import { ingestConfig } from "./config";
import { IngestLock, CatalogMaster } from "./models";

const LOCK_ID = "match-cooldown";
const LOCK_MS = 10 * 60_000;
const DEFAULT_COOLDOWN_MS = 60_000;
const DEFAULT_PAUSE_MS = 50;
const BATCH = 400;

export type CooldownStore = "kroger" | "walmart" | "both";

export class CooldownBusyError extends Error {
  readonly statusCode = 409;

  constructor(readonly reason: "locked" | "cooldown") {
    super(reason === "locked" ? "A match-cooldown reset is already running." : "A match-cooldown reset just finished. Wait for the cooldown.");
  }
}

export type CooldownReport = {
  dryRun: boolean;
  store: CooldownStore;
  kroger: number;
  walmart: number;
  cleared: number;
};

function retryCutoff(now: Date): Date {
  return new Date(now.getTime() - ingestConfig().matchRetryDays * 86_400_000);
}

function cooldownFilter(side: "kroger" | "walmart", now: Date): Record<string, unknown> {
  const tried = side === "walmart" ? "matchWalmartAt" : "matchKrogerAt";
  const has = side === "walmart" ? "krogerProductId" : "walmartItemId";
  const missing = side === "walmart" ? "walmartItemId" : "krogerProductId";
  return {
    key: { $not: /^local:/ },
    [has]: { $type: "string", $ne: "" },
    [tried]: { $gt: retryCutoff(now) },
    $or: [{ [missing]: { $exists: false } }, { [missing]: null }, { [missing]: "" }],
  };
}

async function acquire(now: Date): Promise<{ owner: string } | "locked" | "cooldown"> {
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

async function release(owner: string, now: Date, cooldownMs: number): Promise<void> {
  await IngestLock.updateOne(
    { _id: LOCK_ID, owner },
    { $set: { owner: "cooldown", expiresAt: new Date(now.getTime() + Math.max(0, cooldownMs)) } }
  );
}

async function unlock(owner: string): Promise<void> {
  await IngestLock.updateOne({ _id: LOCK_ID, owner }, { $set: { expiresAt: new Date(0) } });
}

/**
 * Count or clear match cooldowns. A cooldown is a finished miss that still
 * lacks the other store and is inside the retry window. Merged products are
 * left alone. Nothing runs on deploy.
 */
export async function clearMatchCooldowns(options?: {
  apply?: boolean;
  store?: CooldownStore;
  limit?: number;
  pauseMs?: number;
  cooldownMs?: number;
  now?: Date;
  hold?: () => Promise<void>;
  pause?: (ms: number) => Promise<void>;
  batchSize?: number;
}): Promise<CooldownReport> {
  const apply = options?.apply === true;
  const store = options?.store ?? "both";
  const limit = Math.max(1, Math.min(200_000, Math.floor(options?.limit ?? 200_000)));
  const pauseMs = Math.max(0, Math.floor(options?.pauseMs ?? DEFAULT_PAUSE_MS));
  const cooldownMs = Math.max(0, Math.floor(options?.cooldownMs ?? DEFAULT_COOLDOWN_MS));
  const now = options?.now ?? new Date();
  const batchSize = Math.max(1, Math.min(BATCH, Math.floor(options?.batchSize ?? BATCH)));
  const sides = (store === "both" ? ["kroger", "walmart"] : [store]) as Array<"kroger" | "walmart">;
  const report: CooldownReport = { dryRun: !apply, store, kroger: 0, walmart: 0, cleared: 0 };
  for (const side of sides) {
    report[side] = await CatalogMaster.countDocuments(cooldownFilter(side, now));
  }
  if (!apply) return report;

  const gate = await acquire(now);
  if (gate === "locked" || gate === "cooldown") throw new CooldownBusyError(gate);
  const pause = options?.pause ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let owner = gate.owner;
  try {
    if (options?.hold) await options.hold();
    for (const side of sides) {
      const tried = side === "walmart" ? "matchWalmartAt" : "matchKrogerAt";
      const variant = side === "walmart" ? "matchWalmartVariant" : "matchKrogerVariant";
      let left = Math.min(limit, report[side]);
      while (left > 0) {
        const batch = Math.min(batchSize, left);
        const rows = await CatalogMaster.find(cooldownFilter(side, now))
          .select("key")
          .limit(batch)
          .lean<Array<{ key: string }>>();
        if (rows.length === 0) break;
        const keys = rows.map((row) => row.key);
        const result = await CatalogMaster.updateMany(
          { key: { $in: keys } },
          { $unset: { [tried]: "", [variant]: "" } }
        );
        const updated = result.modifiedCount ?? 0;
        report.cleared += updated;
        left -= rows.length;
        if (rows.length < batch) break;
        await pause(pauseMs);
      }
    }
    await release(owner, now, cooldownMs);
    owner = "";
    return report;
  } catch (error) {
    if (owner) await unlock(owner);
    throw error;
  }
}
