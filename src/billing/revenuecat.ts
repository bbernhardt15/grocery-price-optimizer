import { entitlementId, revenueCatSecretApiKey } from "./config";
import { Account } from "../auth/models";
import { isProAccount, type PlanName } from "./entitlement";

export type SubscriberSnapshot = {
  ok: boolean;
  status: number;
  expiresDate?: string | null;
  /** True when the response named the entitlement, including a lifetime (null expiry). */
  present: boolean;
};

type SubscriberFetch = (accountId: string, apiKey: string) => Promise<SubscriberSnapshot>;

let fetcher: SubscriberFetch | null = null;

export function setRevenueCatFetcher(next: SubscriberFetch | null): void {
  fetcher = next;
}

async function fetchSubscriber(accountId: string, apiKey: string): Promise<SubscriberSnapshot> {
  const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(accountId)}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!response.ok) return { ok: false, status: response.status, present: false };
  const body = (await response.json()) as {
    subscriber?: { entitlements?: Record<string, { expires_date?: string | null }> };
  };
  const row = body.subscriber?.entitlements?.[entitlementId()];
  if (!row) return { ok: true, status: response.status, present: false };
  return { ok: true, status: response.status, present: true, expiresDate: row.expires_date ?? null };
}

export async function refreshAccountEntitlement(accountId: string): Promise<{
  refreshed: boolean;
  plan: PlanName;
  pro: boolean;
}> {
  const account = await Account.findById(accountId);
  const current = {
    refreshed: false,
    plan: isProAccount(account) ? ("pro" as const) : ("free" as const),
    pro: isProAccount(account),
  };
  const apiKey = revenueCatSecretApiKey();
  if (!account || !apiKey) return current;
  const snapshot = await (fetcher ?? fetchSubscriber)(accountId, apiKey);
  if (!snapshot.ok) return current;
  if (!snapshot.present) {
    account.entitlement = "free";
    account.entitlementExpiresAt = null;
    account.revenueCatAppUserId = accountId;
    await account.save();
    return { refreshed: true, plan: "free", pro: false };
  }
  const expires =
    snapshot.expiresDate == null || snapshot.expiresDate === ""
      ? null
      : new Date(snapshot.expiresDate);
  const validExpiry = expires != null && Number.isFinite(expires.getTime()) ? expires : null;
  const pro = validExpiry == null || validExpiry.getTime() > Date.now();
  account.entitlement = pro ? "pro" : "free";
  account.entitlementExpiresAt = validExpiry;
  account.revenueCatAppUserId = accountId;
  await account.save();
  return { refreshed: true, plan: pro ? "pro" : "free", pro };
}
