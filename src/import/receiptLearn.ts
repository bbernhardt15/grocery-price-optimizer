/**
 * Learn brand habits from a digital grocery order.
 *
 * Prices stay on the parsed line for this pass and are not a preference.
 * Addresses, loyalty numbers, and order numbers are dropped before a line
 * is kept. Raw receipt text is not stored here.
 */

import { upcForStorage, upcKey } from "../catalog/normalize";
import { classifyProduct, familyFromQuery, familyLabel } from "../catalog/stapleFamilies";
import { parseModelJson, validateAiItems } from "./aiSchema";

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
  { id: "pasta", label: "Pasta", test: /\b(spaghetti|fettuccine|penne|linguine|macaroni)\b/i },
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
  /^(?:sub\s*total|subtotal|grand\s*total|order\s*total|estimated\s*total|total|tax|tip|you\s*saved|savings|balance|amount\s+due|visa|mastercard|amex|paypal|change|thank\s+you.*|item\s+description|item\s+details|description|price|qty|quantity|order\s+summary|order\s+type|order\s+date|order\s+number|original\s+item|item\s+coupons|full?fill?ment|sales\s+tax|sponsored|savings\s*(?:&|and)\s*rewards|\d+\s+items?)\b/i;

const COUPON_LINE = /^(?:item\s+)?coupons?(?:\/sales?)?\b|^sale\s*:|^you\s+saved\b|^\*\s*\$?\d+\.\d{2}$|^\*?\s*-\$?\d+\.\d{2}$/i;

const QTY_PRICE = /^(\d+(?:\.\d+)?)\s*[x×]\s*\$?(\d+\.\d{2})(?:\s+\$?\d+\.\d{2})?\s*(?:ea\.?)?$/i;

