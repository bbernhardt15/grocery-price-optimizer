/**
 * Turns pasted notes, carts, receipts, and spreadsheet exports into
 * grocery lines. No prices are kept. Junk chrome is dropped.
 */

export type ParsedImportItem = {
  raw: string;
  name: string;
  quantity: number;
  brand?: string;
  size?: string;
  upc?: string;
  notes?: string;
};

const MAX_ITEMS = 80;

const JUNK =
  /^(?:sub\s*total|subtotal|grand\s*total|order\s*total|estimated\s*total|total|tax|tip|driver\s*tip|service\s*fee|delivery\s*fee|bag\s*fee|you\s*saved|savings|discount|add\s*to\s*cart|added\s*to\s*cart|save\s*for\s*later|saved\s*for\s*later|continue(?:\s+shopping)?|checkout|check\s*out|place\s*order|order\s*summary|shipping|delivery|pickup|in-?store\s*pickup|sold\s+by\b.*|sponsored|see\s+more|show\s+more|view\s+cart|cart|my\s+cart|your\s+cart|shopping\s+cart|items?(?:\s+in(?:\s+your)?\s+cart)?|qty|quantity|price|item|description|product|remove|edit|share|sign\s*in|log\s*in|create\s+account|subscribe|unsubscribe|privacy(?:\s+policy)?|terms|help|feedback|ratings?|reviews?|page\s+\d+|order\s*#?\s*\d+.*|purchased\s+on\b.*|delivered\b.*|arriving\b.*|today|yesterday|payment\b.*|visa\b.*|mastercard\b.*|amex\b.*|paypal\b.*|change|coupons?|rewards?|member(?:ship)?|thank\s+you.*|receipt|store\s*#?\s*\d+.*)$/i;

const STORE =
  /^(?:kroger|walmart|target|amazon|instacart|aldi|costco|sam'?s(?:\s+club)?|whole\s+foods|trader\s+joe'?s|publix|safeway|albertsons|meijer|h-?e-?b|food\s+lion|wegmans|sprouts)(?:\s*#?\s*\d+)?$/i;

const SECTION =
  /^(?:produce|dairy(?:\s*&\s*eggs)?|meat(?:\s*&\s*seafood)?|seafood|bakery|deli|pantry|frozen|snacks?|beverages?|drinks?|breakfast|baby|household|personal\s+care|pet|grocery|groceries|shopping\s+list|my\s+list|your\s+list|list|ingredients?|order\s+details|items|in\s+your\s+cart|saved\s+items)$/i;

const WORD_NUMBER: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  couple: 2,
  few: 3,
  some: 1,
};

const PURCHASE_UNIT =
  /^(?:gallons?|gals?|loaves|loaf|dozens?|bags?|boxes|box|cartons?|jugs?|jars?|bunches?|heads?|rolls?)$/i;

const MULTIPACK_UNIT = /^(?:packs?|packages?|cans?|bottles?)$/i;

const RECIPE_UNIT =
  /^(?:cups?|tablespoons?|tbsp|teaspoons?|tsp|cloves?|pinches?|dashes?|slices?)$/i;

const WEIGHT_UNIT = /^(?:ounces?|oz|pounds?|lbs?|grams?|g|kilograms?|kg|milliliters?|ml|liters?|litres?)$/i;

const SIZE_PHRASE =
  /(\d+(?:\.\d+)?\s*(?:fl\.?\s*oz|fluid\s+ounces?|oz|lb|lbs|pounds?|g|kg|ml|l|gal|gallons?|qt|quarts?|pt|pints?|ct|count|pk|packs?|dozen|liters?|litres?))\b|(half[\s-]?gallon|gallon|dozen|family\s+size|party\s+size)\b/i;

const COMPOUNDS: Array<[RegExp, string]> = [
  [/mac and cheese/gi, "mac & cheese"],
  [/fish and chips/gi, "fish & chips"],
  [/salt and pepper/gi, "salt & pepper"],
  [/bread and butter/gi, "bread & butter"],
  [/pork and beans/gi, "pork & beans"],
  [/sweet and sour/gi, "sweet & sour"],
  [/peanut butter and jelly/gi, "peanut butter & jelly"],
];

type Draft = ParsedImportItem & { sizeOnly?: boolean; qtyLocked?: boolean };

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clampQty(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(99, Math.floor(value));
}

function singularUnit(unit: string): string {
  const lower = unit.toLowerCase();
  if (lower === "loaves") return "loaf";
  if (lower === "boxes") return "box";
  if (lower.endsWith("s")) return lower.slice(0, -1);
  return lower;
}

function wordQty(word: string): number | null {
  return WORD_NUMBER[word.toLowerCase()] ?? null;
}

function stripBullet(line: string): string {
  return line
    .replace(/^\s*(?:[-*•▪◦‣]|[☐☑✓✔✘]|\[\s*[xX ]?\s*\]|[xX]\s|(?:\d{1,2})[.)]\s)\s*/, "")
    .trim();
}

