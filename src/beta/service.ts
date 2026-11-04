import type { Request, Response } from "express";
import mongoose from "mongoose";
import { requestAuth } from "../auth/middleware";
import { captureServerException } from "../observability/sentry";
import { BetaClientError, BetaEvent, BetaFeedback, BetaSignup } from "./models";
import { allowRate } from "./rateLimit";

const DEVICE_ID = /^[A-Za-z0-9_-]{8,80}$/;

export const PRODUCT_EVENTS = [
  "onboarding_completed",
  "receipt_imported",
  "plan_built",
  "kroger_cart_sent",
  "walmart_opened",
  "trip_completed",
  "feedback_sent",
] as const;

export type ProductEventName = (typeof PRODUCT_EVENTS)[number];

/** The feedback route counts this itself so a second client ping cannot double it. */
export const CLIENT_EVENTS = PRODUCT_EVENTS.filter((name) => name !== "feedback_sent");

export const FEEDBACK_LIMIT = 5;
export const FEEDBACK_WINDOW_MS = 10 * 60 * 1000;
const INVITE_LIMIT = 8;
const INVITE_WINDOW_MS = 10 * 60 * 1000;
const EVENT_LIMIT = 120;
const EVENT_WINDOW_MS = 60 * 1000;
const ERROR_LIMIT = 20;
const ERROR_WINDOW_MS = 60 * 1000;
const ERROR_DUP_WINDOW_MS = 30 * 1000;

export type BetaContext = {
  appVersion: string;
  shellCache: string;
  screen: string;
  tab: string;
  userAgent: string;
  tripItemCount: number;
  storeCount: number;
  timestamp: string;
};

function clip(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);
}

/** Tokens and passwords only. A tester may leave an email address in the note. */
export function scrubBetaText(value: string): string {
  return value
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/gi, "$1 [token]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[token]")
    .replace(/kroger_shopper=[^;\s]*/gi, "kroger_shopper=[filtered]")
    .replace(/(password\s*[:=]\s*)\S+/gi, "$1[filtered]");
}

export function feedbackTextIssue(text: string): string | null {
  if (/password\s*[:=]/i.test(text) || /\bbearer\s+[a-z0-9._~+/-]/i.test(text) || /kroger_shopper=/i.test(text)) {
    return "Leave passwords and tokens out of feedback.";
  }
  const prices = text.match(/\$\s?\d+\.\d{2}/g) || [];
  if (prices.length >= 4 || /\b(subtotal|upc|visa|mastercard|card number)\b/i.test(text)) {
    return "Leave receipt contents out of feedback. A rating and a short note is enough.";
  }
  return null;
}

function countOf(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(10_000, Math.floor(number));
}

export function pickContext(value: unknown, now = new Date()): BetaContext {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const timestamp = clip(record.timestamp, 40);
  const parsed = timestamp && !Number.isNaN(Date.parse(timestamp)) ? new Date(timestamp).toISOString() : now.toISOString();
  return {
    appVersion: scrubBetaText(clip(record.appVersion, 40)),
    shellCache: scrubBetaText(clip(record.shellCache, 40)),
    screen: scrubBetaText(clip(record.screen, 80)),
    tab: scrubBetaText(clip(record.tab, 40)),
    userAgent: scrubBetaText(clip(record.userAgent, 300)),
    tripItemCount: countOf(record.tripItemCount),
    storeCount: countOf(record.storeCount),
    timestamp: parsed,
  };
}

export function inviteCodes(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.BETA_INVITE_CODES?.trim() ?? "";
  if (!raw) return [];
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const part of raw.split(",")) {
    const code = part.trim();
    if (!code || code.length > 80) continue;
    const key = code.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    codes.push(code);
  }
  return codes;
}

export function matchInvite(presented: string, codes: readonly string[]): string | null {
  const needle = presented.trim().toLowerCase();
  if (!needle || needle.length > 80) return null;
  return codes.find((code) => code.toLowerCase() === needle) ?? null;
}

export function readyPayload(state = mongoose.connection.readyState): {
  status: number;
  body: { ok: boolean; mongo: "connected" | "unavailable" };
} {
  const ok = state === 1;
  return { status: ok ? 200 : 503, body: { ok, mongo: ok ? "connected" : "unavailable" } };
}

export function clientIp(req: Request): string {
  return String(req.ip || req.socket?.remoteAddress || "unknown").slice(0, 80);
}

