import { createPrivateKey, createPublicKey, sign, verify, type JsonWebKey, type KeyObject } from "node:crypto";

type Json = Record<string, unknown>;

type Jwk = Json & { kid?: string; kty?: string };

const jwksCache = new Map<string, { expiresAt: number; keys: Jwk[] }>();

function encode(value: Json | Buffer): string {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
  return buffer.toString("base64url");
}

function decodeJson(segment: string): Json {
  const parsed = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Token payload is not an object.");
  }
  return parsed as Json;
}

export function normalizePem(value: string): string {
  return value.trim().replace(/\\n/g, "\n");
}

/** ES256 client secret for Apple's token endpoint. The PEM is the Sign in with Apple key. */
export function signEs256Jwt(privateKeyPem: string, kid: string, payload: Json): string {
  const header = { alg: "ES256", kid, typ: "JWT" };
  const signingInput = `${encode(header)}.${encode(payload)}`;
  const key = createPrivateKey(normalizePem(privateKeyPem));
  const signature = sign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${encode(signature)}`;
}

async function fetchJwks(url: string, now = Date.now()): Promise<Jwk[]> {
  const cached = jwksCache.get(url);
  if (cached && cached.expiresAt > now) return cached.keys;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load signing keys (${response.status}).`);
  }
  const body = (await response.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache.set(url, { keys, expiresAt: now + 60 * 60 * 1000 });
  return keys;
}

export function clearJwksCache(): void {
  jwksCache.clear();
}

function audienceMatches(audience: unknown, allowed: readonly string[]): boolean {
  const values = Array.isArray(audience) ? audience : [audience];
  return values.some((value) => typeof value === "string" && allowed.includes(value));
}

export async function verifyRs256Jwt(
  token: string,
  jwksUrl: string,
  options: { issuer: string | readonly string[]; audience: readonly string[]; now?: number }
): Promise<Json> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new Error("Token is not a signed JWT.");
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
  const header = decodeJson(encodedHeader);
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new Error("Token must be RS256 with a key id.");
  }
  const keys = await fetchJwks(jwksUrl, options.now);
  const jwk = keys.find((key) => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) {
    throw new Error("No signing key matched this token.");
  }
  let key: KeyObject;
  try {
    key = createPublicKey({ key: jwk as JsonWebKey, format: "jwk" });
  } catch {
    throw new Error("Signing key could not be read.");
  }
  const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`);
  const signature = Buffer.from(encodedSignature, "base64url");
  const valid = verify("RSA-SHA256", signingInput, key, signature);
  if (!valid) {
    throw new Error("Token signature did not verify.");
  }
  const payload = decodeJson(encodedPayload);
  const issuers = Array.isArray(options.issuer) ? options.issuer : [options.issuer];
  if (typeof payload.iss !== "string" || !issuers.includes(payload.iss)) {
    throw new Error("Token issuer was not accepted.");
  }
  if (!audienceMatches(payload.aud, options.audience)) {
    throw new Error("Token audience was not accepted.");
  }
  const now = Math.floor((options.now ?? Date.now()) / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) {
    throw new Error("Token is expired.");
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("Token has no subject.");
  }
  return payload;
}
