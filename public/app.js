const formEl = document.querySelector("#optimize-form");
const zipCodeEl = document.querySelector("#zip-code");
const searchEl = document.querySelector("#product-search");
const resultsListEl = document.querySelector("#product-suggestions");
const searchStatusEl = document.querySelector("#product-search-status");
const shoppingListEl = document.querySelector("#shopping-list");
const cartEmptyEl = document.querySelector("#cart-empty");
const findBtn = document.querySelector("#find-btn");
const sampleBtn = document.querySelector("#sample-btn");
const formErrorEl = document.querySelector("#form-error");
const loadingEl = document.querySelector("#loading");
const apiErrorEl = document.querySelector("#api-error");
const emptyStateEl = document.querySelector("#empty-state");
const resultsEl = document.querySelector("#results");
const storeGridEl = document.querySelector("#store-grid");
const grandTotalEl = document.querySelector("#grand-total");
const summaryMetaEl = document.querySelector("#summary-meta");
const unavailableEl = document.querySelector("#unavailable");
const pricingLegendEl = document.querySelector("#pricing-legend");

const ZIP_PATTERN = /^\d{5}(?:-\d{4})?$/;

function normalizeZip(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length >= 9) {
    return `${digits.slice(0, 5)}-${digits.slice(5, 9)}`;
  }
  if (digits.length >= 5) {
    return digits.slice(0, 5);
  }
  return digits;
}
const SAMPLE_ITEMS = [
  { name: "Whole Milk", brand: "Kroger", foodId: "demo-whole-milk", quantity: 2 },
  { name: "Large Eggs", brand: "Kroger", foodId: "demo-large-eggs", quantity: 1 },
  { name: "White Bread", brand: "Kroger", foodId: "demo-white-bread", quantity: 2 },
  { name: "Salted Butter", brand: "Kroger", foodId: "demo-salted-butter", quantity: 1 },
  { name: "Boneless Chicken Breast", brand: "Kroger", foodId: "demo-chicken", quantity: 1 },
];

/** @type {Array<{ name: string, brand: string, foodId: string, quantity: number }>} */
let cart = [];
/** @type {Array<{ name: string, brand: string, foodId: string }>} */
let suggestions = [];
let activeIndex = -1;
let searchTimer = 0;
let searchAbort = null;
/** @type {null | { stores: Array<Record<string, unknown>> }} */
let lastOptimize = null;
let instacartEnabled = false;
/** @type {Promise<void> | null} */
let instacartStatusPromise = null;

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function itemKey(item) {
  return item.id || item.foodId || `${item.name}|${item.brand ?? ""}`;
}

function setBusy(isBusy) {
  findBtn.disabled = isBusy;
  sampleBtn.disabled = isBusy;
  zipCodeEl.disabled = isBusy;
  searchEl.disabled = isBusy;
  loadingEl.hidden = !isBusy;
}

function hideResults() {
  lastOptimize = null;
  resultsEl.hidden = true;
  storeGridEl.innerHTML = "";
  grandTotalEl.textContent = "$0.00";
  summaryMetaEl.textContent = "";
  renderInstacartWholeList();
  renderUnavailable([]);
  renderPricingLegend([]);
}

function showFormError(message) {
  formErrorEl.hidden = !message;
  formErrorEl.textContent = message;
}

function showApiError(message) {
  apiErrorEl.hidden = !message;
  apiErrorEl.textContent = message;
  apiErrorEl.classList.toggle("status-error", Boolean(message));
  apiErrorEl.classList.remove("status-ok");
}

function showApiSuccess(message) {
  apiErrorEl.hidden = !message;
  apiErrorEl.textContent = message;
  apiErrorEl.classList.toggle("status-ok", Boolean(message));
  apiErrorEl.classList.remove("status-error");
}

function renderUnavailable(items) {
  if (!items.length) {
    unavailableEl.hidden = true;
    unavailableEl.innerHTML = "";
    return;
  }

  unavailableEl.hidden = false;
  unavailableEl.innerHTML = `
    <h3>Not found in the catalog</h3>
    <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
  `;
}

