import { itemIsWatched } from "../alerts/compare";
import { PriceWatch } from "../alerts/models";
import { krogerProductIdForLookup, upcKey, walmartUpcForLookup } from "../catalog/normalize";
import { SharedList } from "../models/SharedList";
import { utcDay } from "./budget";
import { CATALOG_DEMAND_DAYS } from "./demand";
import { CatalogDemand, CatalogMaster, CatalogOffer, CatalogRefreshDay } from "./models";

/** A miss waits a day so the same dead offer does not spend the budget again. */
export const REFRESH_RETRY_MS = 24 * 60 * 60 * 1000;

export type RefreshPriority = "list" | "shared" | "watch" | "search" | "merged" | "catalog";

export type RefreshPick = {
  offerId: string;
  productKey: string;
  storeName: string;
  name: string;
  code: string;
  locationId: string;
  priority: RefreshPriority;
};

type OfferRow = {
  _id: unknown;
  productKey: string;
  storeName: string;
  locationId?: string;
  lastSeenAt?: Date;
};

type MasterRow = {
  key: string;
  name: string;
  upc?: string;
  krogerProductId?: string;
};

type PriorityKeys = {
  list: string[];
  shared: string[];
  watch: string[];
  search: string[];
  merged: string[];
};

function addKey(bucket: Set<string>, value: string | undefined): void {
  const raw = value?.trim() ?? "";
  if (!raw || raw.startsWith("local:")) {
    return;
  }
  bucket.add(raw);
  const digits = raw.startsWith("upc:") ? raw.slice(4) : raw;
  const key = upcKey(digits);
  if (key) {
    bucket.add(key);
  }
}

function lookupCode(storeName: string, master: MasterRow): string | null {
  if (storeName === "Kroger") {
    const stored = master.krogerProductId?.replace(/\D/g, "") ?? "";
    if (stored.length === 13 || stored.length === 14) {
      return krogerProductIdForLookup(stored) ?? stored;
    }
    return krogerProductIdForLookup(master.upc || stored || master.key);
  }
  return walmartUpcForLookup(master.upc || master.key);
}

async function loadPriority(now: Date): Promise<PriorityKeys> {
  const since = new Date(now.getTime() - CATALOG_DEMAND_DAYS * 86_400_000);
  const [demand, lists, watches, merged] = await Promise.all([
    CatalogDemand.find({ lastSeenAt: { $gte: since } })
      .sort({ hits: -1, lastSeenAt: -1 })
      .limit(120)
      .select("kind upcKey text")
      .lean<Array<{ kind?: string; upcKey?: string; text?: string }>>(),
    SharedList.find({ revokedAt: null })
      .sort({ updatedAt: -1 })
      .limit(80)
      .select("items")
      .lean<Array<{ items?: Array<{ catalogId?: string; deleted?: boolean }> }>>(),
    PriceWatch.find({ $or: [{ enabled: true }, { "items.watch": "on" }] })
      .limit(80)
      .select("enabled items")
      .lean<Array<{ enabled?: boolean; items?: Array<{ productKey?: string; watch?: "inherit" | "on" | "off" }> }>>(),
    CatalogMaster.find({
      walmartItemId: { $type: "string", $gt: "" },
      krogerProductId: { $type: "string", $gt: "" },
    })
      .select("key")
      .limit(2000)
      .lean<Array<{ key: string }>>(),
  ]);
  const list = new Set<string>();
  const shared = new Set<string>();
  const watch = new Set<string>();
  const search = new Set<string>();
  const phrases: string[] = [];
  for (const row of demand) {
    const bucket = row.kind === "list" ? list : search;
    addKey(bucket, row.upcKey);
    if (row.kind === "search" && row.text && !row.text.startsWith("upc:") && phrases.length < 5) {
      phrases.push(row.text);
    }
  }
  for (const listRow of lists) {
    for (const item of listRow.items ?? []) {
      if (item.deleted) {
        continue;
      }
      addKey(shared, item.catalogId);
    }
  }
  for (const row of watches) {
    for (const item of row.items ?? []) {
      if (!itemIsWatched(Boolean(row.enabled), item.watch ?? "inherit")) {
        continue;
      }
      addKey(watch, item.productKey);
    }
  }
  if (phrases.length > 0) {
    const named = await CatalogMaster.find({
      $or: phrases.map((phrase) => ({ name: { $regex: phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } })),
      status: { $ne: "discontinued" },
    })
      .select("key")
      .limit(30)
      .lean<Array<{ key: string }>>();
    for (const row of named) {
      search.add(row.key);
    }
  }
  return {
    list: [...list],
    shared: [...shared],
    watch: [...watch],
    search: [...search],
    merged: merged.map((row) => row.key),
  };
}

