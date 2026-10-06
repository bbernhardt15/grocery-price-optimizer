/** Idle time before a catalog suggest request. Fast enough to feel live, slow enough to skip partial keystrokes. */
export const SUGGEST_DEBOUNCE_MS = 160;

/**
 * Case-insensitive highlight spans for a typeahead query.
 * Each word is marked wherever it appears. Matching uses indexOf, so
 * characters that are special in regular expressions stay literal.
 * @param {string} text
 * @param {string} query
 * @returns {Array<{ text: string, match: boolean }>}
 */
export function highlightMatch(text, query) {
  const source = String(text ?? "");
  const words = [...new Set(String(query ?? "").trim().toLowerCase().split(/\s+/).filter((word) => word.length > 0))];
  if (!source || words.length === 0) return [{ text: source, match: false }];

  const lower = source.toLowerCase();
  const marks = Array(source.length).fill(false);
  for (const word of words) {
    let from = 0;
    while (from < lower.length) {
      const at = lower.indexOf(word, from);
      if (at < 0) break;
      for (let index = at; index < at + word.length && index < marks.length; index += 1) {
        marks[index] = true;
      }
      from = at + 1;
    }
  }

  /** @type {Array<{ text: string, match: boolean }>} */
  const parts = [];
  let buffer = "";
  let matching = marks[0] === true;
  for (let index = 0; index < source.length; index += 1) {
    if (marks[index] !== matching) {
      parts.push({ text: buffer, match: matching });
      buffer = source[index];
      matching = marks[index] === true;
    } else {
      buffer += source[index];
    }
  }
  if (buffer) parts.push({ text: buffer, match: matching });
  return parts.length > 0 ? parts : [{ text: source, match: false }];
}

/**
 * Combobox cursor. ArrowDown from nothing selects the first row.
 * ArrowUp from nothing selects the last. The index clamps at both ends.
 * @param {number} current
 * @param {number} count
 * @param {"ArrowDown" | "ArrowUp"} key
 */
export function nextSuggestIndex(current, count, key) {
  if (count <= 0) return -1;
  const index = Number.isInteger(current) ? current : -1;
  if (key === "ArrowDown") {
    if (index < 0) return 0;
    return Math.min(count - 1, index + 1);
  }
  if (index < 0) return count - 1;
  return Math.max(0, index - 1);
}

/**
 * @param {string} query
 * @param {"idle" | "loading" | "ready"} phase
 * @param {number} resultCount
 * @returns {"hint" | "loading" | "empty" | "results"}
 */
export function suggestPanelKind(query, phase, resultCount) {
  const text = String(query ?? "").trim();
  if (!text) return "hint";
  if (resultCount > 0 && phase !== "loading") return "results";
  if (phase === "loading") return resultCount > 0 ? "results" : "loading";
  if (phase === "ready") return "empty";
  return "hint";
}

/**
 * Brand, department, and size — skipping blanks so the row doesn't read " · · ".
 * @param {{ brand?: string | null, departmentName?: string | null, sizeLabel?: string | null }} item
 * @returns {string[]}
 */
export function suggestionFacts(item) {
  return [item?.brand, item?.departmentName, item?.sizeLabel]
    .map((value) => String(value ?? "").trim())
    .filter((value) => value.length > 0);
}

/**
 * @param {number | null | undefined} price
 * @param {string | null | undefined} store
 * @param {(value: number) => string} format
 */
export function suggestionPriceLabel(price, store, format) {
  const amount = Number(price);
  if (!Number.isFinite(amount)) return null;
  const money = format(amount);
  const place = String(store ?? "").trim();
  return place ? `${money} at ${place}` : money;
}
