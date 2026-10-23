/**
 * Strip emails, tokens, and Kroger auth material before anything is sent to Sentry.
 * Pure string/object walks so the server and the browser bundle share one implementation.
 */

const SENSITIVE_KEY =
  /email|e-mail|token|authorization|cookie|secret|password|api[-_]?key|credential|session|kroger|ip_address|ipaddress/i;

const QUERY_KEYS = new Set([
  "access_token",
  "refresh_token",
  "id_token",
  "client_secret",
  "api_key",
  "apikey",
  "token",
  "code",
  "state",
  "password",
  "auth",
  "key",
  "signature",
  "kroger_shopper",
]);

const DROP_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-admin-token",
  "x-list-owner",
  "x-api-key",
  "x-auth-token",
]);

const HEADER_KEYS = new Set(["headers", "request_headers", "response_headers"]);
const COOKIE_KEYS = new Set(["cookies", "cookie"]);
const QUERY_CONTAINER_KEYS = new Set(["query_string", "query", "querystring", "search"]);

const MAX_DEPTH = 8;

export function scrubString(value: string): string {
  // Fresh regexes each call. A shared /g pattern keeps lastIndex and skips later matches.
  const authScheme = /\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/gi;
  const jwt = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
  const krogerCookie = /kroger_shopper=[^;\s]*/gi;
  const tokenAssign =
    /(^|[?&#;\s])((?:access_token|refresh_token|id_token|client_secret|api_key|apikey|token|code|state|password|auth|signature)=)[^&#;\s]*/gi;
  const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const emailEncoded = /[A-Z0-9._%+-]+%40[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  return value
    .replace(authScheme, (_match, scheme: string) => `${scheme} [token]`)
    .replace(jwt, "[token]")
    .replace(krogerCookie, "kroger_shopper=[filtered]")
    .replace(tokenAssign, (_match, prefix: string, key: string) => `${prefix}${key}[token]`)
    .replace(email, "[email]")
    .replace(emailEncoded, "[email]");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function scrubHeaders(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const name = key.toLowerCase();
    if (DROP_HEADERS.has(name) || SENSITIVE_KEY.test(key)) continue;
    if (typeof child === "string") out[key] = scrubString(child);
    else if (Array.isArray(child)) {
      out[key] = child.map((item) => (typeof item === "string" ? scrubString(item) : "[filtered]"));
    } else if (child == null) out[key] = child;
    else out[key] = "[filtered]";
  }
  return out;
}

export function scrubQuery(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map((item) => scrubQuery(item, seen));
  if (!isRecord(value)) return value == null ? value : "[filtered]";
  if (seen.has(value)) return "[filtered]";
  seen.add(value);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (QUERY_KEYS.has(key.toLowerCase()) || SENSITIVE_KEY.test(key)) {
      out[key] = "[token]";
      continue;
    }
    out[key] = scrubValue(child, 0, seen);
  }
  return out;
}

export function scrubValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return scrubString(value);
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (depth > MAX_DEPTH) return "[filtered]";
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[filtered]";
    seen.add(value);
    return value.map((item) => scrubValue(item, depth + 1, seen));
  }
  if (!isRecord(value)) return undefined;
  if (seen.has(value)) return "[filtered]";
  seen.add(value);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (lower === "user") continue;
    if (COOKIE_KEYS.has(lower)) continue;
    if (HEADER_KEYS.has(lower)) {
      const headers = scrubHeaders(child);
      if (headers) out[key] = headers;
      continue;
    }
    if (QUERY_CONTAINER_KEYS.has(lower)) {
      out[key] = scrubQuery(child, seen);
      continue;
    }
    if (SENSITIVE_KEY.test(key)) {
      out[key] = "[filtered]";
      continue;
    }
    out[key] = scrubValue(child, depth + 1, seen);
  }
  return out;
}

export function scrubSentryEvent<T>(event: T): T {
  return scrubValue(event, 0, new WeakSet()) as T;
}

export function scrubBreadcrumb<T extends { message?: string; data?: unknown }>(breadcrumb: T): T {
  const next: T = { ...breadcrumb };
  if (typeof next.message === "string") next.message = scrubString(next.message);
  if (next.data !== undefined) next.data = scrubValue(next.data, 0, new WeakSet());
  return next;
}