function renderCart() {
  cartEmptyEl.hidden = cart.length > 0;
  shoppingListEl.innerHTML = cart
    .map((item, index) => {
      const label = `${escapeHtml(item.name)}${item.brand ? ` (${escapeHtml(item.brand)})` : ""}`;
      return `
        <li class="cart-item" data-index="${index}">
          <div class="cart-copy">
            <span class="cart-name">${escapeHtml(item.name)}</span>
            <span class="cart-brand">${escapeHtml(item.brand || "Catalog")}</span>
          </div>
          <div class="qty">
            <button class="qty-btn" type="button" data-action="dec" data-index="${index}" aria-label="Decrease ${label}">−</button>
            <input
              type="number"
              min="1"
              step="1"
              inputmode="numeric"
              value="${item.quantity}"
              data-action="qty"
              data-index="${index}"
              aria-label="Quantity for ${label}"
            />
            <button class="qty-btn" type="button" data-action="inc" data-index="${index}" aria-label="Increase ${label}">+</button>
          </div>
          <button class="remove-btn" type="button" data-action="remove" data-index="${index}" aria-label="Remove ${label}">✕</button>
        </li>
      `;
    })
    .join("");
}

function addToCart(product) {
  const key = itemKey(product);
  const existing = cart.find((item) => itemKey(item) === key);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({
      name: product.name,
      brand: product.brand || "Generic",
      foodId: product.foodId || product.id,
      id: product.id || product.foodId,
      quantity: 1,
    });
  }
  renderCart();
}

function setQuantity(index, quantity) {
  if (!cart[index]) {
    return;
  }
  cart[index].quantity = Math.max(1, Math.floor(quantity) || 1);
  renderCart();
}

function hideSuggestions() {
  suggestions = [];
  activeIndex = -1;
  resultsListEl.hidden = true;
  resultsListEl.innerHTML = "";
  searchEl.setAttribute("aria-expanded", "false");
}

function renderSuggestions() {
  if (!suggestions.length) {
    hideSuggestions();
    return;
  }

  resultsListEl.hidden = false;
  searchEl.setAttribute("aria-expanded", "true");
  resultsListEl.innerHTML = suggestions
    .map((product, index) => {
      const active = index === activeIndex ? " is-active" : "";
      return `
        <li>
          <button
            type="button"
            class="suggest-item${active}"
            role="option"
            data-index="${index}"
            aria-selected="${index === activeIndex ? "true" : "false"}"
          >
            <span class="suggest-name">${escapeHtml(product.name)}</span>
            <span class="suggest-brand">${escapeHtml(product.brand || "Generic")}</span>
          </button>
        </li>
      `;
    })
    .join("");
}

function chooseSuggestion(index) {
  const product = suggestions[index];
  if (!product) {
    return;
  }
  addToCart(product);
  searchEl.value = "";
  searchStatusEl.hidden = false;
  searchStatusEl.textContent =
    "Matches appear in a list under this field as you type.";
  hideSuggestions();
  searchEl.focus();
  showFormError("");
}

async function fetchSuggestions(query) {
  if (searchAbort) {
    searchAbort.abort();
  }
  if (query.trim().length < 2) {
    hideSuggestions();
    searchStatusEl.hidden = false;
    searchStatusEl.textContent =
      "Matches appear in a list under this field as you type.";
    return;
  }

  searchAbort = new AbortController();
  searchStatusEl.hidden = false;
  searchStatusEl.textContent = "Searching catalog…";

  try {
    const response = await fetch(
      `/api/search-catalog?query=${encodeURIComponent(query.trim())}`,
      { signal: searchAbort.signal }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Search failed (${response.status})`);
    }

    suggestions = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.products)
        ? payload.products
        : [];
    activeIndex = suggestions.length ? 0 : -1;
    if (!suggestions.length) {
      hideSuggestions();
      searchStatusEl.hidden = false;
      searchStatusEl.textContent = "No catalog matches.";
      return;
    }
    searchStatusEl.hidden = true;
    renderSuggestions();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }
    hideSuggestions();
    searchStatusEl.hidden = false;
    searchStatusEl.textContent =
      error instanceof Error ? error.message : "Catalog search failed.";
  }
}

function renderPricingLegend(reports) {
  if (!pricingLegendEl) {
    return;
  }
  if (!reports.length) {
    pricingLegendEl.hidden = true;
    pricingLegendEl.innerHTML = "";
    return;
  }

  const hasWeekly = reports.some(
    (report) =>
      report.source === "weekly_ad" ||
      report.source === "cached_weekly_ad" ||
      String(report.label ?? "").toLowerCase().includes("weekly ad")
  );
  const weeklyNote = hasWeekly
    ? `<p class="pricing-legend-note">Weekly ad prices come from that store’s circular near your ZIP. They are sale prices printed in the flyer, not a full live shelf catalog. Partner feed is a licensed shelf file when credentials exist.</p>`
    : `<p class="pricing-legend-note">Live prices are retailer APIs. Partner feed is a licensed shelf file when configured. Weekly ad (when enabled) is flyer/circular pricing only — not aisle-wide. Demo catalog is seed data.</p>`;

  pricingLegendEl.hidden = false;
  pricingLegendEl.innerHTML = `
    <h3>Price sources</h3>
    <ul>
      ${reports
        .map((report) => {
          const extra =
            report.error && report.error !== report.detail
              ? ` ${escapeHtml(report.error)}`
              : "";
          return `<li><span class="price-badge price-badge-${pricingBadgeKind(
            report.source
          )}">${escapeHtml(report.label)}</span> <strong>${escapeHtml(
            report.storeName
          )}</strong> — ${escapeHtml(report.detail)}${extra}</li>`;
        })
        .join("")}
    </ul>
    ${weeklyNote}
  `;
}

function pricingBadgeKind(source) {
  if (source === "live") return "live";
  if (source === "partner_feed") return "partner";
  if (source === "cached_live") return "cached";
  if (source === "weekly_ad" || source === "cached_weekly_ad") return "weekly";
  if (source === "mixed") return "mixed";
  if (source === "unavailable") return "unavailable";
  return "seed";
}

function renderPricingBadge(store) {
  const pricing = store.pricing;
  if (!pricing) {
    return "";
  }
  return `<p class="store-count">${escapeHtml(store.itemCount)} item${
    Number(store.itemCount) === 1 ? "" : "s"
  } · <span class="price-badge price-badge-${pricingBadgeKind(
    pricing.source
  )}" title="${escapeHtml(pricing.detail)}">${escapeHtml(pricing.label)}</span></p>`;
}

