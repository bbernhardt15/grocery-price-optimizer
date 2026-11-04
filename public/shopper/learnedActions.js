/**
 * Change and Remove sit on one horizontal row inside the card.
 * Equal columns, a 44px target, and a fixed row height so the card
 * does not wobble when the brand line wraps.
 */

function escapeText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {string} family */
export function learnedActionsHtml(family) {
  const id = escapeText(family);
  return `<div class="learned-actions" role="group" aria-label="Item actions">
    <button type="button" class="ghost learned-action" data-learned-change="${id}">Change</button>
    <button type="button" class="ghost learned-action" data-learned-remove="${id}">Remove</button>
  </div>`;
}
