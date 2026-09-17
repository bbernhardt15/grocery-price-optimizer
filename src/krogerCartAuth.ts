import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const KROGER_API_BASE = "https://api.kroger.com/v1";
const AUTHORIZE_ENDPOINT = `${KROGER_API_BASE}/connect/oauth2/authorize`;
const TOKEN_ENDPOINT = `${KROGER_API_BASE}/connect/oauth2/token`;
const CART_ADD_ENDPOINT = `${KROGER_API_BASE}/cart/add`;

export const KROGER_SHOPPER_COOKIE = "kroger_shopper";
export const DEFAULT_CART_SCOPE = "cart.basic:write";
export const DEFAULT_CART_MODALITY = "PICKUP";
export const PENDING_TTL_MS = 15 * 60 * 1000;
const KROGER_CART_USER_AGENT = "GroceryGitter/1.0";

export type KrogerOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
};

export type KrogerCartLine = {
  upc: string;
  quantity: number;
  modality: string;
  name?: string;
};

export type ShopperToken = {
  accessToken: string;
  refreshToken?: string;
  expiresAtMs: number;
};

export type PendingKrogerCart = {
  items: KrogerCartLine[];
  locationId?: string;
  createdAtMs: number;
};

export type SignedCartState = {
  v: 1;
  nonce: string;
  exp: number;
  items: KrogerCartLine[];
  locationId?: string;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

/**
 * Cart writes need the *shopper* to complete authorization-code OAuth.
 * The KROGER_CLIENT_ID/SECRET already used for Products/Locations
 * (client-credentials, product.compact) cannot call PUT /v1/cart/add.
 */
export function readKrogerOAuthConfig(): KrogerOAuthConfig | null {
  const clientId = process.env.KROGER_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.KROGER_CLIENT_SECRET?.trim() ?? "";
  const redirectUri = process.env.KROGER_REDIRECT_URI?.trim() ?? "";
  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    scope: process.env.KROGER_CART_SCOPE?.trim() || DEFAULT_CART_SCOPE,
  };
}

export function isKrogerCartOAuthConfigured(): boolean {
  return readKrogerOAuthConfig() !== null;
}

export function readCartModality(): string {
  const value = process.env.KROGER_CART_MODALITY?.trim().toUpperCase() ?? "";
  if (value === "PICKUP" || value === "DELIVERY") {
    return value;
  }
  return DEFAULT_CART_MODALITY;
}

export function newOAuthState(): string {
  return randomBytes(24).toString("hex");
}

/**
 * Kroger Cart API expects a 13-digit UPC. Live Products `productId` values
 * are usually already that shape; shorter numeric ids are left-padded.
 */
export function normalizeKrogerUpc(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8) {
    return undefined;
  }
  if (digits.length <= 13) {
    return digits.padStart(13, "0");
  }
  return digits;
}

export function buildKrogerAuthorizeUrl(
  config: KrogerOAuthConfig,
  state: string
): string {
  const params = new URLSearchParams({
    scope: config.scope,
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
  });
  return `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

function hmacKey(secret: string, purpose: string): Buffer {
  return createHmac("sha256", secret).update(purpose).digest();
}

function signPayload(secret: string, encodedBody: string): string {
  return createHmac("sha256", hmacKey(secret, "kroger-oauth-state"))
    .update(encodedBody)
    .digest("base64url");
}

/**
 * Signed OAuth `state` so Railway can round-trip the pending cart across
 * instances without storing shopper tokens or relying on in-memory maps.
 */
export function signCartState(
  config: KrogerOAuthConfig,
  cart: Omit<PendingKrogerCart, "createdAtMs">,
  nowMs = Date.now()
): string {
  const payload: SignedCartState = {
    v: 1,
    nonce: randomBytes(12).toString("hex"),
    exp: nowMs + PENDING_TTL_MS,
    items: cart.items,
    ...(cart.locationId ? { locationId: cart.locationId } : {}),
  };
  const encodedBody = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedBody}.${signPayload(config.clientSecret, encodedBody)}`;
}

