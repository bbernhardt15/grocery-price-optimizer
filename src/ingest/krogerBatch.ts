import { krogerProductIdForLookup, krogerRequestId, upcKey } from "../catalog/normalize";

/** Kroger documents at most 50 comma-separated ids on filter.productId. */
export const KROGER_PRODUCT_ID_BATCH = 50;

/** 13-digit ids, de-duplicated, capped at one Products call. */
export function krogerProductIdList(ids: string[], limit = KROGER_PRODUCT_ID_BATCH): string[] {
  const cap = Math.max(1, Math.min(KROGER_PRODUCT_ID_BATCH, Math.floor(limit)));
  const out: string[] = [];
  for (const raw of ids) {
    const id = krogerRequestId(raw) ?? "";
    if (!/^\d{13}$/.test(id) || out.includes(id)) {
      continue;
    }
    out.push(id);
    if (out.length >= cap) {
      break;
    }
  }
  return out;
}

type BatchRecord = {
  productId?: string;
  retailerItemId?: string;
  upc?: string;
};

type BatchPick = {
  code: string;
  key?: string;
  productKey?: string;
};

function pickKey(pick: BatchPick): string {
  return pick.key || pick.productKey || "";
}

/** A batch row belongs to this item when the product id or the UPC key matches. Names are not used. */
export function krogerBatchRecordMatches(record: BatchRecord, pick: BatchPick): boolean {
  const expected = pick.code.replace(/\D/g, "");
  const id = (record.productId || record.retailerItemId || "").replace(/\D/g, "");
  if (id && (id === expected || krogerProductIdForLookup(id) === expected)) {
    return true;
  }
  const key = upcKey(record.upc) || upcKey(id);
  const master = upcKey(pickKey(pick)) || pickKey(pick);
  if (key && master && key === master) {
    return true;
  }
  const rawUpc = (record.upc || "").replace(/\D/g, "");
  return Boolean(rawUpc && (rawUpc === expected || krogerProductIdForLookup(rawUpc) === expected));
}

export function partitionKrogerBatch<T extends BatchPick, R extends BatchRecord>(
  picks: T[],
  records: R[]
): { hits: Array<{ pick: T; records: R[] }>; misses: T[] } {
  const hits: Array<{ pick: T; records: R[] }> = [];
  const misses: T[] = [];
  for (const pick of picks) {
    const matched = records.filter((record) => krogerBatchRecordMatches(record, pick));
    if (matched.length > 0) {
      hits.push({ pick, records: matched });
    } else {
      misses.push(pick);
    }
  }
  return { hits, misses };
}

/** One location per call. Later locations stay queued for the next call. */
export function krogerLocationGroup<T extends { locationId?: string }>(picks: T[], fallbackLocation?: string): T[] {
  if (picks.length === 0) {
    return [];
  }
  const locationId = (picks[0]?.locationId || fallbackLocation || "").trim();
  return picks
    .filter((pick) => (pick.locationId || fallbackLocation || "").trim() === locationId)
    .slice(0, KROGER_PRODUCT_ID_BATCH);
}
