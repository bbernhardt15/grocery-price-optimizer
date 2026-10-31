/**
 * Learn brand habits from a digital grocery order.
 *
 * Prices stay on the parsed line for this pass and are not a preference.
 * Addresses, loyalty numbers, and order numbers are dropped before a line
 * is kept. Raw receipt text is not stored here.
 */

import { upcForStorage } from "../catalog/normalize";
import { classifyProduct, familyFromQuery, familyLabel } from "../catalog/stapleFamilies";

export type ReceiptLine = {
  name: string;
  brand: string;
  size: string;
  quantity: number;
  upc: string;
  price: number | null;
  receipt: number;
  raw: string;
  storeBrand: boolean;
  family: string;
  label: string;
};

export type LearnedMode = "brand" | "storeBrand" | "cheapest";

export type LearnedPreference = {
  family: string;
  label: string;
  mode: LearnedMode;
  brand: string;
  productName: string;
  size: string;
  upc: string;
  count: number;
  receipts: number;
  confidence: "low" | "high";
};

export type ReceiptAnalysis = {
  lines: ReceiptLine[];
  learned: LearnedPreference[];
  paper: boolean;
  paperNote: string;
};

export const PAPER_RECEIPT_NOTE =
  "These look like a paper receipt. Item names are shortened and there is no barcode, so the matches may be less accurate. Check each line.";

const STORE_PHRASES: Array<[string, string]> = [
  ["private selection", "Private Selection"],
  ["simple truth", "Simple Truth"],
  ["good and gather", "Good & Gather"],
  ["parent's choice", "Parent's Choice"],
  ["parents choice", "Parent's Choice"],
  ["market pantry", "Market Pantry"],
  ["great value", "Great Value"],
  ["marketside", "Marketside"],
  ["favorite day", "Favorite Day"],
  ["friendly farms", "Friendly Farms"],
  ["countryside creamery", "Countryside Creamery"],
  ["specially selected", "Specially Selected"],
  ["earthly grains", "Earthly Grains"],
  ["l'oven fresh", "L'oven Fresh"],
  ["up and up", "Up & Up"],
  ["kirkwood", "Kirkwood"],
  ["goldhen", "Goldhen"],
  ["reggano", "Reggano"],
  ["millville", "Millville"],
  ["clancy's", "Clancy's"],
  ["clancys", "Clancy's"],
  ["equate", "Equate"],
  ["kroger", "Kroger"],
  ["aldi", "Aldi"],
];

const NAME_PHRASES: Array<[string, string]> = [
  ["dave's killer bread", "Dave's Killer Bread"],
  ["daves killer bread", "Dave's Killer Bread"],
  ["sweet baby ray's", "Sweet Baby Ray's"],
  ["sweet baby rays", "Sweet Baby Ray's"],
  ["head and shoulders", "Head & Shoulders"],
  ["healthy choice", "Healthy Choice"],
  ["little debbie", "Little Debbie"],
  ["pepperidge farm", "Pepperidge Farm"],
  ["oscar mayer", "Oscar Mayer"],
  ["hidden valley", "Hidden Valley"],
  ["coca-cola", "Coca-Cola"],
  ["coca cola", "Coca-Cola"],
  ["go-gurt", "Go-GURT"],
  ["go gurt", "Go-GURT"],
  ["kool-aid", "Kool-Aid"],
  ["kool aid", "Kool-Aid"],
  ["nature's own", "Nature's Own"],
  ["hellmann's", "Hellmann's"],
  ["hellmanns", "Hellmann's"],
  ["barilla", "Barilla"],
  ["bertolli", "Bertolli"],
  ["cheerios", "Cheerios"],
  ["charmin", "Charmin"],
  ["folgers", "Folgers"],
  ["mahatma", "Mahatma"],
  ["perdue", "Perdue"],
  ["quaker", "Quaker"],
  ["tropicana", "Tropicana"],
  ["bounty", "Bounty"],
  ["kraft", "Kraft"],
  ["tyson", "Tyson"],
  ["heinz", "Heinz"],
  ["snuggle", "Snuggle"],
  ["lysol", "Lysol"],
  ["oreo", "Oreo"],
  ["tide", "Tide"],
  ["dove", "Dove"],
  ["dawn", "Dawn"],
  ["jif", "Jif"],
];

