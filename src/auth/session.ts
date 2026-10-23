import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { Account, AuthSession } from "./models";
import { sha256 } from "./seal";

export const SESSION_COOKIE = "gg_session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export type RequestAuth = {
  accountId: string;
  sessionId: string;
};

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sessionCookieHeader(token: string, maxAgeSeconds = SESSION_MS / 1000, nodeEnv = process.env.NODE_ENV): string {
  const secure = nodeEnv === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function clearSessionCookieHeader(nodeEnv = process.env.NODE_ENV): string {
  const secure = nodeEnv === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function readBearer(req: Request): string | undefined {
  const header = req.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1];
}

export async function createSession(accountId: string, now = Date.now()): Promise<string> {
  const token = newSessionToken();
  await AuthSession.create({
    tokenHash: sha256(token),
    accountId,
    expiresAt: new Date(now + SESSION_MS),
  });
  return token;
}

export async function readSession(token: string | undefined, now = Date.now()): Promise<RequestAuth | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const doc = await AuthSession.findOne({ tokenHash: sha256(token) }).lean();
  if (!doc) return null;
  const expiresAt = doc.expiresAt instanceof Date ? doc.expiresAt.getTime() : 0;
  if (expiresAt <= now) {
    await AuthSession.deleteOne({ _id: doc._id });
    return null;
  }
  return { accountId: String(doc.accountId), sessionId: String(doc._id) };
}

export async function revokeSession(sessionId: string | undefined): Promise<void> {
  if (!sessionId) return;
  await AuthSession.deleteOne({ _id: sessionId });
}

export async function revokeAccountSessions(accountId: string): Promise<void> {
  await AuthSession.deleteMany({ accountId });
}

export function authFrom(res: Response): RequestAuth | undefined {
  const value = res.locals.auth as RequestAuth | undefined;
  if (!value?.accountId) return undefined;
  return value;
}

export async function accountSummary(accountId: string) {
  const account = await Account.findById(accountId).lean();
  if (!account) return null;
  const { AuthIdentity } = await import("./models");
  const identities = await AuthIdentity.find({ accountId }).select("provider").lean();
  return {
    id: String(account._id),
    email: account.email || "",
    displayName: account.displayName || "",
    providers: identities.map((row) => row.provider),
    krogerLinked: Boolean(account.krogerSealed),
  };
}