const PII = [
  /\border\s*(?:number|#|no\.?)\b/i,
  /\bloyalty\b/i,
  /\bmember\s*(?:id|number|#)\b/i,
  /\b(?:card|account)\s*(?:number|#)\b/i,
  /\b\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/,
  /@/,
  /\b\d{1,6}\s+\S+(?:\s+\S+){0,5}\s+(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pike|hwy|highway)\b/i,
  /^[A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?(?:\s+USA)?$/i,
  /\blast\s*4\b/i,
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

function qtyPrice(line: string): { quantity: number; price: number } | null {
  const match = clean(line).match(QTY_PRICE);
  if (!match?.[1] || !match[2]) return null;
  const quantity = Math.min(99, Math.max(1, Math.round(Number(match[1]))));
  const price = Number(match[2]);
  if (!Number.isFinite(price)) return null;
  return { quantity, price };
}

/** Digital order text, a pasted receipt, or several orders split by `--- receipt ---`. */
export function parseReceiptText(text: string): ReceiptLine[] {
  const source = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!source.trim()) return [];
  const items: Draft[] = [];
  const state: { current: Draft | null; parts: string[]; receipt: number } = { current: null, parts: [], receipt: 1 };
  const flush = () => {
    if (state.current?.name) items.push(state.current);
    state.current = null;
  };
  const commitParts = () => {
    if (!state.parts.length) return;
    const name = clean(state.parts.join(" "));
    state.parts = [];
    if (!name || isJunkLine(name)) return;
    if (state.current && state.current.price == null && !state.current.upc) {
      state.current.name = clean(`${state.current.name} ${name}`);
      state.current.raw = clean(`${state.current.raw} ${name}`);
      return;
    }
    flush();
    state.current = { name, quantity: 1, price: null, upc: "", raw: name, receipt: state.receipt };
  };
  for (const original of source.split("\n")) {
    const line = original.trim();
    if (!line || line === "*") continue;
    if (/^---\s*receipt\s*---$/i.test(line)) {
      commitParts();
      flush();
      state.receipt += 1;
      continue;
    }
    if (COUPON_LINE.test(line)) continue;
    const upcOnly = line.match(/^(?:upc|gtin|barcode)\s*[:#]?\s*(\d{8,14})\b/i);
    if (upcOnly?.[1]) {
      commitParts();
      if (state.current) state.current.upc = upcOnly[1];
      continue;
    }
    const priced = qtyPrice(line);
    if (priced) {
      commitParts();
      if (state.current) {
        state.current.quantity = priced.quantity;
        if (state.current.price == null) state.current.price = priced.price;
      }
      continue;
    }
    const qtyOnly = line.match(/^(?:qty|quantity)\s*[:#]?\s*(\d{1,2}(?:\.\d+)?)\b/i);
    if (qtyOnly?.[1]) {
      commitParts();
      if (state.current) state.current.quantity = Math.min(99, Math.max(1, Math.round(Number(qtyOnly[1]))));
      continue;
    }
    const amount = priceOnly(line);
    if (amount != null) {
      commitParts();
      if (state.current && state.current.price == null) state.current.price = amount;
      continue;
    }
    if (isJunkLine(line)) continue;
    const inline = takeInline(line);
    if (!inline) continue;
    if (inline.price != null && abbreviated(inline.name)) {
      commitParts();
      flush();
      items.push({
        name: inline.name,
        quantity: inline.quantity,
        price: inline.price,
        upc: inline.upc,
        raw: line,
        receipt: state.receipt,
      });
      continue;
    }
    if (state.current && (state.current.upc || state.current.price != null)) flush();
    state.parts.push(inline.name);
  }
  commitParts();
  flush();
  return items.map(finish).filter((line): line is ReceiptLine => Boolean(line)).slice(0, 160);
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

function nameKey(line: ReceiptLine): string {
  return fold(`${line.brand} ${line.name}`)
    .replace(/\b\d+(?:\.\d+)?\s*(?:fl|oz|lb|lbs|ct|pk|pack|count|ml|g)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sameReceiptLine(a: ReceiptLine, b: ReceiptLine): boolean {
  if ((a.receipt || 1) !== (b.receipt || 1)) return false;
  const upcA = upcKey(a.upc);
  const upcB = upcKey(b.upc);
  if (upcA && upcB && upcA === upcB) return true;
  const left = nameKey(a);
  const right = nameKey(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const sameBrand = fold(a.brand) && fold(a.brand) === fold(b.brand);
  if (sameBrand && (left.includes(right) || right.includes(left))) return true;
  return false;
}

/**
 * Same item repeated inside one receipt (overlapping page slices) counts once.
 * Quantity is the largest reported count, not the sum of the copies.
 */
export function dedupeReceiptLines(lines: ReceiptLine[]): ReceiptLine[] {
  const kept: ReceiptLine[] = [];
  for (const line of lines) {
    const match = kept.find((row) => sameReceiptLine(row, line));
    if (!match) {
      kept.push({ ...line });
      continue;
    }
    match.quantity = Math.max(match.quantity || 1, line.quantity || 1);
    if (!match.upc && line.upc) match.upc = line.upc;
    if (nameKey(line).length > nameKey(match).length) match.name = line.name;
    if (!match.brand && line.brand) match.brand = line.brand;
  }
  return kept;
}

/**
 * Brand that shows up on the most receipts, then on the most lines.
 * One noisy receipt does not beat a brand that repeats across orders.
 */
function frequentBrand(lines: ReceiptLine[]): string {
  const stats = new Map<string, { display: string; receipts: number; lines: number }>();
  const seen = new Set<string>();
  for (const line of lines) {
    const key = fold(line.brand);
    if (!key) continue;
    const row = stats.get(key) || { display: line.brand, receipts: 0, lines: 0 };
    row.lines += 1;
    const token = `${line.receipt || 1}|${key}`;
    if (!seen.has(token)) {
      seen.add(token);
      row.receipts += 1;
    }
    stats.set(key, row);
  }
  return [...stats.values()].sort((a, b) => b.receipts - a.receipts || b.lines - a.lines || a.display.localeCompare(b.display))[0]?.display || "";
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
      brand = frequentBrand(store);
      productName = store[0]?.name || productName;
      size = store[0]?.size || size;
      upc = store.find((line) => line.upc)?.upc || upc;
    } else if (named.length && named.length * 2 >= rows.length) {
      mode = "brand";
      brand = frequentBrand(named);
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
  const lines = dedupeReceiptLines(parseReceiptText(text));
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

function dedupeLines(lines: ReceiptLine[]): ReceiptLine[] {
  const seen = new Set<string>();
  const kept: ReceiptLine[] = [];
  for (const line of lines) {
    const key = line.upc ? `upc:${line.upc}` : `name:${fold(line.name)}|${fold(line.size)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(line);
  }
  return kept;
}

/** Model JSON, a transcript, or both. UPC lines from the transcript win. */
export function receiptFromVision(raw: string): ReceiptAnalysis | null {
  const text = String(raw || "");
  if (!text.trim()) return null;
  let payload: { text?: unknown } | null = null;
  try {
    const parsed = parseModelJson(text);
    payload = parsed && typeof parsed === "object" ? (parsed as { text?: unknown }) : null;
  } catch {
    payload = null;
  }
  const transcript = typeof payload?.text === "string" ? payload.text : payload ? "" : text;
  const fromText = transcript.trim() ? analyzeReceipt(transcript) : { lines: [], learned: [], paper: false, paperNote: "" };
  const modeled = validateAiItems(payload ?? {});
  const fromItems = modeled.ok ? learnReceiptLines(modeled.items) : null;
  const lines = dedupeLines([...(fromText.lines.some((line) => line.upc) ? fromText.lines : []), ...(fromItems?.lines || []), ...(!fromText.lines.some((line) => line.upc) ? fromText.lines : [])]);
  if (!lines.length) return null;
  const paper = looksLikePaperReceipt(lines);
  return { lines, learned: inferReceiptPreferences(lines), paper, paperNote: paper ? PAPER_RECEIPT_NOTE : "" };
}

/** Re-learn after the shopper removes a line. Prices are cleared. */
export type CatalogBrandHit = {
  upc?: string;
  brand?: string;
  name?: string;
  storeBrand?: boolean;
};

/**
 * When a line has a UPC that is already in the catalog, use that brand.
 * The model is not asked to guess a brand from a barcode.
 */
export function applyCatalogBrands(lines: ReceiptLine[], products: CatalogBrandHit[]): ReceiptLine[] {
  const byUpc = new Map<string, CatalogBrandHit>();
  for (const product of products || []) {
    const key = upcKey(product?.upc);
    if (!key || byUpc.has(key)) continue;
    if (!clean(product.brand || "") && !clean(product.name || "")) continue;
    byUpc.set(key, product);
  }
  if (!byUpc.size) return lines;
  let changed = false;
  const next = lines.map((line) => {
    const key = upcKey(line.upc);
    const match = key ? byUpc.get(key) : undefined;
    if (!match) return line;
    const brand = clean(match.brand || "") || line.brand;
    const store = Boolean(match.storeBrand) || isReceiptStoreBrand(brand);
    const named = clean(match.name || "") || line.name;
    const category = categoryFor(named, brand) || (line.family ? { id: line.family, label: line.label } : null);
    const updated: ReceiptLine = {
      ...line,
      brand,
      storeBrand: store,
      family: category?.id || line.family,
      label: category?.label || line.label,
    };
    if (updated.brand !== line.brand || updated.storeBrand !== line.storeBrand || updated.family !== line.family || updated.label !== line.label) {
      changed = true;
    }
    return updated;
  });
  return changed ? next : lines;
}

export function relearnReceipt(lines: ReceiptLine[]): ReceiptAnalysis {
  const kept = dedupeReceiptLines(lines);
  const paper = looksLikePaperReceipt(kept);
  return {
    lines: kept,
    learned: inferReceiptPreferences(kept),
    paper,
    paperNote: paper ? PAPER_RECEIPT_NOTE : "",
  };
}

export function learnReceiptLines(input: unknown[]): ReceiptAnalysis {
  const lines = dedupeReceiptLines(
    (Array.isArray(input) ? input : [])
      .slice(0, 160)
      .map((row, index) => asLine(row, index))
      .filter((line): line is ReceiptLine => Boolean(line))
  );
  const paper = looksLikePaperReceipt(lines);
  return {
    lines,
    learned: inferReceiptPreferences(lines),
    paper,
    paperNote: paper ? PAPER_RECEIPT_NOTE : "",
  };
}
