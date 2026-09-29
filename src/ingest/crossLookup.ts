import { krogerProductIdForLookup, walmartUpcForLookup } from "../catalog/normalize";
import { CatalogMaster, CatalogOffer } from "./models";

/**
 * Staple aisles first, then the rest. Within one aisle, the row with the
 * most stored offers is tried first. Each master is looked up once.
 */
const STAPLE_DEPARTMENTS = [
  "dairy-eggs",
  "produce",
  "meat-seafood",
  "bakery",
  "beverages",
  "breakfast",
  "pantry",
  "frozen",
  "snacks",
  "household",
  "deli",
  "baby",
  "personal-care",
  "pet",
  "other",
] as const;

const BATCH = 30;

type Candidate = {
  key: string;
  name: string;
  upc?: string;
  departmentId?: string;
};

async function pickUntried(side: "walmart" | "kroger"): Promise<Candidate | null> {
  const triedField = side === "walmart" ? "matchWalmartAt" : "matchKrogerAt";
  for (const departmentId of STAPLE_DEPARTMENTS) {
    const rows = await CatalogMaster.find({
      departmentId,
      key: { $not: /^local:/ },
      [triedField]: { $exists: false },
      ...(side === "walmart"
        ? { krogerProductId: { $type: "string", $ne: "" }, $or: [{ walmartItemId: { $exists: false } }, { walmartItemId: null }, { walmartItemId: "" }] }
        : { walmartItemId: { $type: "string", $ne: "" }, $or: [{ krogerProductId: { $exists: false } }, { krogerProductId: null }, { krogerProductId: "" }] }),
    })
      .select("key name upc departmentId")
      .limit(BATCH)
      .lean<Candidate[]>();
    if (rows.length === 0) {
      continue;
    }
    const counts = await CatalogOffer.aggregate<{ _id: string; n: number }>([
      { $match: { productKey: { $in: rows.map((row) => row.key) } } },
      { $group: { _id: "$productKey", n: { $sum: 1 } } },
    ]);
    const byKey = new Map(counts.map((row) => [row._id, row.n]));
    rows.sort((a, b) => (byKey.get(b.key) ?? 0) - (byKey.get(a.key) ?? 0) || a.name.localeCompare(b.name));
    return rows[0] ?? null;
  }
  return null;
}

async function markTried(side: "walmart" | "kroger", key: string, now: Date): Promise<void> {
  const field = side === "walmart" ? "matchWalmartAt" : "matchKrogerAt";
  await CatalogMaster.updateOne({ key }, { $set: { [field]: now } });
}

/**
 * Next Kroger-only master to ask Walmart about. Returns a 12-digit UPC-A.
 * A code that cannot be a UPC-A is marked tried so it does not block the queue.
 */
export async function nextWalmartLookup(now: Date): Promise<{ key: string; name: string; upc: string } | null> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const row = await pickUntried("walmart");
    if (!row) {
      return null;
    }
    const upc = walmartUpcForLookup(row.upc || row.key);
    if (upc) {
      return { key: row.key, name: row.name, upc };
    }
    await markTried("walmart", row.key, now);
  }
  return null;
}

/** Next Walmart-UPC master to ask Kroger about. Returns a 13-digit product id. */
export async function nextKrogerLookup(now: Date): Promise<{ key: string; name: string; productId: string } | null> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const row = await pickUntried("kroger");
    if (!row) {
      return null;
    }
    const productId = krogerProductIdForLookup(row.upc || row.key);
    if (productId) {
      return { key: row.key, name: row.name, productId };
    }
    await markTried("kroger", row.key, now);
  }
  return null;
}

export async function markWalmartLookup(key: string, now: Date): Promise<void> {
  await markTried("walmart", key, now);
}

export async function markKrogerLookup(key: string, now: Date): Promise<void> {
  await markTried("kroger", key, now);
}
