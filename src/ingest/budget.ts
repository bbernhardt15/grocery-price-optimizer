/**
 * Ingest pacing. Shopper traffic is not charged against this ledger.
 * The daily ceiling is the background job's own budget, set under the
 * published provider cap so live requests keep headroom.
 */

import { IngestBudget } from "./models";

export type RetryClass = "rate" | "server" | "fatal";

export function retryClass(error: unknown): RetryClass {
  const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: number }).status) : NaN;
  if (status === 429) {
    return "rate";
  }
  if (Number.isFinite(status) && status >= 500 && status <= 599) {
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
}

/**
 * Spaces calls at least `minIntervalMs` apart and stops at the daily budget.
 * `now` and `sleep` are injectable so tests do not wait on a real clock.
 */
export class RateGate {
  private nextAt = 0;

  constructor(
    private readonly options: {
      minIntervalMs: number;
      dailyBudget: number;
      provider: string;
      store: BudgetStore;
      now: () => number;
      sleep: (ms: number) => Promise<void>;
    }
  ) {}

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
  async tryConsume(provider: string, limit: number, now: Date): Promise<boolean> {
    const day = utcDay(now);
    const doc = await IngestBudget.findOneAndUpdate(
      { provider, day },
      { $inc: { calls: 1 } },
      { upsert: true, new: true }
    ).lean<{ calls?: number } | null>();
    const calls = doc?.calls ?? 1;
    if (calls > limit) {
      await IngestBudget.updateOne({ provider, day }, { $inc: { calls: -1 } });
      return false;
    }
    return true;
  }

  async used(provider: string, now: Date): Promise<number> {
    const doc = await IngestBudget.findOne({ provider, day: utcDay(now) }).lean<{ calls?: number } | null>();
    return doc?.calls ?? 0;
  }
}
