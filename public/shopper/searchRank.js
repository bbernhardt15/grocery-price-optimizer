// src/shopper/searchRank.ts
var HOUSE = [
  "great value",
  "marketside",
  "equate",
  "parent's choice",
  "parents choice",
  "kroger",
  "simple truth",
  "private selection",
  "good & gather",
  "good and gather",
  "market pantry",
  "up & up",
  "up and up",
  "favorite day",
  "friendly farms",
  "kirkwood",
  "goldhen",
  "earthly grains",
  "reggano",
  "countryside creamery",
  "millville",
  "clancy's",
  "clancys",
  "specially selected",
  "l'oven fresh",
  "member's mark",
  "members mark"
];
var SPECIALTY = [
  "fairlife",
  "organic valley",
  "horizon",
  "lactaid",
  "vital farms",
  "eggland",
  "kerrygold",
  "dave's killer",
  "daves killer",
  "applegate",
  "boar's head",
  "boars head",
  "plugra",
  "maple hill",
  "oatly",
  "califia"
];
function fold(value) {
  return String(value || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function brandText(item) {
  return fold(`${item?.brand || ""} ${item?.name || ""} ${item?.familyName || ""}`);
}
function isCommonStoreBrand(item) {
  if (!item) return false;
  if (item.storeBrand === true) return true;
  const brand = fold(item.brand);
  if (brand.length < 3) return false;
  return HOUSE.some((name) => {
    const house = fold(name);
    return brand.includes(house) || house.includes(brand);
  });
}
function isSpecialtyBrand(item) {
  const text = brandText(item || {});
  if (!text) return false;
  return SPECIALTY.some((name) => text.includes(fold(name)));
}
function itemShelfPrice(item) {
  const prices = [];
  const push = (value) => {
    const amount = Number(value);
    if (Number.isFinite(amount) && amount > 0) prices.push(amount);
  };
  if (!item) return Number.POSITIVE_INFINITY;
  push(item.bestPrice);
  push(item.bestOffer?.price);
  push(item.price);
  push(item.priceFrom);
  for (const offer of item.offers || []) push(offer?.price);
  for (const variant of item.variants || []) {
    const nested = itemShelfPrice(variant);
    if (Number.isFinite(nested)) prices.push(nested);
  }
  if (!prices.length) return Number.POSITIVE_INFINITY;
  return Math.min(...prices);
}
function includesBrand(item, brand) {
  const wanted = fold(brand);
  if (wanted.length < 3) return false;
  const have = fold(item?.brand);
  if (have.length >= 3 && (have.includes(wanted) || wanted.includes(have))) return true;
  return brandText(item).includes(wanted);
}
function includesName(item, name) {
  const wanted = fold(name);
  if (wanted.length < 3) return false;
  const text = brandText(item);
  if (!text) return false;
  if (text.includes(wanted)) return true;
  const tokens = wanted.split(" ").filter((token) => token.length > 2);
  return tokens.length > 0 && tokens.every((token) => text.includes(token));
}
function preferenceApplies(pref, family) {
  const row = String(pref?.family || "").trim();
  if (!row || !family) return true;
  return row === family;
}
function personalKind(item, context = {}) {
  const family = String(context.family || "").trim();
  for (const pref of context.preferences || []) {
    if (!pref || pref.mode === "never" || pref.mode === "skip" || pref.mode === "cheapest") continue;
    if (!preferenceApplies(pref, family)) continue;
    if (pref.mode === "storeBrand" && isCommonStoreBrand(item)) return "preference";
    if (pref.productId && item.id && pref.productId === item.id) return "preference";
    const brands = [...pref.brands || [], pref.brand].filter(Boolean);
    if (brands.some((brand) => includesBrand(item, brand))) return "preference";
  }
  for (const row of context.history || []) {
    if (row?.brand && includesBrand(item, row.brand) && (!row.name || includesName(item, row.name))) return "history";
    if (!row?.brand && row?.name && includesName(item, row.name)) return "history";
  }
  for (const row of context.usuals || []) {
    if (row?.brand && includesBrand(item, row.brand) && (!row.name || includesName(item, row.name))) return "usual";
    if (!row?.brand && row?.name && includesName(item, row.name)) return "usual";
  }
  return "";
}
var PERSONAL_ORDER = {
  preference: 0,
  history: 1,
  usual: 2,
  "": 3
};
function tierOf(item, context) {
  if (personalKind(item, context)) return 0;
  if (isSpecialtyBrand(item)) return 2;
  return 1;
}
function rankSearchResults(items, context = {}) {
  return (items || []).map((item, index) => ({
    item,
    index,
    tier: tierOf(item, context),
    personal: personalKind(item, context),
    price: itemShelfPrice(item),
    store: isCommonStoreBrand(item) ? 0 : 1
  })).sort(
    (a, b) => a.tier - b.tier || PERSONAL_ORDER[a.personal] - PERSONAL_ORDER[b.personal] || a.price - b.price || a.store - b.store || a.index - b.index
  ).map((row) => row.item);
}
export {
  isCommonStoreBrand,
  isSpecialtyBrand,
  itemShelfPrice,
  personalKind,
  rankSearchResults
};
