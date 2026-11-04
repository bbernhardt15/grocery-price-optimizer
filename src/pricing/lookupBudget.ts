import { StorePricingError } from "./types";

/**
 * Live Kroger and Walmart calls share one budget per plan.
 * A timeout or a 429 is retried once, then the line is unchecked
 * instead of being called missing.
 */
export const LOOKUP_DEADLINE_MS = 9_000;
export const LOOKUP_MAX_CALLS = 64;
export const LOOKUP_MAX_PER_STORE = 40;
export const LOOKUP_MAX_ATTEMPTS = 2;

export type LookupKind = "timeout" | "error" | "rate_limit";

export type LookupBudget = {
  startedAt: number;
  deadlineAt: number;
  maxCalls: number;
  maxPerStore: number;
  liveCalls: number;
  perStore: Map<string, number>;
};

export type PricedLookup<T> =
  | { status: "ok"; products: T[] }
  | { status: "miss" }
  | { status: "budget"; kind: "timeout" }
  | { status: "failed"; kind: LookupKind; message: string; error: unknown };

export function createLookupBudget(
  now = Date.now(),
  options: { deadlineMs?: number; maxCalls?: number; maxPerStore?: number } = {}
): LookupBudget {
  const deadlineMs = options.deadlineMs ?? LOOKUP_DEADLINE_MS;
  return {
    startedAt: now,
    deadlineAt: now + deadlineMs,
    maxCalls: options.maxCalls ?? LOOKUP_MAX_CALLS,
    maxPerStore: options.maxPerStore ?? LOOKUP_MAX_PER_STORE,
    liveCalls: 0,
    perStore: new Map(),
  };
}

export function storeBudgetKey(storeName: string): string {
  return String(storeName || "").trim().toLowerCase();
}

/** Same item, different punctuation or quantity text, one cache slot. */
export function stableLineKey(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function budgetOpen(budget: LookupBudget, storeName: string, now = Date.now()): boolean {
  if (now >= budget.deadlineAt) return false;
  if (budget.liveCalls >= budget.maxCalls) return false;
  const used = budget.perStore.get(storeBudgetKey(storeName)) || 0;
  return used < budget.maxPerStore;
}

export function noteLiveCall(budget: LookupBudget, storeName: string): void {
  const key = storeBudgetKey(storeName);
  budget.liveCalls += 1;
  budget.perStore.set(key, (budget.perStore.get(key) || 0) + 1);
}

export function lookupFailureKind(error: unknown): LookupKind {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof StorePricingError ? error.status : undefined;
  if (status === 429 || /\b429\b|too many requests|rate limit/i.test(message)) return "rate_limit";
  if (
    status === 408 ||
    /timeout|timed out|aborted|aborterror/i.test(message) ||
    (error instanceof StorePricingError && error.code === "network" && /timeout|abort/i.test(message))
  ) {
    return "timeout";
  }
  return "error";
}

export function lookupIsRetryable(error: unknown): boolean {
  const kind = lookupFailureKind(error);
  if (kind === "rate_limit" || kind === "timeout") return true;
  const status = error instanceof StorePricingError ? error.status : undefined;
  if (status !== undefined && status >= 500 && status <= 504) return true;
  if (error instanceof StorePricingError && error.code === "network") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /\b50[234]\b|bad gateway|service unavailable|ECONNRESET|socket hang up/i.test(message);
}

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One live search. An empty shelf is a real miss and is not retried.
 * A timeout, 429, or 5xx is tried once more while the budget allows.
 */
export async function runPricedLookup<T>(input: {
  budget: LookupBudget;
  storeName: string;
  run: () => Promise<T[]>;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}): Promise<PricedLookup<T>> {
  const now = input.now || Date.now;
  const wait = input.wait || defaultWait;
  const maxAttempts = input.maxAttempts ?? LOOKUP_MAX_ATTEMPTS;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (!budgetOpen(input.budget, input.storeName, now())) {
      return { status: "budget", kind: "timeout" };
    }
    noteLiveCall(input.budget, input.storeName);
    try {
      const products = await input.run();
      if (products.length > 0) return { status: "ok", products };
      return { status: "miss" };
    } catch (error) {
      lastError = error;
      const retry = attempt < maxAttempts && lookupIsRetryable(error) && budgetOpen(input.budget, input.storeName, now());
      if (!retry) break;
      const pause = attempt === 1 ? 250 : 500;
      if (now() + pause >= input.budget.deadlineAt) break;
      await wait(pause);
    }
  }
  const kind = lookupFailureKind(lastError);
  const message = lastError instanceof Error ? lastError.message : String(lastError ?? "lookup failed");
  return { status: "failed", kind, message, error: lastError };
}

export function couldntCheckNote(storeName: string): string {
  const name = String(storeName || "This store").trim() || "This store";
  return `${name} couldn't check right now, retry`;
}