function itemSourceMark(item) {
  if (item.priceSource === "live" || item.priceSource === "cached_live" || item.priceSource === "partner_feed") {
    return ` <em class="item-source item-source-live">live</em>`;
  }
  if (item.priceSource === "weekly_ad") {
    return ` <em class="item-source item-source-weekly">weekly ad</em>`;
  }
  if (item.priceSource === "seed") {
    return ` <em class="item-source">demo</em>`;
  }
  return "";
}

function itemLabel(item) {
  const quantity = item.quantity ?? 1;
  const brand = item.brand ? ` (${item.brand})` : "";
  return `${quantity}x ${item.name}${brand}`;
}

function itemPriceHtml(item) {
  const quantity = item.quantity ?? 1;
  const itemTotal = item.itemTotal ?? item.price * quantity;
  const unit = item.unitPriceText
    ? ` <span class="unit-price">(${escapeHtml(item.unitPriceText)})</span>`
    : "";
  return `${money(itemTotal)}${unit}`;
}

function itemOpenUrl(store, item, index) {
  const fromHandoff = store.handoff?.items?.[index]?.url;
  return fromHandoff || item.url || "";
}

function instacartCtaMarkup(attrs) {
  return `<button type="button" class="instacart-cta" ${attrs}><img src="/instacart-carrot.svg" width="22" height="22" alt="" />Shop on Instacart</button>`;
}

function instacartStoreExtras(store) {
  if (!instacartEnabled) {
    return "";
  }
  const handoffType = store?.handoff?.action?.type;
  if (handoffType === "kroger_cart" || handoffType === "walmart_cart") {
    return "";
  }
  if (!Array.isArray(store?.items) || store.items.length === 0) {
    return "";
  }
  return `
    ${instacartCtaMarkup(
      `data-instacart-scope="store" data-instacart-store="${escapeHtml(store.storeName)}"`
    )}
    <p class="handoff-detail">Opens an Instacart shopping list for these items. You pick the retailer and check out there. This does not fill ${escapeHtml(
      store.storeName
    )}'s own cart, and Instacart prices can differ.</p>
  `;
}

