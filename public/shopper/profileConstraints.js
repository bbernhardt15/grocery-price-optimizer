/**
 * Turn a taste profile into hard filters and a constraint object.
 *
 * The ask box should call `profileToConstraints(getUserProfile())` and send
 * that object with a meal-idea request. Search, starter lists, and matching
 * should call `productExcluded` / `filterTiles`. Matching uses the words on
 * the product. It is not a medical check. Shoppers still read the label.
 */

import { THEMED_LISTS } from "./themedLists.js";

const NON_DAIRY_BUTTER = [
  "peanut butter",
  "almond butter",
  "cashew butter",
  "sunflower butter",
  "apple butter",
  "cocoa butter",
  "shea butter",
  "cookie butter",
];
const NON_DAIRY_MILK = ["almond milk", "oat milk", "soy milk", "coconut milk", "rice milk", "cashew milk", "flax milk", "hemp milk"];

const FOOD_WORDS = {
  fruit: /\b(apples?|bananas?|berries|grapes|oranges?|fruit)\b/i,
  vegetables: /\b(spinach|lettuce|broccoli|carrots?|potatoes|vegetables?|salad)\b/i,
  chicken: /\bchicken\b/i,
  beef: /\b(beef|steaks?)\b/i,
  pork: /\b(pork|bacon|hams?)\b/i,
  seafood: /\b(fish|salmon|tuna|shrimp|crab|seafood)\b/i,
  eggs: /\beggs?\b/i,
  dairy: /\b(milk|cheese|yogurt|butter|dairy)\b/i,
  cheese: /\b(cheese|cheddar)\b/i,
  bread: /\bbreads?\b/i,
  pasta: /\b(pastas?|spaghetti)\b/i,
  rice: /\brice\b/i,
  beans: /\bbeans?\b/i,
  snacks: /\b(chips|crackers|snacks?)\b/i,
  sweets: /\b(candy|cookies?|cakes?|ice cream|chocolate)\b/i,
  coffee: /\bcoffees?\b/i,
  soda: /\b(sodas?|colas?|coke)\b/i,
};

const CUISINE_LISTS = {
  mexican: ["taco-night"],
  italian: ["weeknight"],
  american: ["cookout", "game-day", "tailgate"],
  chinese: ["weeknight"],
  indian: ["weeknight"],
  mediterranean: ["weeknight"],
  thai: ["weeknight"],
  southern: ["cookout"],
  japanese: ["weeknight"],
  "middle-eastern": ["weeknight"],
};

const LOVE_LISTS = {
  chicken: ["weeknight"],
  beef: ["taco-night", "cookout"],
  seafood: ["weeknight"],
  eggs: ["breakfast"],
  coffee: ["breakfast"],
  bread: ["breakfast", "weekly"],
  pasta: ["weeknight"],
  snacks: ["game-day", "movie-night"],
  soda: ["cookout", "game-day"],
  fruit: ["weekly", "breakfast"],
  vegetables: ["weeknight", "weekly"],
};

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripPhrases(text, phrases) {
  let next = ` ${text.toLowerCase()} `;
  for (const phrase of phrases) {
    next = next.replace(new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "gi"), " ");
  }
  return next.replace(/\s+/g, " ").trim();
}

export function dairyHit(text) {
  const raw = clean(text);
  if (!raw) return false;
  if (/dairy[-\s]?free/i.test(raw)) return false;
  if (/\b(vegan butter|plant butter|plant-based butter)\b/i.test(raw)) return false;
  const body = stripPhrases(raw, [...NON_DAIRY_BUTTER, ...NON_DAIRY_MILK]);
  return /\b(milks?|cheeses?|cheddar|mozzarella|parmesan|yogurts?|yoghurt|butter|cream|whey|casein|lactose|ghee|dairy|buttermilk|half-and-half)\b/i.test(body);
}

export function eggHit(text) {
  const body = clean(text).replace(/\beggplants?\b/gi, " ");
  return /\beggs?\b|\bmayonnaise\b|\bmayo\b|\bmeringue\b/i.test(body);
}

