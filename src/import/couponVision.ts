/**
 * A coupon screenshot is read by the same vision call as a receipt photo.
 * This module only accepts fields the model copied. A missing amount stays
 * missing. Nothing here invents a discount, a store, or an expiration.
 */

import { parseModelJson } from "./aiSchema";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME = /^[\p{L}\p{N}][\p{L}\p{N}&'’.,/+%$ -]{0,119}$/u;

export type CouponRead = {
  storeName: string;
  itemName: string;
  kind: "dollars" | "percent" | "";
  amount: number | null;
  expiresOn: string;
  minQuantity: number | null;
  minSpend: number | null;
  conditions: string;
  gaps: string[];
};

function text(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function moneyAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 500) {
    return Math.round(value * 100) / 100;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim().replace(/^\$/, ""));
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 500) return Math.round(parsed * 100) / 100;
  }
  return null;
}

function whole(value: unknown, max: number): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) return null;
  return parsed;
}

function day(value: unknown): string {
  const raw = text(value, 10);
  if (!DAY.test(raw)) return "";
  const [year, month, date] = raw.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, date));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== date) return "";
  return raw;
}

export function emptyCouponRead(gaps: string[] = ["unreadable"]): CouponRead {
  return {
    storeName: "",
    itemName: "",
    kind: "",
    amount: null,
    expiresOn: "",
    minQuantity: null,
    minSpend: null,
    conditions: "",
    gaps,
  };
}

/** Turn the vision JSON into a review draft. Unknown fields stay blank. */
export function parseCouponVision(raw: string): CouponRead {
  let payload: unknown;
  try {
    payload = parseModelJson(raw);
  } catch {
    return emptyCouponRead();
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return emptyCouponRead();
  const row = payload as Record<string, unknown>;
  const storeName = text(row.storeName, 80);
  const itemName = text(row.itemName, 120);
  const kindText = text(row.kind, 16).toLowerCase();
  const kind = kindText === "percent" || kindText === "%" ? "percent" : kindText === "dollars" || kindText === "$" ? "dollars" : "";
  let amount = moneyAmount(row.amount);
  if (kind === "percent" && amount != null && amount > 100) amount = null;
  const expiresOn = day(row.expiresOn);
  const minQuantity = whole(row.minQuantity, 20);
  const minSpend = moneyAmount(row.minSpend);
  const conditions = text(row.conditions, 160);
  const gaps: string[] = [];
  if (!storeName || !NAME.test(storeName)) gaps.push("store");
  if (!itemName || !NAME.test(itemName)) gaps.push("item");
  if (!kind || amount == null) gaps.push("amount");
  return {
    storeName: NAME.test(storeName) ? storeName : "",
    itemName: NAME.test(itemName) ? itemName : "",
    kind: amount == null ? "" : kind,
    amount,
    expiresOn,
    minQuantity: minQuantity && minQuantity > 1 ? minQuantity : null,
    minSpend,
    conditions,
    gaps,
  };
}

export function couponReadApplies(
  coupon: { expiresOn?: string; minQuantity?: number | null; minSpend?: number | null; storeName?: string },
  item: { quantity?: number; storeName?: string },
  itemTotal: number,
  today: string
): { ok: boolean; reason: string } {
  if (coupon.expiresOn && coupon.expiresOn < today) return { ok: false, reason: "expired" };
  const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
  if (coupon.minQuantity && qty < coupon.minQuantity) return { ok: false, reason: "quantity" };
  const spend = Number(itemTotal);
  if (coupon.minSpend && (!Number.isFinite(spend) || spend + 0.009 < coupon.minSpend)) return { ok: false, reason: "spend" };
  return { ok: true, reason: "" };
}