export function verifyCartState(
  config: KrogerOAuthConfig,
  state: string,
  nowMs = Date.now()
): SignedCartState | null {
  const dot = state.lastIndexOf(".");
  if (dot <= 0) {
    return null;
  }
  const encodedBody = state.slice(0, dot);
  const signature = state.slice(dot + 1);
  if (!encodedBody || !signature) {
    return null;
  }

  const expected = signPayload(config.clientSecret, encodedBody);
  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (
    actualBuf.length !== expectedBuf.length ||
    !timingSafeEqual(actualBuf, expectedBuf)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encodedBody, "base64url").toString("utf8")
    ) as SignedCartState;
    if (parsed.v !== 1 || !Array.isArray(parsed.items) || parsed.items.length === 0) {
      return null;
    }
    if (typeof parsed.exp !== "number" || parsed.exp <= nowMs) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function basicAuth(config: KrogerOAuthConfig): string {
  return Buffer.from(`${config.clientId}:${config.clientSecret}`).toString(
    "base64"
  );
}

function tokenHeaders(config: KrogerOAuthConfig): Record<string, string> {
  return {
    Authorization: `Basic ${basicAuth(config)}`,
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
    "User-Agent": KROGER_CART_USER_AGENT,
  };
}

function shopperTokenFromPayload(payload: TokenResponse): ShopperToken {
  const lifetimeMs = Math.max((payload.expires_in ?? 1800) - 60, 30) * 1000;
  return {
    accessToken: payload.access_token as string,
    refreshToken: payload.refresh_token,
    expiresAtMs: Date.now() + lifetimeMs,
  };
}

async function postKrogerToken(
  config: KrogerOAuthConfig,
  body: URLSearchParams
): Promise<ShopperToken> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: tokenHeaders(config),
    body,
  });

  const payload = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description ||
        payload.error ||
        `Kroger authorization-code exchange failed (${response.status})`
    );
  }

  return shopperTokenFromPayload(payload);
}

export async function exchangeAuthorizationCode(
  config: KrogerOAuthConfig,
  code: string
): Promise<ShopperToken> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  });
  return postKrogerToken(config, body);
}

export async function refreshShopperToken(
  config: KrogerOAuthConfig,
  refreshToken: string
): Promise<ShopperToken> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return postKrogerToken(config, body);
}

export type CartAddResult =
  | { ok: true; status: number; added: number }
  | { ok: false; status: number; added: 0; error: string };

/**
 * Body sent to PUT https://api.kroger.com/v1/cart/add.
 * Extra fields (item names used for fallback search links) are stripped so
 * Kroger only receives upc / quantity / modality.
 */
export function cartAddPayload(items: KrogerCartLine[]): {
  items: Array<{ upc: string; quantity: number; modality: string }>;
} {
  return {
    items: items.map((item) => ({
      upc: item.upc,
      quantity: item.quantity,
      modality: item.modality,
    })),
  };
}

/**
 * PUT https://api.kroger.com/v1/cart/add
 * Requires a shopper access token with cart.basic:write (not client-credentials).
 * Returns ok only when Kroger acknowledges the write. Never invents success.
 */
export async function addItemsToKrogerCart(
  accessToken: string,
  items: KrogerCartLine[]
): Promise<CartAddResult> {
  if (items.length === 0) {
    return {
      ok: false,
      status: 400,
      added: 0,
      error: "No Kroger items with a UPC to add.",
    };
  }

  let response: Response;
  try {
    response = await fetch(CART_ADD_ENDPOINT, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": KROGER_CART_USER_AGENT,
      },
      body: JSON.stringify(cartAddPayload(items)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      status: 0,
      added: 0,
      error: `Kroger Cart API unavailable (${message})`,
    };
  }

  if (response.status < 200 || response.status >= 300) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      error_description?: string;
      message?: string;
    };
    const error =
      payload.error_description ||
      payload.message ||
      payload.error ||
      `Kroger cart add failed (${response.status})`;
    return { ok: false, status: response.status, added: 0, error };
  }

  return { ok: true, status: response.status, added: items.reduce((sum, item) => sum + item.quantity, 0) };
}

