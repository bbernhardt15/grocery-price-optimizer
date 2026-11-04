/**
 * ZIP entry for onboarding.
 * iOS Chrome keeps painting the placeholder on its own layer after the
 * field is cleared and typed into again, so the hint sits on top of the
 * digits. The placeholder attribute is present only while the value is
 * empty. There is no second label drawn over the field, and the autofill
 * chrome is turned off so it cannot paint another overlay.
 */

import { ZIP_PLACEHOLDER } from "./zipField.js";

export { ZIP_PLACEHOLDER };

function escapeAttr(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/** @param {HTMLInputElement | null | undefined} input @param {string} [placeholder] */
export function syncZipPlaceholder(input, placeholder = ZIP_PLACEHOLDER) {
  if (!input) return;
  const empty = String(input.value || "").length === 0;
  if (empty) {
    input.removeAttribute("data-filled");
    if (input.getAttribute("placeholder") !== placeholder) input.setAttribute("placeholder", placeholder);
    return;
  }
  input.setAttribute("data-filled", "1");
  input.removeAttribute("placeholder");
}

/** @param {HTMLInputElement | null | undefined} input */
export function bindZipEntry(input) {
  if (!input || input.dataset.zipBound === "1") return;
  input.dataset.zipBound = "1";
  const sync = () => syncZipPlaceholder(input);
  input.addEventListener("input", sync);
  input.addEventListener("keyup", sync);
  input.addEventListener("change", sync);
  sync();
}

/**
 * Label sits above the field. The input carries the placeholder itself,
 * and only when it has no digits.
 * @param {{ id?: string, value?: string, placeholder?: string }} [options]
 */
export function zipEntryFieldHtml(options = {}) {
  const id = options.id || "profile-zip";
  const value = String(options.value || "");
  const placeholder = options.placeholder || ZIP_PLACEHOLDER;
  const filled = value.length > 0;
  const hint = filled ? "" : ` placeholder="${escapeAttr(placeholder)}"`;
  const flag = filled ? ` data-filled="1"` : "";
  return `<div class="zip-entry">
    <label class="zip-entry-label" for="${escapeAttr(id)}">ZIP</label>
    <input id="${escapeAttr(id)}" class="zip-entry-input" type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" maxlength="5" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" aria-autocomplete="none" data-1p-ignore="true" data-lpignore="true" data-form-type="other" name="gg-code-entry"${hint}${flag} value="${escapeAttr(value)}" />
  </div>`;
}