async function staleOffers(storeName: string, now: Date, limit: number, keys?: string[]): Promise<OfferRow[]> {
  if (keys && keys.length === 0) {
    return [];
  }
  const cutoff = new Date(now.getTime() - REFRESH_RETRY_MS);
  return CatalogOffer.find({
    storeName,
    status: "stale",
    refreshExcluded: { $ne: true },
    ...(keys ? { productKey: { $in: keys.slice(0, 500) } } : {}),
    $or: [
      { refreshAttemptAt: { $exists: false } },
      { refreshAttemptAt: null },
      { refreshAttemptAt: { $lte: cutoff } },
    ],
  })
    .sort({ lastSeenAt: 1 })
    .limit(limit)
    .select("productKey storeName locationId lastSeenAt")
    .lean<OfferRow[]>();
}

/**
 * Oldest stale offers for one store, skipping general merchandise that was
 * marked refreshExcluded. Saved lists, shared lists, price watches, and
 * recent searches come before merged products, then the rest of the shelf.
 */
export async function nextRefreshPicks(
  storeName: "Walmart" | "Kroger",
  now: Date,
  limit: number
): Promise<RefreshPick[]> {
  const want = Math.max(0, Math.min(20, Math.floor(limit)));
  if (want === 0) {
    return [];
  }
  const priority = await loadPriority(now);
  const tiers: Array<{ priority: RefreshPriority; keys?: string[] }> = [
    { priority: "list", keys: priority.list },
    { priority: "shared", keys: priority.shared },
    { priority: "watch", keys: priority.watch },
    { priority: "search", keys: priority.search },
    { priority: "merged", keys: priority.merged },
    { priority: "catalog" },
  ];
  const chosen: RefreshPick[] = [];
  const seen = new Set<string>();
  const skipIds: unknown[] = [];
  for (const tier of tiers) {
    if (chosen.length >= want) {
      break;
    }
    const keys = tier.keys?.filter((key) => !seen.has(key));
    const offers = await staleOffers(storeName, now, Math.max(want - chosen.length, 1) + 6, keys);
    const masters = await CatalogMaster.find({ key: { $in: offers.map((offer) => offer.productKey) } })
      .select("key name upc krogerProductId")
      .lean<MasterRow[]>();
    const byKey = new Map(masters.map((master) => [master.key, master]));
    for (const offer of offers) {
      if (chosen.length >= want) {
        break;
      }
      if (seen.has(offer.productKey)) {
        continue;
      }
      seen.add(offer.productKey);
      const master = byKey.get(offer.productKey);
      const code = master ? lookupCode(storeName, master) : null;
      if (!master || !code) {
        skipIds.push(offer._id);
        continue;
      }
      chosen.push({
        offerId: String(offer._id),
        productKey: offer.productKey,
        storeName,
        name: master.name,
        code,
        locationId: offer.locationId ?? "",
        priority: tier.priority,
      });
    }
  }
  if (skipIds.length > 0) {
    await CatalogOffer.updateMany({ _id: { $in: skipIds } }, { $set: { refreshAttemptAt: now } });
  }
  return chosen;
}

/** Remember the attempt and add successful price writes to today's count. */
export async function finishRefresh(picks: RefreshPick[], now: Date, refreshedOffers: number): Promise<void> {
  if (picks.length > 0) {
    await CatalogOffer.updateMany(
      { _id: { $in: picks.map((pick) => pick.offerId) } },
      { $set: { refreshAttemptAt: now } }
    );
  }
  if (refreshedOffers <= 0 || picks.length === 0) {
    return;
  }
  const field = picks[0]?.storeName.toLowerCase() === "kroger" ? "kroger" : "walmart";
  const day = utcDay(now);
  await CatalogRefreshDay.updateOne(
    { day },
    { $inc: { [field]: refreshedOffers }, $setOnInsert: { day } },
    { upsert: true }
  );
}

export async function refreshQueueSize(now = new Date()): Promise<{ walmart: number; kroger: number }> {
  const cutoff = new Date(now.getTime() - REFRESH_RETRY_MS);
  const waiting = {
    status: "stale" as const,
    refreshExcluded: { $ne: true },
    $or: [
      { refreshAttemptAt: { $exists: false } },
      { refreshAttemptAt: null },
      { refreshAttemptAt: { $lte: cutoff } },
    ],
  };
  const [walmart, kroger] = await Promise.all([
    CatalogOffer.countDocuments({ ...waiting, storeName: "Walmart" }),
    CatalogOffer.countDocuments({ ...waiting, storeName: "Kroger" }),
  ]);
  return { walmart, kroger };
}

export async function refreshedToday(now = new Date()): Promise<{ walmart: number; kroger: number }> {
  const row = await CatalogRefreshDay.findOne({ day: utcDay(now) }).lean<{ walmart?: number; kroger?: number } | null>();
  return { walmart: row?.walmart ?? 0, kroger: row?.kroger ?? 0 };
}
