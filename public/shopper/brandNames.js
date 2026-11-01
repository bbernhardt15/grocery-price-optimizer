/**
 * Brand strings the shopper sees.
 *
 * Retailer feeds mix parent brands, sub-brands, cuts, registered marks,
 * and distributor names in one field. This module folds those into one
 * display name. It does not invent a brand that is not on a product.
 */

const MARKS = /[®™©]/g;

/** Child line -> parent the shopper would recognize. */
const PARENTS = [
  ["General Mills", ["count chocula", "boo berry", "cheerios", "cinnamon toast crunch", "lucky charms", "trix", "cocoa puffs", "reeses puffs", "wheaties", "chex", "fiber one", "golden grahams", "cookie crisp"]],
  ["Kellogg's", ["frosted flakes", "froot loops", "fruit loops", "rice krispies", "special k", "corn flakes", "raisin bran", "apple jacks", "krave", "kelloggs"]],
  ["Post", ["honey bunches of oats", "honey bunches", "fruity pebbles", "cocoa pebbles", "grape nuts", "grape-nuts", "great grains"]],
  ["Quaker", ["cap'n crunch", "capn crunch", "captain crunch", "life cereal"]],
  ["Malt-O-Meal", ["malt o meal", "malt-o-meal", "moms best", "mom's best"]],
];

/** Folded key -> the casing a shopper expects on a package. */
const DISPLAY = {
  jif: "Jif",
  skippy: "Skippy",
  "peter pan": "Peter Pan",
  "smucker's": "Smucker's",
  smuckers: "Smucker's",
  "smucker's natural": "Smucker's Natural",
  "smuckers natural": "Smucker's Natural",
  "justin's": "Justin's",
  justins: "Justin's",
  "mrs. meyer's": "Mrs. Meyer's",
  "mrs meyers": "Mrs. Meyer's",
  "mrs. meyers": "Mrs. Meyer's",
  "mrs meyers clean day": "Mrs. Meyer's",
  "general mills": "General Mills",
  "kellogg's": "Kellogg's",
  kelloggs: "Kellogg's",
  post: "Post",
  quaker: "Quaker",
  "malt-o-meal": "Malt-O-Meal",
  "malt o meal": "Malt-O-Meal",
  perdue: "Perdue",
  tyson: "Tyson",
  "pilgrim's": "Pilgrim's",
  pilgrims: "Pilgrim's",
  "springer mountain": "Springer Mountain",
  "miller farms": "Miller Farms",
  miller: "Miller",
  "just bare": "Just Bare",
  "bell & evans": "Bell & Evans",
  "bell and evans": "Bell & Evans",
  "arm and hammer": "Arm & Hammer",
  "sanderson farms": "Sanderson Farms",
  "national beef": "National Beef",
  "certified angus beef": "Certified Angus Beef",
  "omaha steaks": "Omaha Steaks",
  "eggland's best": "Eggland's Best",
  "egglands best": "Eggland's Best",
  "nature's own": "Nature's Own",
  "dave's killer bread": "Dave's Killer Bread",
  "land o lakes": "Land O Lakes",
  "private selection": "Private Selection",
  dawn: "Dawn",
  palmolive: "Palmolive",
  "seventh generation": "Seventh Generation",
  chobani: "Chobani",
  fage: "Fage",
  yoplait: "Yoplait",
  "siggi's": "Siggi's",
  siggis: "Siggi's",
};

const CUTS = new Set(
  "breast breasts thigh thighs drum drums drumstick drumsticks wing wings tender tenders tenderloin leg legs quarter quarters whole ground cutlet cutlets boneless skinless family pack tray".split(
    " "
  )
);

const JUNK_EXACT = new Set(["unbranded", "brand", "n/a", "na", "none", "null", "unknown", "fresh", "produce", "organic", "various", "misc", "miscellaneous"]);

export const MIN_NAME_BRANDS = 3;

export const PRODUCE_FAMILIES = new Set(["cilantro", "lettuce", "onions", "tomatoes", "bananas"]);

