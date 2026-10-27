import dns from "node:dns/promises";

export type Lookup = (hostname: string) => Promise<string[]>;

async function defaultLookup(hostname: string): Promise<string[]> {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

let fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis);
let lookupImpl: Lookup = defaultLookup;

export function getFetch(): typeof fetch {
  return fetchImpl;
}

export function getLookup(): Lookup {
  return lookupImpl;
}

/** Tests replace network calls. Pass null to restore the real ones. */
export function setImportRuntime(next: { fetchImpl?: typeof fetch; lookup?: Lookup } | null): void {
  if (!next) {
    fetchImpl = globalThis.fetch.bind(globalThis);
    lookupImpl = defaultLookup;
    return;
  }
  if (next.fetchImpl) fetchImpl = next.fetchImpl;
  if (next.lookup) lookupImpl = next.lookup;
}
