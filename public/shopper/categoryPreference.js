/**
 * How the shopper buys a staple.
 *
 * categoryPreferences[family] is { family, mode, brand?, productId?, size?, attributes? }.
 * mode is brand, storeBrand, cheapest, or skip.
 * The resolver only returns a catalog row that is already in `products`.
 * It does not invent a product or a price. Allergy and diet rules win.
 */

import { parseProfile } from "./profile.js";
import { productExcluded } from "./profileConstraints.js";
import { isStoreBrand, priceOf } from "./productPreference.js";
import {
  attributeTests,
  classifyProduct,
  familyFromQuery,
  familyLabel,
  isHouseBrand,
  pickAtStore,
  PREFERENCE_CATEGORIES,
  productMatchesFamily,
  rankFamilyScore,
  searchTermFor,
  unitPriceAmount,
} from "./stapleFamilies.js";

const MODES = ["brand", "storeBrand", "cheapest", "skip", "never"];

export function categoryModes() {
  return MODES.slice();
}

export function modeLabel(mode) {
  if (mode === "brand") return "Name brand";
  if (mode === "storeBrand") return "Store brand";
  if (mode === "cheapest") return "Cheapest";
  if (mode === "skip") return "Skip";
  if (mode === "never") return "I don't buy this";
  return "";
}

function clean(value, max = 80) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function categoryPreferenceOf(value, familyId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const family = clean(value.family || familyId, 40).toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(family)) return null;
  const mode = MODES.includes(value.mode) ? value.mode : "";
  if (!mode) return null;
  const attributes = Array.isArray(value.attributes)
    ? value.attributes.map((item) => clean(item, 40).toLowerCase()).filter(Boolean).slice(0, 8)
    : [];
  return {
    family,
    mode,
    brand: clean(value.brand, 80),
    productId: clean(value.productId || value.catalogId, 80),
    size: clean(value.size || value.sizeLabel, 80),
    attributes,
    updatedAt: Number(value.updatedAt) || 0,
  };
}

export function setCategoryPreference(profile, preference, at = Date.now()) {
  const next = parseProfile(profile);
  const row = categoryPreferenceOf({ ...preference, updatedAt: at }, preference?.family);
  if (!row) return next;
  next.categoryPreferences = { ...(next.categoryPreferences || {}), [row.family]: row };
  next.updatedAt = at;
  return next;
}

function allowed(profile, products) {
  return (products || []).filter((product) => product?.id && !productExcluded(profile, product).excluded);
}

function matchesAttributes(product, familyId, attributes) {
  const selected = attributes || [];
  if (!selected.length) return true;
  const tests = attributeTests(familyId).filter((row) => selected.includes(row.id));
  if (!tests.length) return true;
  const text = `${product?.name || ""} ${product?.sizeLabel || ""} ${product?.variantLabel || ""}`;
  return tests.every((row) => row.test.test(text));
}

function brandHit(product, brand) {
  const wanted = clean(brand, 80).toLowerCase();
  if (!wanted) return false;
  return String(product?.brand || "").toLowerCase().includes(wanted);
}

function labelOf(product) {
  const brand = clean(product?.brand, 80);
  const name = clean(product?.familyName || product?.name, 120);
  if (brand && name && !name.toLowerCase().includes(brand.toLowerCase())) return `${brand} ${name}`;
  return name || brand;
}

/**
 * One concrete catalog row for a family, or a prompt when they have not chosen.
 * @param {{ profile?: object, family?: string, products?: object[], storeName?: string, query?: string }} input
 */
export function resolveCategoryPreference(input) {
  const profile = input?.profile || {};
  const query = String(input?.query || "");
  const family = input?.family || familyFromQuery(query);
  if (!family) return { status: "none", family: "", product: null, mode: "", swapped: null, ask: false };
  if (query && productExcluded(profile, { name: query }).excluded) {
    return { status: "excluded", family, product: null, mode: "", swapped: null, ask: false };
  }
  const pref = (profile.categoryPreferences || {})[family];
  const pool = allowed(profile, input?.products).filter((product) => productMatchesFamily(product, family));
  if (pref?.mode === "never") {
    return { status: "never", family, product: null, mode: "never", swapped: null, ask: false, declined: true };
  }
  if (!pref || pref.mode === "skip") {
    return { status: pref?.mode === "skip" ? "skip" : "ask", family, product: null, mode: pref?.mode || "", swapped: null, ask: true, declined: false };
  }
  const narrowed = pool.filter((product) => matchesAttributes(product, family, pref.attributes));
  const rows = narrowed.length ? narrowed : pool;
  if (pref.mode === "brand") {
    const exact = pref.productId ? rows.find((product) => product.id === pref.productId) : null;
    if (exact) return { status: "brand", family, product: exact, mode: "brand", swapped: null, ask: false };
    const branded = pref.brand ? rows.filter((product) => brandHit(product, pref.brand)) : [];
    const pick = (branded.length ? branded : rows)
      .slice()
      .sort((a, b) => rankFamilyScore(b, family, pref.brand) - rankFamilyScore(a, family, pref.brand))[0];
    if (!pick) return { status: "ask", family, product: null, mode: "brand", swapped: null, ask: true };
    if (branded.length) return { status: "brand", family, product: pick, mode: "brand", swapped: null, ask: false };
    const from = [pref.brand, familyLabel(family)].filter(Boolean).join(" ");
    return {
      status: "swapped",
      family,
      product: pick,
      mode: "brand",
      ask: false,
      swapped: { from, to: labelOf(pick) },
    };
  }
  if (pref.mode === "storeBrand") {
    const storeName = input?.storeName || "";
    const pick = storeName
      ? pickAtStore(rows, family, "storeBrand", storeName, pref)
      : rows.filter((product) => isHouseBrand(product) || isStoreBrand(product.brand, product)).sort((a, b) => rankFamilyScore(b, family) - rankFamilyScore(a, family))[0];
    if (!pick) return { status: "ask", family, product: null, mode: "storeBrand", swapped: null, ask: true };
    return { status: "storeBrand", family, product: pick, mode: "storeBrand", swapped: null, ask: false };
  }
  if (pref.mode === "cheapest") {
    const storeName = input?.storeName || "";
    if (storeName) {
      const pick = pickAtStore(rows, family, "cheapest", storeName, pref);
      if (!pick) return { status: "ask", family, product: null, mode: "cheapest", swapped: null, ask: true };
      return { status: "cheapest", family, product: pick, mode: "cheapest", swapped: null, ask: false };
    }
    const priced = rows
      .map((product) => ({ product, unit: unitPriceAmount(product), price: priceOf(product) }))
      .filter((row) => row.unit != null || row.price != null);
    if (!priced.length) return { status: "ask", family, product: null, mode: "cheapest", swapped: null, ask: true };
    priced.sort((a, b) => (a.unit ?? a.price) - (b.unit ?? b.price));
    return { status: "cheapest", family, product: priced[0].product, mode: "cheapest", swapped: null, ask: false };
  }
  return { status: "ask", family, product: null, mode: "", swapped: null, ask: true };
}