function deviceFrom(req: Request): string | null {
  const header = req.header("x-device-id");
  const bodyDevice =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? (req.body as { deviceId?: unknown }).deviceId
      : undefined;
  const value = typeof header === "string" && header.trim() ? header.trim() : typeof bodyDevice === "string" ? bodyDevice.trim() : "";
  return DEVICE_ID.test(value) ? value : null;
}

function accountIdFrom(res: Response): string | undefined {
  return requestAuth(res)?.accountId;
}

export async function submitFeedback(req: Request, res: Response, now = Date.now()): Promise<{ status: number; body: Record<string, unknown> }> {
  const deviceId = deviceFrom(req);
  if (!deviceId) {
    return { status: 401, body: { error: "Send this device's id." } };
  }
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : {};
  const rating = body.rating;
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { status: 400, body: { error: "Choose a rating from 1 to 5." } };
  }
  const message = scrubBetaText(clip(body.message, 2000));
  const issue = feedbackTextIssue(typeof body.message === "string" ? body.message : message);
  if (issue) return { status: 400, body: { error: issue } };
  const ip = clientIp(req);
  if (
    !allowRate(`feedback:${ip}:${deviceId}`, FEEDBACK_LIMIT, FEEDBACK_WINDOW_MS, now) ||
    !allowRate(`feedback-ip:${ip}`, 20, FEEDBACK_WINDOW_MS, now)
  ) {
    return { status: 429, body: { error: "Too many feedback notes. Try again in a little while." } };
  }
  const screen = scrubBetaText(clip(body.screen, 80));
  const context = pickContext(body.context, new Date(now));
  const accountId = accountIdFrom(res);
  await BetaFeedback.create({
    rating,
    message,
    screen,
    context,
    deviceId,
    ...(accountId ? { accountId } : {}),
  });
  await recordProductEvent("feedback_sent");
  return { status: 201, body: { ok: true } };
}

export async function listFeedback(limit: number): Promise<{ feedback: Array<Record<string, unknown>> }> {
  const capped = Math.min(200, Math.max(1, Math.floor(limit) || 50));
  const docs = await BetaFeedback.find().sort({ createdAt: -1 }).limit(capped).lean();
  return {
    feedback: docs.map((doc) => ({
      id: String(doc._id),
      rating: doc.rating,
      message: doc.message,
      screen: doc.screen,
      context: doc.context,
      createdAt: doc.createdAt,
    })),
  };
}

