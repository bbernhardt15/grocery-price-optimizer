import { createHmac, timingSafeEqual } from "node:crypto";
import { authSecret } from "./config";

export type AuthState = {
  v: 1;
  provider: "apple" | "google";
  exp: number;
  returnTo: string;
  deviceId?: string;
  nonce: string;
};

const STATE_TTL_MS = 10 * 60 * 1000;

function sign(body: string): string {
  return createHmac("sha256", authSecret()).update(body).digest("base64url");
}

export function signAuthState(state: AuthState): string {
  const body = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyAuthState(token: string, now = Date.now()): AuthState | null {
  const secret = authSecret();
  if (!secret) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(body);
  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AuthState;
    if (parsed.v !== 1 || (parsed.provider !== "apple" && parsed.provider !== "google")) return null;
    if (typeof parsed.exp !== "number" || parsed.exp <= now) return null;
    if (typeof parsed.returnTo !== "string" || typeof parsed.nonce !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Relative paths stay on this site. The Capacitor shells may return to
 * capacitor://localhost (iOS) or https://localhost (Android). Anything else
 * is replaced so the redirect cannot leave the app.
 */
export function safeReturnTo(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 300) return fallback;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return value;
  // Node's URL parser does not treat capacitor:// as a host-bearing scheme.
  if (value.startsWith("capacitor://localhost")) return "capacitor://localhost/";
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && url.hostname === "localhost") return "https://localhost/";
  } catch {
    return fallback;
  }
  return fallback;
}

export function returnWithSession(returnTo: string, sessionToken: string): string {
  const safe = safeReturnTo(returnTo);
  if (safe.startsWith("capacitor://")) {
    return `capacitor://localhost/?session=${encodeURIComponent(sessionToken)}`;
  }
  if (safe.startsWith("/")) {
    const join = safe.includes("?") ? "&" : "?";
    return `${safe}${join}session=${encodeURIComponent(sessionToken)}`;
  }
  const url = new URL(safe);
  url.searchParams.set("session", sessionToken);
  return url.toString();
}

export function newAuthState(input: {
  provider: "apple" | "google";
  returnTo: string;
  deviceId?: string;
  nonce: string;
  now?: number;
}): AuthState {
  return {
    v: 1,
    provider: input.provider,
    exp: (input.now ?? Date.now()) + STATE_TTL_MS,
    returnTo: safeReturnTo(input.returnTo),
    ...(input.deviceId ? { deviceId: input.deviceId } : {}),
    nonce: input.nonce,
  };
}