export function glutenHit(text) {
  const raw = clean(text);
  if (!raw || /gluten[-\s]?free/i.test(raw)) return false;
  const body = raw.replace(/\bbuckwheat\b/gi, " ");
  return /\b(wheats?|gluten|barley|ryes?|flours?|breads?|pastas?|spaghetti|couscous|seitan|bagels?|tortillas?)\b/i.test(body);
}

export function peanutHit(text) {
  return /\bpeanuts?\b/i.test(clean(text));
}

export function treeNutHit(text) {
  return /\b(almonds?|cashews?|walnuts?|pecans?|pistachios?|hazelnuts?|macadamias?|brazil nuts?|pralines?|tree nuts?)\b/i.test(clean(text));
}

export function soyHit(text) {
  return /\b(soy|soya|tofu|edamame|miso|tempeh)\b/i.test(clean(text));
}

export function fishHit(text) {
  const body = clean(text).replace(/\bshellfish\b|\bstarfish\b/gi, " ");
  return /\b(fish|salmon|tuna|cod|tilapia|anchov(?:y|ies)|sardines?|trout|halibut|catfish|mahi)\b/i.test(body);
}

export function shellfishHit(text) {
  return /\b(shellfish|shrimps?|prawns?|crabs?|lobsters?|clams?|oysters?|mussels?|scallops?)\b/i.test(clean(text));
}

export function sesameHit(text) {
  return /\b(sesame|tahini)\b/i.test(clean(text));
}

export function meatHit(text) {
  const raw = clean(text);
  if (!raw || /\b(vegetarian|vegan|plant[-\s]?based|meatless|beyond|impossible)\b/i.test(raw)) return false;
  return /\b(beef|steaks?|pork|bacon|hams?|chicken|turkey|lamb|meats?|sausages?|pepperoni|salami|brisket|meatballs?)\b/i.test(raw);
}

export function ketoHit(text) {
  const raw = clean(text);
  if (!raw || /\b(keto|zero sugar|sugar[-\s]?free|diet)\b/i.test(raw)) return false;
  return /\b(breads?|pastas?|spaghetti|sodas?|colas?|cereals?|sugars?|flours?|rices?|tortillas?|cand(?:y|ies)|juices?|potatoes|chips)\b/i.test(raw);
}

export function halalHit(text) {
  return /\b(pork|bacon|hams?|pepperoni|beers?|wines?|alcohol|vodka|rum|whiskey|gelatin)\b/i.test(clean(text));
}

function rule(kind, id, label) {
  return { excluded: true, kind, id, reason: label, warning: warningFor(kind, label) };
}

function warningFor(kind, label) {
  if (kind === "allergy") {
    return `${label} is on your never-include list. We match the words on the product, so still read the label.`;
  }
  if (kind === "diet") return `${label} is one of your diets, so this stays off the list.`;
  if (kind === "avoid") return `You asked to avoid ${label.toLowerCase()}.`;
  return `You asked to never buy ${label}.`;
}

function allergyHit(id, text) {
  switch (id) {
    case "peanut":
      return peanutHit(text) ? "Peanut" : "";
    case "tree-nut":
      return treeNutHit(text) ? "Tree nuts" : "";
    case "milk":
      return dairyHit(text) ? "Milk" : "";
    case "egg":
      return eggHit(text) ? "Egg" : "";
    case "wheat":
      return glutenHit(text) ? "Wheat" : "";
    case "soy":
      return soyHit(text) ? "Soy" : "";
    case "fish":
      return fishHit(text) ? "Fish" : "";
    case "shellfish":
      return shellfishHit(text) ? "Shellfish" : "";
    case "sesame":
      return sesameHit(text) ? "Sesame" : "";
    default:
      return "";
  }
}

