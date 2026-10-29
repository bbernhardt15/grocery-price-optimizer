/**
 * Resolve a grocery word to the shopper's exact product.
 *
 * Call `resolveProductPreference({ profile, query, products })`.
 * `products` must be real catalog rows. This module never invents a
 * product, a photo, or a price. Allergy and diet rules beat a preference.
 * A missing favorite becomes the closest same-family catalog row, and the
 * plan is the only place that says "We swapped X for Y".
 */

import { parseProfile } from "./profile.js";
import { productExcluded, productHaystack, exclusionForText, slotText } from "./profileConstraints.js";
import { resolveSlot, scaleQuantity } from "./themedLists.js";
import {
  classifyProduct,
  familyFromQuery as familyFromStaple,
  familyLabel as stapleFamilyLabel,
  PREFERENCE_CATEGORIES,
  productMatchesFamily as stapleMatches,
} from "./stapleFamilies.js";

const STORE_BRANDS = new Set(
  [
    "kroger",
    "simple truth",
    "private selection",
    "great value",
    "marketside",
    "equate",
    "parent's choice",
    "good & gather",
    "up & up",
    "favorite day",
    "friendly farms",
    "kirkwood",
    "l'oven fresh",
    "goldhen",
    "earthly grains",
    "reggano",
    "countryside creamery",
    "millville",
    "clancy's",
    "specially selected",
    "aldi",
  ].map((brand) => brand.toLowerCase())
);

/** Mirrors the catalog store-brand list. A brand not in this set is a name brand. */
export function isStoreBrand(brand, product) {
  if (product?.storeBrand === true) return true;
  return STORE_BRANDS.has(String(brand || "").trim().toLowerCase());
}

/** A price that is already on the catalog row. Missing prices stay missing. */
export function priceOf(product) {
  const amount = Number(product?.typicalPrice ?? product?.price ?? product?.bestOffer?.price);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

const FAMILIES = PREFERENCE_CATEGORIES;

const FAMILY_CATEGORY = {
  butter: "dairy",
  milk: "dairy",
  eggs: "dairy",
  cheese: "dairy",
  yogurt: "dairy",
  chicken: "meat",
  "ground-beef": "meat",
  bread: "pantry",
  pasta: "pantry",
  cereal: "pantry",
  coffee: "pantry",
  soda: "drinks",
  chips: "snacks",
  bananas: "produce",
  "peanut-butter": "pantry",
};

export const STAPLES = PREFERENCE_CATEGORIES.map((family) => ({
  id: family.id,
  label: family.label,
  search: family.search,
}));

export function familyFromQuery(query) {
  return familyFromStaple(query);
}

export function familyLabel(id) {
  return stapleFamilyLabel(id);
}

export function brandModeFor(profile, category) {
  const overrides = profile?.brand?.overrides || {};
  if (category && overrides[category]) return overrides[category];
  return profile?.brand?.default || null;
}

export function categoryForFamily(family) {
  return FAMILY_CATEGORY[family] || "";
}

function none(family = "") {
  return { status: "none", product: null, family, warning: "", change: false, swapped: null, locked: false };
}

export function isBlockedProduct(profile, product) {
  const id = String(product?.id || product?.catalogId || "");
  const upc = String(product?.upc || "").replace(/\D/g, "");
  return (profile?.neverProducts || []).some((row) => (id && row.catalogId === id) || (upc && row.upc && row.upc === upc));
}

function allowedProducts(profile, products) {
  return (products || []).filter((product) => product?.id && !productExcluded(profile, product).excluded && !isBlockedProduct(profile, product));
}

function productMatchesFamily(product, family) {
  return stapleMatches(product, family);
}

const STOP = new Set(["the", "and", "with", "for", "pack", "oz", "fl", "ct", "classic", "size", "original", "style"]);

function tokens(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOP.has(token) && !/^\d+$/.test(token));
}