export function toCartLines(
  items: Array<{
    upc?: string;
    productId?: string;
    quantity?: number;
    name?: string;
  }>,
  modality = readCartModality()
): KrogerCartLine[] {
  const lines: KrogerCartLine[] = [];
  for (const item of items) {
    const upc = normalizeKrogerUpc(item.upc || item.productId);
    if (!upc) {
      continue;
    }
    const quantity =
      typeof item.quantity === "number" && Number.isFinite(item.quantity)
        ? Math.max(1, Math.floor(item.quantity))
        : 1;
    const name = item.name?.trim();
    lines.push({
      upc,
      quantity,
      modality,
      ...(name ? { name } : {}),
    });
  }
  return lines;
}

function cookieEncryptionKey(secret: string): Buffer {
  return hmacKey(secret, "kroger-shopper-cookie");
}

/** Encrypt the shopper token into an HttpOnly cookie (not written to disk). */
export function sealShopperToken(
  clientSecret: string,
  token: ShopperToken
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cookieEncryptionKey(clientSecret), iv);
  const plaintext = Buffer.from(JSON.stringify(token), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function unsealShopperToken(
  clientSecret: string,
  sealed: string,
  nowMs = Date.now()
): ShopperToken | undefined {
  try {
    const buf = Buffer.from(sealed, "base64url");
    if (buf.length < 29) {
      return undefined;
    }
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      cookieEncryptionKey(clientSecret),
      iv
    );
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    const token = JSON.parse(plaintext.toString("utf8")) as ShopperToken;
    if (!token.accessToken || typeof token.expiresAtMs !== "number") {
      return undefined;
    }
    if (nowMs >= token.expiresAtMs && !token.refreshToken) {
      return undefined;
    }
    return token;
  } catch {
    return undefined;
  }
}

export async function shopperTokenForRequest(
  config: KrogerOAuthConfig,
  sealedCookie: string | undefined
): Promise<ShopperToken | undefined> {
  if (!sealedCookie) {
    return undefined;
  }
  const token = unsealShopperToken(config.clientSecret, sealedCookie);
  if (!token) {
    return undefined;
  }
  if (Date.now() < token.expiresAtMs) {
    return token;
  }
  if (!token.refreshToken) {
    return undefined;
  }
  try {
    return await refreshShopperToken(config, token.refreshToken);
  } catch {
    return undefined;
  }
}

/**
 * In-memory pending carts as a same-process cache. Production uses the
 * HMAC-signed OAuth state so a different Railway instance can finish the
 * callback. Shopper tokens live only in the encrypted cookie.
 */
export class KrogerCartSessionStore {
  private readonly pending = new Map<string, PendingKrogerCart>();
  private readonly shoppers = new Map<string, ShopperToken>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  savePending(state: string, cart: Omit<PendingKrogerCart, "createdAtMs">): void {
    this.pending.set(state, { ...cart, createdAtMs: this.now() });
  }

  takePending(state: string): PendingKrogerCart | undefined {
    const cart = this.pending.get(state);
    this.pending.delete(state);
    if (!cart) {
      return undefined;
    }
    if (this.now() - cart.createdAtMs > PENDING_TTL_MS) {
      return undefined;
    }
    return cart;
  }

  saveShopper(sessionId: string, token: ShopperToken): void {
    this.shoppers.set(sessionId, token);
  }

  getShopper(sessionId: string): ShopperToken | undefined {
    const token = this.shoppers.get(sessionId);
    if (!token) {
      return undefined;
    }
    if (this.now() >= token.expiresAtMs) {
      this.shoppers.delete(sessionId);
      return undefined;
    }
    return token;
  }
}

export const krogerCartSessions = new KrogerCartSessionStore();
