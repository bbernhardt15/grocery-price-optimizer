/**
 * Instacart Developer Platform shopping-list handoff.
 *
 * POST {base}/idp/v1/products/products_link
 * https://docs.instacart.com/developer_platform_api/api/products/create_shopping_list_page
 *
 * Development base: https://connect.dev.instacart.tools
 * Production base:  https://connect.instacart.com
 *
 * This is not the INSTACART_PARTNER_* price-feed stub.
 */

import { parsePackageSize } from "./packageSize";

export const INSTACART_DEV_BASE_URL = "https://connect.dev.instacart.tools";
export const INSTACART_PROD_BASE_URL = "https://connect.instacart.com";
export const INSTACART_PRODUCTS_LINK_PATH = "/idp/v1/products/products_link";
export const INSTACART_RETAILERS_PATH = "/idp/v1/retailers";

const PRODUCTS_LINK_DOC =
  "https://docs.instacart.com/developer_platform_api/api/products/create_shopping_list_page";

/** Shopping-list links have no default expiry. Cap well under the 365-day max. */
const LINK_EXPIRES_IN_DAYS = 7;
const MAX_LINE_ITEMS = 80;

export type InstacartLineInput = {
  name: string;
  quantity?: number;
  /** Grocery Gitter unit (`gal`, `lbs`, `oz`, `count`, …) when no package size is set. */
  unit?: string;
  /** Retailer package text from Product.size, such as "1 gal", "16 oz", or "12 ct". */
  size?: string;
  brand?: string;
  upc?: string;
};

export type InstacartMeasurement = {
  quantity: number;
  unit: string;
};

export type InstacartLineItem = {
  name: string;
  quantity: number;
  unit: string;
  display_text: string;
  line_item_measurements: InstacartMeasurement[];
  upcs?: string[];
};

export type InstacartConfig = {
  apiKey: string;
  baseUrl: string;
};

export type InstacartShoppingListResult = {
  productsLinkUrl: string;
  retailerKey: string | null;
  retailerPreselected: boolean;
  retailerNote: string;
};

export class InstacartRequestError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "InstacartRequestError";
    this.statusCode = statusCode;
  }
}

type FetchLike = typeof fetch;

const UNIT_TO_INSTACART: Record<string, string> = {
  oz: "ounce",
  ounce: "ounce",
  ounces: "ounce",
  lbs: "pound",
  lb: "pound",
  pound: "pound",
  pounds: "pound",
  count: "each",
  each: "each",
  ct: "each",
  ea: "each",
  g: "gram",
  gram: "gram",
  grams: "gram",
  kg: "kilogram",
  kilogram: "kilogram",
  kilograms: "kilogram",
  ml: "milliliter",
  milliliter: "milliliter",
  milliliters: "milliliter",
  l: "liter",
  liter: "liter",
  liters: "liter",
  gal: "gallon",
  gallon: "gallon",
  gallons: "gallon",
  cup: "cup",
  cups: "cup",
  tbsp: "tablespoon",
  tablespoon: "tablespoon",
  tablespoons: "tablespoon",
  tsp: "teaspoon",
  teaspoon: "teaspoon",
  teaspoons: "teaspoon",
  package: "package",
  packages: "package",
  can: "can",
  cans: "can",
  bunch: "bunch",
  bunches: "bunch",
};

const RETAILER_ALIASES: Record<string, string[]> = {
  heb: ["heb", "h e b"],
  "h e b": ["heb", "h e b"],
  "sams club": ["sams club", "sam s club"],
  "sam s club": ["sams club", "sam s club"],
  "whole foods": ["whole foods", "whole foods market"],
  "whole foods market": ["whole foods", "whole foods market"],
  "stop and shop": ["stop and shop"],
  giant: ["giant", "giant food"],
  "giant food": ["giant", "giant food"],
};

export function readInstacartConfig(
  env: NodeJS.ProcessEnv = process.env
): InstacartConfig | null {
  const apiKey = env.INSTACART_API_KEY?.trim() ?? "";
  const baseRaw = env.INSTACART_API_BASE_URL?.trim() ?? "";
  if (!apiKey || !baseRaw) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(baseRaw);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    return null;
  }
  if (!parsed.hostname) {
    return null;
  }

  return { apiKey, baseUrl: parsed.origin };
}

export function isInstacartHandoffEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return readInstacartConfig(env) !== null;
}

