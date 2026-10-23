import type { Response } from "express";
import { Account } from "../auth/models";
import { requestAuth } from "../auth/middleware";
import { billingEnforced } from "./config";
import { isProAccount, type PlanName } from "./entitlement";
import { limitsFor, OPEN_LIMITS, type PlanLimits } from "./limits";

export type Access = {
  enforced: boolean;
  plan: PlanName;
  pro: boolean;
  limits: PlanLimits;
};

export async function accessFor(res: Response): Promise<Access> {
  const cached = res.locals.billingAccess as Access | undefined;
  if (cached) return cached;
  const enforced = billingEnforced();
  let storedPro = false;
  const auth = requestAuth(res);
  if (auth) {
    const account = await Account.findById(auth.accountId).select("entitlement entitlementExpiresAt").lean();
    storedPro = isProAccount(account);
  }
  const plan: PlanName = storedPro ? "pro" : "free";
  const access: Access = {
    enforced,
    plan,
    pro: storedPro,
    limits: enforced ? limitsFor(plan) : OPEN_LIMITS,
  };
  res.locals.billingAccess = access;
  return access;
}
