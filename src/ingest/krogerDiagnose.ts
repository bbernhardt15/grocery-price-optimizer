import { randomUUID } from "node:crypto";
import { krogerMatchLookupPaused } from "../catalog/krogerLookupFormat";
import { krogerFormatCode, type KrogerLookupFormat, KROGER_LOOKUP_FORMATS } from "../catalog/normalize";
import { krogerTermBinds } from "./krogerBind";
import { activeKrogerLocationIds, krogerProbeTerm, openSharedKrogerGate, sampleKrogerMisses, type ProbeLock } from "./krogerProbe";
import type { BudgetStore } from "./budget";

/** Misses to name-search. Controls are extra and do not multiply with this. */
export const KROGER_DIAGNOSE_SAFE_LIMIT = 3;
export const KROGER_DIAGNOSE_MAX = 5;

/** Short staple phrases Kroger carries. Sent as filter.term exactly, not as a product id. */
export const KROGER_DIAGNOSE_CONTROLS = ["Kroger 2% milk gallon", "large eggs dozen", "bananas"] as const;

/** How many saved stores to check before giving up on a location. The first valid one is used. */
const LOCATION_CHECK_CAP = 4;

export type DiagnoseHit = {
  productId: string;
  upc: string;
  description: string;
  brand: string;
  sameProduct: boolean;
};

export type DiagnoseClient = {
  term(input: { term: string; locationId?: string }): Promise<{
    httpStatus: number;
    query?: string;
    hits: Array<{ productId?: string; upc?: string; description?: string; brand?: string }>;
  }>;
  product(input: { code: string; locationId?: string }): Promise<{
    httpStatus: number;
    query?: string;
    hits: Array<{ productId?: string; upc?: string; description?: string; brand?: string }>;
  }>;
  productPath(input: { code: string; locationId?: string }): Promise<{
    httpStatus: number;
    query?: string;
    hits: Array<{ productId?: string; upc?: string; description?: string; brand?: string }>;
  }>;
  location(locationId: string): Promise<{ httpStatus: number; valid: boolean }>;
};

export type IdComparison = {
  format: KrogerLookupFormat;
  ours: string;
  versusProductId: string;
  versusUpc: string;
};

export type DiagnoseCrossCheck = {
  krogerProductId: string;
  krogerUpc: string;
  description: string;
  sameProduct: boolean;
  generated: Record<string, string>;
  compared: IdComparison[];
};

export type DiagnoseLookup = {
  productId: string;
  mode: "filter.productId" | "GET /products/{id}";
  locationId: string | null;
  httpStatus: number;
  hit: boolean;
  returnedProductId: string;
  returnedUpc: string;
};

export type KrogerDiagnoseReport = {
  pausedMatchLookup: boolean;
  safeLimit: number;
  calls: number;
  stopped: "" | "budget" | "busy";
  location: { locationId: string; httpStatus: number; valid: boolean } | null;
  locationsChecked: Array<{ locationId: string; httpStatus: number; valid: boolean }>;
  items: Array<{
    name: string;
    brand: string;
    department: string;
    upc: string;
    /** The filter.term value actually sent. */
    term: string;
    query: "filter.term";
    httpStatus: number;
    hits: DiagnoseHit[];
    crossCheck: DiagnoseCrossCheck[];
  }>;
  controls: Array<{
    term: string;
    query: "filter.term";
    httpStatus: number;
    hits: DiagnoseHit[];
    lookups: DiagnoseLookup[];
  }>;
  summary: {
    sampled: number;
    termHttp200: number;
    strictBinds: number;
    controlTermsHit: number;
    productIdFilterHit: number;
    productPathHit: number;
    barcodeMatched: number;
  };
  /** What the counts mean. Name matching is not turned on by this sentence. */
  conclusion: string;
};

export type KrogerDiagnoseJob = {
  id: string;
  status: "running" | "done" | "error" | "busy";
  safeLimit: number;
  poll: string;
  calls: number;
  report: KrogerDiagnoseReport | null;
  error: string;
};

const jobs = new Map<string, KrogerDiagnoseJob>();

type Miss = { name: string; brand?: string; departmentId: string; upc: string };

function cleanHit(hit: { productId?: string; upc?: string; description?: string; brand?: string } | undefined): DiagnoseHit {
  return {
    productId: String(hit?.productId || "").replace(/\D/g, ""),
    upc: String(hit?.upc || "").replace(/\D/g, ""),
    description: String(hit?.description || "").replace(/\s+/g, " ").trim().slice(0, 160),
    brand: String(hit?.brand || "").replace(/\s+/g, " ").trim().slice(0, 80),
    sameProduct: false,
  };
}

/** How our derived id differs from the id Kroger returned. */
export function describeKrogerIdGap(ours: string | null, theirs: string): string {
  if (!ours) return "not generated";
  if (!theirs) return `ours ${ours}; Kroger sent no value`;
  if (ours === theirs) return "same";
  if (theirs.endsWith(ours)) return `Kroger adds prefix ${theirs.slice(0, theirs.length - ours.length)}`;
  if (ours.endsWith(theirs)) return `ours adds prefix ${ours.slice(0, ours.length - theirs.length)}`;
  return `ours ${ours} (${ours.length} digits) vs Kroger ${theirs} (${theirs.length} digits)`;
}

