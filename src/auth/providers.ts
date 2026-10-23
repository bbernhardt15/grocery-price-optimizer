import { appleAudiences, googleAudiences, testTokensAllowed } from "./config";
import type { VerifiedIdentity } from "./identity";
import { verifyRs256Jwt } from "./jwt";

const APPLE_JWKS = "https://appleid.apple.com/auth/keys";
const GOOGLE_JWKS = "https://www.googleapis.com/oauth2/v3/certs";

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

function readTestIdentity(token: string, provider: "apple" | "google"): VerifiedIdentity | null {
  if (!testTokensAllowed()) return null;
  const parts = token.split(":");
  if (parts.length < 3 || parts[0] !== "test" || parts[1] !== provider) return null;
  const subject = parts[2] ?? "";
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(subject)) return null;
  const email = (parts[3] ?? "").trim().toLowerCase();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  return {
    provider,
    subject,
    ...(validEmail ? { email } : {}),
    emailVerified: validEmail,
  };
}

function emailFromPayload(payload: Record<string, unknown>): { email?: string; emailVerified: boolean } {
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const flag = payload.email_verified;
  const emailVerified = flag === true || flag === "true";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { emailVerified: false };
  return { email, emailVerified };
}

export async function verifyAppleIdentity(token: string, displayName?: string): Promise<VerifiedIdentity> {
  const test = readTestIdentity(token, "apple");
  if (test) return { ...test, ...(displayName ? { displayName } : {}) };
  const audience = appleAudiences();
  if (audience.length === 0) {
    throw new ProviderError("Sign in with Apple is not configured.", 503);
  }
  if (token.length > 8000) throw new ProviderError("Apple token was rejected.", 401);
  try {
    const payload = await verifyRs256Jwt(token, APPLE_JWKS, {
      issuer: "https://appleid.apple.com",
      audience,
    });
    const email = emailFromPayload(payload);
    return {
      provider: "apple",
      subject: String(payload.sub),
      ...email,
      ...(displayName ? { displayName } : {}),
    };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("Apple token was rejected.", 401);
  }
}

export async function verifyGoogleIdentity(token: string, displayName?: string): Promise<VerifiedIdentity> {
  const test = readTestIdentity(token, "google");
  if (test) return { ...test, ...(displayName ? { displayName } : {}) };
  const audience = googleAudiences();
  if (audience.length === 0) {
    throw new ProviderError("Google sign-in is not configured.", 503);
  }
  if (token.length > 8000) throw new ProviderError("Google token was rejected.", 401);
  try {
    const payload = await verifyRs256Jwt(token, GOOGLE_JWKS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience,
    });
    const email = emailFromPayload(payload);
    const name = displayName || (typeof payload.name === "string" ? payload.name.slice(0, 80) : "");
    return {
      provider: "google",
      subject: String(payload.sub),
      ...email,
      ...(name ? { displayName: name } : {}),
    };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("Google token was rejected.", 401);
  }
}