const SPECIFIC: Array<{ id: string; label: string; test: RegExp }> = [
  { id: "cream-cheese", label: "Cream cheese", test: /\bcream cheese\b/i },
  { id: "pasta-sauce", label: "Pasta sauce", test: /\b(pasta sauce|marinara|spaghetti sauce|alfredo)\b/i },
  { id: "bbq-sauce", label: "BBQ sauce", test: /\b(bbq|barbecue|barbeque)\s+sauce\b/i },
  { id: "mac-and-cheese", label: "Mac and cheese", test: /\bmac(?:aroni)?\s*(?:and|&)\s*cheese\b/i },
  { id: "chicken-nuggets", label: "Chicken nuggets", test: /\b(dino nuggets|chicken nuggets|fun nuggets|nuggets)\b/i },
  { id: "fabric-softener", label: "Fabric softener", test: /\bfabric softener\b|\bsnuggle\b/i },
  { id: "bread-crumbs", label: "Bread crumbs", test: /\bbread crumbs?\b/i },
  { id: "cheese", label: "Cheese", test: /\bamerican singles\b/i },
  { id: "snack-cakes", label: "Snack cakes", test: /\blittle debbie\b|\bcreme pies\b/i },
  { id: "crackers", label: "Crackers", test: /\bgoldfish\b|\bcrackers\b/i },
];

const GENERAL: Array<{ id: string; label: string; test: RegExp }> = [
  { id: "tortillas", label: "Tortillas", test: /\btortillas?\b/i },
  { id: "body-wash", label: "Body wash", test: /\bbody wash\b/i },
  { id: "shampoo", label: "Shampoo", test: /\bshampoo\b|\bhead and shoulders\b/i },
  { id: "cookies", label: "Cookies", test: /\b(oreo|sandwich cookies|cookies)\b/i },
  { id: "drink-mix", label: "Drink mix", test: /\bkool\s*aid\b|\bdrink mix\b/i },
  { id: "frozen-meal", label: "Frozen meal", test: /\bcafe steamers\b|\bfrozen meal\b/i },
  { id: "yogurt", label: "Yogurt", test: /\bgo\s*-?\s*gurt\b/i },
  { id: "ice-cream", label: "Ice cream", test: /\bice cream\b/i },
  { id: "mayonnaise", label: "Mayonnaise", test: /\b(mayonnaise|mayo)\b/i },
  { id: "ranch", label: "Ranch dressing", test: /\branch\b/i },
  { id: "oatmeal", label: "Oatmeal", test: /\boatmeal\b|\binstant oats\b/i },
  { id: "water", label: "Water", test: /\b(purified water|bottled water|spring water)\b/i },
  { id: "orange-juice", label: "Orange juice", test: /\borange juice\b/i },
  { id: "cleaner", label: "Cleaner", test: /\b(lysol|disinfectant)\b/i },
];

const SIZE_PHRASE =
  /(\d+(?:\.\d+)?\s*(?:fl\.?\s*oz|fluid\s+ounces?|oz|lb|lbs|pounds?|g|kg|ml|l|gal|gallons?|qt|quarts?|pt|pints?|ct|count|pk|packs?|dozen))\b|(half[\s-]?gallon|gallon|dozen|family\s+size)\b/i;

const JUNK =
  /^(?:sub\s*total|subtotal|grand\s*total|order\s*total|estimated\s*total|total|tax|tip|you\s*saved|savings|balance|amount\s+due|visa|mastercard|amex|paypal|change|thank\s+you.*|item\s+description|description|price|qty|quantity)\b/i;

