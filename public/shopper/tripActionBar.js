/**
 * Select all stays at the top. Add and Start with an empty trip sit at the
 * end of the list, after the shopper has scrolled the rows.
 */

function escapeText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {number} count */
export function selectedCountLabel(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  return n === 1 ? "1 selected" : `${n} selected`;
}

/** @param {number} count */
export function tripButtonsEnabled(count) {
  return Math.max(0, Math.floor(Number(count) || 0)) > 0;
}

/**
 * @param {{ count?: number, canAdd?: boolean, escapeHtml?: (value: string) => string }} [options]
 */
export function tripActionBarHtml(options = {}) {
  const escape = options.escapeHtml || escapeText;
  const count = Math.max(0, Math.floor(Number(options.count) || 0));
  return `<div class="trip-action-bar" id="trip-action-bar">
    <div class="trip-action-tools">
      <button type="button" class="ghost trip-select-all" data-trip-all="all">Select all</button>
      <button type="button" class="ghost" data-trip-all="none">Clear all</button>
      <p class="trip-action-count" id="trip-add-count">${escape(selectedCountLabel(count))}</p>
    </div>
  </div>`;
}

/**
 * @param {ParentNode | null | undefined} root
 * @param {{ label?: string, canAdd?: boolean, selected?: number }} status
 */
export function syncTripAddBar(root, status) {
  if (!root) return { selected: 0, canAdd: false };
  const selected = Math.max(0, Math.floor(Number(status?.selected) || 0));
  const canAdd = status?.canAdd === true && tripButtonsEnabled(selected);
  const total = root.querySelector("#trip-add-total");
  if (total) total.textContent = status?.label || "";
  const count = root.querySelector("#trip-add-count");
  if (count) count.textContent = selectedCountLabel(selected);
  for (const button of root.querySelectorAll("[data-trip-add]")) {
    if ("disabled" in button) button.disabled = !canAdd;
  }
  return { selected, canAdd };
}
