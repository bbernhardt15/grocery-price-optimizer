import { Router } from "express";
import { requestAuth } from "../auth/middleware";
import { accessFor } from "../billing/access";
import {
  MANAGE_LINKS,
  STRIPE_STUB,
  entitlementId,
  publicSdkKeys,
  revenueCatWebhookSecret,
} from "../billing/config";
import { freeLimits, proLimits } from "../billing/limits";
import { refreshAccountEntitlement } from "../billing/revenuecat";
import { applyRevenueCatEvent, presentedSecret, readRevenueCatEvent, secretsEqual } from "../billing/webhook";

const router = Router();

router.get("/billing/status", async (_req, res) => {
  try {
    const access = await accessFor(res);
    res.json({
      enforced: access.enforced,
      plan: access.plan,
      pro: access.pro,
      limits: access.limits,
      plans: { free: freeLimits(), pro: proLimits() },
      keys: publicSdkKeys(),
      entitlementId: entitlementId(),
      manage: MANAGE_LINKS,
      stripe: STRIPE_STUB,
      terms: "/terms",
      privacy: "/privacy",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "status failed";
    console.error(`Billing status failed: ${message}`);
    if (!res.headersSent) res.status(500).json({ error: "The plan could not be loaded." });
  }
});

router.post("/billing/refresh", async (req, res) => {
  const auth = requestAuth(res);
  if (!auth) {
    res.status(401).json({ error: "Sign in to refresh a subscription." });
    return;
  }
  try {
    const result = await refreshAccountEntitlement(auth.accountId);
    res.locals.billingAccess = undefined;
    const fresh = await accessFor(res);
    res.json({
      refreshed: result.refreshed,
      plan: fresh.plan,
      pro: fresh.pro,
      enforced: fresh.enforced,
      limits: fresh.limits,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "refresh failed";
    console.error(`Billing refresh failed: ${message}`);
    if (!res.headersSent) res.status(500).json({ error: "The subscription could not be refreshed." });
  }
});

router.post("/billing/revenuecat", async (req, res) => {
  const expected = revenueCatWebhookSecret();
  if (!expected) {
    res.status(503).json({ error: "RevenueCat is not configured." });
    return;
  }
  if (!secretsEqual(presentedSecret(req.header("authorization")), expected)) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  const event = readRevenueCatEvent(req.body);
  if (!event) {
    res.status(400).json({ error: "Send a RevenueCat event." });
    return;
  }
  try {
    const result = await applyRevenueCatEvent(event);
    res.json({ stored: result.stored });
  } catch (error) {
    const message = error instanceof Error ? error.message : "webhook failed";
    console.error(`RevenueCat webhook failed: ${message}`);
    if (!res.headersSent) res.status(500).json({ error: "The entitlement could not be stored." });
  }
});

export default router;
