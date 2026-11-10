import { gtinJoinKey } from "../catalog/gtin";
import { CatalogMaster, CatalogOffer } from "./models";

const BATCH = 400;

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
  return gtinJoinKey(row.upc) || gtinJoinKey(row.krogerProductId) || gtinJoinKey(row.key);
}

/**
 * Point masters that share a GTIN at one key. Dry-run counts only.
 * Apply moves offers and store ids, then deletes the duplicate masters.
 * A second apply finds nothing left to merge.
 */
export async function remergeGtinCatalog(options?: { apply?: boolean; limit?: number }): Promise<RemergeReport> {
  const apply = options?.apply === true;
  const limit = Math.max(1, Math.min(200_000, Math.floor(options?.limit ?? 200_000)));
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
    const batch = Math.min(BATCH, limit - report.examined);
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
  }
  return report;
}