export function toInstacartLineItem(
  item: InstacartLineInput
): InstacartLineItem | null {
  const name = item.name?.trim() ?? "";
  if (!name) {
    return null;
  }

  const packages = normalizeQuantity(item.quantity);
  const measured = measurementFor(item, packages);
  const display = displayText(
    name,
    item.brand,
    packages,
    item.unit,
    item.size?.trim() || measured.sizeLabel
  );
  const upc = normalizeUpc(item.upc);

  return {
    name: name.slice(0, 200),
    quantity: measured.quantity,
    unit: measured.unit,
    display_text: display.slice(0, 240),
    line_item_measurements: [{ quantity: measured.quantity, unit: measured.unit }],
    ...(upc ? { upcs: [upc] } : {}),
  };
}

export function buildProductsLinkBody(input: {
  items: InstacartLineInput[];
  title: string;
  instructions: string[];
  partnerLinkbackUrl?: string;
}): {
  title: string;
  link_type: "shopping_list";
  expires_in: number;
  instructions: string[];
  line_items: InstacartLineItem[];
  landing_page_configuration?: { partner_linkback_url: string };
} {
  const lineItems = input.items
    .slice(0, MAX_LINE_ITEMS)
    .map((item) => toInstacartLineItem(item))
    .filter((item): item is InstacartLineItem => item !== null);

  if (lineItems.length === 0) {
    throw new InstacartRequestError(
      "Send at least one item with a product name.",
      400
    );
  }

  const linkback = sanitizeLinkback(input.partnerLinkbackUrl);
  return {
    title: input.title.trim().slice(0, 120) || "Grocery Gitter list",
    link_type: "shopping_list",
    expires_in: LINK_EXPIRES_IN_DAYS,
    instructions: input.instructions.map((line) => line.slice(0, 500)).slice(0, 8),
    line_items: lineItems,
    ...(linkback
      ? { landing_page_configuration: { partner_linkback_url: linkback } }
      : {}),
  };
}

export function normalizeRetailerName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function retailerNamesMatch(storeName: string, retailerName: string): boolean {
  const store = normalizeRetailerName(storeName);
  const retailer = normalizeRetailerName(retailerName);
  if (!store || !retailer) {
    return false;
  }
  if (store === retailer) {
    return true;
  }
  const storeAliases = RETAILER_ALIASES[store] ?? [store];
  const retailerAliases = RETAILER_ALIASES[retailer] ?? [retailer];
  return storeAliases.some(
    (alias) => alias === retailer || retailerAliases.includes(alias)
  );
}

export function matchRetailerKey(
  storeName: string,
  retailers: Array<{ retailer_key?: string; name?: string }>
): string | null {
  const matches = retailers.filter(
    (retailer) =>
      typeof retailer.retailer_key === "string" &&
      retailer.retailer_key.trim().length > 0 &&
      typeof retailer.name === "string" &&
      retailerNamesMatch(storeName, retailer.name)
  );
  if (matches.length === 0) {
    return null;
  }

  const store = normalizeRetailerName(storeName);
  const exact = matches.find(
    (retailer) => normalizeRetailerName(retailer.name ?? "") === store
  );
  const chosen = exact ?? matches[0];
  return chosen.retailer_key?.trim() || null;
}

export function withRetailerKey(productsLinkUrl: string, retailerKey: string): string {
  const url = new URL(productsLinkUrl);
  url.searchParams.set("retailer_key", retailerKey);
  return url.toString();
}

export function createShoppingListCopy(storeName?: string): {
  title: string;
  instructions: string[];
} {
  const store = storeName?.trim();
  if (store) {
    return {
      title: `Grocery Gitter · ${store}`.slice(0, 120),
      instructions: [
        `Items Grocery Gitter priced at ${store}. Select ${store} on Instacart if it is offered near you. Grocery Gitter prices are not Instacart prices.`,
      ],
    };
  }

  return {
    title: "Grocery Gitter list",
    instructions: [
      "Combined Grocery Gitter trip. Instacart checkout uses one retailer for this list. Prices on Instacart can differ from Grocery Gitter.",
    ],
  };
}