function dietHit(id, text) {
  switch (id) {
    case "vegetarian":
      return meatHit(text) || fishHit(text) || shellfishHit(text) ? "Vegetarian" : "";
    case "vegan":
      return meatHit(text) || fishHit(text) || shellfishHit(text) || dairyHit(text) || eggHit(text) || /\bhoney\b/i.test(text)
        ? "Vegan"
        : "";
    case "gluten-free":
      return glutenHit(text) ? "Gluten-free" : "";
    case "dairy-free":
      return dairyHit(text) ? "Dairy-free" : "";
    case "pescatarian":
      return meatHit(text) ? "Pescatarian" : "";
    case "keto":
      return ketoHit(text) ? "Keto" : "";
    case "halal":
      return halalHit(text) ? "Halal" : "";
    case "kosher":
      return halalHit(text) || shellfishHit(text) ? "Kosher" : "";
    case "carnivore":
      return /\b(breads?|pastas?|rices?|cereals?|sodas?|cand(?:y|ies)|flours?|sugars?|chips|lettuce|onions?|tomatoes?|cilantro|apples?|bananas?)\b/i.test(text)
        ? "Carnivore"
        : "";
    case "atkins":
    case "low-carb":
      return ketoHit(text) ? (id === "atkins" ? "Atkins" : "Low-carb") : "";
    case "paleo":
      return /\b(breads?|pastas?|rices?|cereals?|milks?|cheeses?|yogurts?|beans?|peanuts?|sodas?|sugars?|flours?)\b/i.test(text) ? "Paleo" : "";
    case "whole30":
      return /\b(breads?|pastas?|rices?|cereals?|milks?|cheeses?|sugars?|sodas?|beans?|soy|alcohol|wines?|beers?)\b/i.test(text) ? "Whole30" : "";
    case "diabetic-friendly":
      return /\b(sodas?|colas?|cand(?:y|ies)|sugars?|cookies?|cakes?)\b/i.test(text) ? "Diabetic-friendly" : "";
    case "low-sodium":
      return "";
    default:
      return "";
  }
}

