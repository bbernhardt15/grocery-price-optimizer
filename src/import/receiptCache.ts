/**
 * Same file bytes should not pay for another vision read.
 * The cache is the process memory for this server, keyed by content hash.
 */

import { createHash } from "node:crypto";

type Entry = { savedAt: number; body: unknown };

const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 40;
const cache = new Map<string, Entry>();

export function contentHash(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function readReceiptCache(key: string): unknown | null {
  const row = cache.get(key);
  if (!row) return null;
  if (Date.now() - row.savedAt > TTL_MS) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, row);
  return row.body;
}

export function writeReceiptCache(key: string, body: unknown): void {
  if (!key || body == null) return;
  cache.set(key, { savedAt: Date.now(), body });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

export function resetReceiptCache(): void {
  cache.clear();
}
