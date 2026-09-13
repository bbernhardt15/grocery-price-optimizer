const KROGER_API_BASE = "https://api.kroger.com/v1";
const TOKEN_ENDPOINT = `${KROGER_API_BASE}/connect/oauth2/token`;
const LOCATIONS_ENDPOINT = `${KROGER_API_BASE}/locations`;

/** Catalog location used when Kroger API credentials are not configured. */
export const DEMO_KROGER_LOCATION_ID = "01400441";

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type KrogerLocation = {
  locationId?: string;
};

type LocationsResponse = {
  data?: KrogerLocation[];
};

function readCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.KROGER_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.KROGER_CLIENT_SECRET?.trim() ?? "";

  if (!clientId || !clientSecret) {
    throw new Error(
      "Kroger API credentials are missing. Set KROGER_CLIENT_ID and KROGER_CLIENT_SECRET."
    );
  }

  return { clientId, clientSecret };
}

function demoLocationId(): string {
  return process.env.KROGER_MOCK_LOCATION_ID?.trim() || DEMO_KROGER_LOCATION_ID;
}

function normalizeZip(zipCode: string): string {
  const zip = zipCode.trim();
  if (!/^\d{5}(?:-\d{4})?$/.test(zip)) {
    throw new Error(`Invalid ZIP code: ${zipCode}`);
  }

  return zip.slice(0, 5);
}

/**
 * Client for Kroger's public Locations API (api.kroger.com).
 * Tokens are fetched once via client-credentials and reused until they expire.
 */
export class KrogerService {
  private accessToken: string | null = null;
  private tokenExpiresAtMs = 0;

  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && now < this.tokenExpiresAtMs) {
      return this.accessToken;
    }

    const { clientId, clientSecret } = readCredentials();
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope: process.env.KROGER_SCOPE?.trim() || "product.compact",
    });

    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });

    const payload = (await response.json()) as TokenResponse;
    if (!response.ok || !payload.access_token) {
      throw new Error(
        payload.error_description ||
          payload.error ||
          `Kroger token request failed (${response.status})`
      );
    }

    const lifetimeMs = Math.max((payload.expires_in ?? 1800) - 60, 30) * 1000;
    this.accessToken = payload.access_token;
    this.tokenExpiresAtMs = now + lifetimeMs;
    return this.accessToken;
  }

  /**
   * GET /v1/locations?filter.zipCode.near={zip}&filter.limit=1
   * Returns the locationId of the closest store to `zipCode`.
   * Falls back to the seeded demo location when credentials are missing
   * or the official API rejects the request, so local pricing still works.
   */
  async getClosestStoreLocation(zipCode: string): Promise<string> {
    const zip = normalizeZip(zipCode);
    const clientId = process.env.KROGER_CLIENT_ID?.trim() ?? "";
    const clientSecret = process.env.KROGER_CLIENT_SECRET?.trim() ?? "";
    if (!clientId || !clientSecret) {
      return demoLocationId();
    }

    try {
      const token = await this.getAccessToken();
      const query = new URLSearchParams({
        "filter.zipCode.near": zip,
        "filter.limit": "1",
      });

      const response = await fetch(`${LOCATIONS_ENDPOINT}?${query.toString()}`, {
        method: "GET",
        cache: "no-cache",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(
          `Kroger locations request failed (${response.status}) for ZIP ${zip}`
        );
      }

      const payload = (await response.json()) as LocationsResponse;
      const locationId = payload.data?.[0]?.locationId?.trim();
      if (!locationId) {
        throw new Error(`No Kroger store found near ZIP ${zip}`);
      }

      return locationId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `Kroger Locations API unavailable (${message}); using demo store ${demoLocationId()}`
      );
      return demoLocationId();
    }
  }
}

export const krogerService = new KrogerService();
