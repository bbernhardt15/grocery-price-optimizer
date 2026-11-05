/**
 * Shopping list sections follow a store walk. A catalog department wins.
 * Otherwise the item name picks a section.
 */

export const LIST_SECTIONS = [
  "Produce",
  "Bakery",
  "Deli",
  "Meat & Seafood",
  "Dairy & Eggs",
  "Pantry",
  "Breakfast",
  "Snacks",
  "Beverages",
  "Frozen",
  "Baby",
  "Household",
  "Personal Care",
  "Pet",
  "Other",
];

const RULES = [
  ["Produce", /\b(?:banana|apple|onion|tomato|lettuce|cilantro|grape|berry|berries|avocado|potato|potatoes|salad|vegetable|fruit|lime|lemon|pepper|cucumber|carrot|broccoli|spinach|herb)s?\b/i],
  ["Bakery", /\b(?:bread|bagel|muffin|tortilla|bun|roll|croissant|baguette)s?\b/i],
  ["Deli", /\b(?:deli|lunch meat|salami|ham slice)s?\b/i],
  ["Meat & Seafood", /\b(?:chicken|beef|steak|pork|bacon|turkey|sausage|shrimp|salmon|fish|nugget|meat)s?\b/i],
  ["Dairy & Eggs", /\b(?:milk|egg|cheese|yogurt|butter|cream|sour cream)s?\b/i],
  ["Breakfast", /\b(?:cereal|oatmeal|oats|granola|pancake|waffle)s?\b/i],
  ["Snacks", /\b(?:chip|cookie|cracker|pretzel|popcorn|candy|chocolate|snack)s?\b/i],
  ["Beverages", /\b(?:cola|soda|juice|coffee|tea|water|drink|lemonade|beer|wine)s?\b/i],
  ["Frozen", /\b(?:frozen|ice cream|pizza)s?\b/i],
  ["Baby", /\b(?:diaper|formula|baby|wipes)s?\b/i],
  ["Household", /\b(?:detergent|paper towel|toilet paper|cleaner|trash bag|dish soap|foil)s?\b/i],
  ["Personal Care", /\b(?:shampoo|soap|toothpaste|deodorant|lotion)s?\b/i],
  ["Pet", /\b(?:dog food|cat food|pet|litter|kibble)s?\b/i],
  ["Pantry", /\b(?:rice|pasta|sauce|ketchup|oil|bean|soup|flour|sugar|peanut butter|canned)s?\b/i],
];

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/** @param {{ product?: { departmentName?: string, name?: string, familyName?: string, catalogName?: string } } | null | undefined} entry */
export function sectionForEntry(entry) {
  const named = clean(entry?.product?.departmentName);
  if (named && LIST_SECTIONS.includes(named)) return named;
  const text = [entry?.product?.familyName, entry?.product?.catalogName, entry?.product?.name].map(clean).filter(Boolean).join(" ");
  for (const [section, test] of RULES) {
    if (test.test(text)) return section;
  }
  return "Other";
}

/**
 * @param {Array<{ product?: object }>} entries
 * @returns {Array<{ section: string, entries: Array<object> }>}
 */
export function groupListEntries(entries) {
  const buckets = new Map();
  for (const entry of entries || []) {
    const section = sectionForEntry(entry);
    const rows = buckets.get(section) || [];
    rows.push(entry);
    buckets.set(section, rows);
  }
  return LIST_SECTIONS.filter((section) => buckets.has(section)).map((section) => ({
    section,
    entries: buckets.get(section),
  }));
}
