import { randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { parsePublicId } from "../alerts/watchInput";
import {
  appleCodeExchangeConfigured,
  appleServiceId,
  authConfigured,
  authSecret,
  authStatus,
  emailAuthConfigured,
  googleRedirectConfigured,
  googleWebClientId,
} from "../auth/config";
import { consumeMagicLink, issueMagicLink, normalizeEmailAddress, publicOrigin } from "../auth/email";
import { findOrCreateAccount, type VerifiedIdentity } from "../auth/identity";
import { normalizePem, signEs256Jwt } from "../auth/jwt";
import { krogerCookie, requestAuth } from "../auth/middleware";
import { Account, SavedList } from "../auth/models";
import { accessFor } from "../billing/access";
import { paywallBody } from "../billing/http";
import { withinCap } from "../billing/limits";
import { mergeDeviceIntoAccount, parseMergeBody } from "../auth/merge";
import { ProviderError, verifyAppleIdentity, verifyGoogleIdentity } from "../auth/providers";
import { parseSavedListWrite, readSavedList, writeSavedList } from "../auth/savedList";
import {
  accountSummary,
  clearSessionCookieHeader,
  createSession,
  revokeSession,
  sessionCookieHeader,
} from "../auth/session";
import { newAuthState, returnWithSession, safeReturnTo, signAuthState, verifyAuthState } from "../auth/state";
import { readKrogerOAuthConfig, sealShopperToken, unsealShopperToken } from "../krogerCartAuth";
import { createRateLimiter } from "../lists/sharedList";

const router = Router();
const mailLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000 });

function clientAddress(req: Request): string {
  return (req.ip || req.socket.remoteAddress || "local").slice(0, 80);
}

function displayNameFrom(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim().slice(0, 80);
  return name || undefined;
}

function appleDisplayName(user: unknown): string | undefined {
  if (typeof user !== "string" || !user.trim()) return undefined;
  try {
    const parsed = JSON.parse(user) as { name?: { firstName?: string; lastName?: string } };
    return displayNameFrom([parsed.name?.firstName, parsed.name?.lastName].filter(Boolean).join(" "));
  } catch {
    return undefined;
  }
}

async function issue(res: Response, accountId: string): Promise<string> {
  const token = await createSession(accountId);
  res.append("Set-Cookie", sessionCookieHeader(token));
  return token;
}

