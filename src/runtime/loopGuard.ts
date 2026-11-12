import { monitorEventLoopDelay } from "node:perf_hooks";

const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();

let inFlight = 0;
let browseInFlight = 0;
let rejected = 0;
let clientClosed = 0;

/** Shopper browse is the heavy Mongo path. Keep a few in flight and refuse the rest quickly. */
export const BROWSE_CONCURRENCY = 3;

export function loopSnapshot(): {
  lagP99Ms: number;
  lagMeanMs: number;
  inFlight: number;
  browseInFlight: number;
  rejected: number;
  clientClosed: number;
} {
  return {
    lagP99Ms: Math.round(histogram.percentile(99) / 1e6),
    lagMeanMs: Math.round(histogram.mean / 1e6),
    inFlight,
    browseInFlight,
    rejected,
    clientClosed,
  };
}

export function noteClientClosed(): void {
  clientClosed += 1;
}

export function beginRequest(kind: "browse" | "other"): void {
  inFlight += 1;
  if (kind === "browse") browseInFlight += 1;
}

export function endRequest(kind: "browse" | "other"): void {
  inFlight = Math.max(0, inFlight - 1);
  if (kind === "browse") browseInFlight = Math.max(0, browseInFlight - 1);
}

export function rejectBrowse(): void {
  rejected += 1;
}

/** Skip an ingest tick when the shopper is already waiting on the loop. */
export function ingestShouldWait(): boolean {
  const snap = loopSnapshot();
  return snap.lagP99Ms > 100 || snap.browseInFlight > 0 || snap.inFlight > 4;
}

export function resetLoopGuardForTests(): void {
  histogram.reset();
  inFlight = 0;
  browseInFlight = 0;
  rejected = 0;
  clientClosed = 0;
}
