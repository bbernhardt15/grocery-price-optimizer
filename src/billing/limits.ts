import type { PlanName } from "./entitlement";

export type PlanLimits = {
  /** 0 means unlimited. */
  savedLists: number;
  /** 0 means unlimited. */
  sharedLists: number;
  priceAlerts: boolean;
  multiStore: boolean;
  cartHandoffs: boolean;
};

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes" || value === "on") return true;
  if (value === "0" || value === "false" || value === "no" || value === "off") return false;
  return fallback;
}

/** What a shopper gets before they subscribe. */
export function freeLimits(): PlanLimits {
  return {
    savedLists: intEnv("PLAN_FREE_SAVED_LISTS", 1),
    sharedLists: intEnv("PLAN_FREE_SHARED_LISTS", 1),
    priceAlerts: boolEnv("PLAN_FREE_PRICE_ALERTS", false),
    multiStore: boolEnv("PLAN_FREE_MULTI_STORE", false),
    cartHandoffs: boolEnv("PLAN_FREE_CART_HANDOFFS", false),
  };
}

/** Grocery Gitter Pro. Price alerts, the multi-store split, and cart handoffs stay on. */
export function proLimits(): PlanLimits {
  return {
    savedLists: intEnv("PLAN_PRO_SAVED_LISTS", 0),
    sharedLists: intEnv("PLAN_PRO_SHARED_LISTS", 0),
    priceAlerts: true,
    multiStore: true,
    cartHandoffs: true,
  };
}

export function limitsFor(plan: PlanName): PlanLimits {
  return plan === "pro" ? proLimits() : freeLimits();
}

/** A cap of 0 is unlimited. */
export function withinCap(count: number, cap: number): boolean {
  return cap === 0 || count < cap;
}

export const OPEN_LIMITS: PlanLimits = {
  savedLists: 0,
  sharedLists: 0,
  priceAlerts: true,
  multiStore: true,
  cartHandoffs: true,
};
