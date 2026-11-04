import { timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

/** Beta admin routes accept the same headers as the other admin routes. */
export function betaAdminTokens(env: NodeJS.ProcessEnv = process.env): string[] {
  return [env.GG_ADMIN_TOKEN, env.ADMIN_TOKEN].map((value) => value?.trim() || "").filter(Boolean);
}

export function betaAdminOk(req: Request, res: Response): boolean {
  const expected = betaAdminTokens();
  if (!expected.length) {
    res.status(503).json({ error: "Set GG_ADMIN_TOKEN to read beta feedback." });
    return false;
  }
  const header = req.header("authorization") ?? req.header("x-admin-token") ?? "";
  const presented = header.replace(/^Bearer\s+/i, "").trim();
  const ok = expected.some((token) => {
    const left = Buffer.from(presented);
    const right = Buffer.from(token);
    return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
  });
  if (!ok) {
    res.status(401).json({ error: "Admin token required." });
    return false;
  }
  return true;
}
