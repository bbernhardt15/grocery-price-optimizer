import type { NextFunction, Request, Response } from "express";
import { currentInviteCode, deviceIdFromRequest, inviteCodes } from "./service";

/**
 * Routes the shopper app can call before a code is stored, plus browser hops
 * and webhooks that cannot send this device's id.
 * Everything else under /api is refused while BETA_INVITE_CODES is set.
 */
export function betaGateOpen(method: string, path: string): boolean {
  const verb = method.toUpperCase();
  const clean = path.length > 1 ? path.replace(/\/+$/, "") : path;
  if (!clean.startsWith("/api")) return true;
  if (verb === "GET" && clean === "/api/health/ready") return true;
  if (verb === "GET" && clean === "/api/version") return true;
  if (verb === "GET" && clean === "/api/observability") return true;
  if (verb === "GET" && clean === "/api/catalog/placeholder.svg") return true;
  if (verb === "GET" && clean === "/api/beta/gate") return true;
  if (verb === "POST" && clean === "/api/beta/invite") return true;
  if (clean.startsWith("/api/admin/")) return true;
  if (verb === "POST" && clean === "/api/billing/revenuecat") return true;
  if (verb === "GET" && clean === "/api/kroger/logout") return true;
  if (verb === "GET" && (clean === "/api/kroger/oauth/authorize" || clean === "/api/kroger/oauth/callback")) return true;
  if (clean === "/api/auth/apple/callback" || clean === "/api/auth/google/callback" || clean === "/api/auth/email/callback") {
    return true;
  }
  if (verb === "DELETE" && clean === "/api/me/data") return true;
  return false;
}

export async function enforceBetaInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
  // The shopper-facing invite step is retired. Shopper APIs stay open.
  // Admin routes keep their own token check and never rely on this code.
  if (!inviteCodes().length || betaGateOpen(req.method, req.path) || !req.path.startsWith("/api/admin")) {
    next();
    return;
  }
  try {
    const code = await currentInviteCode(deviceIdFromRequest(req));
    if (code) {
      next();
      return;
    }
  } catch {
    res.setHeader("Cache-Control", "no-store");
    res.status(503).json({ error: "Invite check is unavailable." });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.status(401).json({ error: "Enter your invite code." });
}