async function maybeRestoreKrogerCookie(res: Response, accountId: string): Promise<void> {
  const config = readKrogerOAuthConfig();
  if (!config) return;
  const account = await Account.findById(accountId).select("krogerSealed").lean();
  if (!account?.krogerSealed) return;
  const token = unsealShopperToken(config.clientSecret, account.krogerSealed);
  if (!token) return;
  const sealed = sealShopperToken(config.clientSecret, token);
  const maxAge = token.refreshToken ? 7 * 24 * 60 * 60 : 2400;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `kroger_shopper=${encodeURIComponent(sealed)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
  );
}

async function signIn(req: Request, res: Response, identity: VerifiedIdentity, body: unknown): Promise<void> {
  const parsed = parseMergeBody(body);
  if (parsed.error) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const { account } = await findOrCreateAccount(identity);
  const token = await issue(res, String(account._id));
  const merged = await mergeDeviceIntoAccount(String(account._id), {
    deviceId: parsed.deviceId,
    lists: parsed.lists,
    savedList: parsed.savedList,
    krogerSealed: krogerCookie(req),
  });
  await maybeRestoreKrogerCookie(res, String(account._id));
  res.json({ token, account: await accountSummary(String(account._id)), merged });
}

function redirectUri(req: Request, path: string): string {
  return `${publicOrigin(req)}${path}`;
}

router.get("/auth/status", (_req, res) => {
  res.json(authStatus());
});

router.get("/auth/me", async (_req, res) => {
  const auth = requestAuth(res);
  res.json({ account: auth ? await accountSummary(auth.accountId) : null });
});

router.post("/auth/logout", async (_req, res) => {
  const auth = requestAuth(res);
  await revokeSession(auth?.sessionId);
  res.append("Set-Cookie", clearSessionCookieHeader());
  res.json({ signedOut: true });
});

router.post("/auth/apple", async (req, res) => {
  if (!authStatus().providers.apple.enabled) {
    res.status(503).json({ error: "Sign in with Apple is not configured." });
    return;
  }
  const token = typeof req.body?.identityToken === "string" ? req.body.identityToken : "";
  if (!token) {
    res.status(400).json({ error: "Send the Apple identity token." });
    return;
  }
  try {
    const identity = await verifyAppleIdentity(token, displayNameFrom(req.body?.displayName));
    await signIn(req, res, identity, req.body);
  } catch (error) {
    if (error instanceof ProviderError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : "sign-in failed";
    console.error(`Apple sign-in failed: ${message}`);
    if (!res.headersSent) res.status(500).json({ error: "Sign in with Apple failed. Try again." });
  }
});

router.post("/auth/google", async (req, res) => {
  if (!authStatus().providers.google.enabled) {
    res.status(503).json({ error: "Google sign-in is not configured." });
    return;
  }
  const token = typeof req.body?.idToken === "string" ? req.body.idToken : "";
  if (!token) {
    res.status(400).json({ error: "Send the Google ID token." });
    return;
  }
  try {
    const identity = await verifyGoogleIdentity(token, displayNameFrom(req.body?.displayName));
    await signIn(req, res, identity, req.body);
  } catch (error) {
    if (error instanceof ProviderError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : "sign-in failed";
    console.error(`Google sign-in failed: ${message}`);
    if (!res.headersSent) res.status(500).json({ error: "Google sign-in failed. Try again." });
  }
});

router.post("/auth/merge", async (req, res) => {
  const auth = requestAuth(res);
  if (!auth) {
    res.status(401).json({ error: "Sign in first." });
    return;
  }
  const parsed = parseMergeBody(req.body);
  if (parsed.error) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  try {
    const merged = await mergeDeviceIntoAccount(auth.accountId, {
      deviceId: parsed.deviceId,
      lists: parsed.lists,
      savedList: parsed.savedList,
      krogerSealed: krogerCookie(req),
    });
    await maybeRestoreKrogerCookie(res, auth.accountId);
    res.json({ account: await accountSummary(auth.accountId), merged });
  } catch (error) {
    const message = error instanceof Error ? error.message : "merge failed";
    console.error(`Account merge failed: ${message}`);
    if (!res.headersSent) res.status(500).json({ error: "This device could not be added to the account. Try again." });
  }
});

function startRedirect(req: Request, provider: "apple" | "google"): { state: string } | { error: string } {
  if (!authSecret()) return { error: "Sign-in is not configured." };
  const deviceRaw = req.query.deviceId;
  const deviceId = deviceRaw == null || deviceRaw === "" ? undefined : parsePublicId(deviceRaw) ?? undefined;
  if (deviceRaw != null && deviceRaw !== "" && !deviceId) return { error: "deviceId is not valid." };
  const state = signAuthState(
    newAuthState({
      provider,
      returnTo: safeReturnTo(req.query.return),
      ...(deviceId ? { deviceId } : {}),
      nonce: randomBytes(16).toString("hex"),
    })
  );
  return { state };
}

router.get("/auth/apple/start", (req, res) => {
  if (!authConfigured() || !authStatus().providers.apple.redirect) {
    res.status(503).json({ error: "Sign in with Apple redirect is not configured." });
    return;
  }
  const started = startRedirect(req, "apple");
  if ("error" in started) {
    res.status(400).json({ error: started.error });
    return;
  }
  const params = new URLSearchParams({
    client_id: appleServiceId(),
    redirect_uri: redirectUri(req, "/api/auth/apple/callback"),
    response_type: "code id_token",
    response_mode: "form_post",
    scope: "name email",
    state: started.state,
  });
  res.redirect(302, `https://appleid.apple.com/auth/authorize?${params.toString()}`);
});

