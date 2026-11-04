/**
 * Compact "Your usuals" on the Add tab.
 * The section stays collapsed to a count, and opens into one horizontal
 * chip row. It is never a wrapping stack.
 */

export function usualsSummary(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const label = n === 1 ? "1 usual" : `${n} usuals`;
  return { count: n, label };
}

/**
 * @param {Array<{ key?: string, label?: string }>} rows
 * @param {(value: string) => string} escapeHtml
 */
export function usualsRowHtml(rows, escapeHtml) {
  return (rows || [])
    .map((row) => {
      const key = escapeHtml(row?.key || "");
      const label = escapeHtml(row?.label || "Item");
      return `<li><button type="button" class="quick-chip" data-usual-key="${key}">${label}</button></li>`;
    })
    .join("");
}
