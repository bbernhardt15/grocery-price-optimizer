const groceryListEl = document.querySelector("#grocery-list");
const findBtn = document.querySelector("#find-btn");
const formErrorEl = document.querySelector("#form-error");
const loadingEl = document.querySelector("#loading");
const apiErrorEl = document.querySelector("#api-error");
const emptyStateEl = document.querySelector("#empty-state");
const resultsEl = document.querySelector("#results");
const storeGridEl = document.querySelector("#store-grid");
const grandTotalEl = document.querySelector("#grand-total");
const summaryMetaEl = document.querySelector("#summary-meta");
const unavailableEl = document.querySelector("#unavailable");

function parseGroceryList(raw) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);
}

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

function setBusy(isBusy) {
  findBtn.disabled = isBusy;
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

function renderStoreCard(store) {
  const rows = store.items
    .map((item) => {
      const detail = [item.brand, item.unit].filter(Boolean).join(" · ");
      return `
        <li>
          <span class="item-name">${escapeHtml(item.name)}</span>
          <span class="item-price">${money(item.price)}</span>
          <span class="item-meta">Matched “${escapeHtml(item.query)}”${detail ? ` · ${escapeHtml(detail)}` : ""}</span>
        </li>
      `;
    })
    .join("");

  return `
    <article class="store-card">
      <header>
        <h2>${escapeHtml(store.storeName)}</h2>
        <p class="item-count">${store.items.length} item${store.items.length === 1 ? "" : "s"}</p>
      </header>
      <ul class="item-list">${rows}</ul>
      <div class="subtotal">
        <span>Subtotal</span>
        <span>${money(store.subtotal)}</span>
      </div>
    </article>
  `;
}

function renderResults(payload) {
  const storeCount = payload.stores.length;
  const itemCount = payload.stores.reduce((sum, store) => sum + store.items.length, 0);

  emptyStateEl.hidden = true;
  resultsEl.hidden = false;
  grandTotalEl.textContent = money(payload.total);
  summaryMetaEl.textContent = storeCount
    ? `${itemCount} item${itemCount === 1 ? "" : "s"} across ${storeCount} store${storeCount === 1 ? "" : "s"}`
    : "Nothing in the catalog matched this list.";
  storeGridEl.innerHTML = payload.stores.map(renderStoreCard).join("");
  renderUnavailable(payload.unavailable ?? []);
}

async function findCheapestStores() {
  showFormError("");
  showApiError("");

  const items = parseGroceryList(groceryListEl.value);
  if (items.length === 0) {
    showFormError("Add at least one grocery item.");
    hideResults();
    emptyStateEl.hidden = false;
    groceryListEl.focus();
    return;
  }

  setBusy(true);
  try {
    const response = await fetch("/api/optimize-list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
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

findBtn.addEventListener("click", () => {
  void findCheapestStores();
});

groceryListEl.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    void findCheapestStores();
  }
});

groceryListEl.defaultValue = "";
if (!groceryListEl.value.trim()) {
  groceryListEl.value = "Milk\nEggs\nBread";
}
