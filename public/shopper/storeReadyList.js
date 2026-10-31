/**
 * Store-ready list for banners we cannot push a cart to.
 * Kroger is the only account cart write. Walmart is a cart link.
 * Every other store gets a list the shopper can copy, share, print,
 * or walk with, plus a search link when that store has a public search page.
 *
 * Search links are the store's own https pages. On iPhone those are universal
 * links: the store app opens when it is installed, and the website opens when
 * it is not. A custom app scheme is not used, because it cannot fall back to the web.
 */

import { displayProductName } from "./familyTile.js";
import { isShareCancel } from "./shareList.js";
import { formatMoney } from "./savingsMeter.js";
import { groupForAisle, normalizeStoreKey } from "./tripPlan.js";

export const SEARCH_QUERY_MAX = 60;

const CART_WRITE = new Set(["kroger", "walmart"]);

export function usesStoreReadyList(storeName) {
  return !CART_WRITE.has(normalizeStoreKey(storeName));
}

/**
 * Letters, numbers, and decimal points only. Ampersands become "and".
 * Apostrophes drop out so "Jerry's" stays one word.
 * @param {unknown} value
 */
export function stripSearchSymbols(value) {
  return String(value || "")
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^A-Za-z0-9.\s]+/g, " ")
    .replace(/(\d)\.(?=\d)/g, "$1\u0000")
    .replace(/\./g, " ")
    .replace(/\u0000/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

function isLongListingTitle(name) {
  const text = String(name || "").trim();
  if (!text) return false;
  if (text.length > 42) return true;
  if (/[®™©]/.test(text)) return true;
  if (text.includes(",") && text.length > 28) return true;
  return false;
}

function capWords(phrase, max) {
  const clean = String(phrase || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1);
  const space = cut.lastIndexOf(" ");
  const trimmed = (space >= 12 ? cut.slice(0, space) : clean.slice(0, max)).trim();
  return trimmed.replace(/[.\s]+$/g, "");
}

/**
 * Short search phrase: clean product name plus size.
 * A long retailer listing title is never the query.
 * @param {{ familyName?: string, query?: string, name?: string, size?: string } | null | undefined} item
 */
export function cleanSearchQuery(item) {
  const listing = String(item?.name || "");
  const family = stripSearchSymbols(item?.familyName);
  const query = stripSearchSymbols(item?.query);
  const name = stripSearchSymbols(listing);
  const long = isLongListingTitle(listing);
  let base = "";
  if (family && family.length <= 40) base = family;
  else if (long && query && query.length <= 40) base = query;
  else if (!long && name) base = name;
  else {
    const head = stripSearchSymbols(listing.split(",")[0]);
    if (head && head.length <= 40) base = head;
    else base = family || query || capWords(name, 40);
  }
  if (!base) base = "item";
  const size = stripSearchSymbols(item?.size);
  let phrase = base;
  if (size && !base.toLowerCase().includes(size.toLowerCase())) {
    phrase = `${base} ${size}`.replace(/\s+/g, " ").trim();
  }
  return capWords(phrase, SEARCH_QUERY_MAX);
}

/**
 * Same-tab on a phone so iOS and Android can open the store app.
 * A new tab on a computer keeps this list open.
 * @param {{ userAgent?: string, platform?: string, maxTouchPoints?: number }} [env]
 */
export function storeSearchLinkTarget(env = {}) {
  const ua = String(env.userAgent || "");
  const ios = /iPad|iPhone|iPod/.test(ua) || (env.platform === "MacIntel" && Number(env.maxTouchPoints) > 1);
  const android = /Android/i.test(ua);
  return ios || android ? "" : "_blank";
}

/**
 * Public search page for this banner, or "" when none is verified.
 * @param {string} storeName
 * @param {{ familyName?: string, query?: string, name?: string, size?: string }} item
 */
export function storeSearchUrl(storeName, item) {
  if (!usesStoreReadyList(storeName)) return "";
  const phrase = cleanSearchQuery(item);
  if (!phrase) return "";
  const encoded = encodeURIComponent(phrase);
  const params = new URLSearchParams({ q: phrase });
  switch (normalizeStoreKey(storeName)) {
    case "target":
      return `https://www.target.com/s?${new URLSearchParams({ searchTerm: phrase }).toString()}`;
    case "aldi":
      return `https://www.aldi.us/store/aldi/s?${new URLSearchParams({ k: phrase }).toString()}`;
    case "publix":
      return `https://www.publix.com/search?${new URLSearchParams({ searchTerm: phrase }).toString()}`;
    case "h e b":
    case "heb":
      return `https://www.heb.com/search/?${params.toString()}`;
    case "meijer":
      return `https://www.meijer.com/shopping/search.html?${new URLSearchParams({ text: phrase }).toString()}`;
    case "safeway":
      return `https://www.safeway.com/shop/search-results.html?${params.toString()}`;
    case "albertsons":
      return `https://www.albertsons.com/shop/search-results.html?${params.toString()}`;
    case "vons":
      return `https://www.vons.com/shop/search-results.html?${params.toString()}`;
    case "jewel osco":
      return `https://www.jewelosco.com/shop/search-results.html?${params.toString()}`;
    case "acme":
    case "acme markets":
      return `https://www.acmemarkets.com/shop/search-results.html?${params.toString()}`;
    case "tom thumb":
      return `https://www.tomthumb.com/shop/search-results.html?${params.toString()}`;
    case "randalls":
      return `https://www.randalls.com/shop/search-results.html?${params.toString()}`;
    case "pavilions":
      return `https://www.pavilions.com/shop/search-results.html?${params.toString()}`;
    case "food lion":
      return `https://shop.foodlion.com/search?${new URLSearchParams({ search_term: phrase }).toString()}`;
    case "costco":
      return `https://www.costco.com/CatalogSearch?${new URLSearchParams({ keyword: phrase }).toString()}`;
    case "sams club":
      return `https://www.samsclub.com/s/${encoded}`;
    case "whole foods":
    case "whole foods market":
      return `https://www.wholefoodsmarket.com/search?${new URLSearchParams({ text: phrase }).toString()}`;
    case "amazon fresh":
      return `https://www.amazon.com/s?${new URLSearchParams({ k: phrase }).toString()}`;
    default:
      return "";
  }
}

/**
 * Plain hint. Does not claim a cart, an account login, or a file the store can import.
 * @param {string} storeName
 */
export function storeReadyHint(storeName) {
  const key = normalizeStoreKey(storeName);
  const name = String(storeName || "this store").trim() || "this store";
  if (key === "target" || key === "aldi") {
    return `Use this list in aisle order, or tap Search to add each item in the ${name} app. There is no cart connection.`;
  }
  if (key === "costco" || key === "sams club") {
    return `Use the search links to find each item. There is no way to send this list into ${name}, and no cart connection. A membership may be required.`;
  }
  if (storeSearchUrl(name, { name: "milk", query: "milk" })) {
    return "Tap Search to look up each item, or shop the list in order. There is no cart connection.";
  }
  return "Shop this list in aisle order. There is no search link and no cart connection.";
}

function quantityOf(item) {
  return Math.max(1, Math.floor(Number(item?.quantity) || 1));
}

function lineTotal(item) {
  const explicit = Number(item?.itemTotal);
  if (Number.isFinite(explicit)) return explicit;
  const price = Number(item?.price);
  if (!Number.isFinite(price)) return null;
  return price * quantityOf(item);
}

function exactName(item) {
  return displayProductName(item?.name, item?.brand) || String(item?.name || "Item").replace(/\s+/g, " ").trim() || "Item";
}

function decorateItem(storeName, item) {
  const quantity = quantityOf(item);
  const name = exactName(item);
  const rawSize = String(item?.size || "");
  const size = rawSize.replace(/\s+/g, " ").trim();
  const csvSize = rawSize.replace(/\r\n/g, "\n").replace(/[^\S\n]+/g, " ").trim();
  const total = lineTotal(item);
  const priceLabel = total == null ? "" : formatMoney(total);
  const searchUrl = storeSearchUrl(storeName, item);
  const sizeBit = size && !name.toLowerCase().includes(size.toLowerCase()) ? `, ${size}` : "";
  const priceBit = priceLabel ? ` — ${priceLabel}` : "";
  return {
    lineId: String(item?.lineId || ""),
    quantity,
    name,
    size,
    csvSize,
    priceLabel,
    searchUrl,
    searchQuery: cleanSearchQuery(item),
    textLine: `${quantity} × ${name}${sizeBit}${priceBit}`,
  };
}

function listSubtotal(store, items) {
  const known = (items || []).map(lineTotal).filter((value) => value != null);
  if (!known.length) return null;
  const given = Number(store?.subtotal);
  if (Number.isFinite(given)) return given;
  return known.reduce((sum, value) => sum + value, 0);
}

function renderText(storeName, groups, subtotalLabel) {
  if (!groups.length) return `${storeName} list\n\nNothing on this list.`;
  const blocks = [`${storeName} list`];
  for (const group of groups) {
    const heading = group.aisle ? `${group.department} · ${group.aisle}` : group.department;
    blocks.push([heading, ...group.items.map((item) => item.textLine)].join("\n"));
  }
  if (subtotalLabel) blocks.push(`Subtotal ${subtotalLabel}`);
  return blocks.join("\n\n");
}

/** Quote a CSV field when it contains a comma, quote, or line break. */
export function escapeCsvField(value) {
  const text = value == null ? "" : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvRow(cells) {
  return cells.map(escapeCsvField).join(",");
}

function renderCsv(groups, subtotalLabel) {
  const lines = [csvRow(["Department", "Aisle", "Quantity", "Product", "Size", "Expected price"])];
  for (const group of groups) {
    for (const item of group.items) {
      lines.push(
        csvRow([group.department, group.aisle, item.quantity, item.name, item.csvSize, item.priceLabel])
      );
    }
  }
  if (subtotalLabel) lines.push(csvRow(["", "", "", "Subtotal", "", subtotalLabel]));
  return lines.join("\n");
}

export function csvFilename(storeName) {
  const slug = normalizeStoreKey(storeName).replace(/\s+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug || "store"}-list.csv`;
}

/**
 * Aisle order, exact names, quantities, prices when known, and a subtotal.
 * @param {{ storeName?: string, subtotal?: number, items?: object[] }} store
 */
export function buildStoreReadyList(store) {
  const storeName = String(store?.storeName || "Store").trim() || "Store";
  const items = store?.items || [];
  const groups = groupForAisle(items).map((group) => ({
    department: group.department || "Other",
    aisle: group.aisle || "",
    items: (group.items || []).map((item) => decorateItem(storeName, item)),
  }));
  const subtotal = listSubtotal(store, items);
  const subtotalLabel = subtotal == null ? "" : formatMoney(subtotal);
  return {
    storeName,
    title: "Store-ready list",
    hintTitle: `How to get this into ${storeName}`,
    hint: storeReadyHint(storeName),
    groups,
    subtotal,
    subtotalLabel,
    text: renderText(storeName, groups, subtotalLabel),
    csv: renderCsv(groups, subtotalLabel),
    filename: csvFilename(storeName),
  };
}

export function formatStoreReadyText(store) {
  return buildStoreReadyList(store).text;
}

export function formatStoreReadyCsv(store) {
  return buildStoreReadyList(store).csv;
}

/**
 * Web Share when the phone has it. Otherwise copy the list text.
 * A cancelled share stays cancelled. Any other share failure copies the list.
 * @param {{ title?: string, text?: string }} details
 * @param {{ capacitorShare?: { share?: Function }, Capacitor?: { Plugins?: { Share?: { share?: Function } } }, navigatorShare?: Function, navigator?: { share?: Function }, copy?: Function }} [env]
 */
export async function shareStoreList(details, env = {}) {
  const title = String(details?.title || "Store list");
  const text = String(details?.text || "");
  const plugin = env.capacitorShare ?? env.Capacitor?.Plugins?.Share;
  if (plugin && typeof plugin.share === "function") {
    try {
      await plugin.share({ title, text, dialogTitle: "Share list" });
      return "capacitor";
    } catch (error) {
      if (isShareCancel(error)) throw error;
    }
  }
  const webShare =
    env.navigatorShare ||
    (env.navigator && typeof env.navigator.share === "function" ? env.navigator.share.bind(env.navigator) : null);
  if (typeof webShare === "function") {
    try {
      await webShare({ title, text });
      return "web-share";
    } catch (error) {
      if (isShareCancel(error)) throw error;
    }
  }
  if (typeof env.copy !== "function") {
    throw new Error("This phone can't share this list.");
  }
  await env.copy(text);
  return "copy";
}
