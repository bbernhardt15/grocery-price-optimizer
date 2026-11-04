/**
 * The review wait. A per-store checklist, item counts, and a seconds
 * estimate. The 9-second price budget is the ceiling. Never a bare spinner.
 */

import { planChecklist, planChecklistHtml } from "./planProgress.js";

export const PLAN_BUDGET_SECONDS = 9;

function escapeText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {{ itemCount?: number, storeCount?: number, checked?: number, startedAt?: number, now?: number }} input
 */
export function estimatePlanSeconds(input = {}) {
  const items = Math.max(0, Math.floor(Number(input.itemCount) || 0));
  const stores = Math.max(1, Math.floor(Number(input.storeCount) || 1));
  const checked = Math.max(0, Math.floor(Number(input.checked) || 0));
  const work = Math.max(0, items * stores - checked);
  const pace = Math.max(1, Math.ceil(work / 8));
  const elapsed = input.startedAt ? Math.max(0, Math.floor(((input.now || Date.now()) - input.startedAt) / 1000)) : 0;
  const remainingBudget = Math.max(1, PLAN_BUDGET_SECONDS - elapsed);
  return Math.max(1, Math.min(PLAN_BUDGET_SECONDS, remainingBudget, Math.max(pace, 1)));
}

/**
 * @param {string[]} stores
 * @param {Record<string, { done?: boolean, checked?: number, total?: number }>} progress
 * @param {{ itemCount?: number, startedAt?: number, now?: number, note?: string }} [options]
 */
export function planStatusModel(stores, progress = {}, options = {}) {
  const rows = planChecklist(stores, progress);
  const names = rows.map((row) => row.storeName);
  const checked = rows.reduce((sum, row) => sum + (Number(row.checked) || 0), 0);
  const itemCount = Math.max(0, Math.floor(Number(options.itemCount) || 0));
  const priced = rows.filter((row) => row.done).length;
  const seconds = estimatePlanSeconds({
    itemCount: itemCount || rows[0]?.total || 0,
    storeCount: names.length,
    checked,
    startedAt: options.startedAt,
    now: options.now,
  });
  const headline = priced > 0 ? `Priced ${priced} of ${names.length} stores` : `Checking ${names.length} ${names.length === 1 ? "store" : "stores"}`;
  const counts = itemCount > 0 ? `${Math.min(checked, itemCount * names.length)} prices checked · ${itemCount} items` : "Checking prices";
  return {
    rows,
    headline,
    detail: `${counts} · about ${seconds}s`,
    seconds,
  };
}

/** @param {ReturnType<typeof planStatusModel>} model */
export function planStatusHtml(model) {
  const rows = model?.rows?.length ? model.rows : planChecklist(["Kroger", "Walmart"], {});
  const headline = model?.headline || "Checking store prices";
  const detail = model?.detail || `about ${PLAN_BUDGET_SECONDS}s`;
  return `<section class="plan-status" id="plan-status-block" aria-live="polite" aria-busy="true">
    <p class="plan-status-line" id="plan-status-line">${escapeText(headline)}. ${escapeText(detail)}.</p>
    ${planChecklistHtml(rows)}
  </section>`;
}
