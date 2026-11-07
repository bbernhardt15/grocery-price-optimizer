/**
 * Presentation for the five-screen intake.
 * Store choice, live read cards, and the learned summary's labels.
 * No prices are invented here.
 */

import { stapleById } from "./stapleFamilies.js";
import { READING_RECEIPT, readCardTitle } from "./receiptReading.js";

export const CART_READY = new Set(["Kroger", "Walmart"]);

const KNOWN_STORES = ["H-E-B", "Sam's Club", "Whole Foods", "Amazon Fresh", "Jewel-Osco", "Food Lion", "Stop & Shop", "Winn-Dixie", "Giant Eagle", "Instacart", "Kroger", "Walmart", "Target", "Costco", "Meijer", "Publix", "Safeway", "Aldi", "Amazon"];

const DEPT_LABELS = {
  produce: "Produce",
  "dairy-eggs": "Dairy & eggs",
  "meat-seafood": "Meat & seafood",
  bakery: "Bakery",
  deli: "Deli",
  pantry: "Pantry",
  frozen: "Frozen",
  snacks: "Snacks",
  beverages: "Beverages",
  breakfast: "Breakfast",
  baby: "Baby",
  household: "Household",
  "personal-care": "Personal care",
  pet: "Pet",
  other: "Other",
};

function escapeText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function chainSlug(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function storeMonogram(name) {
  const parts = String(name || "")
    .replace(/&/g, " ")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return String(name || "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
}

/** "kroger-order.pdf" → "Kroger order". */
export function orderTitle(name) {
  const text = String(name || "");
  const hit = KNOWN_STORES.find((store) => text.toLowerCase().includes(store.toLowerCase()));
  if (hit) return `${hit} order`;
  const cleaned = text.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim();
  if (!cleaned || /^pasted/i.test(cleaned) || cleaned.length > 42 || text.includes("\n")) return "Pasted order";
  return cleaned;
}

/** Live count on a file card. */
export function foundLabel(name, count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const noun = n === 1 ? "item" : "items";
  return `${orderTitle(name)}, ${n} ${noun} found`;
}

export function learnedCategory(row) {
  const family = stapleById(row?.family);
  const id = family?.departments?.[0] || "other";
  return { id, label: DEPT_LABELS[id] || "Other" };
}

export function modeLine(row) {
  if (row?.mode === "storeBrand") return "Store brand";
  if (row?.mode === "cheapest" || row?.mode === "cheapestPicks") return "Cheapest";
  if (row?.mode === "never") return "Skip";
  return "Name brand";
}

export function frequencyLine(row) {
  const receipts = Math.max(0, Math.floor(Number(row?.receipts) || 0));
  const units = Math.max(0, Math.floor(Number(row?.count) || 0));
  if (receipts > 1) return `On ${receipts} orders`;
  if (units > 1 && receipts <= 1) return `${units} on the order`;
  if (units === 1 || receipts === 1) return "Bought once";
  return "";
}

/**
 * Last paid total when the order lines already have prices.
 * The next trip is a promise, not a made-up price.
 * @param {object[]} lines
 */
export function basketTeaser(lines) {
  const paid = (lines || []).reduce((sum, line) => {
    const amount = Number(line?.price);
    return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
  }, 0);
  const before = paid > 0 ? paid.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "";
  return {
    before,
    after: "We'll find it for less.",
    note: "We'll handle the math.",
  };
}

export function basketTeaserHtml(lines) {
  const teaser = basketTeaser(lines);
  const before = teaser.before
    ? `<div><span>Last time</span><strong>${escapeText(teaser.before)}</strong></div>`
    : `<div><span>Last time</span><strong>Your usuals</strong></div>`;
  return `<aside class="basket-teaser">
    <p class="basket-kicker">Your usual basket</p>
    <div class="basket-compare">
      ${before}
      <div><span>Next trip</span><strong>${escapeText(teaser.after)}</strong></div>
    </div>
    <p>${escapeText(teaser.note)}</p>
  </aside>`;
}

/**
 * @param {string[]} names
 * @param {{ selected?: Set<string>, open?: boolean }} options
 */
export function storeChoiceHtml(names, options = {}) {
  const selected = options.selected instanceof Set ? options.selected : new Set();
  const open = Boolean(options.open);
  return (names || [])
    .map((name) => {
      const on = open || selected.has(name);
      const badge = CART_READY.has(name) ? `<span class="cart-ready">Cart ready</span>` : "";
      return `<label class="store-choice">
        <input type="checkbox" data-place-store="${escapeText(name)}" ${on ? "checked" : ""} />
        <span class="store-mark" data-chain="${escapeText(chainSlug(name))}" aria-hidden="true">${escapeText(storeMonogram(name))}</span>
        <span class="store-choice-copy"><span class="store-choice-name">${escapeText(name)}</span>${badge}</span>
      </label>`;
    })
    .join("");
}

/**
 * Activity under the reading title. The count lives here so the card
 * does not turn into a finished "N items found" screen before the learned view.
 * @param {object | null | undefined} card
 * @param {number} [tick]
 */
export function readingPhaseText(card, tick = 0) {
  const message = String(card?.message || "").trim();
  const named = (card?.items || []).map((name) => String(name || "").trim()).filter(Boolean).length;
  const found = Math.max(0, Math.floor(Number(card?.found) || 0), named);
  const count = found > 0 ? foundLabel(card?.name, found) : "";
  if (/match/i.test(message)) return count ? `${count}. Matching brands…` : "Matching brands…";
  if (message && !/^reading your receipt/i.test(message)) return message;
  if (count) return count;
  const fillers = ["Looking for item names…", "Still reading…", "Working through the receipt…"];
  const step = Math.floor(Number(tick) || 0);
  if (step > 0) return fillers[(step - 1) % fillers.length];
  return "";
}

export function readCardHtml(card) {
  const status = card?.status || "reading";
  const hideItems = Boolean(card?.hideItems);
  const items = hideItems ? "" : (card?.items || []).map((name) => `<li class="read-item">${escapeText(name)}</li>`).join("");
  const phase = readingPhaseText(card, card?.tick);
  const waiting = status === "reading" && !(card?.items || []).length && !phase
    ? `<div class="read-skel" aria-hidden="true"><span></span><span></span><span></span></div>`
    : "";
  const error = status === "error"
    ? `<p class="read-error">${escapeText(card?.error || "Couldn't read that file.")}</p><button type="button" class="ghost" data-read-retry="${escapeText(card?.index)}">Retry</button>`
    : "";
  const ratio = Math.max(0, Math.min(1, Number(card?.ratio) || 0));
  const ratioLabel = String(Math.round(ratio * 1000) / 1000);
  const meter = ratio > 0 ? `<progress max="1" value="${ratioLabel}"></progress>` : `<progress max="1"></progress>`;
  const title = status === "reading" || status === "pending" ? READING_RECEIPT : readCardTitle(card, foundLabel);
  const stage = phase ? `<p class="read-stage" data-read-phase="1">${escapeText(phase)}</p>` : "";
  return `<article class="read-card" data-read-card="${escapeText(card?.index)}" data-state="${escapeText(status)}">
    <h3>${escapeText(title)}</h3>
    ${stage}
    ${meter}
    ${waiting}
    <ul class="read-items">${items}</ul>
    ${error}
  </article>`;
}

export function readLiveHtml(cards) {
  return `<div class="read-live">${(cards || []).map((card) => readCardHtml(card)).join("")}</div>`;
}
