/**
 * Pick a catalog match without opening the store site in a new tab.
 */

import { armSheetHistory } from "./sheetHistory.js";
import { withServiceZip } from "./serviceArea.js";

function escapeText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * One browse on the shared queue. Callers pass the app's fetchBrowse so this
 * search shares the cap, the URL dedupe, and the 503 backoff.
 * @param {string} url
 * @param {(url: string, options?: object, timeout?: number) => Promise<Response>} fetchBrowse
 */
export function requestMatchBrowse(url, fetchBrowse) {
  if (typeof fetchBrowse !== "function") {
    throw new TypeError("Match search needs the shared browse queue.");
  }
  return fetchBrowse(url);
}

/** A 503 or a dropped search keeps the rows already on screen and offers another try. */
export function matchBusyView(previous) {
  const rows = Array.isArray(previous) ? previous : [];
  return {
    rows,
    retry: true,
    status: rows.length
      ? "The aisle is busy. These matches are still here."
      : "The aisle is busy. Try this search again.",
  };
}

/** The food word, without the store or a single flavor, so every matching product can show. */
export function matchBrowseQuery(name) {
  const text = String(name || "").replace(/\s+/g, " ").trim();
  const type = text.match(/\b(parmesan|mozzarella|cheddar|provolone|eggs?|milk|butter|yogurt|bacon|bread)\b/i);
  if (type) {
    const word = type[1].toLowerCase();
    return word === "egg" ? "eggs" : word;
  }
  return text
    .replace(/\b(kroger|walmart|target|aldi|simple truth|great value|good & gather)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const EGG_EXCLUDE =
  /\b(pulp|paper material|egg cartons?|empty carton|packaging|egg rings?|egg cookers?|easter eggs?|plastic eggs?|egg dyes?|egg holders?)\b/i;
const REAL_EGG = /\b(eggs?|eggland|egg beaters|eggbeaters)\b/i;

function itemText(item) {
  return `${item?.name || ""} ${item?.catalogName || ""} ${item?.familyName || ""}`;
}

/** Packaging and novelty eggs leave an egg search. A real egg sold in a carton stays. */
export function isEggSearchReject(item, query) {
  if (!/\beggs?\b/i.test(String(query || ""))) return false;
  const text = itemText(item);
  const category = `${item?.departmentName || ""} ${item?.departmentId || ""} ${item?.category || ""} ${item?.aisle || ""}`.toLowerCase();
  if (EGG_EXCLUDE.test(text)) return true;
  const household = /\b(household|gadget|storage|party|seasonal|kitchen)\b/.test(category);
  if (household && !REAL_EGG.test(text)) return true;
  if (/\b(carton|container|tray)\b/i.test(text) && !REAL_EGG.test(text)) return true;
  if (/\b(iphone|vitamin|tablet)\b/i.test(text) && !REAL_EGG.test(text)) return true;
  return false;
}

/** Drop non-egg rows, then sort flavor then size. Real eggs rank first. */
export function rankFoodMatches(items, query) {
  const ask = String(query || "").toLowerCase();
  const eggs = /\beggs?\b/.test(ask);
  const kept = (items || []).filter((item) => !isEggSearchReject(item, ask));
  const sizeCount = (item) => {
    const label = `${item?.sizeLabel || ""} ${item?.totalSize || ""} ${item?.name || ""}`;
    const match = label.match(/(\d+)\s*(?:ct|count|pk|pack)\b/i);
    return match ? Number(match[1]) : 0;
  };
  return kept
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const aText = `${a.item?.name || ""} ${a.item?.familyName || ""}`.toLowerCase();
      const bText = `${b.item?.name || ""} ${b.item?.familyName || ""}`.toLowerCase();
      if (eggs) {
        const aFood = REAL_EGG.test(aText) && !EGG_EXCLUDE.test(aText) ? 0 : 1;
        const bFood = REAL_EGG.test(bText) && !EGG_EXCLUDE.test(bText) ? 0 : 1;
        if (aFood !== bFood) return aFood - bFood;
      }
      const flavor = String(a.item?.flavorLabel || a.item?.variantLabel || "").localeCompare(String(b.item?.flavorLabel || b.item?.variantLabel || ""));
      if (flavor) return flavor;
      const size = sizeCount(a.item) - sizeCount(b.item);
      if (size) return size;
      return a.index - b.index;
    })
    .map((row) => row.item);
}