function isJunk(line: string): boolean {
  const value = clean(line).replace(/[.:,]+$/g, "");
  if (!value || value.length > 300) return true;
  if (JUNK.test(value) || STORE.test(value) || SECTION.test(value)) return true;
  if (/^(?:your\s+cart|my\s+cart|shopping\s+list|shopping\s+cart|items\s+in\s+(?:your\s+)?cart)\b/i.test(value)) return true;
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(value)) return true;
  if (/^\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}$/.test(value)) return true;
  if (/@/.test(value) && /\s/.test(value) === false) return true;
  if (/^\d+\s+\S+(\s+\S+){0,5}\s+(?:st|street|ave|avenue|rd|road|blvd|dr|drive|ln|lane|way|ct|court)\b/i.test(value)) {
    return true;
  }
  if (/^(?:the usual|same as last time|as usual)$/i.test(value)) return true;
  return false;
}

function priceOnly(line: string): boolean {
  return /^\$?\d+\.\d{2}$/.test(clean(line));
}

function stripPrice(line: string): string {
  return clean(line)
    .replace(/\s+\$\s?\d+(?:\.\d{2})?\s*$/g, "")
    .replace(/(?:^|\s)\$\s?\d+(?:\.\d{2})?(?=\s|$)/g, " ")
    .replace(/\s{2,}\d+\.\d{2}\s*[A-Z]?$/g, "")
    .replace(/\s+\d+\.\d{2}\s*$/g, "")
    .trim();
}

function takeUpc(line: string): { line: string; upc?: string } {
  const match = line.match(/\b(\d{12,14})\b/);
  if (!match?.[1]) return { line };
  return { upc: match[1], line: clean(line.replace(match[1], " ")) };
}

function sizeOnlyText(line: string): string | null {
  const value = clean(line).replace(/^(?:size|pkg|package)[:\s]+/i, "");
  if (!value || value.length > 40) return null;
  if (SIZE_PHRASE.test(value) && !/[a-z]{4,}/i.test(value.replace(SIZE_PHRASE, " "))) return value;
  if (/^(?:half[\s-]?gallon|gallon|gal|dozen|pint|quart|family\s+size|party\s+size|\d+\s*(?:pk|pack|ct|count))$/i.test(value)) {
    return value;
  }
  return null;
}

function qtyOnly(line: string): number | null {
  const value = clean(line);
  const labeled = value.match(/^(?:qty|quantity)\s*[:x×]?\s*(\d{1,2})$/i);
  if (labeled?.[1]) return clampQty(Number(labeled[1]));
  if (/^\d{1,2}$/.test(value)) return clampQty(Number(value));
  return null;
}

function stripFillers(name: string): string {
  let next = clean(name);
  for (let i = 0; i < 4; i += 1) {
    const stripped = next.replace(/^(?:the|a|an|some|please|just)\s+/i, "");
    if (stripped === next) break;
    next = stripped;
  }
  return next;
}

function pullSize(name: string): { name: string; size?: string } {
  const match = name.match(SIZE_PHRASE);
  if (!match || match.index === undefined) return { name };
  const size = clean(match[0]);
  const rest = clean(`${name.slice(0, match.index)} ${name.slice(match.index + match[0].length)}`);
  if (!/[a-z]/i.test(rest)) return { name: clean(name) };
  return { name: rest, size };
}

function applyDash(name: string, size?: string, brand?: string): { name: string; size?: string; brand?: string } {
  const match = name.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (!match?.[1] || !match[2]) return { name, size, brand };
  const left = clean(match[1]);
  const right = clean(match[2]);
  if (!left || !right) return { name, size, brand };
  if (sizeOnlyText(right) || SIZE_PHRASE.test(right)) {
    return { name: left, size: size || right, brand };
  }
  if (sizeOnlyText(left)) {
    return { name: right, size: size || left, brand };
  }
  return { name: left, size, brand: brand || right };
}