export function krogerIdCrossCheck(upc: string, hit: { productId: string; upc: string; description: string; sameProduct: boolean }): DiagnoseCrossCheck {
  const generated: Record<string, string> = {};
  const compared: IdComparison[] = [];
  for (const format of KROGER_LOOKUP_FORMATS) {
    const ours = krogerFormatCode(upc, format);
    if (ours) generated[format] = ours;
    compared.push({
      format,
      ours: ours ?? "",
      versusProductId: describeKrogerIdGap(ours, hit.productId),
      versusUpc: describeKrogerIdGap(ours, hit.upc),
    });
  }
  return {
    krogerProductId: hit.productId,
    krogerUpc: hit.upc,
    description: hit.description,
    sameProduct: hit.sameProduct,
    generated,
    compared,
  };
}

function barcodeMatched(check: DiagnoseCrossCheck): boolean {
  return check.compared.some(
    (row) => row.format !== "plu" && (row.versusProductId === "same" || row.versusUpc === "same")
  );
}

export function diagnoseConclusion(summary: KrogerDiagnoseReport["summary"]): string {
  const lookupWorks = summary.productIdFilterHit + summary.productPathHit > 0;
  if (lookupWorks && summary.barcodeMatched === 0) {
    return "Product id lookup returned Kroger's own ids, and none of the barcode-derived ids matched those ids. The id shape is not the miss. A name search that passes the existing bind rules is the next step, and it is not enabled.";
  }
  if (summary.controlTermsHit === 0) {
    return "The staple term searches did not return products, so product id lookup was not tried from an id Kroger itself returned.";
  }
  if (!lookupWorks) {
    return "Staple term searches returned products, but looking those ids back up did not return a product.";
  }
  if (summary.barcodeMatched > 0) {
    return "At least one barcode-derived id matched a Kroger id from a term search.";
  }
  return "See the control and cross-check rows.";
}

function emptyReport(stopped: KrogerDiagnoseReport["stopped"]): KrogerDiagnoseReport {
  const summary = {
    sampled: 0,
    termHttp200: 0,
    strictBinds: 0,
    controlTermsHit: 0,
    productIdFilterHit: 0,
    productPathHit: 0,
    barcodeMatched: 0,
  };
  return {
    pausedMatchLookup: krogerMatchLookupPaused(),
    safeLimit: KROGER_DIAGNOSE_SAFE_LIMIT,
    calls: 0,
    stopped,
    location: null,
    locationsChecked: [],
    items: [],
    controls: [],
    summary,
    conclusion: diagnoseConclusion(summary),
  };
}

function sameProduct(miss: Miss, hit: DiagnoseHit): boolean {
  return krogerTermBinds(
    { name: miss.name, brand: miss.brand, departmentId: miss.departmentId },
    { name: hit.description || hit.brand, brand: hit.brand }
  );
}