const STORE_BRAND = /^(great value|kroger|simple truth|good & gather|marketside|equate)$/i;

function cleanLabel(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function looksLikeSize(value) {
  return /^\d|\b(?:ct|count|pk|pack|oz|fl oz|lb|gal|ml)\b/i.test(value);
}

function withoutSize(name, size) {
  if (!size) return name;
  const escaped = size.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return name.replace(new RegExp(`[,\\s]*${escaped}$`, "i"), "").replace(/,\s*$/, "").trim();
}

/** "Coke Cherry" reads as "Cherry Coke". A name that already leads with the flavor stays. */
function flavorFirst(name, flavor) {
  const product = name.replace(/,/g, " ").replace(/\s+/g, " ").trim();
  const taste = flavor.replace(/,/g, " ").replace(/\s+/g, " ").trim();
  if (!taste) return product;
  const lower = product.toLowerCase();
  const tasteLower = taste.toLowerCase();
  if (lower === tasteLower || lower.startsWith(`${tasteLower} `)) return product;
  if (lower.endsWith(` ${tasteLower}`)) {
    const noun = product.slice(0, product.length - taste.length).replace(/,\s*$/, "").trim();
    return `${taste} ${noun}`.replace(/\s+/g, " ").trim();
  }
  if (lower.includes(tasteLower)) return product;
  return `${taste} ${product}`.replace(/\s+/g, " ").trim();
}

/** Flavor, then the product, then the pack size. No comma before the size. */
export function productDisplayName(tile, variant) {
  const raw = cleanLabel(variant?.familyName || tile?.familyName || variant?.name || tile?.name || "Item");
  const flavorLabel = cleanLabel(variant?.flavorLabel || tile?.flavorLabel || "");
  const variantLabel = cleanLabel(variant?.variantLabel || "");
  const flavor = flavorLabel || (variantLabel && !looksLikeSize(variantLabel) ? variantLabel : "");
  const size = cleanLabel(variant?.sizeLabel || tile?.sizeLabel || variant?.label || (looksLikeSize(variantLabel) ? variantLabel : ""));
  let base = flavorFirst(withoutSize(raw, size), flavor);
  const brand = cleanLabel(variant?.brand || tile?.brand || "");
  if (brand && STORE_BRAND.test(brand) && !base.toLowerCase().includes(brand.toLowerCase())) base = `${brand} ${base}`;
  if (size && !base.toLowerCase().includes(size.toLowerCase())) return `${base} ${size}`.replace(/\s+/g, " ").trim();
  return base;
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
  let shown = [];

  function rowHtml(rows) {
    return rows
      .map((row) => {
        const id = String(row.id || "");
        const label = String(row.label || "Item");
        const price = row.price ? `<span class="muted">${escapeText(row.price)}</span>` : "";
        const store = escapeText(row.store || "");
        return `<div class="match-row"><button type="button" class="ghost match-pick" data-match-pick="${escapeText(id)}" data-match-store="${store}"><span>${escapeText(label)}</span>${price}</button><button type="button" class="text-btn" data-match-favorite="${escapeText(id)}" data-match-store="${store}">Mark as favorite</button></div>`;
      })
      .join("");
  }

  function paint(rows, message, { retry = false } = {}) {
    const host = dialog.querySelector("#match-results");
    if (!host) return;
    const list = rowHtml(rows);
    const note = message ? `<p class="muted" role="status">${escapeText(message)}</p>` : "";
    const again = retry ? `<button type="button" class="ghost" data-match-retry>Try this search again</button>` : "";
    if (!list && !note && !again) {
      host.innerHTML = `<p class="muted" role="status">Nothing close in Grocery Gitter.</p>`;
      return;
    }
    host.innerHTML = `${list}${note}${again}`;
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

  function showBusy(previous) {
    const busy = matchBusyView(previous);
    shown = busy.rows;
    paint(shown, busy.status, { retry: true });
  }

  async function search(name) {
    const where = storeName ? ` at ${storeName}` : "";
    const kept = shown.slice();
    if (kept.length) paint(kept, `Searching Grocery Gitter${where}…`);
    else paint([], `Searching Grocery Gitter${where}…`);
    const apiUrl = deps.apiUrl || ((path) => path);
    let saved = "";
    try {
      saved = localStorage.getItem("gg-zip") || "";
    } catch {
      saved = "";
    }
    const browseQuery = matchBrowseQuery(name) || name;
    const priced = withServiceZip(`/api/catalog/browse?q=${encodeURIComponent(browseQuery)}&limit=48`, saved);
    if (!priced) {
      paint([], "Add a ZIP to see store prices.");
      shown = [];
      return;
    }
    try {
      const response = await requestMatchBrowse(apiUrl(priced), deps.fetchBrowse);
      if (!response.ok) {
        showBusy(kept);
        return;
      }
      const body = await response.json().catch(() => ({}));
      const items = rankFoodMatches(Array.isArray(body.items) ? body.items : [], browseQuery || name);
      products.clear();
      const rows = [];
      for (const item of items) {
        const id = String(item?.id || item?.defaultVariantId || "");
        if (!id) continue;
        products.set(id, item);
        const named = productDisplayName(item, item);
        const brand = String(item.brand || "").trim();
        const titled = brand && !named.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${named}` : named;
        const offers = storeName
          ? [offerFor(item, storeName) || offerFor(item, "")].filter(Boolean)
          : (Array.isArray(item.offers) ? item.offers : [])
              .map((offer) => ({ store: String(offer?.storeName || ""), price: Number(offer?.price) }))
              .filter((offer) => offer.store);
        const choices = offers.length ? offers : [offerFor(item, "") || { store: "", price: Number(item.bestOffer?.price ?? item.price) }];
        for (const offer of choices) {
          const price = Number(offer?.price);
          const where = offer?.store || "";
          rows.push({
            id,
            label: where && !storeName ? `${titled} · ${where}` : titled,
            price: Number.isFinite(price) && price > 0 ? `$${price.toFixed(2)}` : "",
            store: where || storeName,
          });
        }
      }
      shown = rows;
      paint(rows, rows.length ? "" : storeName ? `Nothing at ${storeName} in Grocery Gitter. That item stays off the ${storeName} cart.` : "Nothing close in Grocery Gitter. You can keep shopping in the store.");
    } catch {
      showBusy(kept);
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
    let ticks = 0;
    const pin = () => {
      if (!dialog.open) return;
      holdPageScroll();
      if (ticks++ < 10) requestAnimationFrame(pin);
    };
    pin();
    if (query) void search(query);
    else paint([], "Type isn't needed. Close this and try the item again.");
  }

  dialog.querySelector("#match-close")?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    const retry = event.target instanceof Element ? event.target.closest("[data-match-retry]") : null;
    if (retry) {
      event.preventDefault();
      if (query) void search(query);
      return;
    }
    const favorite = event.target instanceof Element ? event.target.closest("[data-match-favorite]") : null;
    const target = favorite || (event.target instanceof Element ? event.target.closest("[data-match-pick]") : null);
    if (!target) return;
    event.preventDefault();
    const product = products.get(target.getAttribute("data-match-favorite") || target.getAttribute("data-match-pick") || "");
    const pickedStore = target.getAttribute("data-match-store") || storeName;
    if (product) deps.onPick?.(product, query, pickedStore, { favorite: Boolean(favorite) });
    dialog.close();
  });
  dialog.addEventListener("close", () => {
    products.clear();
    shown = [];
    const pin = () => {
      if (dialog.open) return;
      holdPageScroll();
    };
    pin();
    requestAnimationFrame(pin);
    window.setTimeout(pin, 0);
    window.setTimeout(pin, 50);
    window.setTimeout(pin, 150);
    window.setTimeout(pin, 400);
  });
  return { open };
}