function renderHandoffButton(store) {
  const action = store.handoff?.action;
  const instacart = instacartStoreExtras(store);
  if (!action) {
    return instacart ? `<footer class="store-handoff">${instacart}</footer>` : "";
  }

  const detail = action.detail
    ? `<p class="handoff-detail">${escapeHtml(action.detail)}</p>`
    : "";

  if (action.type === "coming_soon" || action.status === "coming_soon") {
    return `
      <footer class="store-handoff">
        <button class="handoff-btn" type="button" disabled>${escapeHtml(
          action.label || "Coming soon"
        )}</button>
        ${detail}
        ${instacart}
      </footer>
    `;
  }

  if (action.type === "walmart_cart" && action.url) {
    const fallback = action.fallbackUrl
      ? `<a class="handoff-fallback" href="${escapeHtml(
          action.fallbackUrl
        )}" target="_blank" rel="noopener noreferrer">or Search at Walmart</a>`
      : "";
    return `
      <footer class="store-handoff">
        <a
          class="handoff-btn"
          href="${escapeHtml(action.url)}"
          target="_blank"
          rel="noopener noreferrer"
        >${escapeHtml(action.label)}</a>
        ${fallback}
        ${detail}
      </footer>
    `;
  }

  if (action.type === "kroger_cart") {
    const fallback = action.fallbackUrl
      ? `<a class="handoff-fallback" href="${escapeHtml(
          action.fallbackUrl
        )}" target="_blank" rel="noopener noreferrer">or Open at Kroger</a>`
      : "";
    return `
      <footer class="store-handoff">
        <button
          class="handoff-btn"
          type="button"
          data-handoff-store="${escapeHtml(store.storeName)}"
        >${escapeHtml(action.label)}</button>
        ${fallback}
        ${detail}
        ${instacart}
      </footer>
    `;
  }

  if (action.url) {
    return `
      <footer class="store-handoff">
        <a
          class="handoff-btn"
          href="${escapeHtml(action.url)}"
          target="_blank"
          rel="noopener noreferrer"
        >${escapeHtml(action.label)}</a>
        ${detail}
        ${instacart}
      </footer>
    `;
  }

  return `
    <footer class="store-handoff">
      <button class="handoff-btn" type="button" disabled>${escapeHtml(
        action.label || "Unavailable"
      )}</button>
      ${detail}
      ${instacart}
    </footer>
  `;
}

function renderNearbyStore(store) {
  const nearby = store.nearbyStore;
  if (!nearby || !nearby.name) {
    return "";
  }
  const locality = [nearby.city, nearby.state].filter(Boolean).join(", ");
  const tail = [locality, nearby.zip].filter(Boolean).join(" ");
  const address = [nearby.streetAddress, tail].filter(Boolean).join(", ");
  const line = address ? `${nearby.name} · ${address}` : nearby.name;
  return `<p class="store-nearby">Nearest store: ${escapeHtml(line)}</p>`;
}

function renderStoreCard(store) {
  const itemCount = store.itemCount
    ?? store.handoff?.itemCount
    ?? store.items.reduce((sum, item) => sum + (item.quantity ?? 1), 0);
  const rows = store.items
    .map((item, index) => {
      const openUrl = itemOpenUrl(store, item, index);
      const openLink = openUrl
        ? `<a class="item-open" href="${escapeHtml(openUrl)}" target="_blank" rel="noopener noreferrer">Open</a>`
        : "";
      return `<li class="item-line"><span class="item-copy">${escapeHtml(
        itemLabel(item)
      )}${itemSourceMark(item)}</span><span class="item-price">${itemPriceHtml(
        item
      )}</span>${openLink}</li>`;
    })
    .join("");

  return `
    <article class="store-card">
      <header>
        <div>
          <h2>${escapeHtml(store.storeName)}</h2>
          ${renderNearbyStore(store)}
          ${
            store.pricing
              ? renderPricingBadge({ ...store, itemCount })
              : `<p class="store-count">${itemCount} item${itemCount === 1 ? "" : "s"}</p>`
          }
        </div>
        <p class="store-subtotal">${money(store.subtotal)}</p>
      </header>
      <ul class="item-list">${rows}</ul>
      ${renderHandoffButton(store)}
    </article>
  `;
}

function renderResults(payload) {
  lastOptimize = payload;
  const storeCount = payload.stores.length;
  const itemCount =
    payload.tripPlan?.itemCount ??
    payload.stores.reduce(
      (sum, store) =>
        sum + store.items.reduce((inner, item) => inner + (item.quantity ?? 1), 0),
      0
    );
  const tripSummary = payload.tripPlan?.summary;

  emptyStateEl.hidden = true;
  resultsEl.hidden = false;
  grandTotalEl.textContent = money(payload.total);
  summaryMetaEl.textContent = tripSummary
    ? `${tripSummary}${payload.locationId ? ` · Kroger ${payload.locationId}` : ""}`
    : storeCount
      ? `${itemCount} item${itemCount === 1 ? "" : "s"} · ${storeCount} store${
          storeCount === 1 ? "" : "s"
        }${payload.locationId ? ` · Kroger ${payload.locationId}` : ""}`
      : "Nothing in the catalog matched this list.";
  storeGridEl.innerHTML = payload.stores.map(renderStoreCard).join("");
  renderInstacartWholeList();
  renderUnavailable(payload.unavailable ?? []);
  renderPricingLegend(payload.pricingByStore ?? []);
}