function leadingQuantity(line: string): { quantity: number; size?: string; rest: string } | null {
  const words =
    "a couple of|a few|some|couple of|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\\d+(?:\\.\\d+)?";
  const ofPattern = new RegExp(`^(${words})\\s+([a-z]+)\\s+of\\s+(.+)$`, "i");
  const ofMatch = line.match(ofPattern);
  if (ofMatch?.[1] && ofMatch[2] && ofMatch[3]) {
    const unit = ofMatch[2];
    const qtyWord = ofMatch[1].replace(/^a\s+/i, "");
    const numeric = /^\d/.test(qtyWord) ? Number(qtyWord) : wordQty(qtyWord.split(/\s+/)[0] ?? "");
    const quantity = numeric && numeric >= 1 ? clampQty(numeric) : 1;
    if (RECIPE_UNIT.test(unit)) return { quantity: 1, rest: ofMatch[3] };
    if (WEIGHT_UNIT.test(unit)) return { quantity: 1, size: `${quantity} ${singularUnit(unit)}`, rest: ofMatch[3] };
    if (PURCHASE_UNIT.test(unit)) return { quantity, size: singularUnit(unit), rest: ofMatch[3] };
    if (MULTIPACK_UNIT.test(unit)) {
      if (quantity >= 4) return { quantity: 1, size: `${quantity} ${unit.replace(/s$/, "")}`, rest: ofMatch[3] };
      return { quantity, size: unit.replace(/s$/, ""), rest: ofMatch[3] };
    }
  }

  const attached = line.match(/^(\d+)\s*[x×]\s+(.+)$/i);
  if (attached?.[1] && attached[2]) return { quantity: clampQty(Number(attached[1])), rest: attached[2] };

  const spoken = line.match(/^(?:(a|an)\s+)?(couple|few|some|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?:\s+of)?\s+(.+)$/i);
  if (spoken?.[2] && spoken[3] && !/^\d/.test(line)) {
    return { quantity: wordQty(spoken[2]) ?? 1, rest: spoken[3] };
  }

  const labeled = line.match(/^(?:qty|quantity)\s*[:x×]?\s*(\d+)\s+(.+)$/i);
  if (labeled?.[1] && labeled[2]) return { quantity: clampQty(Number(labeled[1])), rest: labeled[2] };

  const leading = line.match(/^(\d+)\s+(.+)$/);
  if (leading?.[1] && leading[2] && !leading[2].startsWith("%")) {
    const rest = leading[2];
    const first = rest.split(/\s+/)[0]?.replace(/[.,]+$/g, "") ?? "";
    const unitWord = /^(?:oz|ounce|ounces|fl|lb|lbs|pound|pounds|g|gram|grams|kg|ml|l|gal|gallon|gallons|qt|quart|pt|pint|ct|count|pk|pack|packs|dozen|ea|each)$/i;
    if (!unitWord.test(first)) return { quantity: clampQty(Number(leading[1])), rest };
  }

  const trailing = line.match(/^(.+?)\s*[x×]\s*(\d+)$/i);
  if (trailing?.[1] && trailing[2]) return { quantity: clampQty(Number(trailing[2])), rest: trailing[1] };

  const qtyTail = line.match(/^(.+?)\s+(?:qty|quantity)\s*[:x×]?\s*(\d+)$/i);
  if (qtyTail?.[1] && qtyTail[2]) return { quantity: clampQty(Number(qtyTail[2])), rest: qtyTail[1] };

  return null;
}

function parseClause(rawLine: string): Draft | null {
  const raw = clean(stripBullet(rawLine));
  if (!raw || isJunk(raw) || priceOnly(raw)) return null;
  const onlyQty = qtyOnly(raw);
  if (onlyQty !== null && raw.length < 12) return { raw, name: "", quantity: onlyQty, sizeOnly: false, qtyLocked: true };
  const onlySize = sizeOnlyText(raw);
  if (onlySize) return { raw, name: "", quantity: 1, size: onlySize, sizeOnly: true };

  let line = stripPrice(raw);
  const upc = takeUpc(line);
  line = upc.line;
  if (!line || isJunk(line)) return null;

  let quantity = 1;
  let size: string | undefined;
  const leading = leadingQuantity(line);
  if (leading) {
    quantity = leading.quantity;
    size = leading.size;
    line = clean(leading.rest);
  }
  line = stripFillers(line);
  let brand: string | undefined;
  const dashed = applyDash(line, size, brand);
  line = dashed.name;
  size = dashed.size;
  brand = dashed.brand;
  if (!size) {
    const pulled = pullSize(line);
    line = pulled.name;
    size = pulled.size;
  }
  const commaSize = line.match(/^(.+?),\s*([^,]+)$/);
  if (commaSize?.[1] && commaSize[2] && (sizeOnlyText(commaSize[2]) || SIZE_PHRASE.test(commaSize[2]))) {
    line = clean(commaSize[1]);
    size = size || clean(commaSize[2]);
  }
  line = clean(line.replace(/^[-–—:,]+|[-–—:,]+$/g, ""));
  if (!line || isJunk(line) || !/[a-z]/i.test(line)) return null;
  return {
    raw,
    name: line,
    quantity,
    ...(brand ? { brand } : {}),
    ...(size ? { size } : {}),
    ...(upc.upc ? { upc: upc.upc } : {}),
  };
}

