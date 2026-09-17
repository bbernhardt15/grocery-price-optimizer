import type {
  StorePricingAccumulator,
  StorePricingReport,
  StorePricingSource,
} from "./types";

export function emptyAccumulator(storeName: string): StorePricingAccumulator {
  return {
    storeName,
    configured: false,
    attempted: false,
    liveHits: 0,
    cachedHits: 0,
    seedHits: 0,
    errors: [],
  };
}

function uniqueMessages(messages: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const message of messages) {
    const trimmed = message.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function sourceOf(acc: StorePricingAccumulator): StorePricingSource {
  const hasLive = acc.liveHits > 0;
  const hasCached = acc.cachedHits > 0;
  const hasSeed = acc.seedHits > 0;

  if ((hasLive || hasCached) && hasSeed) {
    return "mixed";
  }
  if (hasLive) {
    return "live";
  }
  if (hasCached) {
    return "cached_live";
  }
  if (hasSeed) {
    return "seed";
  }
  return "unavailable";
}

function labelOf(source: StorePricingSource): string {
  switch (source) {
    case "live":
      return "Live prices";
    case "cached_live":
      return "Cached live";
    case "mixed":
      return "Mixed live + demo";
    case "seed":
      return "Demo catalog";
    default:
      return "Unavailable";
  }
}

export function finalizeStoreReport(
  acc: StorePricingAccumulator,
  setupHint?: string
): StorePricingReport {
  const source = sourceOf(acc);
  const errors = uniqueMessages(acc.errors);
  const usedFallback = acc.seedHits > 0 && acc.attempted;
  const ok = source === "live" || source === "cached_live" || source === "mixed";
  const isKroger = acc.storeName.trim().toLowerCase() === "kroger";
  const error =
    errors[0] && (acc.attempted || isKroger) ? errors[0] : undefined;

  let detail: string;
  if (source === "live") {
    detail = `Live ${acc.storeName} prices from the retailer API.`;
  } else if (source === "cached_live") {
    detail = `Using ${acc.storeName} prices cached from a live API (less than 24 hours old).`;
  } else if (source === "mixed") {
    detail = `${acc.storeName} split uses some live (or cached live) rows and some demo catalog rows.`;
  } else if (source === "seed") {
    detail = acc.configured
      ? `Live ${acc.storeName} lookup returned nothing or failed; demo catalog prices are shown instead.`
      : setupHint ||
        `${acc.storeName} prices are from the seeded demo catalog, not a live shelf feed.`;
  } else {
    detail =
      error ||
      setupHint ||
      `No ${acc.storeName} prices were available from a live API or the demo catalog.`;
  }

  return {
    storeName: acc.storeName,
    source,
    configured: acc.configured,
    attempted: acc.attempted,
    ok,
    usedFallback,
    label: labelOf(source),
    detail,
    ...(error ? { error } : {}),
    ...(acc.fetchedAt ? { fetchedAt: acc.fetchedAt.toISOString() } : {}),
    ...(acc.locationId ? { locationId: acc.locationId } : {}),
  };
}

/**
 * Banner warning: live fetch failures, plus Kroger missing credentials
 * (existing behavior). Unconfigured Walmart/Target stay on per-store
 * reports so the dashboard can label them Demo without a red banner.
 */
export function pricingWarningFromReports(
  reports: StorePricingReport[]
): string | undefined {
  const parts: string[] = [];
  for (const report of reports) {
    if (!report.error) {
      continue;
    }
    const isKroger = report.storeName.trim().toLowerCase() === "kroger";
    if (report.attempted || isKroger) {
      parts.push(`${report.storeName}: ${report.error}`);
    }
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}