function closestByName(products, wanted) {
  const want = new Set([...tokens(wanted?.name), ...tokens(wanted?.brand), ...tokens(wanted?.familyName)]);
  let best = null;
  let bestScore = 0;
  for (const product of products) {
    const have = new Set([...tokens(product.name), ...tokens(product.familyName), ...tokens(product.brand)]);
    let score = 0;
    for (const token of want) if (have.has(token)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = product;
    }
  }
  return bestScore >= 1 ? best : products[0] || null;
}

function preferenceLabel(pref) {
  const brand = String(pref?.brand || "").trim();
  const name = String(pref?.name || pref?.familyName || "that product").trim();
  if (brand && !name.toLowerCase().includes(brand.toLowerCase())) return `${brand} ${name}`;
  return name;
}

function productLabel(product) {
  const brand = String(product?.brand || "").trim();
  const name = String(product?.familyName || product?.name || "that product").trim();
  if (brand && !name.toLowerCase().includes(brand.toLowerCase())) return `${brand} ${name}`;
  return name;
}

/**
 * Organic wins only when both prices are already on the rows and the
 * organic price is within 15% of the other choice.
 */
export function pickByBrand(products, mode, organicIfClose) {
  const rows = (products || []).filter((product) => product?.id);
  if (!rows.length || !mode) return null;
  let pool = rows;
  if (mode === "store") {
    const stores = rows.filter((product) => isStoreBrand(product.brand, product));
    if (stores.length) pool = stores;
  } else if (mode === "name") {
    const names = rows.filter((product) => !isStoreBrand(product.brand, product));
    if (names.length) pool = names;
  } else if (mode === "cheaper") {
    const priced = rows.filter((product) => priceOf(product) != null);
    if (priced.length) {
      priced.sort((a, b) => priceOf(a) - priceOf(b));
      pool = priced;
    }
  }
  if (organicIfClose) {
    const organic = pool.filter((product) => /\borganic\b/i.test(`${product.name} ${product.brand}`));
    const regular = pool.filter((product) => !/\borganic\b/i.test(`${product.name} ${product.brand}`));
    const organicPrices = organic.map(priceOf).filter((price) => price != null);
    const regularPrices = regular.map(priceOf).filter((price) => price != null);
    if (organicPrices.length && regularPrices.length) {
      const cheapestOrganic = Math.min(...organicPrices);
      const cheapestRegular = Math.min(...regularPrices);
      if (cheapestOrganic <= cheapestRegular * 1.15) {
        return organic.find((product) => priceOf(product) === cheapestOrganic) || organic[0];
      }
    }
  }
  if (mode === "cheaper") {
    const priced = pool.filter((product) => priceOf(product) != null);
    if (!priced.length) return pool[0];
    priced.sort((a, b) => priceOf(a) - priceOf(b));
    return priced[0];
  }
  return pool[0];
}

/**
 * @param {{ profile: object, query?: string, products?: object[], family?: string }} input
 */
export function resolveProductPreference(input) {
  const profile = input?.profile || {};
  const query = String(input?.query || "");
  const family = input?.family || familyFromQuery(query);
  if (!family) return none();
  if (query && exclusionForText(profile, query).excluded) {
    return {
      status: "excluded",
      product: null,
      family,
      warning: `${exclusionForText(profile, query).warning} These results are still here because you searched for them.`,
      change: false,
      swapped: null,
      locked: false,
    };
  }
  const allowed = allowedProducts(profile, input?.products);
  const pref = profile.productPreferences?.[family];
  if (pref) {
    const prefExcluded = productExcluded(profile, { name: pref.name, brand: pref.brand }).excluded || isBlockedProduct(profile, pref);
    const cousins = allowed.filter((product) => productMatchesFamily(product, family));
    if (!prefExcluded) {
      const hit = allowed.find((product) => product.id === pref.catalogId || (pref.upc && product.upc === pref.upc));
      if (hit) {
        return { status: "preferred", product: hit, family, warning: "", change: true, swapped: null, locked: Boolean(pref.locked) };
      }
      const closest = cousins.length ? closestByName(cousins, pref) : null;
      if (closest) {
        return {
          status: "swapped",
          product: closest,
          family,
          warning: "",
          change: true,
          locked: Boolean(pref.locked),
          swapped: { from: preferenceLabel(pref), to: productLabel(closest) },
        };
      }
    } else if (cousins.length) {
      const closest = closestByName(cousins, pref);
      if (closest) {
        return {
          status: "swapped",
          product: closest,
          family,
          warning: "",
          change: true,
          locked: false,
          swapped: { from: preferenceLabel(pref), to: productLabel(closest) },
        };
      }
    }
  }
  const mode = brandModeFor(profile, categoryForFamily(family));
  const candidates = allowed.filter((product) => productMatchesFamily(product, family));
  if (mode && candidates.length) {
    const pick = pickByBrand(candidates, mode, Boolean(profile.brand?.organicIfClose));
    if (pick) return { status: "brand", product: pick, family, warning: "", change: true, swapped: null, locked: false };
  }
  return none(family);
}