function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export async function feedbackCsv(limit = 2000): Promise<string> {
  const docs = await BetaFeedback.find()
    .sort({ createdAt: -1 })
    .limit(Math.min(5000, Math.max(1, limit)))
    .lean();
  const header = ["createdAt", "rating", "screen", "message", "appVersion", "shellCache", "tab", "tripItemCount", "storeCount", "userAgent", "timestamp"];
  const lines = [header.join(",")];
  for (const doc of docs) {
    const context = (doc.context || {}) as Partial<BetaContext>;
    lines.push(
      [
        doc.createdAt ? new Date(doc.createdAt).toISOString() : "",
        doc.rating,
        doc.screen,
        doc.message,
        context.appVersion,
        context.shellCache,
        context.tab,
        context.tripItemCount,
        context.storeCount,
        context.userAgent,
        context.timestamp,
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function redeemInvite(
  req: Request,
  res: Response,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now()
): Promise<{ status: number; body: Record<string, unknown> }> {
  const codes = inviteCodes(env);
  if (!codes.length) {
    return { status: 200, body: { ok: true, required: false } };
  }
  const deviceId = deviceFrom(req);
  if (!deviceId) return { status: 401, body: { error: "Send this device's id." } };
  const presented = req.body && typeof req.body === "object" ? clip((req.body as { code?: unknown }).code, 80) : "";
  const code = matchInvite(presented, codes);
  const existing = await BetaSignup.findOne({ deviceId }).lean();
  if (existing && code && existing.code === code) {
    const accountId = accountIdFrom(res);
    if (accountId && !existing.accountId) {
      await BetaSignup.updateOne({ deviceId, accountId: { $exists: false } }, { $set: { accountId } });
    }
    return { status: 200, body: { ok: true, required: true } };
  }
  const ip = clientIp(req);
  if (!allowRate(`invite:${ip}`, INVITE_LIMIT, INVITE_WINDOW_MS, now)) {
    return { status: 429, body: { error: "Too many invite attempts. Wait a moment and try again." } };
  }
  if (!code) return { status: 401, body: { error: "That invite code is not recognized." } };
  const accountId = accountIdFrom(res);
  await BetaSignup.updateOne(
    { deviceId },
    {
      $setOnInsert: {
        deviceId,
        code,
        ...(accountId ? { accountId } : {}),
      },
    },
    { upsert: true }
  );
  if (accountId) {
    await BetaSignup.updateOne({ deviceId, accountId: { $exists: false } }, { $set: { accountId } });
  }
  return { status: 200, body: { ok: true, required: true } };
}

export async function signupSummary(): Promise<{
  codes: Array<{ code: string; signups: number; lastSignupAt: Date | null }>;
}> {
  const rows = await BetaSignup.aggregate<{ _id: string; signups: number; lastSignupAt: Date | null }>([
    { $group: { _id: "$code", signups: { $sum: 1 }, lastSignupAt: { $max: "$createdAt" } } },
    { $sort: { lastSignupAt: -1, _id: 1 } },
  ]);
  return {
    codes: rows.map((row) => ({
      code: row._id,
      signups: row.signups,
      lastSignupAt: row.lastSignupAt,
    })),
  };
}

export async function recordProductEvent(name: string): Promise<boolean> {
  if (!PRODUCT_EVENTS.includes(name as ProductEventName)) return false;
  await BetaEvent.updateOne({ name }, { $inc: { count: 1 } }, { upsert: true });
  return true;
}

export async function acceptProductEvent(req: Request, now = Date.now()): Promise<{ status: number; body: Record<string, unknown> }> {
  const name = req.body && typeof req.body === "object" ? clip((req.body as { name?: unknown }).name, 80) : "";
  if (!CLIENT_EVENTS.includes(name as (typeof CLIENT_EVENTS)[number])) {
    return { status: 400, body: { error: "Unknown event." } };
  }
  const ip = clientIp(req);
  if (!allowRate(`events:${ip}`, EVENT_LIMIT, EVENT_WINDOW_MS, now)) {
    return { status: 202, body: { ok: true, stored: false } };
  }
  await recordProductEvent(name);
  return { status: 202, body: { ok: true, stored: true } };
}

export async function eventSummary(): Promise<{ events: Array<{ name: ProductEventName; count: number }> }> {
  const rows = await BetaEvent.find().lean();
  const counts = new Map(rows.map((row) => [row.name, row.count]));
  return {
    events: PRODUCT_EVENTS.map((name) => ({ name, count: counts.get(name) || 0 })),
  };
}

export async function recordClientError(req: Request, now = Date.now()): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : {};
  const message = scrubBetaText(clip(body.message, 500));
  if (!message) return { status: 400, body: { error: "Missing error message." } };
  const issue = feedbackTextIssue(typeof body.message === "string" ? body.message : message);
  if (issue) return { status: 400, body: { error: "That report was dropped." } };
  const ip = clientIp(req);
  const duplicate = !allowRate(`errors-dup:${ip}:${message.slice(0, 180)}`, 1, ERROR_DUP_WINDOW_MS, now);
  const flooded = !allowRate(`errors:${ip}`, ERROR_LIMIT, ERROR_WINDOW_MS, now);
  if (duplicate || flooded) return { status: 202, body: { ok: true, stored: false } };
  const stack = scrubBetaText(clip(body.stack, 4000));
  const deviceId = deviceFrom(req);
  await BetaClientError.create({
    message,
    stack,
    screen: scrubBetaText(clip(body.screen, 80)),
    tab: scrubBetaText(clip(body.tab, 40)),
    userAgent: scrubBetaText(clip(req.header("user-agent"), 300)),
    ...(deviceId ? { deviceId } : {}),
  });
  const error = new Error(message.slice(0, 200));
  if (stack) error.stack = stack;
  captureServerException(error);
  console.error(`client error: ${message.slice(0, 300)}`);
  return { status: 202, body: { ok: true, stored: true } };
}

export async function deleteBetaForShopper(deviceId: string, accountId?: string): Promise<{
  feedback: number;
  signups: number;
  clientErrors: number;
}> {
  const identity = accountId ? { $or: [{ deviceId }, { accountId }] } : { deviceId };
  const [feedback, signups, clientErrors] = await Promise.all([
    BetaFeedback.deleteMany(identity),
    BetaSignup.deleteMany(identity),
    BetaClientError.deleteMany({ deviceId }),
  ]);
  return {
    feedback: feedback.deletedCount ?? 0,
    signups: signups.deletedCount ?? 0,
    clientErrors: clientErrors.deletedCount ?? 0,
  };
}
