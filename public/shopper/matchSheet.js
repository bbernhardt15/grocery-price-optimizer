/**
 * Pick a catalog match without opening the store site in a new tab.
 */

import { armSheetHistory } from "./sheetHistory.js";

function escapeText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function mountMatchSheet(deps) {
  if (!deps || typeof document === "undefined" || document.getElementById("match-sheet")) {
    return document.getElementById("match-sheet") ? { open() {} } : null;
  }
  const dialog = document.createElement("dialog");
  dialog.id = "match-sheet";
  dialog.className = "sheet match-sheet";
  dialog.setAttribute("aria-labelledby", "match-title");
  dialog.innerHTML = `<form class="sheet-body" id="match-form">
      <div class="list-head">
        <h2 id="match-title" tabindex="-1">Find a match</h2>
        <button type="button" class="text-btn" id="match-close">Close</button>
      </div>
      <p id="match-lead" class="muted"></p>
      <div id="match-results" class="match-results"></div>
    </form>`;
  document.body.appendChild(dialog);
  const history = armSheetHistory(dialog);
  const products = new Map();
  let query = "";

  function paint(rows, message) {
    const host = dialog.querySelector("#match-results");
    if (!host) return;
    if (!rows.length) {
      host.innerHTML = `<p class="muted">${escapeText(message || "Nothing close in Grocery Gitter.")}</p>`;
      return;
    }
    host.innerHTML = rows
      .map((row) => {
        const id = String(row.id || "");
        const label = String(row.label || "Item");
        const price = row.price ? `<span class="muted">${escapeText(row.price)}</span>` : "";
        return `<button type="button" class="ghost match-pick" data-match-pick="${escapeText(id)}"><span>${escapeText(label)}</span>${price}</button>`;
      })
      .join("");
  }

  async function search(name) {
    paint([], "Searching Grocery Gitter…");
    const apiUrl = deps.apiUrl || ((path) => path);
    try {
      const response = await fetch(apiUrl(`/api/catalog/browse?q=${encodeURIComponent(name)}&limit=8`));
      const body = await response.json().catch(() => ({}));
      const items = Array.isArray(body.items) ? body.items : [];
      products.clear();
      const rows = [];
      for (const item of items) {
        const id = String(item?.id || item?.defaultVariantId || "");
        if (!id) continue;
        products.set(id, item);
        const label = String(item.familyName || item.name || "Item");
        const brand = String(item.brand || "").trim();
        const price = Number(item.bestOffer?.price ?? item.price);
        rows.push({
          id,
          label: brand && !label.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${label}` : label,
          price: Number.isFinite(price) && price > 0 ? `$${price.toFixed(2)}` : "",
        });
      }
      paint(rows, rows.length ? "" : "Nothing close in Grocery Gitter. You can keep shopping in the store.");
    } catch {
      paint([], "Couldn't search just now. You can keep shopping in the store.");
    }
  }

  function open(name) {
    query = String(name || "").replace(/\s+/g, " ").trim();
    const title = dialog.querySelector("#match-title");
    const lead = dialog.querySelector("#match-lead");
    if (title) title.textContent = query ? `Find a match for ${query}` : "Find a match";
    if (lead) {
      lead.textContent = query
        ? `Pick one to add ${query} here. This stays in Grocery Gitter.`
        : "Pick a product. This stays in Grocery Gitter.";
    }
    if (!dialog.open) dialog.showModal();
    history.push();
    title?.focus();
    if (query) void search(query);
    else paint([], "Type isn't needed. Close this and try the item again.");
  }

  dialog.querySelector("#match-close")?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-match-pick]") : null;
    if (!target) return;
    event.preventDefault();
    const product = products.get(target.getAttribute("data-match-pick") || "");
    if (product) deps.onPick?.(product, query);
    dialog.close();
  });
  dialog.addEventListener("close", () => {
    products.clear();
  });
  return { open };
}
