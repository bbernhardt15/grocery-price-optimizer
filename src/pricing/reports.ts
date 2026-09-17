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
    weeklyAdHits: 0,
    cachedWeeklyAdHits: 0,
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
  const hasWeekly = acc.weeklyAdHits > 0;
  const hasCachedWeekly = acc.cachedWeeklyAdHits > 0;
  const hasSeed = acc.seedHits > 0;
  const liveLike = hasLive || hasCached;
  const weeklyLike = hasWeekly || hasCachedWeekly;
  const distinct =
    Number(liveLike) + Number(weeklyLike) + Number(hasSeed);

  if (distinct > 1) {
    return "mixed";
  }
  if (hasLive) {
    return "live";
  }
  if (hasCached) {
    return "cached_live";
  }
  if (hasWeekly) {
    return "weekly_ad";
  }
  if (hasCachedWeekly) {
    return "cached_weekly_ad";
  }
  if (hasSeed) {
    return "seed";
  }
  return "unavailable";
}

function mixedDetail(acc: StorePricingAccumulator): string {
  const liveLike = acc.liveHits > 0 || acc.cachedHits > 0;
  const weeklyLike = acc.weeklyAdHits > 0 || acc.cachedWeeklyAdHits > 0;
  const hasSeed = acc.seedHits > 0;
  const parts: string[] = [];
  if (liveLike) {
    parts.push("live (or cached live) retailer API rows");
  }
  if (weeklyLike) {
    parts.push("weekly-ad / circular prices (not a full shelf catalog)");
  }
  if (hasSeed) {
    parts.push("demo catalog rows");
  }
  return `${acc.storeName} split uses ${parts.join(" and ")}.`;
}

function mixedLabel(acc: StorePricingAccumulator): string {
  const liveLike = acc.liveHits > 0 || acc.cachedHits > 0;
  const weeklyLike = acc.weeklyAdHits > 0 || acc.cachedWeeklyAdHits > 0;
  const hasSeed = acc.seedHits > 0;
  if (liveLike && weeklyLike && hasSeed) {
    return "Mixed live + weekly ad + demo";
  }
  if (liveLike && weeklyLike) {
    return "Mixed live + weekly ad";
  }
  if (weeklyLike && hasSeed) {
    return "Mixed weekly ad + demo";
  }
  if (liveLike && hasSeed) {
    return "Mixed live + demo";
  }
  return "Mixed sources";
}

function labelOf(
  source: StorePricingSource,
  acc: StorePricingAccumulator
): string {
  switch (source) {
    case "live":
      return "Live prices";
    case "cached_live":
      return "Cached live";
    case "weekly_ad":
    case "cached_weekly_ad":
      return "Weekly ad";
    case "mixed":
      return mixedLabel(acc);
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
  const ok =
    source === "live" ||
    source === "cached_live" ||
    source === "weekly_ad" ||
    source === "cached_weekly_ad" ||
    source === "mixed";
  const isKroger = acc.storeName.trim().toLowerCase() === "kroger";
  const error =
    errors[0] && (acc.attempted || isKroger) ? errors[0] : undefined;

  let detail: string;
  if (source === "live") {
    detail = `Live ${acc.storeName} prices from the retailer API.`;
  } else if (source === "cached_live") {
    detail = `Using ${acc.storeName} prices cached from a live API (less than 24 hours old).`;
  } else if (source === "weekly_ad") {
    detail = `${acc.storeName} prices are from the weekly ad / circular near this ZIP, not a full live shelf catalog.`;
  } else if (source === "cached_weekly_ad") {
    detail = `Using ${acc.storeName} weekly-ad prices cached from Flipp (less than 24 hours old). Flyer prices are not a full shelf catalog.`;
  } else if (source === "mixed") {
    detail = mixedDetail(acc);
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
    label: labelOf(source, acc),
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
