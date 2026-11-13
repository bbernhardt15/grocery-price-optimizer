/**
 * Ingest pacing. Shopper traffic is not charged against this ledger.
 * The daily ceiling is the background job's own budget, set under the
 * published provider cap so live requests keep headroom.
 */

import { IngestBudget } from "./models";

export type RetryClass = "rate" | "server" | "fatal";

export function httpStatusOf(error: unknown): number | null {
  if (typeof error === "object" && error && "status" in error) {
    const status = Number((error as { status?: number }).status);
    if (Number.isFinite(status)) {
      return status;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/\((\d{3})\)/);
  return match ? Number(match[1]) : null;
}

export function retryClass(error: unknown): RetryClass {
  const status = httpStatusOf(error);
  if (status === 429) {
    return "rate";
  }
  if (status !== null && status >= 500 && status <= 599) {
    return "server";
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/\b429\b|too many requests|rate limit/i.test(message)) {
    return "rate";
  }
  if (/\b5\d\d\b|unavailable|timeout/i.test(message)) {
    return "server";
  }
  return "fatal";
}

export type IngestErrorDetail = {
  provider: string;
  status: number | null;
  message: string;
  params: Record<string, string | number | boolean | null>;
  /** Response body on a 4xx/5xx, trimmed and with credentials removed. */
  body?: string;
  /** Retry-After and rate-limit headers only. Auth headers are dropped. */
  headers?: Record<string, string>;
  at: string;
};

const SECRET_PARAM = /secret|token|authorization|password|private.?key|consumer/i;

/** Safe to store and show on the admin status route. Drops anything that looks like a credential. */
export function ingestErrorDetail(
  provider: string,
  error: unknown,
  params: Record<string, string | number | boolean | null | undefined>,
  now: Date
): IngestErrorDetail {
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || SECRET_PARAM.test(key)) {
      continue;
    }
    clean[key] = value;
  }
  const body = responseBodyOf(error);
  const headers = responseHeadersOf(error);
  return {
    provider,
    status: httpStatusOf(error),
    message: error instanceof Error ? error.message : String(error),
    params: clean,
    ...(body ? { body } : {}),
    ...(headers ? { headers } : {}),
    at: now.toISOString(),
  };
}

const RATE_HEADER = /^(retry-after|ratelimit-.*|x-ratelimit-.*|x-rate-limit-.*)$/i;

function responseHeadersOf(error: unknown): Record<string, string> | undefined {
  if (!error || typeof error !== "object" || !("headers" in error)) {
    return undefined;
  }
  const raw = (error as { headers?: unknown }).headers;
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string" || !value.trim() || SECRET_PARAM.test(key) || !RATE_HEADER.test(key)) {
      continue;
    }
    out[key.toLowerCase()] = value.slice(0, 200);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function responseBodyOf(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("body" in error)) {
    return undefined;
  }
  const raw = (error as { body?: unknown }).body;
  if (typeof raw !== "string" || !raw.trim()) {
    return undefined;
  }
  return raw
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(client_secret|access_token|refresh_token|private_key)=([^&\s]+)/gi, "$1=[redacted]")
    .slice(0, 500);
}

/** Thrown by {@link chargeCall} when the daily ledger is already at the cap. No HTTP call was made. */
export class CallBudgetExceeded extends Error {
  constructor() {
    super("Ingest daily budget reached");
    this.name = "CallBudgetExceeded";
  }
}

/**
 * The only way an ingest request is allowed to start. Taxonomy, the first
 * page, every nextPage, location lookup, and a retry all come through here:
 * the ledger is consumed, `count` runs once, then the HTTP call starts.
 */
export async function chargeCall<T>(gate: RateGate, run: () => Promise<T>, count: () => void): Promise<T> {
  const slot = await gate.take();
  if (slot === "budget") {
    throw new CallBudgetExceeded();
  }
  count();
  return run();
}

/** After this many 429s in a row, stop Walmart ingest until the next UTC day (or six hours). */
export const WALMART_RATE_HALT_STRIKES = 3;

/**
 * 429 cooldown. Fifteen minutes, then thirty. A third strike stops the crawl
 * until the next UTC midnight, and for at least six hours when midnight is
 * sooner than that. One successful page does not clear the strike count.
 */
export function walmartCooldownUntil(now: Date, strikes: number): string {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  if (strikes >= WALMART_RATE_HALT_STRIKES) {
    const sixHours = now.getTime() + 6 * 60 * 60_000;
    return new Date(Math.max(midnight, sixHours)).toISOString();
  }
  const baseMs = 15 * 60_000;
  const delay = baseMs * 2 ** Math.max(0, strikes - 1);
  const resume = now.getTime() + delay;
  return new Date(Math.min(resume, midnight)).toISOString();
}

/** Retry-After in milliseconds. HTTP-date and delta-seconds are both accepted. */
export function retryAfterMs(error: unknown, now: Date): number | null {
  const headers = responseHeadersOf(error);
  const raw = headers?.["retry-after"];
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const dated = Date.parse(raw);
  if (Number.isFinite(dated)) return Math.max(0, dated - now.getTime());
  return null;
}

