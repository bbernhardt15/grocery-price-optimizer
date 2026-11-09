/**
 * A brand-new shopper: ZIP, stores, a few items typed as text, then the review screen.
 * The page's plan painter lives in app.js. This builds the same review contract
 * (stores, priced lines, no empty state) from the plan the API returns.
 */

import { parseNeedItems } from "./categoryPreference.js";

export function reviewScreen(plan) {
  const stores = Array.isArray(plan?.stores) ? plan.stores : [];
  const rows = [];
  for (const store of stores) {
    const items = Array.isArray(store?.items) ? store.items : [];
    for (const item of items) {
      const name = String(item?.name || item?.query || "").trim();
      if (!name) continue;
      rows.push({
        store: String(store.storeName || "").trim(),
        name,
        price: Number(item.itemTotal ?? item.price),
      });
    }
  }
  const empty = rows.length === 0;
  const html = empty
    ? `<div class="empty-state" data-screen="review"><h2>Nothing to shop yet</h2><p>Add a few items and we'll make the plan.</p></div>`
    : `<section id="review-screen" data-step="plan" data-screen="review" aria-label="Review the split"><h2>Review the split</h2>${stores
        .map((store) => {
          const items = (store.items || [])
            .map((item) => {
              const name = String(item?.name || item?.query || "").trim();
              const amount = Number(item?.itemTotal ?? item?.price);
              const price = Number.isFinite(amount) ? `$${amount.toFixed(2)}` : "";
              return `<li class="review-line"><span>${escapeText(name)}</span>${price ? `<strong>${escapeText(price)}</strong>` : ""}</li>`;
            })
            .join("");
          return `<article class="calm-store"><h3>${escapeText(store.storeName || "")}</h3><ul class="review-lines">${items}</ul></article>`;
        })
        .join("")}</section>`;
  return {
    empty,
    html,
    itemCount: rows.length,
    storeCount: new Set(rows.map((row) => row.store).filter(Boolean)).size,
    rows,
  };
}

function escapeText(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * @param {{ origin: string, fetch?: typeof fetch, console?: { error: (...args: unknown[]) => void } }} options
 */
export async function runFreshAccountJourney({ origin, fetch: fetchImpl = fetch, console: logger = console }) {
  const errors = [];
  const fail = (message) => {
    errors.push(message);
    logger.error(message);
  };

  const zip = "45202";
  const stores = ["Kroger", "Walmart", "Target"];
  const text = "milk, bread, eggs";
  const typed = parseNeedItems(text);
  if (typed.length < 3) fail("typed items did not parse");

  const readyResponse = await fetchImpl(`${origin}/api/health/ready`);
  const ready = await readyResponse.json();
  if (!readyResponse.ok || ready.ok !== true) fail("health ready failed");

  const importedResponse = await fetchImpl(`${origin}/api/import/text`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-device-id": "fresh-shopper-01",
    },
    body: JSON.stringify({ text, preferAi: false, zipCode: zip }),
  });
  const imported = await importedResponse.json();
  const importedItems = Array.isArray(imported?.items) ? imported.items : [];
  if (!importedResponse.ok || importedItems.length < 3) fail("text import did not return items");

  const groceryList = (importedItems.length ? importedItems : typed).map((item) => String(item.name || item.raw || "")).filter(Boolean);
  const planResponse = await fetchImpl(`${origin}/api/optimize-list`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ groceryList, stores, zipCode: zip, allowSubstitutes: true }),
  });
  const plan = await planResponse.json();
  if (!planResponse.ok) fail(plan?.error || "plan failed");
  if (plan?.zipCode && plan.zipCode !== zip) fail("plan ignored the ZIP");

  const screen = reviewScreen(plan);
  if (screen.empty || screen.html.includes("empty-state") || screen.html.includes("Your list is empty")) {
    fail("review screen was empty");
  }

  return { zip, stores, text, typed, ready, imported, plan, screen, errors };
}