const PII = [
  /\border\s*(?:number|#|no\.?)\b/i,
  /\bloyalty\b/i,
  /\bmember\s*(?:id|number|#)\b/i,
  /\b(?:card|account)\s*(?:number|#)\b/i,
  /\b\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/,
  /@/,
  /\b\d{1,6}\s+\S+(?:\s+\S+){0,5}\s+(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pike|hwy|highway)\b/i,
  /^[A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?$/,
  /^(?:sold to|deliver to|ship to|pickup(?:\s+location)?|pick up|order details|payment|billing)$/i,
];

const STORE_KEYS = new Set(STORE_PHRASES.map(([key]) => key));

function fold(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/['’]/g, "'")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9'%. ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clean(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clampQty(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(99, Math.floor(value));
}

export function isReceiptStoreBrand(brand: string): boolean {
  const key = fold(brand);
  if (!key) return false;
  if (STORE_KEYS.has(key)) return true;
  return [...STORE_KEYS].some((phrase) => key === phrase || key.startsWith(`${phrase} `));
}

function phrases(): Array<{ key: string; display: string; store: boolean }> {
  const rows = [
    ...STORE_PHRASES.map(([key, display]) => ({ key: fold(key), display, store: true })),
    ...NAME_PHRASES.map(([key, display]) => ({ key: fold(key), display, store: false })),
  ];
  rows.sort((a, b) => b.key.length - a.key.length);
  return rows;
}

const BRAND_PHRASES = phrases();

function splitBrand(name: string): { brand: string; product: string; store: boolean } {
  const folded = fold(name);
  for (const phrase of BRAND_PHRASES) {
    if (folded === phrase.key || folded.startsWith(`${phrase.key} `)) {
      const pattern = new RegExp(`^${phrase.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      const product = fold(name).replace(pattern, "").replace(/^[\s,.-]+/, "").trim();
      const original = name.replace(new RegExp(`^${phrase.display.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/&/g, "(?:&|and)")}`, "i"), "").replace(/^[\s,.-]+/, "").trim();
      return {
        brand: phrase.display,
        product: original || titleCase(product) || name,
        store: phrase.store,
      };
    }
  }
  return { brand: "", product: name, store: false };
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function pullSize(name: string): { name: string; size: string } {
  const match = name.match(SIZE_PHRASE);
  if (!match || match.index === undefined) return { name: clean(name), size: "" };
  const size = clean(match[0]);
  const rest = clean(`${name.slice(0, match.index)} ${name.slice(match.index + match[0].length)}`).replace(/^[,.-]+|[,.-]+$/g, "");
  if (!/[a-z]/i.test(rest)) return { name: clean(name), size: "" };
  return { name: rest, size };
}

function categoryFor(name: string, brand: string): { id: string; label: string } | null {
  const text = clean(`${brand} ${name}`);
  for (const extra of SPECIFIC) {
    if (extra.test.test(text)) return { id: extra.id, label: extra.label };
  }
  const probe = name || text;
  const family =
    classifyProduct({ name: probe }) ||
    classifyProduct({ name: text }) ||
    familyFromQuery(probe) ||
    familyFromQuery(text) ||
    "";
  if (family) return { id: family, label: familyLabel(family) || family };
  for (const extra of GENERAL) {
    if (extra.test.test(text)) return { id: extra.id, label: extra.label };
  }
  return null;
}

function isJunkLine(line: string): boolean {
  const value = clean(line).replace(/[.:,]+$/g, "");
  if (!value || value.length > 240) return true;
  if (JUNK.test(value)) return true;
  if (PII.some((pattern) => pattern.test(value))) return true;
  if (/^(?:kroger|walmart|target|instacart|amazon|whole foods|aldi)(?:\s*#?\s*\d+)?$/i.test(value)) return true;
  if (/^page\s+\d+/i.test(value)) return true;
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(value)) return true;
  return false;
}

function priceOnly(line: string): number | null {
  const match = clean(line).match(/^\$?\d+\.\d{2}$/);
  if (!match) return null;
  const amount = Number(match[0].replace("$", ""));
  return Number.isFinite(amount) ? amount : null;
}

type Draft = {
  name: string;
  quantity: number;
  price: number | null;
  upc: string;
  raw: string;
  receipt: number;
};

function normalizeUpc(value: string): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 14) return "";
  return upcForStorage(digits) || "";
}

function takeInline(line: string): { name: string; quantity: number; price: number | null; upc: string } | null {
  let working = clean(line);
  let upc = "";
  const labeledUpc = working.match(/\b(?:upc|gtin|barcode)\s*[:#]?\s*(\d{8,14})\b/i);
  if (labeledUpc?.[1]) {
    upc = labeledUpc[1];
    working = clean(working.replace(labeledUpc[0], " "));
  } else {
    const bare = working.match(/\b(\d{12,14})\b/);
    if (bare?.[1]) {
      upc = bare[1];
      working = clean(working.replace(bare[1], " "));
    }
  }
  let price: number | null = null;
  const trailing = working.match(/^(.*\D)\s+\$?(\d+\.\d{2})$/);
  if (trailing?.[1] && trailing[2]) {
    price = Number(trailing[2]);
    working = clean(trailing[1]);
  }
  let quantity = 1;
  const qty = working.match(/^(?:qty|quantity)\s*[:#]?\s*(\d{1,2})\s+(.+)$/i);
  if (qty?.[1] && qty[2]) {
    quantity = clampQty(Number(qty[1]));
    working = clean(qty[2]);
  } else {
    const lead = working.match(/^(\d{1,2})\s+(.+)$/);
    const unit = lead?.[2]?.split(/\s+/)[0] || "";
    if (lead?.[1] && lead[2] && !/^(?:oz|lb|lbs|ct|gal|pk|pack|fl)$/i.test(unit)) {
      quantity = clampQty(Number(lead[1]));
      working = clean(lead[2]);
    }
  }
  working = working.replace(/^[,.-]+|[,.-]+$/g, "").trim();
  if (!working || !/[a-z]/i.test(working) || isJunkLine(working)) return null;
  return { name: working, quantity, price, upc };
}

function finish(draft: Draft): ReceiptLine | null {
  const sized = pullSize(draft.name.replace(/\s+,/g, ",").replace(/,\s*$/g, ""));
  const split = splitBrand(sized.name);
  const product = clean(split.product).replace(/^[,.-]+|[,.-]+$/g, "");
  const name = product || sized.name;
  if (!name || !/[a-z]/i.test(name) || isJunkLine(name)) return null;
  const category = categoryFor(name, split.brand);
  const store = split.store || isReceiptStoreBrand(split.brand);
  return {
    name,
    brand: split.brand,
    size: sized.size,
    quantity: clampQty(draft.quantity),
    upc: normalizeUpc(draft.upc),
    price: draft.price,
    receipt: draft.receipt,
    raw: draft.raw,
    storeBrand: store,
    family: category?.id || "",
    label: category?.label || "",
  };
}

/** Digital order text, a pasted receipt, or several orders split by `--- receipt ---`. */
export function parseReceiptText(text: string): ReceiptLine[] {
  const source = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!source.trim()) return [];
  const items: Draft[] = [];
  let current: Draft | null = null;
  let receipt = 1;
  const flush = () => {
    if (current?.name) items.push(current);
    current = null;
  };
  for (const original of source.split("\n")) {
    const line = original.trim();
    if (!line) continue;
    if (/^---\s*receipt\s*---$/i.test(line)) {
      flush();
      receipt += 1;
      continue;
    }
    const upcOnly = line.match(/^(?:upc|gtin|barcode)\s*[:#]?\s*(\d{8,14})\b/i);
    if (upcOnly?.[1] && current) {
      current.upc = upcOnly[1];
      continue;
    }
    const qtyOnly = line.match(/^(?:qty|quantity)\s*[:#]?\s*(\d{1,2})\b/i);
    if (qtyOnly?.[1]) {
      if (current) current.quantity = clampQty(Number(qtyOnly[1]));
      continue;
    }
    const amount = priceOnly(line);
    if (amount != null && current && current.price == null) {
      current.price = amount;
      continue;
    }
    if (isJunkLine(line)) continue;
    const inline = takeInline(line);
    if (!inline) continue;
    flush();
    current = {
      name: inline.name,
      quantity: inline.quantity,
      price: inline.price,
      upc: inline.upc,
      raw: line,
      receipt,
    };
  }
  flush();
  return items.map(finish).filter((line): line is ReceiptLine => Boolean(line)).slice(0, 80);
}

function abbreviated(name: string): boolean {
  const text = clean(name);
  if (!text || text.length > 42) return false;
  const words = text.split(/\s+/);
  if (words.length > 4) return false;
  if (text === text.toUpperCase() && /[A-Z]/.test(text)) return true;
  return /^[A-Z0-9 .&'+/-]{3,28}$/.test(text);
}

export function looksLikePaperReceipt(lines: Array<Pick<ReceiptLine, "name" | "upc">>): boolean {
  if (!lines.length) return false;
  const withUpc = lines.filter((line) => line.upc).length;
  if (withUpc / lines.length >= 0.25) return false;
  const short = lines.filter((line) => abbreviated(line.name)).length;
  return short / lines.length >= 0.5;
}

function majority(values: string[]): string {
  const counts = new Map<string, { display: string; count: number }>();
  for (const value of values) {
    const key = fold(value);
    if (!key) continue;
    const row = counts.get(key) || { display: value, count: 0 };
    row.count += 1;
    counts.set(key, row);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0]?.display || "";
}

export function inferReceiptPreferences(lines: ReceiptLine[]): LearnedPreference[] {
  const groups = new Map<string, ReceiptLine[]>();
  for (const line of lines) {
    if (!line.family) continue;
    const bucket = groups.get(line.family) || [];
    bucket.push(line);
    groups.set(line.family, bucket);
  }
  const learned: LearnedPreference[] = [];
  for (const [family, rows] of groups) {
    const store = rows.filter((line) => line.storeBrand);
    const named = rows.filter((line) => line.brand && !line.storeBrand);
    const receiptCount = new Set(rows.map((line) => line.receipt || 1)).size;
    const count = rows.reduce((sum, line) => sum + (line.quantity || 1), 0);
    let mode: LearnedMode = "cheapest";
    let brand = "";
    let productName = rows[0]?.name || "";
    let size = rows[0]?.size || "";
    let upc = rows[0]?.upc || "";
    if (store.length && store.length >= named.length && store.length * 2 >= rows.length) {
      mode = "storeBrand";
      brand = majority(store.map((line) => line.brand));
      productName = store[0]?.name || productName;
      size = store[0]?.size || size;
      upc = store.find((line) => line.upc)?.upc || upc;
    } else if (named.length && named.length * 2 >= rows.length) {
      mode = "brand";
      brand = majority(named.map((line) => line.brand));
      const pick = named.find((line) => fold(line.brand) === fold(brand)) || named[0];
      productName = pick?.name || productName;
      size = pick?.size || size;
      upc = pick?.upc || upc;
    }
    const agreed =
      mode === "storeBrand"
        ? store.length === rows.length
        : mode === "brand"
          ? named.every((line) => fold(line.brand) === fold(brand))
          : named.length === 0 && store.length === 0;
    learned.push({
      family,
      label: rows[0]?.label || familyLabel(family) || family,
      mode,
      brand: mode === "brand" ? brand : mode === "storeBrand" ? brand : "",
      productName,
      size,
      upc,
      count,
      receipts: receiptCount,
      confidence: receiptCount >= 2 && agreed ? "high" : "low",
    });
  }
  learned.sort((a, b) => a.label.localeCompare(b.label) || a.family.localeCompare(b.family));
  return learned;
}

export function analyzeReceipt(text: string): ReceiptAnalysis {
  const lines = parseReceiptText(text);
  const paper = looksLikePaperReceipt(lines);
  return {
    lines,
    learned: inferReceiptPreferences(lines),
    paper,
    paperNote: paper ? PAPER_RECEIPT_NOTE : "",
  };
}

function asLine(value: unknown, index: number): ReceiptLine | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<ReceiptLine>;
  const name = clean(String(row.name || "")).slice(0, 160);
  if (!name || isJunkLine(name)) return null;
  const brand = clean(String(row.brand || "")).slice(0, 80);
  const sized = pullSize(name);
  const split = brand ? { brand, product: sized.name, store: isReceiptStoreBrand(brand) } : splitBrand(sized.name);
  const category = categoryFor(split.product || sized.name, split.brand);
  const receipt = Number(row.receipt);
  return {
    name: split.product || sized.name,
    brand: split.brand,
    size: clean(String(row.size || sized.size)).slice(0, 40),
    quantity: clampQty(Number(row.quantity) || 1),
    upc: normalizeUpc(String(row.upc || "")),
    price: null,
    receipt: Number.isFinite(receipt) && receipt > 0 ? Math.min(99, Math.floor(receipt)) : 1,
    raw: name,
    storeBrand: split.store || isReceiptStoreBrand(split.brand),
    family: category?.id || clean(String(row.family || "")).slice(0, 40),
    label: category?.label || clean(String(row.label || "")).slice(0, 80),
  };
}

/** Re-learn after the shopper removes a line. Prices are cleared. */
export function learnReceiptLines(input: unknown[]): ReceiptAnalysis {
  const lines = (Array.isArray(input) ? input : [])
    .slice(0, 80)
    .map((row, index) => asLine(row, index))
    .filter((line): line is ReceiptLine => Boolean(line));
  const paper = looksLikePaperReceipt(lines);
  return {
    lines,
    learned: inferReceiptPreferences(lines),
    paper,
    paperNote: paper ? PAPER_RECEIPT_NOTE : "",
  };
}
