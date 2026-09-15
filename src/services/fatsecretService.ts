import axios, { type AxiosRequestConfig } from "axios";

const TOKEN_URL = "https://oauth.fatsecret.com/connect/token";
const FOOD_SEARCH_URL = "https://platform.fatsecret.com/rest/server.api";
const TOKEN_REFRESH_SKEW_MS = 60_000;

export type FatSecretProduct = {
  id: string;
  name: string;
  brand: string;
};

export type FatSecretHttp = {
  post: (
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ) => Promise<{ data: unknown }>;
  get: (url: string, config?: AxiosRequestConfig) => Promise<{ data: unknown }>;
};

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type FatSecretFood = {
  food_id?: string | number;
  food_name?: string;
  brand_name?: string;
};

type FoodSearchResponse = {
  foods_search?: {
    results?: { food?: FatSecretFood | FatSecretFood[] };
  };
  foods?: { food?: FatSecretFood | FatSecretFood[] };
  error?: { message?: string; code?: string | number };
};

function readCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.FATSECRET_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.FATSECRET_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) {
    throw new Error(
      "FatSecret API credentials are missing. Set FATSECRET_CLIENT_ID and FATSECRET_CLIENT_SECRET."
    );
  }
  return { clientId, clientSecret };
}

function asFoodArray(food: FatSecretFood | FatSecretFood[] | undefined): FatSecretFood[] {
  if (!food) {
    return [];
  }
  return Array.isArray(food) ? food : [food];
}

function toProduct(food: FatSecretFood): FatSecretProduct | null {
  const name = String(food.food_name ?? "").trim();
  const id = String(food.food_id ?? "").trim();
  if (!name || !id) {
    return null;
  }

  return {
    id,
    name,
    brand: food.brand_name?.trim() || "Generic",
  };
}

/**
 * FatSecret Platform client using OAuth 2.0 client credentials.
 * Access tokens are cached in memory and refreshed shortly before they expire.
 */
export class FatSecretService {
  private accessToken: string | null = null;
  private tokenExpiresAtMs = 0;

  constructor(private readonly http: FatSecretHttp = axios) {}

  private hasFreshToken(): boolean {
    return Boolean(this.accessToken) && Date.now() + TOKEN_REFRESH_SKEW_MS < this.tokenExpiresAtMs;
  }

  private async getAccessToken(): Promise<string> {
    if (this.hasFreshToken() && this.accessToken) {
      return this.accessToken;
    }

    const { clientId, clientSecret } = readCredentials();
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope: "premier",
      client_id: clientId,
      client_secret: clientSecret,
    });

    const response = await this.http.post(TOKEN_URL, body.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
    });

    const payload = response.data as TokenResponse;
    if (!payload.access_token) {
      throw new Error(
        payload.error_description ||
          payload.error ||
          "FatSecret token request failed"
      );
    }

    const expiresInSec = payload.expires_in ?? 86400;
    this.accessToken = payload.access_token;
    this.tokenExpiresAtMs = Date.now() + Math.max(expiresInSec, 0) * 1000;
    return this.accessToken;
  }

  /**
   * Search the global FatSecret food catalog (foods.search.v3).
   */
  async searchGlobalCatalog(query: string): Promise<FatSecretProduct[]> {
    const search = query.trim();
    if (!search) {
      return [];
    }

    const token = await this.getAccessToken();
    const response = await this.http.get(FOOD_SEARCH_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      params: {
        method: "foods.search.v3",
        search_expression: search,
        format: "json",
      },
    });

    const payload = response.data as FoodSearchResponse;
    if (payload.error?.message) {
      throw new Error(payload.error.message);
    }

    const foods = asFoodArray(
      payload.foods_search?.results?.food ?? payload.foods?.food
    );
    return foods
      .map(toProduct)
      .filter((product): product is FatSecretProduct => product !== null);
  }
}

export const fatSecretService = new FatSecretService();