export function learnPreference(profile, product, options = {}) {
  const next = parseProfile(profile);
  const family = options.family || classifyProduct(product);
  if (!family || !product) return next;
  if (productExcluded(next, product).excluded || isBlockedProduct(next, product)) return next;
  const current = next.productPreferences[family];
  const locked = options.locked === true;
  if (current?.locked && !locked && !options.replace) {
    if (options.askedId) next.askedLock = { ...next.askedLock, [family]: options.askedId };
    return next;
  }
  next.productPreferences = {
    ...next.productPreferences,
    [family]: {
      family,
      catalogId: String(product.id || product.catalogId || ""),
      upc: String(product.upc || "").replace(/\D/g, ""),
      brand: String(product.brand || ""),
      name: String(product.familyName || product.catalogName || product.name || familyLabel(family)),
      sizeLabel: String(product.variantLabel || product.sizeLabel || product.size || ""),
      imageUrl: String(product.imageUrls?.[0] || product.imageUrl || ""),
      locked,
      source: options.source || "manual",
      updatedAt: options.at || Date.now(),
    },
  };
  if (options.askedId) next.askedLock = { ...next.askedLock, [family]: options.askedId };
  next.updatedAt = options.at || Date.now();
  return next;
}

export function blockProduct(profile, product, at = Date.now()) {
  const next = parseProfile(profile);
  const family = classifyProduct(product);
  const row = {
    family,
    catalogId: String(product?.id || product?.catalogId || ""),
    upc: String(product?.upc || "").replace(/\D/g, ""),
    brand: String(product?.brand || ""),
    name: String(product?.familyName || product?.name || ""),
    updatedAt: at,
  };
  if (!row.catalogId && !row.name) return next;
  next.neverProducts = [...next.neverProducts.filter((item) => item.catalogId !== row.catalogId), row].slice(-40);
  if (family && next.productPreferences[family]?.catalogId === row.catalogId) {
    const prefs = { ...next.productPreferences };
    delete prefs[family];
    next.productPreferences = prefs;
  }
  next.updatedAt = at;
  return next;
}

export function forgetPreference(profile, family, at = Date.now()) {
  const next = parseProfile(profile);
  const prefs = { ...next.productPreferences };
  delete prefs[family];
  next.productPreferences = prefs;
  next.updatedAt = at;
  return next;
}

export function unblockProduct(profile, catalogId, at = Date.now()) {
  const next = parseProfile(profile);
  next.neverProducts = next.neverProducts.filter((item) => item.catalogId !== catalogId);
  next.updatedAt = at;
  return next;
}

export function shouldAskAlways(profile, product) {
  const family = classifyProduct(product);
  if (!family || !product?.id) return false;
  if (productExcluded(profile, product).excluded) return false;
  const pref = profile?.productPreferences?.[family];
  if (pref?.locked) return false;
  if (profile?.askedLock?.[family] === product.id) return false;
  return true;
}

