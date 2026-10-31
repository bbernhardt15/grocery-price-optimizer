/**
 * Shopper taste profile.
 *
 * Guests keep it on this device (`gg-profile`). A signed-in shopper also
 * sends it with the saved list. The ask box and the trip plan should call
 * `getUserProfile()` and pass the object into the constraint and
 * product-preference modules. This file does not invent products or prices.
 */

import { ONBOARDING_KEY } from "./onboarding.js";

export const PROFILE_KEY = "gg-profile";
export const PROFILE_VERSION = 1;

const WHY = ["save-money", "less-stress", "feed-family", "meal-ideas", "specific-diet", "stock-up"];
const FOODS = ["fruit", "vegetables", "chicken", "beef", "pork", "seafood", "eggs", "dairy", "cheese", "bread", "pasta", "rice", "beans", "snacks", "sweets", "coffee", "soda"];
const CUISINES = ["mexican", "italian", "american", "chinese", "indian", "mediterranean", "thai", "southern", "japanese", "middle-eastern"];
const ALLERGIES = ["peanut", "tree-nut", "milk", "egg", "wheat", "soy", "fish", "shellfish", "sesame"];
const DIETS = [
  "carnivore",
  "atkins",
  "paleo",
  "whole30",
  "low-carb",
  "keto",
  "gluten-free",
  "vegetarian",
  "vegan",
  "pescatarian",
  "halal",
  "kosher",
  "low-sodium",
  "diabetic-friendly",
  "dairy-free",
];
const BRANDS = ["name", "store", "cheaper"];
const BRAND_AISLES = ["dairy", "meat", "produce", "pantry", "snacks", "drinks"];
const SHOPPING = ["one-stop", "split", "weekly", "quick"];
const STOPS = ["1", "2", "3", "more"];
const COOKING = ["beginner", "comfortable", "confident"];
const TIME = ["15", "30", "60", "unhurried"];
const SOURCES = ["onboarding", "add", "swap", "import", "manual"];

function blank(now = 0) {
  return {
    version: PROFILE_VERSION,
    updatedAt: now,
    onboarding: { status: "new", step: "place", updatedAt: now },
    why: [],
    household: { size: null, kids: null, picky: null },
    loves: [],
    avoids: [],
    cuisines: {},
    allergies: [],
    diets: [],
    dietNotes: [],
    dietPrompt: "",
    shopStores: [],
    always: [],
    never: [],
    mustHaves: [],
    brand: { default: null, organicIfClose: false, overrides: {} },
    style: { shopping: null, cooking: null, time: null },
    productPreferences: {},
    categoryPreferences: {},
    neverProducts: [],
    askedLock: {},
  };
}

/** A profile with no answers. `updatedAt` stays 0 until something is saved. */
export function emptyProfile() {
  return blank(0);
}

