/**
 * Review stays the same height while prices are still coming in.
 * Skeleton cards match the loaded store cards. The headline is withheld
 * until every store has resolved, so it cannot swap mid-scroll.
 */

import { planIsShowable } from "./planCache.js";

export const REVIEW_CARD_MIN_PX = 148;
/** Room for the coupon callout and the cart button on a phone width. */
export const REVIEW_KROGER_MIN_PX = 256;
/** Coupon callout, cart button, and the Walmart handoff note. */
export const REVIEW_WALMART_MIN_PX = 304;
export const REVIEW_HEAD_MIN_PX = 196;
export const REVIEW_LOADING_STATUS = "Checking store prices";
export const REVIEW_GAVE_UP_STATUS = "Couldn't check every store. Pull to try again.";

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

function storeKey(name) {
  return clean(name).toLowerCase();
}

/** @param {string} storeName */
export function reviewCardMinPx(storeName) {
  const key = storeKey(storeName);
  if (key.includes("walmart")) return REVIEW_WALMART_MIN_PX;
  if (key.includes("kroger")) return REVIEW_KROGER_MIN_PX;
  return REVIEW_CARD_MIN_PX;
}

/**
 * One slot per store the shopper picked. An empty pick still reserves
 * Kroger and Walmart, which is the same pair the price check uses.
 * @param {string[] | null | undefined} storeNames
 */
export function reviewStoreNames(storeNames) {
  const rows = [];
  const seen = new Set();
  for (const name of storeNames || []) {
    const label = clean(name);
    const key = storeKey(label);
    if (!label || seen.has(key)) continue;
    seen.add(key);
    rows.push(label);
  }
  return rows.length ? rows : ["Kroger", "Walmart"];
}

/**
 * Loading and loaded frames share a card count and a min-height.
 * @param {string[] | null | undefined} storeNames
 */
export function reviewLayoutFrames(storeNames) {
  const names = reviewStoreNames(storeNames);
  const cards = names.map((name) => ({
    name,
    minHeight: reviewCardMinPx(name),
    height: reviewCardMinPx(name),
  }));
  return {
    count: cards.length,
    headMinHeight: REVIEW_HEAD_MIN_PX,
    loading: cards.map((card) => ({ ...card, role: "skeleton" })),
    loaded: cards.map((card) => ({ ...card, role: "store" })),
  };
}

/** @param {string[] | null | undefined} storeNames */
export function reviewFramesMatch(storeNames) {
  const frames = reviewLayoutFrames(storeNames);
  if (frames.loading.length !== frames.loaded.length || frames.loading.length !== frames.count) return false;
  return frames.loading.every(
    (card, index) => card.minHeight === frames.loaded[index].minHeight && card.height === frames.loaded[index].height
  );
}

/** @param {string[] | null | undefined} storeNames */
export function reviewSkeletonHtml(storeNames) {
  const frames = reviewLayoutFrames(storeNames);
  const cards = frames.loading
    .map(
      (card) =>
        `<article class="review-skel-card" data-review-skel="${escapeText(card.name)}" style="min-height:${card.minHeight}px;height:${card.height}px"><span class="review-skel-line"></span><span class="review-skel-line"></span><span class="review-skel-line"></span></article>`
    )
    .join("");
  return `<div class="store-grid review-skel" data-review-skel-count="${frames.count}" aria-hidden="true">${cards}</div>`;
}

/**
 * The loading shell. No plan headline, no totals, no store-error rows.
 * The head slot is already the height of the savings card so filling it
 * later does not insert a block above the store cards.
 * @param {string[] | null | undefined} storeNames
 * @param {string} [status]
 */
export function reviewLoadingHtml(storeNames, status = REVIEW_LOADING_STATUS) {
  const frames = reviewLayoutFrames(storeNames);
  const line = clean(status) || REVIEW_LOADING_STATUS;
  return `<div class="review-stable" data-review-stable="loading" data-review-skel-count="${frames.count}">
    <div class="review-head-slot" data-review-head-slot style="min-height:${frames.headMinHeight}px"></div>
    ${reviewSkeletonHtml(storeNames)}
    <p class="review-loading-status">${escapeText(line)}</p>
  </div>`;
}

/**
 * The headline is part of the settled plan only.
 * @param {object | null | undefined} payload
 */
export function reviewHeadlineReady(payload) {
  // A still-streaming body is not the headline. The caller marks a priced
  // partial as displayed first. An unpriced $0 shell is not a headline.
  if (!payload || payload.partial) return false;
  return planIsShowable(payload);
}

/** Skeleton slots for stores that have not answered yet. An empty list stays empty. */
export function reviewPendingCardsHtml(names) {
  const list = [];
  const seen = new Set();
  for (const name of names || []) {
    const label = clean(name);
    const key = storeKey(label);
    if (!label || seen.has(key)) continue;
    seen.add(key);
    list.push(label);
  }
  return list
    .map((name) => {
      const minHeight = reviewCardMinPx(name);
      return `<article class="review-skel-card" data-review-pending="${escapeText(name)}" style="min-height:${minHeight}px;height:${minHeight}px" aria-hidden="true"><span class="review-skel-line"></span><span class="review-skel-line"></span><span class="review-skel-line"></span></article>`;
    })
    .join("");
}
