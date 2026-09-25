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
  return {
    provider,
    status: httpStatusOf(error),
    message: error instanceof Error ? error.message : String(error),
    params: clean,
    at: now.toISOString(),
  };
}

/**
 * 429 cooldown. Fifteen minutes, doubling each strike, never longer than six
 * hours and never past the next UTC midnight (when the daily ledger resets).
 */
export function walmartCooldownUntil(now: Date, strikes: number): string {
  const baseMs = 15 * 60_000;
  const capMs = 6 * 60 * 60_000;
  const delay = Math.min(capMs, baseMs * 2 ** Math.max(0, strikes - 1));
  const resume = now.getTime() + delay;
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return new Date(Math.min(resume, midnight)).toISOString();
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

  async used(provider: string, now: Date): Promise<number> {
    const doc = await IngestBudget.findOne({ provider, day: utcDay(now) }).lean<{ calls?: number } | null>();
    return doc?.calls ?? 0;
  }
}
