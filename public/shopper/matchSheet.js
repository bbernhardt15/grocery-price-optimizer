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
  let storeName = "";

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

  function offerFor(item, store) {
    const offers = Array.isArray(item?.offers) ? item.offers : item?.bestOffer ? [item.bestOffer] : [];
    const wanted = String(store || "").trim().toLowerCase();
    if (!wanted) {
      const price = Number(item?.bestOffer?.price ?? item?.price);
      return { store: String(item?.bestOffer?.storeName || ""), price };
    }
    const hit = offers.find((offer) => String(offer?.storeName || "").trim().toLowerCase() === wanted);
    if (!hit) return null;
    return { store: String(hit.storeName || store), price: Number(hit.price) };
  }

  async function search(name) {
    const where = storeName ? ` at ${storeName}` : "";
    paint([], `Searching Grocery Gitter${where}…`);
    const apiUrl = deps.apiUrl || ((path) => path);
    const storeQuery = storeName ? `&store=${encodeURIComponent(storeName)}` : "";
    try {
      const response = await fetch(apiUrl(`/api/catalog/browse?q=${encodeURIComponent(name)}&limit=12${storeQuery}`));
      const body = await response.json().catch(() => ({}));
      const items = Array.isArray(body.items) ? body.items : [];
      products.clear();
      const rows = [];
      for (const item of items) {
        const id = String(item?.id || item?.defaultVariantId || "");
        if (!id) continue;
        const offer = offerFor(item, storeName);
        if (storeName && !offer) continue;
        products.set(id, item);
        const label = String(item.familyName || item.name || "Item");
        const brand = String(item.brand || "").trim();
        const price = offer ? offer.price : Number(item.bestOffer?.price ?? item.price);
        rows.push({
          id,
          label: brand && !label.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${label}` : label,
          price: Number.isFinite(price) && price > 0 ? `$${price.toFixed(2)}` : "",
          store: offer?.store || storeName,
        });
      }
      paint(rows, rows.length ? "" : storeName ? `Nothing at ${storeName} in Grocery Gitter. That item stays off the ${storeName} cart.` : "Nothing close in Grocery Gitter. You can keep shopping in the store.");
    } catch {
      paint([], "Couldn't search just now. You can keep shopping in the store.");
    }
  }

  let returnScroll = 0;
  function holdPageScroll() {
    window.scrollTo(0, returnScroll);
  }
  function open(name, store) {
    returnScroll = window.scrollY || 0;
    query = String(name || "").replace(/\s+/g, " ").trim();
    storeName = String(store || "").replace(/\s+/g, " ").trim();
    const title = dialog.querySelector("#match-title");
    const lead = dialog.querySelector("#match-lead");
    if (title) title.textContent = query ? `Find a match for ${query}` : "Find a match";
    if (lead) {
      lead.textContent = storeName
        ? `Pick a ${storeName} price for ${query || "this item"}. It is added to the ${storeName} cart in Grocery Gitter, not the other store.`
        : query
          ? `Pick one to add ${query} here. This stays in Grocery Gitter.`
          : "Pick a product. This stays in Grocery Gitter.";
    }
    if (!dialog.open) dialog.showModal();
    holdPageScroll();
    history.push();
    if (title instanceof HTMLElement) title.focus({ preventScroll: true });
    requestAnimationFrame(holdPageScroll);
    if (query) void search(query);
    else paint([], "Type isn't needed. Close this and try the item again.");
  }

  dialog.querySelector("#match-close")?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-match-pick]") : null;
    if (!target) return;
    event.preventDefault();
    const product = products.get(target.getAttribute("data-match-pick") || "");
    if (product) deps.onPick?.(product, query, storeName);
    dialog.close();
  });
  dialog.addEventListener("close", () => {
    products.clear();
    holdPageScroll();
    requestAnimationFrame(holdPageScroll);
  });
  return { open };
}
