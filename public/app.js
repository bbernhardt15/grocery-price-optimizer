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
];

/** @type {Array<{ name: string, brand: string, foodId: string, quantity: number }>} */
let cart = [];
/** @type {Array<{ name: string, brand: string, foodId: string }>} */
let suggestions = [];
let activeIndex = -1;
let searchTimer = 0;
let searchAbort = null;

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
  resultsEl.hidden = true;
  storeGridEl.innerHTML = "";
  grandTotalEl.textContent = "$0.00";
  summaryMetaEl.textContent = "";
  renderUnavailable([]);
}

function showFormError(message) {
  formErrorEl.hidden = !message;
  formErrorEl.textContent = message;
}

function showApiError(message) {
  apiErrorEl.hidden = !message;
  apiErrorEl.textContent = message;
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
  searchStatusEl.hidden = true;
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
    searchStatusEl.hidden = true;
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

function itemFragment(item) {
  const quantity = item.quantity ?? 1;
  const itemTotal = item.itemTotal ?? item.price * quantity;
  const brand = item.brand ? ` (${item.brand})` : "";
  return `${quantity}x ${item.name}${brand} — ${money(itemTotal)}`;
}

function renderStoreCard(store) {
  const rows = store.items
    .map(
      (item) =>
        `<li class="item-line">${escapeHtml(itemFragment(item))}</li>`
    )
    .join("");

  return `
    <article class="store-card">
      <header>
        <h2>${escapeHtml(store.storeName)}</h2>
        <p class="store-subtotal">${money(store.subtotal)}</p>
      </header>
      <ul class="item-list">${rows}</ul>
    </article>
  `;
}

function renderResults(payload) {
  const storeCount = payload.stores.length;
  const itemCount = payload.stores.reduce(
    (sum, store) =>
      sum + store.items.reduce((inner, item) => inner + (item.quantity ?? 1), 0),
    0
  );

  emptyStateEl.hidden = true;
  resultsEl.hidden = false;
  grandTotalEl.textContent = money(payload.total);
  summaryMetaEl.textContent = storeCount
    ? `${itemCount} item${itemCount === 1 ? "" : "s"} · ${storeCount} store${
        storeCount === 1 ? "" : "s"
      }${payload.locationId ? ` · Kroger ${payload.locationId}` : ""}`
    : "Nothing in the catalog matched this list.";
  storeGridEl.innerHTML = payload.stores.map(renderStoreCard).join("");
  renderUnavailable(payload.unavailable ?? []);
}

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
