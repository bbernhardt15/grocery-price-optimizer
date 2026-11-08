/**
 * A store card shows the checkout on the collapsed row. Opening it
 * only lists the items.
 */

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeText(value) {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Review-tab label. Walmart is a cart link, not a sign-in. */
export function reviewCheckoutLabel(store) {
  const type = store?.handoff?.action?.type || "";
  const name = clean(store?.storeName) || "the store";
  if (type === "kroger_cart") return `Send to ${name} cart`;
  if (type === "walmart_cart") return "Open Walmart cart";
  const label = clean(store?.handoff?.action?.label);
  if (label) return label.replace(/^Open in Walmart cart$/i, "Open Walmart cart");
  return `Open ${name} list`;
}

/**
 * Swap the button's visible words without moving the control.
 * @param {string} actionHtml
 * @param {string} label
 */
export function withCheckoutLabel(actionHtml, label) {
  const html = String(actionHtml || "");
  const next = escapeText(label);
  if (!html || !next) return html;
  return html.replace(/>([^<]*)<\/button>/, `>${next}</button>`);
}

/**
 * @param {{ name: string, countLabel: string, total?: string, markHtml?: string, actionHtml: string, itemsHtml: string, couponsHtml?: string, swapsHtml?: string }} card
 */
export function reviewStoreCardHtml(card) {
  const total = card.total ? `<strong>${escapeText(card.total)}</strong>` : "";
  const minHeight = Math.max(0, Math.floor(Number(card.minHeight) || 0));
  const style = minHeight ? ` style="min-height:${minHeight}px"` : "";
  return `<article class="calm-store review-store" data-store="${escapeText(card.name)}"${style}>
    <header class="review-store-head">
      <h3 class="store-fold-name">${escapeText(card.name)}</h3>
      <p class="review-store-meta"><span>${escapeText(card.countLabel)}</span>${total}</p>
    </header>
    <div class="review-store-main">
      <details class="store-fold" open>
        <summary>Items in this cart</summary>
        ${card.markHtml || ""}
        <p class="price-source">Shelf estimates from ${escapeText(card.name)}. Not a checkout total.</p>
        <ul class="review-lines">${card.itemsHtml || ""}</ul>
        ${card.swapsHtml || ""}
      </details>
      <div class="shop-actions review-checkout">${card.actionHtml || ""}</div>
    </div>
    ${card.couponsHtml || ""}
  </article>`;
}