function parseRows(lines: string[]): Draft[] {
  const items: Draft[] = [];
  let pendingQty: number | null = null;
  for (const line of lines) {
    const draft = parseClause(line);
    if (!draft) continue;
    if (!draft.name && draft.qtyLocked) {
      const last = items.at(-1);
      if (last && !last.qtyLocked) {
        last.quantity = draft.quantity;
        last.qtyLocked = true;
      } else {
        pendingQty = draft.quantity;
      }
      continue;
    }
    if (draft.sizeOnly) {
      const last = items.at(-1);
      if (last && !last.size && draft.size) last.size = draft.size;
      continue;
    }
    if (pendingQty) {
      draft.quantity = pendingQty;
      draft.qtyLocked = true;
      pendingQty = null;
    }
    items.push(draft);
  }
  return items;
}

function splitProse(text: string): string[] {
  let value = text;
  for (const [pattern, token] of COMPOUNDS) value = value.replace(pattern, token);
  return value
    .split(/\s*,\s*(?:and\s+)?|\s+and\s+/i)
    .map((part) => clean(part))
    .filter(Boolean);
}

function looseLines(text: string): string[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const commas = (text.match(/,/g) || []).length;
  const prose = lines.length <= 2 && (commas >= 2 || /\band\b/i.test(text));
  if (!prose) return lines.flatMap((line) => (line.split(",").length >= 3 ? splitProse(line) : [line]));
  return splitProse(lines.join(" "));
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(clean(current));
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(clean(current));
  return cells;
}

const NAME_HEADER = /^(?:item(?:\s*name)?|product(?:\s*name)?|title|description|name)$/i;
const QTY_HEADER = /^(?:qty|quantity|count|units)$/i;
const BRAND_HEADER = /^brand$/i;
const SIZE_HEADER = /^(?:size|package|unit\s*size)$/i;
const UPC_HEADER = /^(?:upc|gtin|barcode|ean)$/i;

function tryParseCsv(text: string): ParsedImportItem[] | null {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;
  const table = lines.map(parseCsvLine).filter((row) => row.some(Boolean));
  const header = table[0]?.map((cell) => cell.replace(/[_-]+/g, " "));
  if (!header || header.length < 2) return null;
  const nameAt = header.findIndex((cell) => NAME_HEADER.test(cell));
  if (nameAt < 0) return null;
  const qtyAt = header.findIndex((cell) => QTY_HEADER.test(cell));
  const brandAt = header.findIndex((cell) => BRAND_HEADER.test(cell));
  const sizeAt = header.findIndex((cell) => SIZE_HEADER.test(cell));
  const upcAt = header.findIndex((cell) => UPC_HEADER.test(cell));
  const items: ParsedImportItem[] = [];
  for (const row of table.slice(1)) {
    const nameCell = row[nameAt] ?? "";
    if (!nameCell || isJunk(nameCell)) continue;
    const draft = parseClause(nameCell);
    if (!draft?.name) continue;
    const qtyCell = qtyAt >= 0 ? Number(row[qtyAt]) : NaN;
    if (Number.isFinite(qtyCell) && qtyCell >= 1) draft.quantity = clampQty(qtyCell);
    const brand = brandAt >= 0 ? row[brandAt] : "";
    const size = sizeAt >= 0 ? row[sizeAt] : "";
    const upc = upcAt >= 0 ? row[upcAt]?.replace(/\D/g, "") : "";
    items.push({
      raw: nameCell,
      name: draft.name,
      quantity: draft.quantity,
      ...(brand && !isJunk(brand) ? { brand } : draft.brand ? { brand: draft.brand } : {}),
      ...(size ? { size } : draft.size ? { size: draft.size } : {}),
      ...(upc && upc.length >= 12 ? { upc } : draft.upc ? { upc: draft.upc } : {}),
    });
  }
  return items.length ? items : null;
}

function mergeKey(item: ParsedImportItem): string {
  return [item.name, item.brand || "", item.size || "", item.upc || ""]
    .join("|")
    .toLowerCase()
    .replace(/[^a-z0-9|]+/g, "");
}

function merge(items: ParsedImportItem[]): ParsedImportItem[] {
  const map = new Map<string, ParsedImportItem>();
  for (const item of items) {
    const name = clean(item.name);
    if (!name) continue;
    const next: ParsedImportItem = { ...item, name, quantity: clampQty(item.quantity) };
    const key = mergeKey(next);
    const existing = map.get(key);
    if (existing) existing.quantity = clampQty(existing.quantity + next.quantity);
    else map.set(key, next);
  }
  return [...map.values()].slice(0, MAX_ITEMS);
}

export function parseImportText(text: string): ParsedImportItem[] {
  const cleanText = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!cleanText) return [];
  const csv = tryParseCsv(cleanText);
  if (csv) return merge(csv);
  return merge(parseRows(looseLines(cleanText)).map(({ sizeOnly: _size, qtyLocked: _qty, ...item }) => item));
}