function renderInstacartWholeList() {
  const slot = document.querySelector("#instacart-whole-list");
  if (!slot) {
    return;
  }
  const stores = lastOptimize?.stores ?? [];
  if (!instacartEnabled || stores.length === 0) {
    slot.hidden = true;
    slot.innerHTML = "";
    return;
  }
  slot.hidden = false;
  slot.innerHTML = `
    <p class="instacart-whole-caption">or shop the whole list on Instacart</p>
    ${instacartCtaMarkup('data-instacart-scope="list"')}
  `;
}

async function startKrogerCart(store, button) {
  const handoff = store.handoff;
  showApiError("");
  if (button) {
    button.disabled = true;
    button.dataset.originalLabel = button.textContent;
    button.textContent = "Talking to Kroger…";
  }
  try {
    const response = await fetch("/api/kroger/cart/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        items: handoff?.items ?? store.items,
        locationId: store.items?.[0]?.locationId,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Kroger cart start failed (${response.status})`);
    }
    if (payload.status === "added") {
      const added = payload.added ?? 0;
      showApiSuccess(
        `Kroger accepted ${added} item${added === 1 ? "" : "s"} in your shopper cart. Finish pickup on kroger.com while logged into the same account.`
      );
      if (button) {
        button.disabled = false;
        button.textContent = "Added — open Kroger cart";
        button.dataset.krogerAdded = "1";
      }
      return;
    }
    if (!payload.authorizeUrl) {
      throw new Error("Kroger did not return a shopper login URL.");
    }
    window.location.assign(payload.authorizeUrl);
  } catch (error) {
    showApiError(
      error instanceof Error
        ? `${error.message} Use Open at Kroger on each line if cart write is unavailable.`
        : "Could not start Kroger cart OAuth."
    );
    if (button) {
      button.disabled = false;
      button.textContent = button.dataset.originalLabel || "Add to Kroger cart";
    }
  }
}

function instacartItemsFrom(stores) {
  const items = [];
  for (const store of stores) {
    for (const item of store.items ?? []) {
      if (!item || typeof item.name !== "string" || !item.name.trim()) {
        continue;
      }
      const line = {
        name: item.name,
        quantity: item.quantity ?? 1,
      };
      if (item.unit) {
        line.unit = item.unit;
      }
      if (item.size) {
        line.size = item.size;
      }
      if (item.brand) {
        line.brand = item.brand;
      }
      if (item.upc) {
        line.upc = item.upc;
      }
      items.push(line);
    }
  }
  return items;
}

async function openInstacartList(button) {
  const scope = button.dataset.instacartScope;
  const storeName = button.dataset.instacartStore || "";
  const stores = lastOptimize?.stores ?? [];
  const selected =
    scope === "store" ? stores.filter((store) => store.storeName === storeName) : stores;
  const items = instacartItemsFrom(selected);
  showApiError("");
  if (items.length === 0) {
    showApiError("Nothing on this list can be sent to Instacart.");
    return;
  }

  const original = button.innerHTML;
  button.disabled = true;
  button.textContent = "Opening Instacart…";
  try {
    const postalCode = normalizeZip(zipCodeEl.value);
    const response = await fetch("/api/instacart/shopping-list", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        items,
        ...(scope === "store" && storeName ? { storeName } : {}),
        ...(ZIP_PATTERN.test(postalCode) ? { postalCode } : {}),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Instacart shopping list failed (${response.status})`);
    }
    if (!payload.productsLinkUrl) {
      throw new Error("Instacart did not return a shopping list link.");
    }
    const note = payload.retailerNote ? ` ${payload.retailerNote}` : "";
    // "noopener" in window.open features makes Chrome return null even when the
    // tab opened. Drop opener after a normal open so a real popup block is detectable.
    const opened = window.open(payload.productsLinkUrl, "_blank");
    if (opened) {
      opened.opener = null;
    }
    if (!opened) {
      showApiError(
        `Instacart created the list, but the browser blocked the new tab.${note} Copy this link: ${payload.productsLinkUrl}`
      );
      return;
    }
    showApiSuccess(`Opened an Instacart shopping list.${note}`);
  } catch (error) {
    showApiError(
      error instanceof Error ? error.message : "Could not open an Instacart shopping list."
    );
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
}

