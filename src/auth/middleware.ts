import type { NextFunction, Request, Response } from "express";
import { readRequestCookie, KROGER_SHOPPER_COOKIE } from "../krogerCartAuth";
import { authConfigured } from "./config";
import { readBearer, readSession, SESSION_COOKIE, type RequestAuth } from "./session";

export async function attachAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!authConfigured()) {
    next();
    return;
  }
  const token = readBearer(req) || readRequestCookie(req.headers.cookie, SESSION_COOKIE);
  if (!token) {
    next();
    return;
  }
  try {
    const auth = await readSession(token);
    if (auth) res.locals.auth = auth;
  } catch (error) {
    const message = error instanceof Error ? error.message : "session lookup failed";
    console.error(`Session lookup failed: ${message}`);
  }
  next();
}

export function requestAuth(res: Response): RequestAuth | undefined {
  const value = res.locals.auth as RequestAuth | undefined;
  return value?.accountId ? value : undefined;
}

export function krogerCookie(req: Request): string | undefined {
  return readRequestCookie(req.headers.cookie, KROGER_SHOPPER_COOKIE);
}