/**
 * How long a Kroger 429 pauses the crawl.
 * The pause grows from 30s, and a Retry-After longer than that wins.
 */
export function krogerRateCooldownUntil(now: Date, strikes: number, retryAfter: number | null): string {
  const exponential = Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, strikes - 1));
  const wait = Math.max(exponential, retryAfter ?? 0);
  return new Date(now.getTime() + wait).toISOString();
}

/** Exponential backoff with optional jitter. `rand` is 0..1; tests pass 0. */
export function backoffDelayMs(
  attempt: number,
  baseMs = 1000,
  capMs = 60_000,
  rand: () => number = Math.random
): number {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
  const jitter = exp * 0.2 * Math.min(1, Math.max(0, rand()));
  return Math.round(exp + jitter);
}

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export type BudgetStore = {
  tryConsume(provider: string, limit: number, now: Date): Promise<boolean>;
  used(provider: string, now: Date): Promise<number>;
  /** Give back one charge. Used when a 5xx is retried so the failure does not spend the day. */
  refund(provider: string, now: Date): Promise<void>;
};

export class MemoryBudgetStore implements BudgetStore {
  private counts = new Map<string, number>();

  async tryConsume(provider: string, limit: number, now: Date): Promise<boolean> {
    const key = `${provider}:${utcDay(now)}`;
    const used = this.counts.get(key) ?? 0;
    if (used >= limit) {
      return false;
    }
    this.counts.set(key, used + 1);
    return true;
  }

  async used(provider: string, now: Date): Promise<number> {
    return this.counts.get(`${provider}:${utcDay(now)}`) ?? 0;
  }

  async refund(provider: string, now: Date): Promise<void> {
    const key = `${provider}:${utcDay(now)}`;
    const used = this.counts.get(key) ?? 0;
    if (used <= 1) {
      this.counts.delete(key);
      return;
    }
    this.counts.set(key, used - 1);
  }
}

/**
 * Spaces calls at least `minIntervalMs` apart and stops at the daily budget.
 * `now` and `sleep` are injectable so tests do not wait on a real clock.
 */
export class RateGate {
  private nextAt: number;

  constructor(
    private readonly options: {
      minIntervalMs: number;
      dailyBudget: number;
      provider: string;
      store: BudgetStore;
      now: () => number;
      sleep: (ms: number) => Promise<void>;
      /** Epoch ms. Carried across ticks so a fresh gate still waits out the last call. */
      initialNextAt?: number;
    }
  ) {
    this.nextAt = options.initialNextAt && Number.isFinite(options.initialNextAt) ? options.initialNextAt : 0;
  }

  /** When the next call is allowed. Persist this on the checkpoint. */
  nextAllowedAt(): number {
    return this.nextAt;
  }

  /** Return the charge from the last take. The pacing gap stays, so a retry still waits. */
  async refund(): Promise<void> {
    await this.options.store.refund(this.options.provider, new Date(this.options.now()));
  }

  async take(): Promise<"ok" | "budget"> {
    const used = await this.options.store.used(this.options.provider, new Date(this.options.now()));
    if (used >= this.options.dailyBudget) {
      return "budget";
    }
    const now = this.options.now();
    const wait = this.nextAt - now;
    if (wait > 0) {
      await this.options.sleep(wait);
    }
    const allowed = await this.options.store.tryConsume(
      this.options.provider,
      this.options.dailyBudget,
      new Date(this.options.now())
    );
    if (!allowed) {
      return "budget";
    }
    this.nextAt = this.options.now() + this.options.minIntervalMs;
    return "ok";
  }
}

export class MongoBudgetStore implements BudgetStore {
  /**
   * Hard cap. The increment only matches a row still under the limit, so two
   * replicas cannot both slip past it and then try to subtract. Creating the
   * day's row is the one race; a duplicate-key loser retries the same guard.
   */
  async tryConsume(provider: string, limit: number, now: Date): Promise<boolean> {
    if (limit < 1) {
      return false;
    }
    const day = utcDay(now);
    const updated = await IngestBudget.findOneAndUpdate(
      { provider, day, calls: { $lt: limit } },
      { $inc: { calls: 1 } },
      { new: true }
    ).lean<{ calls?: number } | null>();
    if (updated) {
      return true;
    }
    try {
      await IngestBudget.create({ provider, day, calls: 1 });
      return true;
    } catch {
      const again = await IngestBudget.findOneAndUpdate(
        { provider, day, calls: { $lt: limit } },
        { $inc: { calls: 1 } },
        { new: true }
      ).lean<{ calls?: number } | null>();
      return Boolean(again);
    }
  }

  async refund(provider: string, now: Date): Promise<void> {
    await IngestBudget.updateOne({ provider, day: utcDay(now), calls: { $gt: 0 } }, { $inc: { calls: -1 } });
  }

  async used(provider: string, now: Date): Promise<number> {
    const doc = await IngestBudget.findOne({ provider, day: utcDay(now) }).lean<{ calls?: number } | null>();
    return doc?.calls ?? 0;
  }
}
