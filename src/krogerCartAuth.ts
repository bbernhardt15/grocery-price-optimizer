import { randomBytes } from "node:crypto";

const KROGER_API_BASE = "https://api.kroger.com/v1";
const AUTHORIZE_ENDPOINT = `${KROGER_API_BASE}/connect/oauth2/authorize`;
const TOKEN_ENDPOINT = `${KROGER_API_BASE}/connect/oauth2/token`;
const CART_ADD_ENDPOINT = `${KROGER_API_BASE}/cart/add`;

export const KROGER_SHOPPER_COOKIE = "kroger_shopper";
export const DEFAULT_CART_SCOPE = "cart.basic:write";
export const DEFAULT_CART_MODALITY = "PICKUP";

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

export function newOAuthState(): string {
  return randomBytes(24).toString("hex");
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

function basicAuth(config: KrogerOAuthConfig): string {
  return Buffer.from(`${config.clientId}:${config.clientSecret}`).toString(
    "base64"
  );
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

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth(config)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
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

  const lifetimeMs = Math.max((payload.expires_in ?? 1800) - 60, 30) * 1000;
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAtMs: Date.now() + lifetimeMs,
  };
}

export type CartAddResult =
  | { ok: true; status: number; added: number }
  | { ok: false; status: number; added: 0; error: string };

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
      },
      body: JSON.stringify({ items }),
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

  if (!response.ok) {
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

  return { ok: true, status: response.status, added: items.length };
}

export function toCartLines(
  items: Array<{
    upc?: string;
    productId?: string;
    quantity?: number;
  }>,
  modality = DEFAULT_CART_MODALITY
): KrogerCartLine[] {
  const lines: KrogerCartLine[] = [];
  for (const item of items) {
    const upc = (item.upc || item.productId || "").trim();
    if (!upc) {
      continue;
    }
    const quantity =
      typeof item.quantity === "number" && Number.isFinite(item.quantity)
        ? Math.max(1, Math.floor(item.quantity))
        : 1;
    lines.push({ upc, quantity, modality });
  }
  return lines;
}

const PENDING_TTL_MS = 15 * 60 * 1000;

/**
 * In-memory pending carts + shopper tokens for a single Node process.
 * Production with multiple instances would need Redis; Phase 1 keeps this
 * local so we do not persist shopper tokens on disk.
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