export async function runKrogerDiagnose(input: {
  limit?: number;
  client: DiagnoseClient;
  locations?: string[];
  misses?: Miss[];
  controls?: string[];
  store?: BudgetStore;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  minIntervalMs?: number;
  dailyBudget?: number;
  holdLock?: () => Promise<ProbeLock | null>;
  readNextAllowedAt?: () => Promise<number>;
  writeNextAllowedAt?: (ms: number) => Promise<void>;
  onProgress?: (report: KrogerDiagnoseReport) => void;
}): Promise<KrogerDiagnoseReport> {
  const limit = Math.max(1, Math.min(KROGER_DIAGNOSE_MAX, Math.floor(input.limit ?? KROGER_DIAGNOSE_SAFE_LIMIT)));
  const gate = await openSharedKrogerGate(input);
  if (gate === "busy") return emptyReport("busy");

  try {
    const storeIds = (input.locations ?? (await activeKrogerLocationIds())).slice(0, LOCATION_CHECK_CAP);
    const checked: KrogerDiagnoseReport["locationsChecked"] = [];
    let locationId = "";
    for (const id of storeIds) {
      if (!(await gate.charge())) break;
      const result = await input.client.location(id);
      checked.push({ locationId: id, httpStatus: result.httpStatus, valid: result.valid });
      if (result.valid) {
        locationId = id;
        break;
      }
    }
    const place = locationId ? { locationId } : {};
    const misses = gate.stopped() ? [] : (input.misses ?? (await sampleKrogerMisses(limit))).slice(0, limit);
    const controls = input.controls ?? [...KROGER_DIAGNOSE_CONTROLS];
    const items: KrogerDiagnoseReport["items"] = [];
    const controlRows: KrogerDiagnoseReport["controls"] = [];

    const snapshot = (): KrogerDiagnoseReport => {
      const summary = {
        sampled: items.length,
        termHttp200: items.filter((item) => item.httpStatus === 200).length,
        strictBinds: items.filter((item) => item.hits.some((hit) => hit.sameProduct)).length,
        controlTermsHit: controlRows.filter((row) => row.hits.length > 0).length,
        productIdFilterHit: controlRows.reduce(
          (sum, row) => sum + row.lookups.filter((lookup) => lookup.mode === "filter.productId" && lookup.hit).length,
          0
        ),
        productPathHit: controlRows.reduce(
          (sum, row) => sum + row.lookups.filter((lookup) => lookup.mode === "GET /products/{id}" && lookup.hit).length,
          0
        ),
        barcodeMatched: items.reduce(
          (sum, item) => sum + item.crossCheck.filter((check) => barcodeMatched(check)).length,
          0
        ),
      };
      return {
        pausedMatchLookup: krogerMatchLookupPaused(),
        safeLimit: KROGER_DIAGNOSE_SAFE_LIMIT,
        calls: gate.calls(),
        stopped: gate.stopped(),
        location: checked.find((row) => row.valid) ?? null,
        locationsChecked: checked,
        items,
        controls: controlRows,
        summary,
        conclusion: diagnoseConclusion(summary),
      };
    };

    for (const miss of misses) {
      if (gate.stopped()) break;
      const term = krogerProbeTerm(miss.name);
      if (!term) {
        items.push({
          name: miss.name,
          brand: miss.brand || "",
          department: miss.departmentId,
          upc: miss.upc,
          term: "",
          query: "filter.term",
          httpStatus: 0,
          hits: [],
          crossCheck: [],
        });
        continue;
      }
      if (!(await gate.charge())) break;
      const result = await input.client.term({ term, ...place });
      const hits = result.hits.slice(0, 5).map((hit) => {
        const row = cleanHit(hit);
        row.sameProduct = sameProduct(miss, row);
        return row;
      });
      items.push({
        name: miss.name,
        brand: miss.brand || "",
        department: miss.departmentId,
        upc: miss.upc,
        term,
        query: "filter.term",
        httpStatus: result.httpStatus,
        hits,
        crossCheck: hits
          .filter((hit) => hit.productId || hit.upc)
          .map((hit) => krogerIdCrossCheck(miss.upc, hit)),
      });
      input.onProgress?.(snapshot());
    }

    for (const phrase of controls) {
      if (gate.stopped()) break;
      const term = phrase.replace(/\s+/g, " ").trim().slice(0, 80);
      if (!term) continue;
      if (!(await gate.charge())) break;
      const result = await input.client.term({ term, ...place });
      const hits = result.hits.slice(0, 5).map((hit) => cleanHit(hit));
      const lookups: DiagnoseLookup[] = [];
      const first = hits.find((hit) => hit.productId);
      if (first && !gate.stopped()) {
        const modes: Array<{ mode: DiagnoseLookup["mode"]; call: DiagnoseClient["product"] }> = [
          { mode: "filter.productId", call: input.client.product },
          { mode: "GET /products/{id}", call: input.client.productPath },
        ];
        for (const mode of modes) {
          for (const withLocation of [true, false]) {
            if (gate.stopped()) break;
            if (!(await gate.charge())) break;
            const looked = await mode.call({
              code: first.productId,
              ...(withLocation && locationId ? { locationId } : {}),
            });
            const returned = cleanHit(looked.hits[0]);
            lookups.push({
              productId: first.productId,
              mode: mode.mode,
              locationId: withLocation && locationId ? locationId : null,
              httpStatus: looked.httpStatus,
              hit: looked.hits.length > 0,
              returnedProductId: returned.productId,
              returnedUpc: returned.upc,
            });
          }
        }
      }
      controlRows.push({
        term,
        query: "filter.term",
        httpStatus: result.httpStatus,
        hits,
        lookups,
      });
      input.onProgress?.(snapshot());
    }

    const report = snapshot();
    input.onProgress?.(report);
    return report;
  } finally {
    await gate.close();
  }
}

export function startKrogerDiagnoseJob(
  limit: number,
  run: (limit: number, onProgress: (report: KrogerDiagnoseReport) => void) => Promise<KrogerDiagnoseReport>
): KrogerDiagnoseJob {
  const id = randomUUID();
  const job: KrogerDiagnoseJob = {
    id,
    status: "running",
    safeLimit: KROGER_DIAGNOSE_SAFE_LIMIT,
    poll: `/api/admin/kroger/diagnose/${id}`,
    calls: 0,
    report: null,
    error: "",
  };
  jobs.set(id, job);
  while (jobs.size > 8) {
    const oldest = jobs.keys().next().value;
    if (!oldest || oldest === id) break;
    jobs.delete(oldest);
  }
  void run(limit, (report) => {
    job.calls = report.calls;
    job.report = report;
  })
    .then((report) => {
      job.report = report;
      job.calls = report.calls;
      job.status = report.stopped === "busy" ? "busy" : "done";
    })
    .catch((error: unknown) => {
      job.status = "error";
      job.error = (error instanceof Error ? error.message : "Kroger diagnose failed")
        .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
        .replace(/client_secret=\S+/gi, "client_secret=[redacted]");
    });
  return job;
}

export function krogerDiagnoseJob(id: string): KrogerDiagnoseJob | null {
  return jobs.get(id) ?? null;
}