/**
 * Split a sentence or a pasted line into staple items.
 * "I need bread, milk, eggs, bacon, steak, chili, cilantro" -> those families.
 * @param {string} text
 */
export function parseNeedItems(text) {
  const cleaned = String(text || "")
    .replace(/^(?:i need|we need|please (?:get|add)|get me|add)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];
  return cleaned
    .split(/\s*(?:,|;|\n|\band\b)\s*/i)
    .map((part) => part.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 24)
    .map((raw) => ({ raw, family: familyFromQuery(raw) || "" }));
}

/** A grocery list of staples, not a meal sentence. */
export function isPreferenceList(text) {
  const items = parseNeedItems(text);
  if (items.length < 2) return false;
  const known = items.filter((item) => item.family).length;
  return known >= 2 && known / items.length >= 0.6;
}

/**
 * Resolve every item in a multi-item request.
 * Items with a saved mode get a real product. The rest are asked once.
 */
export function resolveNeedList(input) {
  const items = parseNeedItems(input?.text || "");
  const added = [];
  const ask = [];
  for (const item of items) {
    if (!item.family) {
      ask.push({ ...item, reason: "unknown" });
      continue;
    }
    const resolved = resolveCategoryPreference({
      profile: input?.profile,
      family: item.family,
      query: item.raw,
      products: input?.products,
      storeName: input?.storeName,
    });
    if (resolved.status === "excluded") {
      added.push({ ...item, ...resolved, excluded: true });
      continue;
    }
    if (resolved.declined || resolved.status === "never") {
      added.push({ ...item, ...resolved, excluded: true, declined: true });
      continue;
    }
    if (!resolved.product || resolved.ask) {
      ask.push({ ...item, reason: resolved.status || "ask" });
      continue;
    }
    added.push({ ...item, ...resolved, excluded: false });
  }
  return { items, added: added.filter((row) => row.product), skipped: added.filter((row) => row.excluded), ask };
}

/** Cuts and types that actually appear on this shelf. */
function shelfText(product) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  return [product, ...variants]
    .map((row) => `${row?.name || ""} ${row?.catalogName || ""} ${row?.familyName || ""} ${row?.sizeLabel || ""} ${row?.variantLabel || ""}`)
    .join(" ");
}

export function cutsInShelf(products, familyId) {
  return attributeTests(familyId)
    .filter((row) => (products || []).some((product) => productMatchesFamily(product, familyId) && row.test.test(shelfText(product))))
    .map((row) => ({ id: row.id, label: row.label }));
}

export function nameBrandsFor(products, familyId) {
  const counts = new Map();
  for (const product of products || []) {
    if (!productMatchesFamily(product, familyId)) continue;
    if (isHouseBrand(product) || isStoreBrand(product.brand, product)) continue;
    const brand = clean(product.brand, 80);
    if (!brand || /^(fresh|produce|organic)$/i.test(brand)) continue;
    const key = brand.toLowerCase();
    const row = counts.get(key) || { brand, count: 0, score: 0, product: product };
    row.count += 1;
    const score = rankFamilyScore(product, familyId);
    if (score >= row.score) {
      row.score = score;
      row.product = product;
    }
    counts.set(key, row);
  }
  return [...counts.values()]
    .sort((a, b) => b.score - a.score || b.count - a.count || a.brand.localeCompare(b.brand))
    .slice(0, 8);
}

export function learnCategoryFromProduct(profile, product, at = Date.now()) {
  const family = classifyProduct(product);
  if (!family || !product?.id) return parseProfile(profile);
  return setCategoryPreference(
    profile,
    {
      family,
      mode: "brand",
      brand: product.brand || "",
      productId: product.id,
      size: product.sizeLabel || product.variantLabel || product.size || "",
      attributes: [],
    },
    at
  );
}

export function preferenceCategories() {
  return PREFERENCE_CATEGORIES;
}

export function categorySearch(familyId) {
  return searchTermFor(familyId);
}

export { familyFromQuery, familyLabel, classifyProduct, productMatchesFamily };