function neverPhraseHit(text, phrases) {
  const hay = clean(text);
  for (const phrase of phrases || []) {
    const token = clean(phrase);
    if (token.length < 3) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(token).replace(/\s+/g, "\\s+")}\\b`, "i");
    if (pattern.test(hay)) return token;
  }
  return "";
}

/** @param {string} text */
export function exclusionForText(profile, text) {
  const hay = clean(text);
  if (!hay || !profile) return { excluded: false, kind: "", id: "", reason: "", warning: "" };
  for (const id of profile.allergies || []) {
    const label = allergyHit(id, hay);
    if (label) return rule("allergy", id, label);
  }
  for (const id of profile.diets || []) {
    const label = dietHit(id, hay);
    if (label) return rule("diet", id, label);
  }
  const dietNote = neverPhraseHit(hay, profile.dietNotes);
  if (dietNote) return rule("diet", "other", dietNote);
  for (const id of profile.avoids || []) {
    const pattern = FOOD_WORDS[id];
    if (pattern && pattern.test(hay)) return rule("avoid", id, id.charAt(0).toUpperCase() + id.slice(1));
  }
  const phrase = neverPhraseHit(hay, profile.never);
  if (phrase) return rule("never", "never", phrase);
  return { excluded: false, kind: "", id: "", reason: "", warning: "" };
}

export function productHaystack(product) {
  return [product?.name, product?.familyName, product?.catalogName, product?.brand, product?.subcategory]
    .map(clean)
    .filter(Boolean)
    .join(" ");
}

/** Allergy and diet rules. A blocked product id is handled by the preference module. */
export function productExcluded(profile, product) {
  return exclusionForText(profile, productHaystack(product));
}

/**
 * The shopper typed this themselves. Tell them, and do not hide the results.
 * @param {string} query
 */
export function exclusionWarning(profile, query) {
  const hit = exclusionForText(profile, query);
  if (!hit.excluded) return "";
  return `${hit.warning} These results are still here because you searched for them.`;
}

export function hasHardRules(profile) {
  if (!profile) return false;
  return Boolean(
    profile.allergies?.length || profile.diets?.length || profile.avoids?.length || profile.never?.length || profile.neverProducts?.length
  );
}

export function tileExcluded(profile, tile) {
  if (!hasHardRules(profile)) return false;
  const variants = Array.isArray(tile?.variants) && tile.variants.length ? tile.variants : [tile];
  const shown = variants.find((variant) => variant?.id && variant.id === tile?.defaultVariantId) || variants[0] || tile;
  return productExcluded(profile, shown).excluded || productExcluded(profile, { name: tile?.familyName || tile?.name, brand: tile?.brand }).excluded;
}

/** Hard filter for shelves, starter lists, and suggestions. Explicit searches stay unfiltered. */
export function filterTiles(profile, tiles, query = "") {
  if (!Array.isArray(tiles) || !tiles.length || !hasHardRules(profile)) return tiles || [];
  if (query && exclusionWarning(profile, query)) return tiles;
  return tiles.filter((tile) => !tileExcluded(profile, tile));
}

export function slotText(slot) {
  return [slot?.label, slot?.search, slot?.suggested?.name, slot?.suggested?.brand].map(clean).filter(Boolean).join(" ");
}

/** A starter slot whose own name is excluded, before a shelf is loaded. */
export function slotIsExcluded(profile, slot) {
  return exclusionForText(profile, slotText(slot)).excluded;
}

function listScore(list, profile, boost) {
  let score = boost?.has?.(list.id) ? 1 : 0;
  const blob = `${list.title} ${list.blurb} ${(list.slots || []).map((slot) => slot.label).join(" ")}`.toLowerCase();
  for (const [cuisine, ids] of Object.entries(CUISINE_LISTS)) {
    if (!ids.includes(list.id)) continue;
    if (profile?.cuisines?.[cuisine] === "like") score += 5;
    if (profile?.cuisines?.[cuisine] === "dislike") score -= 4;
  }
  for (const love of profile?.loves || []) {
    if ((LOVE_LISTS[love] || []).includes(list.id)) score += 2;
  }
  for (const avoid of profile?.avoids || []) {
    if (FOOD_WORDS[avoid] && FOOD_WORDS[avoid].test(blob)) score -= 2;
  }
  if ((profile?.why || []).includes("meal-ideas") && /taco|weeknight|dinner/.test(blob)) score += 1;
  if ((profile?.why || []).some((id) => id === "stock-up" || id === "save-money") && list.id === "weekly") score += 2;
  if ((profile?.why || []).includes("feed-family") && list.id === "weekly") score += 1;
  return score;
}

export function listFullyExcluded(profile, list) {
  const slots = list?.slots || [];
  if (!slots.length || !hasHardRules(profile)) return false;
  return slots.every((slot) => slotIsExcluded(profile, slot));
}

/** Likes and cuisines float a list up. A list whose every slot is excluded drops out. */
export function orderStarterLists(lists, profile, boost) {
  return (lists || [])
    .filter((list) => !listFullyExcluded(profile, list))
    .map((list) => ({ list, score: listScore(list, profile, boost) }))
    .sort((a, b) => b.score - a.score || 0)
    .map((row) => row.list);
}

export function firstListId(profile) {
  const everyday = ["weekly", "breakfast", "taco-night", "weeknight", "cookout"]
    .map((id) => THEMED_LISTS.find((list) => list.id === id))
    .filter(Boolean);
  return orderStarterLists(everyday, profile)[0]?.id || "weekly";
}

/** Household size, or null when they have not answered. 5 means 5 or more. */
export function defaultHeadcount(profile) {
  const size = Number(profile?.household?.size);
  if (!Number.isFinite(size) || size < 1) return null;
  return Math.min(5, Math.floor(size));
}

export function pinnedUsualRows(profile) {
  const names = profile?.mustHaves?.length ? profile.mustHaves : profile?.always || [];
  return names.map((name) => ({ name, brand: "", catalogId: "", quantity: 1 }));
}

function labels(ids, dictionary) {
  return (ids || []).map((id) => dictionary[id] || id);
}

const WHY_LABELS = {
  "save-money": "Save money",
  "less-stress": "Less stress",
  "feed-family": "Feed a family",
  "meal-ideas": "Meal ideas",
  "specific-diet": "A specific diet",
  "stock-up": "Stock up",
};

/**
 * Plain constraints for the ask box. No prices and no invented products.
 * Preferred products are only ones the shopper already picked.
 */
export function profileToConstraints(profile) {
  const source = profile || {};
  const liked = Object.entries(source.cuisines || {})
    .filter(([, stance]) => stance === "like")
    .map(([id]) => id);
  const disliked = Object.entries(source.cuisines || {})
    .filter(([, stance]) => stance === "dislike")
    .map(([id]) => id);
  const preferredProducts = Object.values(source.productPreferences || {}).map((pref) => ({
    family: pref.family,
    name: pref.name,
    brand: pref.brand || "",
    size: pref.sizeLabel || "",
    id: pref.catalogId || "",
    upc: pref.upc || "",
    locked: Boolean(pref.locked),
  }));
  const hardExclusions = [];
  for (const id of source.allergies || []) hardExclusions.push(`Never include ${id.replace("-", " ")}. Match product words. Still read the label.`);
  for (const id of source.diets || []) hardExclusions.push(`Diet: ${id}.`);
  for (const id of source.avoids || []) hardExclusions.push(`Avoid ${id}.`);
  for (const phrase of source.never || []) hardExclusions.push(`Never buy ${phrase}.`);
  return {
    why: labels(source.why, WHY_LABELS),
    household: {
      size: source.household?.size ?? null,
      kids: source.household?.kids ?? null,
      pickyEaters: source.household?.picky ?? null,
      headcount: defaultHeadcount(source),
    },
    loves: source.loves || [],
    avoids: source.avoids || [],
    cuisinesLiked: liked,
    cuisinesDisliked: disliked,
    allergies: source.allergies || [],
    diets: source.diets || [],
    always: source.always || [],
    never: source.never || [],
    mustHaves: source.mustHaves || [],
    brand: {
      default: source.brand?.default || null,
      organicIfClose: Boolean(source.brand?.organicIfClose),
      overrides: { ...(source.brand?.overrides || {}) },
    },
    style: { ...(source.style || {}) },
    hardExclusions,
    preferredProducts,
    blockedProducts: (source.neverProducts || []).map((row) => ({
      family: row.family || "",
      name: row.name || "",
      brand: row.brand || "",
      id: row.catalogId || "",
    })),
  };
}

/**
 * Drop excluded rows from an import review. Idempotent.
 * The review sheet markup stays as it is. The caller shows `note`.
 */
export function shapeImportReview(review, profile) {
  if (!review || !Array.isArray(review.items)) return { review, note: "" };
  const dropped = [];
  const items = [];
  for (const item of review.items) {
    const name = item?.name || "";
    const hit = exclusionForText(profile, name);
    const choices = (item?.choices || []).filter((choice) => !productExcluded(profile, choice?.product).excluded);
    if (hit.excluded && choices.length === 0) {
      dropped.push(name || hit.reason);
      continue;
    }
    const selectedGone = item?.selectedId && !choices.some((choice) => choice?.product?.id === item.selectedId);
    items.push({
      ...item,
      choices,
      ...(selectedGone ? { selectedId: choices[0]?.product?.id || "", accepted: choices.length > 0 } : {}),
    });
  }
  const note = dropped.length ? `Left off ${dropped.filter(Boolean).slice(0, 4).join(", ")} because of your taste profile.` : "";
  return {
    review: {
      ...review,
      items,
      found: items.filter((item) => item.status !== "missing").length,
      total: review.total || items.length + dropped.length,
      profileShaped: true,
    },
    note,
  };
}
