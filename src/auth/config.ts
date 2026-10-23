/**
 * Sign-in stays off until AUTH_SECRET is set and at least one provider is set.
 * A missing provider is skipped. Nothing here is required for guest mode.
 */

export type AuthProviderName = "apple" | "google" | "email";

function trimmed(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function splitCsv(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of value.split(",")) {
    const item = part.trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

export function authSecret(): string {
  return trimmed("AUTH_SECRET");
}

export function authConfigured(): boolean {
  return authSecret().length > 0 && (appleAuthConfigured() || googleAuthConfigured() || emailAuthConfigured());
}

/** Audiences accepted on an Apple identity token. The bundle id is included so the native app token verifies. */
export function appleAudiences(): string[] {
  const clients = splitCsv(trimmed("APPLE_CLIENT_ID"));
  if (clients.length === 0) return [];
  const bundle = trimmed("APPLE_BUNDLE_ID") || "app.grocerygitter";
  return splitCsv([...clients, bundle].join(","));
}

export function appleServiceId(): string {
  return splitCsv(trimmed("APPLE_CLIENT_ID"))[0] ?? "";
}

/**
 * The redirect flow verifies the identity token Apple posts back.
 * Team id, key id, and the private key are only needed when that token is
 * missing and the authorization code has to be exchanged.
 */
export function appleRedirectConfigured(): boolean {
  return Boolean(appleServiceId());
}

export function appleCodeExchangeConfigured(): boolean {
  return Boolean(appleServiceId() && trimmed("APPLE_TEAM_ID") && trimmed("APPLE_KEY_ID") && trimmed("APPLE_PRIVATE_KEY"));
}

export function appleAuthConfigured(): boolean {
  return appleAudiences().length > 0;
}

export function googleAudiences(): string[] {
  return splitCsv(trimmed("GOOGLE_CLIENT_ID"));
}

export function googleWebClientId(): string {
  return trimmed("GOOGLE_WEB_CLIENT_ID") || googleAudiences()[0] || "";
}

export function googleRedirectConfigured(): boolean {
  return Boolean(googleWebClientId() && trimmed("GOOGLE_CLIENT_SECRET"));
}

export function googleAuthConfigured(): boolean {
  return googleAudiences().length > 0;
}

export function emailAuthConfigured(): boolean {
  return Boolean(trimmed("RESEND_API_KEY") && trimmed("AUTH_EMAIL_FROM"));
}

export function authStatus() {
  const apple = appleAuthConfigured();
  const google = googleAuthConfigured();
  const email = emailAuthConfigured();
  return {
    enabled: authSecret().length > 0 && (apple || google || email),
    providers: {
      apple: {
        enabled: apple && authSecret().length > 0,
        clientId: apple ? appleServiceId() : "",
        redirect: appleRedirectConfigured() && authSecret().length > 0,
      },
      google: {
        enabled: google && authSecret().length > 0,
        clientId: google && authSecret().length > 0 ? googleWebClientId() : "",
        redirect: googleRedirectConfigured() && authSecret().length > 0,
      },
      email: {
        enabled: email && authSecret().length > 0,
      },
    },
  };
}

/** Test tokens are refused unless this is set. Never set it on Railway. */
export function testTokensAllowed(): boolean {
  return process.env.AUTH_ALLOW_TEST_TOKENS === "1";
}
