import { timingSafeEqual } from "node:crypto";
import { Account } from "../auth/models";
import { entitlementId } from "./config";

const GRANT = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
  "NON_RENEWING_PURCHASE",
  "PRODUCT_CHANGE",
  "TEMPORARY_ENTITLEMENT_GRANT",
  "SUBSCRIPTION_EXTENDED",
  "TRANSFER",
]);

const REVOKE = new Set(["EXPIRATION"]);

export type RcEvent = {
  type?: string;
  app_user_id?: string;
  entitlement_ids?: unknown;
  expiration_at_ms?: unknown;
  transferred_to?: unknown;
  transferred_from?: unknown;
};

export type EntitlementAction = "grant" | "revoke" | "cancellation" | "ignore";

export function presentedSecret(authorization: string | undefined): string {
  const header = (authorization || "").trim();
  const bearer = /^Bearer\s+(\S.*)$/i.exec(header);
  return (bearer ? bearer[1] : header).trim();
}

export function secretsEqual(presented: string, expected: string): boolean {
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    timingSafeEqual(right, right);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function readRevenueCatEvent(body: unknown): RcEvent | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const event =
    record.event && typeof record.event === "object" ? (record.event as Record<string, unknown>) : record;
  if (typeof event.type !== "string" || !event.type.trim()) return null;
  return event as RcEvent;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

export function eventAction(event: RcEvent, entitlement: string): EntitlementAction {
  const ids = stringList(event.entitlement_ids);
  if (ids.length > 0 && !ids.includes(entitlement)) return "ignore";
  const type = event.type || "";
  if (REVOKE.has(type)) return "revoke";
  if (type === "CANCELLATION") return "cancellation";
  if (GRANT.has(type)) return "grant";
  return "ignore";
}

export function expirationDate(event: RcEvent): Date | null {
  const raw = event.expiration_at_ms;
  const ms = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : Number.NaN;
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

export function targetsFor(event: RcEvent): { grant: string[]; revoke: string[] } {
  const action = eventAction(event, entitlementId());
  if (action === "ignore") return { grant: [], revoke: [] };
  if (event.type === "TRANSFER") {
    const grant = stringList(event.transferred_to);
    const revoke = stringList(event.transferred_from);
    if (grant.length === 0 && revoke.length === 0 && typeof event.app_user_id === "string" && event.app_user_id.trim()) {
      return { grant: [event.app_user_id.trim()], revoke: [] };
    }
    return { grant, revoke };
  }
  const id = typeof event.app_user_id === "string" ? event.app_user_id.trim() : "";
  if (!id) return { grant: [], revoke: [] };
  if (action === "revoke") return { grant: [], revoke: [id] };
  return { grant: [id], revoke: [] };
}

async function findAccount(appUserId: string) {
  if (!appUserId || appUserId.length > 200) return null;
  if (/^[a-f0-9]{24}$/i.test(appUserId)) {
    const byId = await Account.findById(appUserId);
    if (byId) return byId;
  }
  return Account.findOne({ revenueCatAppUserId: appUserId });
}

export async function applyRevenueCatEvent(event: RcEvent): Promise<{ stored: boolean; updated: string[] }> {
  const action = eventAction(event, entitlementId());
  if (action === "ignore") return { stored: false, updated: [] };
  const targets = targetsFor(event);
  const expires = expirationDate(event);
  const updated: string[] = [];

  for (const appUserId of targets.revoke) {
    const account = await findAccount(appUserId);
    if (!account) continue;
    account.entitlement = "free";
    account.entitlementExpiresAt = expires ?? new Date();
    account.revenueCatAppUserId = appUserId;
    await account.save();
    updated.push(String(account._id));
  }

  for (const appUserId of targets.grant) {
    const account = await findAccount(appUserId);
    if (!account) continue;
    account.revenueCatAppUserId = appUserId;
    if (action === "cancellation") {
      if (expires) {
        account.entitlementExpiresAt = expires;
        account.entitlement = expires.getTime() > Date.now() ? "pro" : "free";
      }
    } else {
      account.entitlement = "pro";
      account.entitlementExpiresAt = expires;
    }
    await account.save();
    updated.push(String(account._id));
  }

  return { stored: updated.length > 0, updated };
}
