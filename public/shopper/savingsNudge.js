/**
 * A split that barely beats the best single store is usually not worth the extra stop.
 */

import { formatMoney, roundMoney } from "./savingsMeter.js";

export const NUDGE_DOLLARS = 5;
export const NUDGE_RATIO = 0.03;

function escapeText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {{ best?: { stops?: number, total?: number }, baseline?: { storeName?: string, total?: number, complete?: boolean }, saved?: number } | null | undefined} plans
 */
export function savingsNudge(plans) {
  const best = plans?.best;
  const baseline = plans?.baseline;
  const stops = Math.floor(Number(best?.stops) || 0);
  const single = Number(baseline?.total);
  const saved = Number.isFinite(Number(plans?.saved)) ? roundMoney(plans.saved) : roundMoney(single - Number(best?.total));
  if (!baseline?.complete || !baseline.storeName || stops < 2) return null;
  if (!Number.isFinite(single) || single <= 0 || !(saved > 0.009)) return null;
  const ratio = saved / single;
  if (saved + 0.009 >= NUDGE_DOLLARS && ratio + 1e-9 >= NUDGE_RATIO) return null;
  const lead = stops === 2 ? "Two stores" : `${stops} stores`;
  return {
    saved,
    ratio,
    stops,
    storeName: baseline.storeName,
    singleTotal: roundMoney(single),
    text: `${lead} only saves ${formatMoney(saved)}. Shop just at ${baseline.storeName} for ${formatMoney(single)} instead?`,
  };
}

/** @param {ReturnType<typeof savingsNudge>} nudge */
export function savingsNudgeHtml(nudge, escapeHtml = escapeText) {
  if (!nudge?.text) return "";
  return `<section class="savings-nudge" data-savings-nudge="1">
    <p>${escapeHtml(nudge.text)}</p>
    <div class="review-head-actions">
      <button type="button" class="primary" data-nudge-single="1">Shop just at ${escapeHtml(nudge.storeName)}</button>
      <button type="button" class="ghost" data-nudge-keep="1">Keep the split</button>
    </div>
  </section>`;
}