function clean(value, max = 80) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function pickIds(value, allowed, max = 24) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value) {
    const id = clean(entry, 40).toLowerCase();
    if (!allowed.includes(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

function pickStoreNames(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value) {
    const name = clean(entry, 40);
    if (!/^[A-Za-z0-9&.' -]{2,40}$/.test(name) || out.some((item) => item.toLowerCase() === name.toLowerCase())) continue;
    out.push(name);
    if (out.length >= 24) break;
  }
  return out;
}

function phrases(value) {
  const source = Array.isArray(value) ? value.join(",") : value;
  return String(source || "")
    .split(/[\n,]/)
    .map((part) => clean(part, 60))
    .filter((part) => part.length >= 3)
    .slice(0, 24);
}

function boolOrNull(value) {
  if (value === true || value === false) return value;
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

function stamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(Math.floor(number), 9e15);
}

function preferenceOf(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value;
  const name = clean(row.name || row.familyName, 120);
  if (!name) return null;
  const family = clean(row.family, 40).toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(family)) return null;
  const catalogId = clean(row.catalogId || row.id, 80);
  const upc = clean(row.upc, 20).replace(/\D/g, "");
  const source = SOURCES.includes(row.source) ? row.source : "manual";
  return {
    family,
    catalogId: /^[A-Za-z0-9:_-]{1,80}$/.test(catalogId) ? catalogId : "",
    upc,
    brand: clean(row.brand, 80),
    name,
    sizeLabel: clean(row.sizeLabel || row.size, 80),
    imageUrl: clean(row.imageUrl, 240),
    locked: row.locked === true || row.locked === "yes",
    source,
    updatedAt: stamp(row.updatedAt),
  };
}

function neverOf(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const name = clean(value.name, 120);
  const catalogId = clean(value.catalogId || value.id, 80);
  if (!name && !catalogId) return null;
  return {
    family: clean(value.family, 40).toLowerCase(),
    catalogId: /^[A-Za-z0-9:_-]{1,80}$/.test(catalogId) ? catalogId : "",
    upc: clean(value.upc, 20).replace(/\D/g, ""),
    brand: clean(value.brand, 80),
    name,
    updatedAt: stamp(value.updatedAt),
  };
}

/**
 * Read any saved object as the current profile.
 * A missing version, a partial object, and the string `"1"` all become version 1.
 * Unknown fields are dropped. Prices are never kept.
 * @param {unknown} raw
 */
export function parseProfile(raw) {
  let value = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return emptyProfile();
    try {
      value = JSON.parse(text);
    } catch {
      return emptyProfile();
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyProfile();
  const row = value;
  const profile = blank(stamp(row.updatedAt));
  const whySource = row.why || row.goals;
  profile.why = pickIds(whySource, WHY);
  const household = row.household && typeof row.household === "object" ? row.household : {};
  const size = Number(household.size);
  profile.household = {
    size: Number.isFinite(size) && size >= 1 ? Math.min(5, Math.floor(size)) : null,
    kids: boolOrNull(household.kids),
    picky: boolOrNull(household.picky ?? household.pickyEaters),
  };
  profile.loves = pickIds(row.loves, FOODS);
  profile.avoids = pickIds(row.avoids, FOODS);
  const cuisines = {};
  if (row.cuisines && typeof row.cuisines === "object" && !Array.isArray(row.cuisines)) {
    for (const id of CUISINES) {
      const stance = row.cuisines[id];
      if (stance === "like" || stance === "dislike") cuisines[id] = stance;
    }
  }
  profile.cuisines = cuisines;
  profile.allergies = pickIds(row.allergies, ALLERGIES);
  profile.diets = pickIds(row.diets, DIETS);
  profile.dietNotes = phrases(row.dietNotes).slice(0, 8);
  profile.dietPrompt = row.dietPrompt === "asked" || row.dietPrompt === "skipped" ? row.dietPrompt : "";
  profile.shopStores = pickStoreNames(row.shopStores);
  profile.always = phrases(row.always);
  profile.never = phrases(row.never);
  profile.mustHaves = phrases(row.mustHaves).length ? phrases(row.mustHaves) : profile.always.slice();
  const brand = row.brand && typeof row.brand === "object" ? row.brand : {};
  const overrides = {};
  if (brand.overrides && typeof brand.overrides === "object") {
    for (const aisle of BRAND_AISLES) {
      if (BRANDS.includes(brand.overrides[aisle])) overrides[aisle] = brand.overrides[aisle];
    }
  }
  profile.brand = {
    default: BRANDS.includes(brand.default) ? brand.default : null,
    organicIfClose: brand.organicIfClose === true,
    overrides,
  };
  const style = row.style && typeof row.style === "object" ? row.style : {};
  profile.style = {
    shopping: SHOPPING.includes(style.shopping) ? style.shopping : null,
    stops: STOPS.includes(style.stops) ? style.stops : null,
    cooking: COOKING.includes(style.cooking) ? style.cooking : null,
    time: TIME.includes(style.time) ? style.time : null,
  };
  const prefs = {};
  const sourcePrefs = row.productPreferences || row.preferences;
  if (sourcePrefs && typeof sourcePrefs === "object" && !Array.isArray(sourcePrefs)) {
    for (const [key, entry] of Object.entries(sourcePrefs).slice(0, 40)) {
      const pref = preferenceOf({ ...entry, family: entry?.family || key });
      if (pref) prefs[pref.family] = pref;
    }
  }
  profile.productPreferences = prefs;
  const categoryPreferences = {};
  const sourceCategories = row.categoryPreferences;
  if (sourceCategories && typeof sourceCategories === "object" && !Array.isArray(sourceCategories)) {
    for (const [key, entry] of Object.entries(sourceCategories).slice(0, 64)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const mode = ["brand", "storeBrand", "cheapest", "skip", "never"].includes(entry.mode) ? entry.mode : "";
      const family = clean(entry.family || key, 40).toLowerCase();
      if (!mode || !/^[a-z0-9-]{2,40}$/.test(family)) continue;
      const productId = clean(entry.productId || entry.catalogId, 80);
      const source = ["receipt", "onboarding", "add", "manual"].includes(entry.source) ? entry.source : "";
      const confidence = entry.confidence === "high" || entry.confidence === "low" ? entry.confidence : "";
      categoryPreferences[family] = {
        family,
        mode,
        brand: clean(entry.brand, 80),
        productId: /^[A-Za-z0-9:_-]{1,80}$/.test(productId) ? productId : "",
        size: clean(entry.size || entry.sizeLabel, 80),
        attributes: Array.isArray(entry.attributes)
          ? entry.attributes.map((item) => clean(item, 40).toLowerCase()).filter(Boolean).slice(0, 8)
          : [],
        source,
        confidence,
        count: Math.max(0, Math.min(999, Math.floor(Number(entry.count) || 0))),
        label: clean(entry.label, 80),
        updatedAt: stamp(entry.updatedAt),
      };
    }
  }
  profile.categoryPreferences = categoryPreferences;
  profile.neverProducts = Array.isArray(row.neverProducts)
    ? row.neverProducts.map(neverOf).filter(Boolean).slice(0, 40)
    : [];
  const asked = {};
  if (row.askedLock && typeof row.askedLock === "object") {
    for (const [key, id] of Object.entries(row.askedLock).slice(0, 40)) {
      const family = clean(key, 40).toLowerCase();
      const catalogId = clean(id, 80);
      if (/^[a-z0-9-]{2,40}$/.test(family) && catalogId) asked[family] = catalogId;
    }
  }
  profile.askedLock = asked;
  const onboard = row.onboarding && typeof row.onboarding === "object" ? row.onboarding : {};
  const status = ["new", "in_progress", "done", "skipped"].includes(onboard.status) ? onboard.status : "new";
  profile.onboarding = {
    status,
    step: clean(onboard.step, 40) || "why",
    updatedAt: stamp(onboard.updatedAt || row.updatedAt),
  };
  return profile;
}

function storageOf(storage) {
  if (storage) return storage;
  if (typeof localStorage !== "undefined") return localStorage;
  return null;
}

/** The profile on this device. Missing or broken storage is an empty profile. */
export function getUserProfile(storage) {
  const store = storageOf(storage);
  if (!store) return emptyProfile();
  try {
    return parseProfile(store.getItem(PROFILE_KEY));
  } catch {
    return emptyProfile();
  }
}

export function profileIsStored(storage) {
  const store = storageOf(storage);
  if (!store) return false;
  try {
    return Boolean(store.getItem(PROFILE_KEY));
  } catch {
    return false;
  }
}

/** Persist a profile. The saved `updatedAt` is the time of this write. */
export function saveUserProfile(storage, profile, at = Date.now()) {
  const store = storageOf(storage);
  const next = parseProfile(profile);
  next.updatedAt = stamp(at) || Date.now();
  next.onboarding.updatedAt = next.updatedAt;
  if (!store) return next;
  try {
    store.setItem(PROFILE_KEY, JSON.stringify(next));
  } catch {
    /* private browsing */
  }
  return next;
}

/**
 * Newer answers win. A product preference is kept per family by its own time,
 * so one phone's butter lock is not wiped by an older list sync.
 * @param {unknown} local
 * @param {unknown} remote
 */
export function mergeProfiles(local, remote) {
  const left = parseProfile(local);
  const right = parseProfile(remote);
  if (!left.updatedAt && !right.updatedAt) return left;
  const newer = right.updatedAt >= left.updatedAt ? right : left;
  const older = newer === right ? left : right;
  const productPreferences = { ...older.productPreferences };
  for (const [key, pref] of Object.entries(newer.productPreferences)) {
    const current = productPreferences[key];
    const newerTime = !current || pref.updatedAt > current.updatedAt;
    const sameTimeLock = current && pref.updatedAt === current.updatedAt && pref.locked && !current.locked;
    if (newerTime || sameTimeLock) productPreferences[key] = pref;
  }
  const categoryPreferences = { ...(older.categoryPreferences || {}) };
  for (const [key, pref] of Object.entries(newer.categoryPreferences || {})) {
    const current = categoryPreferences[key];
    if (!current || pref.updatedAt > current.updatedAt) categoryPreferences[key] = pref;
  }
  return { ...newer, productPreferences, categoryPreferences, updatedAt: Math.max(left.updatedAt, right.updatedAt) };
}

/**
 * First visit shows the guide. A phone that already finished the old
 * two-screen welcome is not forced through it. An in-progress guide resumes.
 * @param {{ getItem: (key: string) => string | null }} storage
 */
export function shouldPromptProfile(storage) {
  const store = storageOf(storage);
  if (!store) return false;
  let legacy = false;
  let raw = null;
  try {
    legacy = store.getItem(ONBOARDING_KEY) === "1";
    raw = store.getItem(PROFILE_KEY);
  } catch {
    return false;
  }
  if (!raw) return !legacy;
  const profile = parseProfile(raw);
  if (profile.onboarding.status === "done" || profile.onboarding.status === "skipped") return false;
  if (profile.onboarding.status === "in_progress") return true;
  return !legacy;
}

export const PROFILE_OPTIONS = {
  why: WHY,
  foods: FOODS,
  cuisines: CUISINES,
  allergies: ALLERGIES,
  diets: DIETS,
  brands: BRANDS,
  aisles: BRAND_AISLES,
  shopping: SHOPPING,
  stops: STOPS,
  cooking: COOKING,
  time: TIME,
};
