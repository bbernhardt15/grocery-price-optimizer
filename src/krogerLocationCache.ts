import mongoose from "mongoose";

/** Last known good Kroger store for a ZIP. Demo ids are never stored. */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COLLECTION = "krogerlocations";

type CachedStore = { locationId: string; expiresAt: number };

const memory = new Map<string, CachedStore>();

export function clearKrogerStoreCache(): void {
  memory.clear();
}

export async function readKrogerStore(zip: string): Promise<string | null> {
  const key = zip.trim().slice(0, 5);
  const hit = memory.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.locationId;
  if (hit) memory.delete(key);
  if (mongoose.connection.readyState !== 1) return null;
  try {
    const doc = await mongoose.connection.collection(COLLECTION).findOne({ zip: key });
    const locationId = typeof doc?.locationId === "string" ? doc.locationId.trim() : "";
    const expiresAt = doc?.expiresAt ? new Date(doc.expiresAt).getTime() : 0;
    if (!locationId || !expiresAt || expiresAt <= Date.now()) return null;
    memory.set(key, { locationId, expiresAt });
    return locationId;
  } catch {
    return null;
  }
}

export async function rememberKrogerStore(zip: string, locationId: string): Promise<void> {
  const key = zip.trim().slice(0, 5);
  const id = locationId.trim();
  if (!/^\d{5}$/.test(key) || !id) return;
  const expiresAt = Date.now() + TTL_MS;
  memory.set(key, { locationId: id, expiresAt });
  if (mongoose.connection.readyState !== 1) return;
  try {
    await mongoose.connection.collection(COLLECTION).updateOne(
      { zip: key },
      { $set: { zip: key, locationId: id, expiresAt: new Date(expiresAt) } },
      { upsert: true }
    );
  } catch {
    /* the process cache still has the store */
  }
}
