export type PlanName = "free" | "pro";

export function isProAccount(
  account: { entitlement?: string | null; entitlementExpiresAt?: Date | string | null } | null | undefined
): boolean {
  if (!account || account.entitlement !== "pro") return false;
  if (account.entitlementExpiresAt == null) return true;
  const time = new Date(account.entitlementExpiresAt).getTime();
  if (!Number.isFinite(time)) return true;
  return time > Date.now();
}
