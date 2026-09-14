import axios, { type AxiosRequestConfig } from "axios";

const TOKEN_URL = "https://oauth.fatsecret.com/connect/token";
/** Catalog search (foods.search.v5). food/v5 is get-by-id; search is foods/search/v5. */
const FOOD_SEARCH_URL = "https://platform.fatsecret.com/rest/foods/search/v5";

export type FatSecretProduct = {
  name: string;
  brand: string;
  foodId: string;
  barcode?: string;
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
  food_type?: string;
  food_barcode?: string;
  barcode?: string;
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
  const foodId = String(food.food_id ?? "").trim();
  if (!name || !foodId) {
    return null;
  }

  const brand = food.brand_name?.trim() || "Generic";
  const barcode = (food.food_barcode ?? food.barcode)?.trim();

  return {
    name,
    brand,
    foodId,
    ...(barcode ? { barcode } : {}),
  };
}

/**
 * FatSecret Platform client (OAuth 2.0 client credentials).
 * Tokens are reused in memory until they expire.
 */
export class FatSecretService {
  private accessToken: string | null = null;
  private tokenExpiresAtMs = 0;

  constructor(private readonly http: FatSecretHttp = axios) {}

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && now < this.tokenExpiresAtMs) {
      return this.accessToken;
    }

    const { clientId, clientSecret } = readCredentials();
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope: process.env.FATSECRET_SCOPE?.trim() || "basic",
      client_id: clientId,
      client_secret: clientSecret,
    });

    const response = await this.http.post(TOKEN_URL, body.toString(), {
      auth: { username: clientId, password: clientSecret },
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

    const lifetimeMs = Math.max((payload.expires_in ?? 86400) - 60, 30) * 1000;
    this.accessToken = payload.access_token;
    this.tokenExpiresAtMs = now + lifetimeMs;
    return this.accessToken;
  }

  /**
   * Search the global FatSecret food catalog.
   * GET https://platform.fatsecret.com/rest/foods/search/v5
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
        search_expression: search,
        format: "json",
        max_results: 20,
        page_number: 0,
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