async function exchangeAppleCode(req: Request, code: string): Promise<string> {
  if (!appleCodeExchangeConfigured()) {
    throw new ProviderError("Apple did not return an identity token.", 401);
  }
  const now = Math.floor(Date.now() / 1000);
  const clientSecret = signEs256Jwt(normalizePem(process.env.APPLE_PRIVATE_KEY ?? ""), process.env.APPLE_KEY_ID?.trim() ?? "", {
    iss: process.env.APPLE_TEAM_ID?.trim() ?? "",
    iat: now,
    exp: now + 60 * 60 * 24 * 150,
    aud: "https://appleid.apple.com",
    sub: appleServiceId(),
  });
  const response = await fetch("https://appleid.apple.com/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: appleServiceId(),
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(req, "/api/auth/apple/callback"),
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as { id_token?: string };
  if (!response.ok || !payload.id_token) {
    throw new ProviderError("Apple did not return an identity token.", 401);
  }
  return payload.id_token;
}

router.post("/auth/apple/callback", async (req, res) => {
  const state = verifyAuthState(typeof req.body?.state === "string" ? req.body.state : "");
  if (!state || state.provider !== "apple") {
    res.status(400).send("Sign-in state was not accepted. Start again from Grocery Gitter.");
    return;
  }
  try {
    const posted = typeof req.body?.id_token === "string" ? req.body.id_token : "";
    const identityToken = posted || (typeof req.body?.code === "string" ? await exchangeAppleCode(req, req.body.code) : "");
    if (!identityToken) throw new ProviderError("Apple did not return an identity token.", 401);
    const identity = await verifyAppleIdentity(identityToken, appleDisplayName(req.body?.user));
    const { account } = await findOrCreateAccount(identity);
    const token = await issue(res, String(account._id));
    await mergeDeviceIntoAccount(String(account._id), {
      deviceId: state.deviceId,
      lists: [],
      savedList: null,
      krogerSealed: krogerCookie(req),
    });
    await maybeRestoreKrogerCookie(res, String(account._id));
    res.redirect(302, returnWithSession(state.returnTo, token));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Apple sign-in failed.";
    if (!res.headersSent) res.status(401).send(message);
  }
});

router.get("/auth/google/start", (req, res) => {
  if (!authConfigured() || !authStatus().providers.google.redirect) {
    res.status(503).json({ error: "Google redirect sign-in is not configured." });
    return;
  }
  const started = startRedirect(req, "google");
  if ("error" in started) {
    res.status(400).json({ error: started.error });
    return;
  }
  const params = new URLSearchParams({
    client_id: googleWebClientId(),
    redirect_uri: redirectUri(req, "/api/auth/google/callback"),
    response_type: "code",
    scope: "openid email profile",
    state: started.state,
    prompt: "select_account",
  });
  res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get("/auth/google/callback", async (req, res) => {
  const state = verifyAuthState(typeof req.query.state === "string" ? req.query.state : "");
  if (!state || state.provider !== "google" || !googleRedirectConfigured()) {
    res.status(400).send("Sign-in state was not accepted. Start again from Grocery Gitter.");
    return;
  }
  const code = typeof req.query.code === "string" ? req.query.code : "";
  if (!code) {
    res.status(400).send("Google did not return a sign-in code.");
    return;
  }
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: googleWebClientId(),
        client_secret: process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "",
        redirect_uri: redirectUri(req, "/api/auth/google/callback"),
        grant_type: "authorization_code",
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { id_token?: string };
    if (!response.ok || !payload.id_token) {
      res.status(401).send("Google did not return a sign-in token.");
      return;
    }
    const identity = await verifyGoogleIdentity(payload.id_token);
    const { account } = await findOrCreateAccount(identity);
    const token = await issue(res, String(account._id));
    await mergeDeviceIntoAccount(String(account._id), {
      deviceId: state.deviceId,
      lists: [],
      savedList: null,
      krogerSealed: krogerCookie(req),
    });
    await maybeRestoreKrogerCookie(res, String(account._id));
    res.redirect(302, returnWithSession(state.returnTo, token));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google sign-in failed.";
    if (!res.headersSent) res.status(401).send(message);
  }
});

router.post("/auth/email/start", async (req, res) => {
  if (!authConfigured() || !emailAuthConfigured()) {
    res.status(503).json({ error: "Email sign-in is not configured." });
    return;
  }
  const email = normalizeEmailAddress(req.body?.email);
  if (!email) {
    res.status(400).json({ error: "Enter an email address." });
    return;
  }
  if (!mailLimiter.allow(`email:${email}`, 5) || !mailLimiter.allow(`ip:${clientAddress(req)}`, 20)) {
    res.status(429).json({ error: "Too many sign-in emails. Wait and try again." });
    return;
  }
  try {
    await issueMagicLink(email, safeReturnTo(req.body?.return), publicOrigin(req));
    res.json({ sent: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "email failed";
    console.error(`Magic link failed: ${message}`);
    res.status(502).json({ error: "The sign-in email could not be sent. Try again." });
  }
});

router.get("/auth/email/callback", async (req, res) => {
  if (!authConfigured() || !emailAuthConfigured()) {
    res.status(503).send("Email sign-in is not configured.");
    return;
  }
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const link = await consumeMagicLink(token);
  if (!link) {
    res.status(400).send("This sign-in link is invalid or already used. Request a new one.");
    return;
  }
  try {
    const { account } = await findOrCreateAccount({
      provider: "email",
      subject: link.email,
      email: link.email,
      emailVerified: true,
    });
    const session = await issue(res, String(account._id));
    await maybeRestoreKrogerCookie(res, String(account._id));
    res.redirect(302, returnWithSession(link.returnTo, session));
  } catch (error) {
    const message = error instanceof Error ? error.message : "email sign-in failed";
    console.error(`Email sign-in failed: ${message}`);
    if (!res.headersSent) res.status(500).send("Sign-in could not be finished. Try again.");
  }
});

router.get("/me/list", async (_req, res) => {
  const auth = requestAuth(res);
  if (!auth) {
    res.status(401).json({ error: "Sign in to sync this list." });
    return;
  }
  res.json({ list: await readSavedList(auth.accountId) });
});

router.put("/me/list", async (req, res) => {
  const auth = requestAuth(res);
  if (!auth) {
    res.status(401).json({ error: "Sign in to sync this list." });
    return;
  }
  const parsed = parseSavedListWrite(req.body);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  try {
    const access = await accessFor(res);
    const cap = access.limits.savedLists;
    if (cap !== 0) {
      const count = await SavedList.countDocuments({ accountId: auth.accountId });
      if (count === 0 && !withinCap(count, cap)) {
        res.status(402).json(paywallBody("A saved list is part of Grocery Gitter Pro.", "savedLists"));
        return;
      }
    }
    res.json({ list: await writeSavedList(auth.accountId, parsed) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "list sync failed";
    console.error(`Saved list sync failed: ${message}`);
    if (!res.headersSent) res.status(500).json({ error: "The list could not be saved. Try again." });
  }
});

export default router;