export function acceptAlways(profile, product, source = "add", at = Date.now()) {
  const next = learnPreference(profile, product, { locked: true, source, at });
  const family = classifyProduct(product);
  if (family) {
    const asked = { ...next.askedLock };
    delete asked[family];
    next.askedLock = asked;
  }
  return next;
}

export function declineAlways(profile, product, at = Date.now()) {
  return learnPreference(profile, product, {
    locked: false,
    source: "add",
    at,
    askedId: product?.id,
  });
}

function choiceFromPreference(pref) {
  if (!pref) return null;
  return {
    catalogId: pref.catalogId,
    familyKey: "",
    familyName: pref.name,
    name: pref.name,
    brand: pref.brand,
    sizeLabel: pref.sizeLabel,
    updatedAt: pref.updatedAt || 0,
  };
}

/**
 * Starter-list slot. Exclusions win. A product preference is the favorite.
 * Brand mode picks among real shelf rows when there is no favorite.
 * @param {{ profile: object, slot: object, favorite?: object, override?: object, products?: object[], people?: number, quantity?: number }} input
 */
export function guideSlot(input) {
  const profile = input.profile || {};
  const slot = input.slot;
  const people = input.people;
  const quantity = input.quantity == null ? scaleQuantity(slot?.serves || 4, people) : input.quantity;
  if (profile.categoryPreferences?.[slot?.id]?.mode === "never") {
    return { quantity: quantity || 1, product: null, source: "excluded", swapped: null, missing: true, excluded: true, status: "excluded" };
  }
  const products = input.products || [];
  const allowed = allowedProducts(profile, products);
  const matching = allowed.filter((product) => {
    const family = familyFromQuery(slot?.id) || familyFromQuery(slot?.search) || familyFromQuery(slot?.label);
    if (family) return productMatchesFamily(product, family);
    const want = String(slot?.search || slot?.label || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2);
    if (!want.length) return false;
    const have = new Set(productHaystack(product).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    return want.every((token) => have.has(token));
  });
  if (exclusionForText(profile, slotText(slot)).excluded && matching.length === 0) {
    return { quantity: quantity || 1, product: null, source: "excluded", swapped: null, missing: true, excluded: true, status: "excluded" };
  }
  const pref = profile.productPreferences?.[slot?.id];
  const prefBlocked = pref && (productExcluded(profile, { name: pref.name, brand: pref.brand }).excluded || isBlockedProduct(profile, pref));
  const override = input.override && input.override.cleared === true ? null : input.override || null;
  const favorite = input.favorite || (!override && pref && !prefBlocked ? choiceFromPreference(pref) : null);
  const searchTokens = String(slot?.search || slot?.label || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !/^(?:the|and|with|for)$/.test(token));
  const named = allowed.filter((product) => {
    if (!searchTokens.length) return false;
    const have = productHaystack(product).toLowerCase();
    return searchTokens.every((token) => have.includes(token));
  });
  const shelf = matching.length ? matching : named;
  if (!favorite && !override) {
    const mode = brandModeFor(profile, categoryForFamily(slot?.id) || categoryForFamily(familyFromQuery(slot?.search)));
    if (mode && matching.length) {
      const pick = pickByBrand(matching, mode, Boolean(profile.brand?.organicIfClose));
      if (pick) {
        return { quantity: quantity || 1, product: pick, source: "brand", swapped: null, missing: false, excluded: false, status: "brand" };
      }
    }
  }
  const resolved = resolveSlot({
    slot,
    people,
    favorite,
    override,
    products: shelf,
    quantity,
  });
  if (pref && !prefBlocked && resolved.swapped) {
    return { ...resolved, excluded: false, status: "swapped" };
  }
  return { ...resolved, excluded: false, status: resolved.product ? "resolved" : "none" };
}

export function swapSentence(swapped) {
  if (!swapped?.from || !swapped?.to) return "";
  return `We swapped ${swapped.from} for ${swapped.to}`;
}