export async function createInstacartShoppingList(
  input: {
    items: InstacartLineInput[];
    storeName?: string;
    postalCode?: string;
    partnerLinkbackUrl?: string;
  },
  options: {
    config?: InstacartConfig | null;
    fetchImpl?: FetchLike;
  } = {}
): Promise<InstacartShoppingListResult> {
  const config = options.config === undefined ? readInstacartConfig() : options.config;
  if (!config) {
    throw new InstacartRequestError(
      "Instacart shopping lists are turned off. Set INSTACART_API_KEY and INSTACART_API_BASE_URL (https://connect.dev.instacart.tools for a development key, or https://connect.instacart.com for a production key).",
      503
    );
  }

  const storeName = input.storeName?.trim() || undefined;
  const copy = createShoppingListCopy(storeName);
  const body = buildProductsLinkBody({
    items: input.items,
    title: copy.title,
    instructions: copy.instructions,
    partnerLinkbackUrl: input.partnerLinkbackUrl,
  });

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await instacartFetch(
    fetchImpl,
    config,
    INSTACART_PRODUCTS_LINK_PATH,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  const payload = await readJson(response);
  if (!response.ok) {
    throw new InstacartRequestError(
      formatInstacartError(response.status, payload),
      502
    );
  }

  const productsLinkUrl = readProductsLinkUrl(payload);
  if (!productsLinkUrl) {
    throw new InstacartRequestError(
      "Instacart did not return a products_link_url. Check that this key can call POST /idp/v1/products/products_link.",
      502
    );
  }

  const hint = await hintRetailer({
    config,
    fetchImpl,
    productsLinkUrl,
    storeName,
    postalCode: normalizePostalCode(input.postalCode),
  });

  return {
    productsLinkUrl: hint.url,
    retailerKey: hint.retailerKey,
    retailerPreselected: hint.retailerKey !== null,
    retailerNote: hint.note,
  };
}

function normalizeQuantity(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return Math.min(Math.round(value * 1000) / 1000, 99);
}

function mapUnit(unit: string | undefined): { unit: string } {
  const raw = unit?.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ") ?? "";
  if (!raw) {
    return { unit: "each" };
  }
  return { unit: UNIT_TO_INSTACART[raw] ?? "each" };
}

function displayText(
  name: string,
  brand: string | undefined,
  quantity: number,
  rawUnit: string | undefined,
  sizeLabel: string | undefined
): string {
  const trimmedBrand = brand?.trim() ?? "";
  const titled =
    trimmedBrand && !name.toLowerCase().includes(trimmedBrand.toLowerCase())
      ? `${trimmedBrand} ${name}`
      : name;
  const size = sizeLabel?.trim() || rawUnit?.trim() || "";
  if (!size || /^(count|each|ea|ct)$/i.test(size)) {
    return titled;
  }
  if (sizeLabel) {
    return quantity === 1 ? `${titled} (${sizeLabel})` : `${titled} (${formatQty(quantity)} × ${sizeLabel})`;
  }
  return `${titled} (${formatQty(quantity)} ${size})`;
}

const SIZE_LABEL_UNITS: Record<string, string> = {
  "fl oz": "fl oz ounce",
  gal: "gallon",
  qt: "quart",
  pt: "pint",
  ml: "milliliter",
  l: "liter",
  lb: "pound",
  oz: "ounce",
  kg: "kilogram",
  g: "gram",
};

function measurementFor(
  item: InstacartLineInput,
  packages: number
): { quantity: number; unit: string; sizeLabel?: string } {
  const fromSize = measurementFromSize(item.size, packages);
  if (fromSize) {
    return fromSize;
  }
  return { quantity: packages, unit: mapUnit(item.unit).unit };
}

/**
 * Volume and weight package sizes become the Instacart measurement
 * (package amount × how many the shopper asked for). Count sizes such as
 * "12 ct" stay one `each` per package so Instacart does not add twelve cartons.
 */
function measurementFromSize(
  size: string | undefined,
  packages: number
): { quantity: number; unit: string; sizeLabel: string } | null {
  const parsed = parsePackageSize(size);
  if (!parsed) {
    return null;
  }
  if (parsed.dimension === "count") {
    return { quantity: packages, unit: "each", sizeLabel: parsed.label };
  }

  const simple = parsed.label.match(/^(\d+(?:\.\d+)?) (fl oz|gal|qt|pt|ml|L|lb|oz|kg|g)$/i);
  if (simple?.[1] && simple[2]) {
    const unit = SIZE_LABEL_UNITS[simple[2].toLowerCase()];
    if (unit) {
      return {
        quantity: roundQty(Number(simple[1]) * packages),
        unit,
        sizeLabel: parsed.label,
      };
    }
  }

  const total = parsed.amount * packages;
  const converted =
    parsed.dimension === "volume" ? volumeFromFlOz(total) : weightFromOz(total);
  return { ...converted, sizeLabel: parsed.label };
}

function volumeFromFlOz(flOz: number): { quantity: number; unit: string } {
  const gallons = flOz / 128;
  if (isCleanAmount(gallons)) {
    return { quantity: roundQty(gallons), unit: "gallon" };
  }
  const quarts = flOz / 32;
  if (isCleanAmount(quarts)) {
    return { quantity: roundQty(quarts), unit: "quart" };
  }
  const pints = flOz / 16;
  if (isCleanAmount(pints)) {
    return { quantity: roundQty(pints), unit: "pint" };
  }
  const liters = flOz / 33.8140227018;
  if (liters >= 1 && isCleanAmount(liters)) {
    return { quantity: roundQty(liters), unit: "liter" };
  }
  return { quantity: roundQty(flOz), unit: "fl oz ounce" };
}

function weightFromOz(ounces: number): { quantity: number; unit: string } {
  const pounds = ounces / 16;
  if (pounds >= 1 && isCleanAmount(pounds)) {
    return { quantity: roundQty(pounds), unit: "pound" };
  }
  const grams = ounces * (1000 / 35.27396195);
  if (grams >= 1 && isCleanAmount(grams) && grams < 1000) {
    return { quantity: roundQty(grams), unit: "gram" };
  }
  return { quantity: roundQty(ounces), unit: "ounce" };
}

function isCleanAmount(value: number): boolean {
  const nearest = Math.round(value * 4) / 4;
  return Math.abs(value - nearest) < 0.02;
}

function roundQty(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Math.min(Math.max(rounded, 0.001), 9999);
}

function formatQty(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function normalizeUpc(value: string | undefined): string | undefined {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (digits.length < 8 || digits.length > 14) {
    return undefined;
  }
  return digits;
}

export function sanitizeLinkback(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function normalizePostalCode(value: string | undefined): string | undefined {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (digits.length < 5) {
    return undefined;
  }
  return digits.slice(0, 5);
}

async function hintRetailer(input: {
  config: InstacartConfig;
  fetchImpl: FetchLike;
  productsLinkUrl: string;
  storeName?: string;
  postalCode?: string;
}): Promise<{ url: string; retailerKey: string | null; note: string }> {
  const { storeName, postalCode } = input;
  if (!storeName) {
    return {
      url: input.productsLinkUrl,
      retailerKey: null,
      note: "Choose a retailer on the Instacart page. One Instacart order uses one retailer, so this combined list is not split across the trip-plan stores. The shopping-list API has no retailer field.",
    };
  }

  if (!postalCode) {
    return {
      url: input.productsLinkUrl,
      retailerKey: null,
      note: `Choose ${storeName} on the Instacart page. No ZIP was available for nearby-retailer lookup, and POST /idp/v1/products/products_link does not accept a retailer.`,
    };
  }

  try {
    const url = new URL(INSTACART_RETAILERS_PATH, `${input.config.baseUrl}/`);
    url.searchParams.set("postal_code", postalCode);
    url.searchParams.set("country_code", "US");
    const response = await instacartFetch(input.fetchImpl, input.config, url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${input.config.apiKey}`,
      },
    });
    const payload = await readJson(response);
    if (!response.ok) {
      return {
        url: input.productsLinkUrl,
        retailerKey: null,
        note: retailerLookupNote(storeName, response.status),
      };
    }

    const retailers = Array.isArray(payload.retailers) ? payload.retailers : [];
    const retailerKey = matchRetailerKey(
      storeName,
      retailers.filter(
        (retailer): retailer is { retailer_key?: string; name?: string } =>
          Boolean(retailer) && typeof retailer === "object"
      )
    );
    if (!retailerKey) {
      return {
        url: input.productsLinkUrl,
        retailerKey: null,
        note: `Choose ${storeName} on the Instacart page. No nearby Instacart retailer matched that name, and the shopping-list request cannot preselect a store.`,
      };
    }

    return {
      url: withRetailerKey(input.productsLinkUrl, retailerKey),
      retailerKey,
      note: `Instacart opened with ${storeName} hinted (retailer_key ${retailerKey}) from GET /idp/v1/retailers. Confirm that store before checkout. The shopping-list POST itself has no retailer field; retailer_key is documented for recipe page URLs.`,
    };
  } catch {
    return {
      url: input.productsLinkUrl,
      retailerKey: null,
      note: `Choose ${storeName} on the Instacart page. Nearby-retailer lookup failed, and POST /idp/v1/products/products_link does not accept a retailer.`,
    };
  }
}

function retailerLookupNote(storeName: string, status: number): string {
  if (status === 401 || status === 403) {
    return `Choose ${storeName} on the Instacart page. This API key cannot call GET /idp/v1/retailers (HTTP ${status}); Instacart documents that call as a separate key. The shopping-list POST has no retailer field.`;
  }
  return `Choose ${storeName} on the Instacart page. Nearby-retailer lookup returned HTTP ${status}, and the shopping-list API cannot preselect a store.`;
}

async function instacartFetch(
  fetchImpl: FetchLike,
  config: InstacartConfig,
  pathOrUrl: string | URL,
  init: RequestInit
): Promise<Response> {
  const url =
    pathOrUrl instanceof URL
      ? pathOrUrl
      : new URL(pathOrUrl, `${config.baseUrl}/`);
  try {
    return await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(12_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "network error";
    throw new InstacartRequestError(
      `Could not reach Instacart at ${config.baseUrl} (${reason}). Confirm INSTACART_API_BASE_URL is ${INSTACART_DEV_BASE_URL} or ${INSTACART_PROD_BASE_URL}.`,
      502
    );
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function readProductsLinkUrl(payload: Record<string, unknown>): string | null {
  const value = payload.products_link_url;
  if (typeof value !== "string" || !isInstacartHttpsUrl(value)) {
    return null;
  }
  return value;
}

function isInstacartHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      return false;
    }
    const host = url.hostname.toLowerCase();
    return (
      host === "instacart.com" ||
      host.endsWith(".instacart.com") ||
      host === "instacart.tools" ||
      host.endsWith(".instacart.tools")
    );
  } catch {
    return false;
  }
}

export function formatInstacartError(status: number, payload: unknown): string {
  const details = collectErrorMessages(payload).slice(0, 4);
  const prefix = statusPrefix(status);
  if (details.length === 0) {
    return prefix;
  }
  return `${prefix} ${details.join("; ")}`;
}

function statusPrefix(status: number): string {
  if (status === 400) {
    return "Instacart rejected the shopping list (HTTP 400).";
  }
  if (status === 401) {
    return "Instacart rejected the API key (HTTP 401). Use a development key with https://connect.dev.instacart.tools, or a production key with https://connect.instacart.com.";
  }
  if (status === 403) {
    return "Instacart denied access (HTTP 403). This key may not be allowed to call POST /idp/v1/products/products_link.";
  }
  if (status === 429) {
    return "Instacart rate-limited this request (HTTP 429). Wait a moment and try again.";
  }
  if (status >= 500) {
    return `Instacart could not create a shopping list (HTTP ${status}). Try again shortly.`;
  }
  return `Instacart shopping list failed (HTTP ${status}). See ${PRODUCTS_LINK_DOC}.`;
}

function collectErrorMessages(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const record = payload as Record<string, unknown>;
  const messages: string[] = [];
  const error = record.error;
  if (error && typeof error === "object") {
    const err = error as Record<string, unknown>;
    const nested = Array.isArray(err.errors) ? err.errors : [];
    const nestedMessages = nested.flatMap((entry) => messageFromEntry(entry));
    if (nestedMessages.length > 0) {
      messages.push(...nestedMessages);
    } else if (typeof err.message === "string" && err.message.trim()) {
      messages.push(err.message.trim());
    }
  }
  if (Array.isArray(record.errors)) {
    messages.push(...record.errors.flatMap((entry) => messageFromEntry(entry)));
  }
  return [...new Set(messages.map((message) => message.slice(0, 240)))];
}

function messageFromEntry(entry: unknown): string[] {
  if (!entry || typeof entry !== "object") {
    return [];
  }
  const record = entry as Record<string, unknown>;
  const nested =
    record.error && typeof record.error === "object"
      ? (record.error as Record<string, unknown>)
      : record;
  const message = typeof nested.message === "string" ? nested.message.trim() : "";
  if (!message || message === "There were issues with your request") {
    return [];
  }
  const meta = record.meta;
  const key =
    typeof record.key === "string"
      ? record.key
      : meta && typeof meta === "object" && typeof (meta as { key?: unknown }).key === "string"
        ? (meta as { key: string }).key
        : "";
  return [key ? `${message} (${key})` : message];
}
