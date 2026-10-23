import type { NextFunction, Request, Response } from "express";
import { accessFor } from "./access";
import { paywallBody } from "./http";

export type BooleanFeature = "priceAlerts" | "multiStore" | "cartHandoffs";

/**
 * When `REVENUECAT_WEBHOOK_SECRET` is unset, calls next().
 * When it is set, calls next() only if the signed-in account has an active `pro` entitlement.
 * Otherwise responds 402. Feature routes use `blockUnlessFeature` so a free-tier flag can still allow one feature.
 */
export async function requirePro(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const access = await accessFor(res);
    if (!access.enforced || access.pro) {
      next();
      return;
    }
    const message =
      typeof res.locals.proMessage === "string" && res.locals.proMessage
        ? res.locals.proMessage
        : "Grocery Gitter Pro is required.";
    const feature = typeof res.locals.proFeature === "string" ? res.locals.proFeature : undefined;
    if (!res.headersSent) res.status(402).json(paywallBody(message, feature));
  } catch (error) {
    next(error);
  }
}

/** Returns true when the response is already finished and the route should stop. */
export async function blockUnlessFeature(
  req: Request,
  res: Response,
  feature: BooleanFeature,
  message: string
): Promise<boolean> {
  const access = await accessFor(res);
  if (access.limits[feature]) return false;
  res.locals.proMessage = message;
  res.locals.proFeature = feature;
  let passed = false;
  await requirePro(req, res, () => {
    passed = true;
  });
  return !passed;
}