function loadInstacartStatus() {
  if (!instacartStatusPromise) {
    instacartStatusPromise = fetch("/api/instacart/status", {
      headers: { Accept: "application/json" },
    })
      .then((response) => (response.ok ? response.json() : { enabled: false }))
      .then((payload) => {
        instacartEnabled = Boolean(payload.enabled);
      })
      .catch(() => {
        instacartEnabled = false;
      });
  }
  return instacartStatusPromise;
}

resultsEl.addEventListener("click", (event) => {
  const button = event.target.closest(".instacart-cta");
  if (!button || !resultsEl.contains(button)) {
    return;
  }
  void openInstacartList(button);
});

storeGridEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-handoff-store]");
  if (!button) {
    return;
  }
  if (button.dataset.krogerAdded === "1") {
    window.open("https://www.kroger.com/cart", "_blank", "noopener,noreferrer");
    return;
  }
  const storeName = button.dataset.handoffStore;
  const store = lastOptimize?.stores?.find(
    (entry) => entry.storeName === storeName
  );
  if (!store) {
    return;
  }
  void startKrogerCart(store, button);
});

async function findCheapestStores() {
  showFormError("");
  showApiError("");

  if (cart.length === 0) {
    showFormError("Add at least one grocery item from the catalog.");
    hideResults();
    emptyStateEl.hidden = false;
    searchEl.focus();
    return;
  }

  const zipCode = normalizeZip(zipCodeEl.value);
  if (zipCodeEl.value.trim() !== zipCode) {
    zipCodeEl.value = zipCode;
  }
  if (!ZIP_PATTERN.test(zipCode)) {
    showFormError("Enter a 5-digit ZIP code so we can price your nearest store.");
    hideResults();
    emptyStateEl.hidden = false;
    zipCodeEl.focus();
    return;
  }

  const items = cart.map((item) => ({
    name: item.name,
    brand: item.brand,
    foodId: item.foodId,
    quantity: item.quantity,
  }));

  setBusy(true);
  try {
    await loadInstacartStatus();
    const response = await fetch("/api/optimize-list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, zipCode }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Request failed (${response.status})`);
    }

    renderResults(payload);
    if (payload.pricingWarning) {
      showApiError(
        `Some items could not use live store prices: ${payload.pricingWarning}`
      );
    }
  } catch (error) {
    resultsEl.hidden = true;
    emptyStateEl.hidden = true;
    showApiError(
      error instanceof Error
        ? error.message
        : "Could not reach the optimizer. Is the server running?"
    );
  } finally {
    setBusy(false);
  }
}

searchEl.addEventListener("input", () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    void fetchSuggestions(searchEl.value);
  }, 280);
});

searchEl.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (!suggestions.length) {
      return;
    }
    activeIndex = (activeIndex + 1) % suggestions.length;
    renderSuggestions();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    if (!suggestions.length) {
      return;
    }
    activeIndex = (activeIndex - 1 + suggestions.length) % suggestions.length;
    renderSuggestions();
  } else if (event.key === "Enter" && suggestions.length && activeIndex >= 0) {
    event.preventDefault();
    chooseSuggestion(activeIndex);
  } else if (event.key === "Escape") {
    hideSuggestions();
  }
});

resultsListEl.addEventListener("mousedown", (event) => {
  const button = event.target.closest("[data-index]");
  if (!button) {
    return;
  }
  event.preventDefault();
  chooseSuggestion(Number(button.dataset.index));
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".product-search")) {
    hideSuggestions();
  }
});

shoppingListEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) {
    return;
  }
  const index = Number(button.dataset.index);
  if (button.dataset.action === "inc") {
    setQuantity(index, (cart[index]?.quantity ?? 1) + 1);
  } else if (button.dataset.action === "dec") {
    setQuantity(index, (cart[index]?.quantity ?? 1) - 1);
  } else if (button.dataset.action === "remove") {
    cart.splice(index, 1);
    renderCart();
  }
});

shoppingListEl.addEventListener("change", (event) => {
  const input = event.target.closest("input[data-action='qty']");
  if (!input) {
    return;
  }
  setQuantity(Number(input.dataset.index), Number(input.value));
});

formEl.addEventListener("submit", (event) => {
  event.preventDefault();
  void findCheapestStores();
});

sampleBtn.addEventListener("click", () => {
  cart = SAMPLE_ITEMS.map((item) => ({ ...item }));
  showFormError("");
  renderCart();
});

renderCart();
void loadInstacartStatus();