function cleanSpaces(value) {
  return String(value || "")
    .replace(MARKS, "")
    .replace(/['’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Case-fold and strip marks so "Chobani®" and "chobani" are one brand. */
export function brandKey(value) {
  return cleanSpaces(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9'%. ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isProduceFamily(familyId) {
  return PRODUCE_FAMILIES.has(String(familyId || ""));
}

export function isCutLabel(value) {
  const key = brandKey(value);
  if (!key) return false;
  const tokens = key.split(" ").filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => CUTS.has(token));
}

export function isJunkBrand(value) {
  const key = brandKey(value);
  if (!key) return true;
  if (/^\d+$/.test(key)) return true;
  if (JUNK_EXACT.has(key)) return true;
  if (isCutLabel(key)) return true;
  if (/\b(?:inc|llc|ltd|corp|corporation|company|distributing|distributor|importer|wholesale)\b/.test(key)) return true;
  if (/\bfoods?\s+express\b/.test(key)) return true;
  if (/\belf on the shelf\b/.test(key)) return true;
  if (key.length > 48) return true;
  return false;
}

function parentDisplay(key) {
  for (const [parent, children] of PARENTS) {
    const parentKey = brandKey(parent);
    if (key === parentKey || key.startsWith(`${parentKey} `)) return parent;
    if (children.some((child) => key === brandKey(child) || key.startsWith(`${brandKey(child)} `))) return parent;
  }
  return "";
}

function titleCase(value) {
  return value
    .split(" ")
    .map((word) => {
      if (!word) return word;
      if (word === "and") return "and";
      if (word.length <= 2 && word === word.toUpperCase()) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

export function displayBrand(value) {
  const stripped = cleanSpaces(value);
  const key = brandKey(stripped);
  if (!key || isJunkBrand(key)) return "";
  const parent = parentDisplay(key);
  if (parent) return parent;
  if (DISPLAY[key]) return DISPLAY[key];
  const meyer = key.match(/\bmrs\.?\s+meyers?\b/);
  if (meyer) return "Mrs. Meyer's";
  const letters = stripped.replace(/[^A-Za-z]/g, "");
  const shouted = letters && letters === letters.toUpperCase();
  const whispered = letters && letters === letters.toLowerCase();
  if (shouted || whispered) return titleCase(key);
  return stripped;
}

/**
 * One shopper-facing brand, or "" when the string is a cut, an id, or junk.
 * @param {string} value
 */
export function canonicalBrand(value) {
  const display = displayBrand(value);
  if (!display) return null;
  return { key: brandKey(display), display };
}

/**
 * Pull a real brand off a catalog row. Cuts stored in the brand field are
 * ignored. A known brand inside the product name still counts.
 * @param {object} product
 * @param {string[]} [known]
 */
export function brandFromProduct(product, known = []) {
  const direct = canonicalBrand(product?.brand);
  if (direct && !isCutLabel(product?.brand)) return direct;
  const hay = `${product?.brand || ""} ${product?.name || ""} ${product?.familyName || ""}`;
  const folded = brandKey(hay);
  const pool = [...known];
  for (const [parent, children] of PARENTS) pool.push(parent, ...children);
  for (const name of Object.values(DISPLAY)) pool.push(name);
  const ranked = [...new Set(pool.map((item) => displayBrand(item)).filter(Boolean))].sort(
    (a, b) => brandKey(b).length - brandKey(a).length
  );
  for (const name of ranked) {
    const key = brandKey(name);
    if (key.length < 3) continue;
    if (folded.includes(key)) return canonicalBrand(name);
  }
  return null;
}

export function shouldAskNameBrand(familyId, count) {
  if (isProduceFamily(familyId)) return false;
  return Number(count) >= MIN_NAME_BRANDS;
}

export function productImage(product) {
  const urls = [];
  if (Array.isArray(product?.imageUrls)) urls.push(...product.imageUrls);
  if (product?.imageUrl) urls.push(product.imageUrl);
  return urls.map((url) => String(url || "").trim()).find((url) => url && !/placeholder|no[-_]?image/i.test(url)) || "";
}
