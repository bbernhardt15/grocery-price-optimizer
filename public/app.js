import { describeSavings, estimateSavings, formatMoney } from "./shopper/savingsMeter.js";
import {
  highlightMatch,
  nextSuggestIndex,
  SUGGEST_DEBOUNCE_MS,
  suggestionFacts,
  suggestionPriceLabel,
} from "./shopper/typeahead.js";
import { itemWatched, nextItemWatch, parseTargetPrice } from "./shopper/priceAlerts.js";
import {
  nextTheme,
  parseThemeChoice,
  THEME_KEY,
  themeButtonLabel,
  themeColor,
  themeGlyph,
  themeIsDark,
} from "./shopper/theme.js";

const $ = (id) => document.getElementById(id);

const searchEl = $("search");
const suggestionsEl = $("suggestions");
const zipEl = $("zip");
const gridEl = $("grid");
const tripEl = $("trip");
const resultCountEl = $("result-count");
const coverageBannerEl = $("coverage-banner");
const catalogErrorEl = $("catalog-error");
const sentinelEl = $("sentinel");
const sortEl = $("sort");
const listItemsEl = $("list-items");
const listEmptyEl = $("list-empty");
const listCountEl = $("list-count");
const estimateTotalEl = $("estimate-total");
const estimateNoteEl = $("estimate-note");
const meterFillEl = $("meter-fill");
const barMeterEl = $("bar-meter");
const meterEl = $("savings-meter");
const meterCaptionEl = $("meter-caption");
const suggestPanel = $("suggest-panel");
const suggestStatus = $("suggest-status");
const planBtn = $("plan-btn");
const planErrorEl = $("plan-error");
const allowSubsEl = $("allow-subs");
const listAlertsEl = $("list-alerts");
const listPanel = $("list-panel");
const alertsDialog = $("alerts-dialog");
const alertsListEl = $("alerts-list");
const alertsEmptyEl = $("alerts-empty");
const alertsToggle = $("alerts-toggle");
const toastEl = $("toast");
const productDialog = $("product-dialog");
const coverageDialog = $("coverage-dialog");

const ZIP_KEY = "gg-zip";
const LIST_KEY = "gg-list";
const SUBS_KEY = "gg-subs";
const ALERTS_KEY = "gg-list-alerts";
const DEVICE_KEY = "gg-device";
const LIST_ID_KEY = "gg-list-id";
const PUSH_KEY = "gg-push";
const SYNC_FLAG = "gg-watch-synced";
const ZIP_PATTERN = /^\d{5}(?:-\d{4})?$/;

/** @type {Map<string, { product: Record<string, any>, quantity: number }>} */
const list = new Map();
/** @type {Map<string, Record<string, any>>} */
const productsById = new Map();
let departments = [];
let activeDepartment = "all";
let query = "";
let nextCursor = null;
let loading = false;
let total = 0;
let coverage = [];
let catalogSource = "demo";
let instacartEnabled = false;
/** @type {Record<string, any> | null} */
let lastOptimize = null;
let searchTimer = 0;
let suggestLoadingTimer = 0;
let suggestAbort = null;
let activeSuggest = -1;
let listLoading = false;
let listReady = false;
let watchTimer = 0;
let unreadAlerts = 0;
/** @type {Array<Record<string, any>>} */
let priceAlerts = [];
let pushPublicKey = "";
/** @type {Array<Record<string, any>>} */
let suggestions = [];
/** Query the current suggestion rows belong to. */
let suggestionQuery = "";

const money = formatMoney;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalizeZip(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length >= 9) return `${digits.slice(0, 5)}-${digits.slice(5, 9)}`;
  if (digits.length >= 5) return digits.slice(0, 5);
  return digits;
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  window.setTimeout(() => toastEl.classList.remove("show"), 1600);
}

function sourceLabel(source) {
  if (source === "live") return "Live";
  if (source === "partner_feed") return "Partner";
  if (source === "weekly_ad") return "Weekly ad";
  return "Demo";
}

function bestOffer(product, store) {
  const offers = product.offers.filter((offer) => offer.availability !== "out_of_stock");
  const pool = store ? offers.filter((offer) => offer.storeName === store) : offers;
  return [...(pool.length ? pool : product.offers)].sort((a, b) => a.price - b.price)[0];
}

function randomId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `gg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function deviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = randomId();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function savedListId() {
  let id = localStorage.getItem(LIST_ID_KEY);
  if (!id) {
    id = randomId();
    localStorage.setItem(LIST_ID_KEY, id);
  }
  return id;
}

function saveList() {
  const rows = [...list.values()].map((entry) => ({
    id: entry.product.id,
    quantity: entry.quantity,
    baselinePrice: entry.baselinePrice,
    baselineStore: entry.baselineStore,
    watch: entry.watch || "inherit",
    targetPrice: entry.targetPrice ?? null,
  }));
  localStorage.setItem(LIST_KEY, JSON.stringify(rows));
  scheduleWatchSync();
}

function scheduleWatchSync() {
  if (!listReady) return;
  window.clearTimeout(watchTimer);
  watchTimer = window.setTimeout(() => void syncWatch(), 400);
}

async function syncWatch() {
  const listOn = Boolean(listAlertsEl?.checked);
  const items = [];
  for (const entry of list.values()) {
    if (!(Number(entry.baselinePrice) > 0)) continue;
    items.push({
      productId: entry.product.id,
      name: entry.product.name,
      brand: entry.product.brand || "",
      watch: entry.watch || "inherit",
      baselinePrice: entry.baselinePrice,
      baselineStore: entry.baselineStore || "",
      targetPrice: entry.targetPrice ?? null,
    });
  }
  const active = listOn || items.some((item) => item.watch === "on");
  if (!active && localStorage.getItem(SYNC_FLAG) !== "1") return;
  const zip = normalizeZip(zipEl.value);
  try {
    const response = await fetch("/api/price-alerts/watches", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: deviceId(),
        listId: savedListId(),
        listName: "My list",
        zip: ZIP_PATTERN.test(zip) ? zip.slice(0, 5) : "",
        enabled: listOn,
        items,
      }),
    });
    if (response.ok) localStorage.setItem(SYNC_FLAG, "1");
  } catch {
    /* the list stays on this device; the next change tries again */
  }
}

function quotesForProduct(product, allowSubs) {
  const quotes = [];
  for (const offer of product?.offers ?? []) {
    if (offer.availability === "out_of_stock") continue;
    quotes.push({ storeName: offer.storeName, price: Number(offer.price) });
  }
  if (allowSubs) {
    for (const gap of product?.gaps ?? []) {
      if (!gap.substitute) continue;
      if (quotes.some((quote) => quote.storeName === gap.storeName)) continue;
      quotes.push({ storeName: gap.storeName, price: Number(gap.substitute.price) });
    }
  }
  return quotes;
}

function listLines() {
  const allow = allowSubsEl.checked;
  return [...list.values()].map((entry) => ({
    quantity: entry.quantity,
    quotes: quotesForProduct(entry.product, allow),
  }));
}

function renderEstimate() {
  const count = [...list.values()].reduce((sum, entry) => sum + entry.quantity, 0);
  const savingsEl = $("savings");
  const badgeEl = $("savings-badge");
  const barSave = $("bar-save");
  const barCaption = $("bar-caption");
  const listBar = $("list-bar");
  listCountEl.textContent = String(count);
  $("bar-count").textContent = count ? `My list · ${count}` : "My list";
  planBtn.disabled = list.size === 0 || listLoading;
  listEmptyEl.hidden = list.size > 0 || listLoading;

  const loadingNote = $("savings-loading");
  if (listLoading) {
    savingsEl.dataset.state = "loading";
    savingsEl.setAttribute("aria-busy", "true");
    loadingNote.hidden = false;
    listBar.dataset.state = "loading";
    meterEl.setAttribute("aria-valuenow", "0");
    meterEl.setAttribute("aria-valuetext", "Checking prices for your list.");
    barMeterEl.style.width = "0%";
    badgeEl.hidden = true;
    barSave.hidden = true;
    barCaption.textContent = "Checking prices…";
    renderListRows();
    return;
  }

  const meter = estimateSavings(listLines());
  const copy = describeSavings(meter, { allowSubstitutes: allowSubsEl.checked });
  const width = meter.saved > 0 ? Math.max(meter.ratio, 8) : 0;
  savingsEl.dataset.state = meter.status;
  savingsEl.setAttribute("aria-busy", "false");
  loadingNote.hidden = true;
  listBar.dataset.state = meter.status;
  estimateTotalEl.textContent = money(meter.splitTotal);
  $("bar-total").textContent = money(meter.splitTotal);
  estimateNoteEl.textContent = copy.note;
  meterCaptionEl.textContent = copy.caption;
  barCaption.textContent = meter.status === "empty" ? "Add items to see savings" : copy.caption;
  meterFillEl.style.width = `${width}%`;
  barMeterEl.style.width = `${width}%`;
  meterEl.setAttribute("aria-valuenow", String(meter.ratio));
  meterEl.setAttribute("aria-valuetext", copy.meterText);
  if (copy.badge) {
    badgeEl.hidden = false;
    badgeEl.textContent = copy.badge;
    barSave.hidden = false;
    barSave.textContent = copy.badge;
  } else {
    badgeEl.hidden = true;
    badgeEl.textContent = "";
    barSave.hidden = true;
  }
  renderListRows();
}

function savingsBlock(total, subject) {
  const meter = estimateSavings(listLines(), Number.isFinite(total) ? { splitTotal: total } : {});
  const copy = describeSavings(meter, { subject });
  if (meter.status === "empty") return "";
  const width = meter.saved > 0 ? Math.max(meter.ratio, 8) : 0;
  const badge = copy.badge ? `<p class="savings-badge">${escapeHtml(copy.badge)}</p>` : "";
  return `<div class="trip-savings">
    ${badge}
    <p class="muted">${escapeHtml(copy.note)}</p>
    <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${meter.ratio}" aria-valuetext="${escapeHtml(copy.meterText)}">
      <span class="meter-fill" style="width:${width}%"></span>
    </div>
    <p class="meter-caption">${escapeHtml(copy.caption)}</p>
  </div>`;
}

function renderListRows() {
  listItemsEl.innerHTML = [...list.values()]
    .map((entry) => {
      const offer = bestOffer(entry.product);
      if (!offer) return "";
      const gap = (entry.product.gaps ?? []).find((item) => item.substitute);
      const sub = gap?.substitute
        ? `<p class="gap">Not at ${escapeHtml(gap.storeName)} · substitute ${escapeHtml(gap.substitute.brand)} ${escapeHtml(gap.substitute.name)} ${money(gap.substitute.price)}</p>`
        : "";
      const watched = itemWatched(Boolean(listAlertsEl?.checked), entry.watch || "inherit");
      const targetValue = entry.targetPrice ? String(entry.targetPrice) : "";
      return `<li class="list-row">
        <img src="${escapeHtml(entry.product.imageUrls?.[0] || "")}" alt="" />
        <div>
          <strong>${escapeHtml(entry.product.name)}</strong>
          <p class="muted">${escapeHtml(entry.product.brand)} · ${escapeHtml(entry.product.sizeLabel || "")}</p>
          <p class="muted">${money(offer.price)} at ${escapeHtml(offer.storeName)}</p>
          ${sub}
          <div class="alert-controls">
            <label class="check-row item-watch">
              <input type="checkbox" data-watch="${escapeHtml(entry.product.id)}" ${watched ? "checked" : ""} />
              Watch price
            </label>
            <label class="target-price">Target $
              <input data-target="${escapeHtml(entry.product.id)}" inputmode="decimal" value="${escapeHtml(targetValue)}" placeholder="optional" aria-label="Target price for ${escapeHtml(entry.product.name)}" />
            </label>
          </div>
        </div>
        <div class="stepper">
          <button type="button" data-list-dec="${escapeHtml(entry.product.id)}" aria-label="Decrease ${escapeHtml(entry.product.name)}">−</button>
          <output>${entry.quantity}</output>
          <button type="button" data-list-inc="${escapeHtml(entry.product.id)}" aria-label="Increase ${escapeHtml(entry.product.name)}">+</button>
        </div>
      </li>`;
    })
    .join("");
}

function setQuantity(id, quantity) {
  const entry = list.get(id);
  if (!entry) return;
  if (quantity < 1) {
    list.delete(id);
    toast("Removed from list");
  } else {
    entry.quantity = Math.min(99, quantity);
  }
  saveList();
  renderEstimate();
  syncCards();
}

function addProduct(product, quantity = 1) {
  const existing = list.get(product.id);
  const next = Math.min(99, (existing?.quantity ?? 0) + quantity);
  if (existing) {
    existing.quantity = next;
    existing.product = product;
  } else {
    const offer = bestOffer(product);
    list.set(product.id, {
      product,
      quantity: Math.max(1, quantity),
      baselinePrice: offer?.price ?? null,
      baselineStore: offer?.storeName ?? "",
      watch: "inherit",
      targetPrice: null,
    });
  }
  productsById.set(product.id, product);
  saveList();
  renderEstimate();
  syncCards();
  const card = gridEl.querySelector(`[data-product-id="${CSS.escape(product.id)}"]`);
  if (card) {
    card.classList.remove("just-added");
    void card.offsetWidth;
    card.classList.add("just-added");
  }
  toast(`Added ${product.name}`);
}

function syncCards() {
  for (const card of gridEl.querySelectorAll("[data-product-id]")) {
    const id = card.getAttribute("data-product-id");
    const entry = list.get(id);
    const box = card.querySelector("input[type=checkbox]");
    const output = card.querySelector("output");
    if (box) box.checked = Boolean(entry);
    if (output) output.textContent = String(entry?.quantity ?? 1);
  }
}

function filterQuery() {
  const params = new URLSearchParams();
  if (activeDepartment !== "all") params.set("department", activeDepartment);
  if (query) params.set("q", query);
  const store = $("filter-store").value;
  const brand = $("filter-brand").value;
  const sub = $("filter-sub").value;
  const size = $("filter-size").value;
  if (store) params.set("store", store);
  if (brand) params.set("brand", brand);
  if (sub) params.set("subcategory", sub);
  if (size && size !== "any") params.set("size", size);
  if ($("filter-sale").checked) params.set("onSale", "1");
  if ($("filter-store-brand").checked) params.set("storeBrand", "1");
  const min = $("filter-min").value.trim();
  const max = $("filter-max").value.trim();
  if (min) params.set("minPrice", min);
  if (max) params.set("maxPrice", max);
  params.set("sort", sortEl.value);
  const zip = normalizeZip(zipEl.value);
  if (ZIP_PATTERN.test(zip)) params.set("zip", zip.slice(0, 5));
  params.set("limit", "12");
  return params;
}

function cardHtml(product) {
  const store = $("filter-store").value;
  const offer = bestOffer(product, store || undefined);
  const sale = product.offers.some((item) => item.onSale);
  const demo = offer.priceSource === "seed";
  const gap = (product.gaps ?? []).find((item) => item.substitute);
  const gapHtml = gap
    ? `<p class="gap">Not at ${escapeHtml(gap.storeName)} · substitute ${escapeHtml(gap.substitute.brand)} ${escapeHtml(gap.substitute.name)} ${money(gap.substitute.price)}</p>`
    : "";
  const checked = list.has(product.id) ? "checked" : "";
  const qty = list.get(product.id)?.quantity ?? 1;
  return `<article class="card" data-product-id="${escapeHtml(product.id)}">
    <button class="card-open" type="button" data-open="${escapeHtml(product.id)}" aria-label="Details for ${escapeHtml(product.name)}">
      <img src="${escapeHtml(product.imageUrls?.[0] || "")}" alt="" />
      ${sale ? '<span class="badge">Sale</span>' : ""}
      ${demo ? '<span class="demo-badge">Demo</span>' : `<span class="demo-badge">${escapeHtml(sourceLabel(offer.priceSource))}</span>`}
    </button>
    <div class="card-body">
      <p class="brand">${escapeHtml(product.brand)}${product.storeBrand ? " · store brand" : ""}</p>
      <h3>${escapeHtml(product.name)}</h3>
      <p class="size">${escapeHtml(product.sizeLabel || product.departmentName)}</p>
      <p class="price"><strong>${money(offer.price)}</strong> <span>${escapeHtml(offer.storeName)}</span></p>
      <p class="unit">${escapeHtml(offer.unitPriceText || "")}</p>
      ${gapHtml}
    </div>
    <div class="card-actions">
      <label class="check">
        <input type="checkbox" data-check="${escapeHtml(product.id)}" ${checked} aria-label="Add ${escapeHtml(product.name)} to my list" />
        Add
      </label>
      <div class="stepper">
        <button type="button" data-dec="${escapeHtml(product.id)}" aria-label="Decrease quantity of ${escapeHtml(product.name)}">−</button>
        <output>${qty}</output>
        <button type="button" data-inc="${escapeHtml(product.id)}" aria-label="Increase quantity of ${escapeHtml(product.name)}">+</button>
      </div>
    </div>
  </article>`;
}

function skeletons() {
  gridEl.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton" aria-hidden="true"></div>').join("");
}

function fillFacets(facets) {
  const brand = $("filter-brand");
  const store = $("filter-store");
  const sub = $("filter-sub");
  const keep = { brand: brand.value, store: store.value, sub: sub.value };
  const options = (values, current, label) =>
    [`<option value="">${label}</option>`]
      .concat(values.map((value) => `<option ${value === current ? "selected" : ""}>${escapeHtml(value)}</option>`))
      .join("");
  brand.innerHTML = options(facets.brands ?? [], keep.brand, "All brands");
  store.innerHTML = options(facets.stores ?? [], keep.store, "All stores");
  sub.innerHTML = options(facets.subcategories ?? [], keep.sub, "All");
}

function renderDepartments() {
  const chips = [`<button type="button" class="chip" data-dept="all" role="tab" aria-selected="${activeDepartment === "all"}">All</button>`];
  const links = [`<button type="button" class="dept-link" data-dept="all" ${activeDepartment === "all" ? 'aria-current="page"' : ""}>All departments</button>`];
  for (const department of departments) {
    const selected = activeDepartment === department.id;
    chips.push(`<button type="button" class="chip" data-dept="${escapeHtml(department.id)}" role="tab" aria-selected="${selected}">${escapeHtml(department.name)}</button>`);
    links.push(`<button type="button" class="dept-link" data-dept="${escapeHtml(department.id)}" ${selected ? 'aria-current="page"' : ""}>${escapeHtml(department.name)}</button>`);
  }
  $("dept-chips").innerHTML = chips.join("");
  $("dept-nav").innerHTML = links.join("");
}

function showCatalogError(message) {
  catalogErrorEl.hidden = !message;
  catalogErrorEl.textContent = message;
}

async function loadPage(reset) {
  if (loading) return;
  if (!reset && !nextCursor) return;
  loading = true;
  if (reset) {
    skeletons();
    nextCursor = null;
    tripEl.hidden = true;
    gridEl.hidden = false;
  }
  showCatalogError("");
  const params = filterQuery();
  if (!reset && nextCursor) params.set("cursor", nextCursor);
  try {
    const response = await fetch(`/api/catalog/browse?${params.toString()}`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Browse failed (${response.status})`);
    coverage = body.coverage ?? coverage;
    catalogSource = body.catalogSource || catalogSource;
    total = body.total ?? 0;
    nextCursor = body.nextCursor;
    if (reset) fillFacets(body.facets ?? {});
    const items = body.items ?? [];
    for (const product of items) productsById.set(product.id, product);
    const html = items.map(cardHtml).join("");
    gridEl.innerHTML = reset ? html : gridEl.innerHTML + html;
    if (!items.length && reset) {
      gridEl.innerHTML = '<p class="muted">Nothing in this aisle matches those filters.</p>';
    }
    const label = query ? `Results for “${query}”` : activeDepartment === "all" ? "All departments" : departments.find((d) => d.id === activeDepartment)?.name || "Aisle";
    resultCountEl.textContent = `${total} ${total === 1 ? "product" : "products"} · ${label}`;
    const demo = catalogSource === "demo";
    coverageBannerEl.textContent = demo
      ? "Demo shelves — store prices here are samples until Walmart, Kroger, or a partner feed is configured. Open Coverage for what each store can actually browse."
      : catalogSource === "database"
        ? "Prices from Grocery Gitter’s saved catalog. Aldi and Target stay on the demo shelf until a feed exists."
        : catalogSource === "mixed"
          ? "Live samples are mixed with the demo catalog. Stores without a catalog API stay labeled Demo."
          : "Live catalog sample. This is not a full store assortment.";
    if (body.warnings?.length) {
      showCatalogError(body.warnings.join(" "));
    }
  } catch (error) {
    showCatalogError(error instanceof Error ? error.message : "Could not load the catalog.");
    if (reset) gridEl.innerHTML = "";
  } finally {
    loading = false;
    if (reset && nextCursor && sentinelEl.getBoundingClientRect().top < window.innerHeight + 40) {
      void loadPage(false);
    }
  }
}

function selectDepartment(id) {
  activeDepartment = id;
  query = "";
  searchEl.value = "";
  closeSuggestions();
  renderDepartments();
  const chip = document.querySelector(`[data-dept="${CSS.escape(id)}"]`);
  chip?.scrollIntoView({ inline: "center", block: "nearest" });
  void loadPage(true);
}

function highlightHtml(text, q) {
  return highlightMatch(text, q)
    .map((part) => (part.match ? `<mark>${escapeHtml(part.text)}</mark>` : escapeHtml(part.text)))
    .join("");
}

function closeSuggestions() {
  window.clearTimeout(suggestLoadingTimer);
  suggestAbort?.abort();
  suggestPanel.hidden = true;
  suggestionsEl.hidden = true;
  suggestStatus.hidden = true;
  searchEl.setAttribute("aria-expanded", "false");
  searchEl.removeAttribute("aria-activedescendant");
}

function paintActiveSuggest() {
  const options = suggestionsEl.querySelectorAll("[role=option]");
  options.forEach((option, index) => {
    const selected = index === activeSuggest;
    option.setAttribute("aria-selected", String(selected));
    if (selected) option.scrollIntoView({ block: "nearest" });
  });
  if (activeSuggest >= 0) searchEl.setAttribute("aria-activedescendant", `suggest-${activeSuggest}`);
  else searchEl.removeAttribute("aria-activedescendant");
}

function showSuggestStatus(message) {
  suggestPanel.hidden = false;
  suggestionsEl.hidden = true;
  suggestionsEl.innerHTML = "";
  suggestStatus.hidden = false;
  suggestStatus.textContent = message;
  searchEl.setAttribute("aria-expanded", "true");
  searchEl.removeAttribute("aria-activedescendant");
}

function renderSuggestionRows(q) {
  suggestionsEl.innerHTML = suggestions
    .map((item, index) => {
      const facts = suggestionFacts(item).map((fact) => highlightHtml(fact, q));
      const price = suggestionPriceLabel(item.bestPrice, item.bestStore, money);
      const meta = [...facts, price ? escapeHtml(price) : ""].filter(Boolean).join(" · ");
      const thumb = item.imageUrl
        ? `<img src="${escapeHtml(item.imageUrl)}" alt="" />`
        : "";
      return `<li role="presentation"><button type="button" class="suggest-option" role="option" data-suggest="${index}" id="suggest-${index}" aria-selected="${index === activeSuggest}">
        ${thumb}
        <span>
          <span class="suggest-name">${highlightHtml(item.name || "", q)}</span>
          ${meta ? `<span class="suggest-meta">${meta}</span>` : ""}
        </span>
      </button></li>`;
    })
    .join("");
  suggestStatus.hidden = true;
  suggestionsEl.hidden = false;
  suggestPanel.hidden = false;
  searchEl.setAttribute("aria-expanded", "true");
  paintActiveSuggest();
}

function chooseSuggestion(index) {
  const item = suggestions[index];
  if (!item) return;
  query = item.name;
  searchEl.value = item.name;
  activeDepartment = "all";
  renderDepartments();
  closeSuggestions();
  void loadPage(true);
}

async function loadSuggestions(text) {
  const q = text.trim();
  if (!q) {
    suggestions = [];
    suggestionQuery = "";
    activeSuggest = -1;
    showSuggestStatus("Type a product, brand, or aisle.");
    return;
  }
  window.clearTimeout(suggestLoadingTimer);
  suggestAbort?.abort();
  const controller = new AbortController();
  suggestAbort = controller;
  const requestQuery = q;
  if (suggestionQuery !== q) {
    suggestions = [];
    activeSuggest = -1;
    suggestionQuery = "";
  }
  suggestLoadingTimer = window.setTimeout(() => {
    if (suggestions.length === 0) showSuggestStatus(`Searching for “${q}”…`);
  }, 200);
  try {
    const response = await fetch(`/api/catalog/suggest?q=${encodeURIComponent(q)}`, { signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (controller.signal.aborted || searchEl.value.trim() !== requestQuery) return;
    window.clearTimeout(suggestLoadingTimer);
    suggestions = body.suggestions ?? [];
    suggestionQuery = q;
    activeSuggest = -1;
    if (suggestions.length === 0) {
      showSuggestStatus(`No matches for “${q}”. Press Enter to search the shelves.`);
      return;
    }
    renderSuggestionRows(q);
  } catch (error) {
    if (error?.name === "AbortError") return;
    window.clearTimeout(suggestLoadingTimer);
    if (searchEl.value.trim() !== requestQuery) return;
    suggestions = [];
    showSuggestStatus(`No matches for “${q}”. Press Enter to search the shelves.`);
  }
}

function openList(open) {
  listPanel.classList.toggle("open", open);
  $("list-toggle").setAttribute("aria-expanded", String(open));
  if (open && window.matchMedia("(max-width: 1099px)").matches) {
    listPanel.querySelector("h2")?.focus();
  }
}

function openFilters(open) {
  $("filters").classList.toggle("open", open);
  $("filters-open").setAttribute("aria-expanded", String(open));
}

function itemCompareNote(product) {
  const meter = estimateSavings([{ quantity: 1, quotes: quotesForProduct(product, false) }]);
  if (meter.status !== "ready") return "";
  return `<p class="compare-note">${escapeHtml(describeSavings(meter, { subject: "item" }).note)}</p>`;
}

function openProduct(product) {
  const offers = [...product.offers].sort((a, b) => a.price - b.price);
  const gaps = product.gaps ?? [];
  productDialog.innerHTML = `<div class="sheet-body">
    <img class="hero" src="${escapeHtml(product.imageUrls?.[0] || "")}" alt="" />
    <p class="brand">${escapeHtml(product.brand)} · ${escapeHtml(product.departmentName)}</p>
    <h2 id="dialog-title">${escapeHtml(product.name)}</h2>
    <p class="muted">${escapeHtml(product.sizeLabel || "Size varies")}${product.storeBrand ? " · store brand" : ""}</p>
    ${itemCompareNote(product)}
    <h3>Prices</h3>
    <ul class="offer-list">
      ${offers
        .map(
          (offer) => `<li><span>${escapeHtml(offer.storeName)} · ${escapeHtml(sourceLabel(offer.priceSource))}${offer.onSale ? " · sale" : ""}</span><strong>${money(offer.price)} ${escapeHtml(offer.unitPriceText || "")}</strong></li>`
        )
        .join("")}
    </ul>
    ${
      gaps.length
        ? `<h3>Substitutes <span class="sub-tag">Not an exact match</span></h3>
      <ul class="sub-list">
        ${gaps
          .map((gap) =>
            gap.substitute
              ? `<li><span><span class="sub-tag">Substitute</span> Not at ${escapeHtml(gap.storeName)}: ${escapeHtml(gap.substitute.brand)} ${escapeHtml(gap.substitute.name)}</span>
            <button type="button" class="ghost" data-add-sub="${escapeHtml(gap.substitute.productId)}">Add</button></li>`
              : `<li><span>No close substitute at ${escapeHtml(gap.storeName)}</span></li>`
          )
          .join("")}
      </ul>`
        : "<p class='muted'>Every default store has an exact offer for this item.</p>"
    }
    <button type="button" class="primary" id="dialog-add">Add to my list</button>
    <button type="button" class="ghost" id="dialog-close">Close</button>
  </div>`;
  productDialog.showModal();
  productDialog.querySelector("#dialog-add").onclick = () => {
    addProduct(product, 1);
    productDialog.close();
  };
  productDialog.querySelector("#dialog-close").onclick = () => productDialog.close();
  productDialog.querySelectorAll("[data-add-sub]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.getAttribute("data-add-sub");
      const known = productsById.get(id);
      const productToAdd = known || (await fetch(`/api/catalog/products/${encodeURIComponent(id)}`).then((r) => r.json())).product;
      if (productToAdd?.id) {
        productsById.set(productToAdd.id, productToAdd);
        addProduct(productToAdd, 1);
        productDialog.close();
      }
    });
  });
}

function openCoverage() {
  coverageDialog.innerHTML = `<div class="sheet-body">
    <h2 id="coverage-title">Catalog coverage</h2>
    <ul class="offer-list">
      ${(coverage || [])
        .map(
          (store) => `<li><span><strong>${escapeHtml(store.storeName)}</strong> · ${escapeHtml(store.label)}<br /><span class="muted">${escapeHtml(store.detail)}</span></span></li>`
        )
        .join("")}
    </ul>
    <button type="button" class="primary" id="coverage-close">Close</button>
  </div>`;
  coverageDialog.showModal();
  coverageDialog.querySelector("#coverage-close").onclick = () => coverageDialog.close();
}

function pricingClass(pricing) {
  const source = pricing?.source;
  if (source === "live" || source === "cached_live" || source === "partner_feed") return "badge-live";
  if (source === "weekly_ad" || source === "cached_weekly_ad") return "badge-ad";
  return "badge-demo";
}

function renderTrip(payload) {
  lastOptimize = payload;
  gridEl.hidden = true;
  sentinelEl.hidden = true;
  tripEl.hidden = false;
  const stores = payload.stores ?? [];
  tripEl.innerHTML = `
    <button type="button" class="ghost" id="trip-back">Back to shelves</button>
    <div class="trip-banner">
      <div>
        <p>Trip plan</p>
        <p>${escapeHtml(payload.tripPlan?.summary || `${stores.length} stores`)}</p>
        <div id="instacart-whole"></div>
      </div>
      <p class="trip-total">${money(payload.total)}</p>
    </div>
    ${savingsBlock(Number(payload.total))}
    ${payload.pricingWarning ? `<p class="muted">${escapeHtml(payload.pricingWarning)}</p>` : ""}
    <div class="store-grid">
      ${stores.map(renderStore).join("")}
    </div>
    ${(payload.unavailable ?? []).length ? `<p class="status">No price for: ${escapeHtml(payload.unavailable.join(", "))}</p>` : ""}
  `;
  const whole = $("instacart-whole");
  if (instacartEnabled && stores.length) {
    whole.innerHTML = `<p>or shop the whole list on Instacart</p><button type="button" class="instacart-cta" data-instacart-scope="list"><img src="/instacart-carrot.svg" alt="" />Shop on Instacart</button>`;
  }
  $("trip-back").onclick = () => {
    tripEl.hidden = true;
    gridEl.hidden = false;
    sentinelEl.hidden = false;
  };
}

function renderStore(store) {
  const rows = (store.items ?? [])
    .map((item) => {
      const sub = item.matchKind === "substitute" ? ` <span class="sub-tag">Substitute</span>` : "";
      return `<li><span>${item.quantity}× ${escapeHtml(item.name)} (${escapeHtml(item.brand)})${sub}</span><span>${money(item.itemTotal ?? item.price)}</span></li>`;
    })
    .join("");
  const action = store.handoff?.action;
  let handoff = "";
  if (action?.type === "coming_soon") {
    handoff = `<button class="handoff-btn" type="button" disabled>${escapeHtml(action.label || "Coming soon")}</button>`;
  } else if (action?.type === "kroger_cart") {
    handoff = `<button class="handoff-btn" type="button" data-kroger="${escapeHtml(store.storeName)}">${escapeHtml(action.label)}</button>`;
  } else if (action?.url) {
    handoff = `<a class="handoff-btn" href="${escapeHtml(action.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(action.label)}</a>`;
  }
  const instacart =
    instacartEnabled && action?.type !== "kroger_cart" && action?.type !== "walmart_cart"
      ? `<button type="button" class="instacart-cta" data-instacart-scope="store" data-instacart-store="${escapeHtml(store.storeName)}"><img src="/instacart-carrot.svg" alt="" />Shop on Instacart</button>`
      : "";
  const nearby = store.nearbyStore?.name
    ? `<p class="store-nearby">Nearest store: ${escapeHtml(store.nearbyStore.name)}</p>`
    : "";
  return `<article class="store-card">
    <header>
      <div>
        <h3>${escapeHtml(store.storeName)}</h3>
        ${nearby}
        <span class="${pricingClass(store.pricing)}">${escapeHtml(store.pricing?.label || "Prices")}</span>
      </div>
      <strong>${money(store.subtotal)}</strong>
    </header>
    <ul class="item-list">${rows}</ul>
    <footer class="store-handoff">${handoff}${action?.detail ? `<p class="handoff-detail">${escapeHtml(action.detail)}</p>` : ""}${instacart}</footer>
  </article>`;
}

async function planTrip() {
  planErrorEl.hidden = true;
  const zip = normalizeZip(zipEl.value);
  zipEl.value = zip;
  if (!ZIP_PATTERN.test(zip)) {
    planErrorEl.hidden = false;
    planErrorEl.textContent = "Enter a 5-digit ZIP so the trip can use your nearest stores.";
    zipEl.focus();
    return;
  }
  localStorage.setItem(ZIP_KEY, zip);
  const items = [...list.values()].map((entry) => ({
    name: entry.product.name,
    brand: entry.product.brand,
    quantity: entry.quantity,
    catalogId: entry.product.id,
    upc: entry.product.upc,
  }));
  planBtn.disabled = true;
  planBtn.textContent = "Planning…";
  try {
    const status = await fetch("/api/instacart/status").then((response) => response.json().catch(() => ({ enabled: false })));
    instacartEnabled = Boolean(status.enabled);
    const response = await fetch("/api/optimize-list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, zipCode: zip, allowSubstitutes: allowSubsEl.checked }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Trip plan failed (${response.status})`);
    renderTrip(body);
    openList(false);
    tripEl.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    planErrorEl.hidden = false;
    planErrorEl.textContent = error instanceof Error ? error.message : "Could not plan the trip.";
  } finally {
    planBtn.disabled = list.size === 0;
    planBtn.textContent = "Plan the trip";
  }
}

async function openInstacart(button) {
  const scope = button.dataset.instacartScope;
  const storeName = button.dataset.instacartStore || "";
  const stores = lastOptimize?.stores ?? [];
  const selected = scope === "store" ? stores.filter((store) => store.storeName === storeName) : stores;
  const items = [];
  for (const store of selected) {
    for (const item of store.items ?? []) {
      items.push({
        name: item.name,
        quantity: item.quantity ?? 1,
        ...(item.unit ? { unit: item.unit } : {}),
        ...(item.size ? { size: item.size } : {}),
        ...(item.brand ? { brand: item.brand } : {}),
        ...(item.upc ? { upc: item.upc } : {}),
      });
    }
  }
  button.disabled = true;
  try {
    const response = await fetch("/api/instacart/shopping-list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items,
        ...(scope === "store" && storeName ? { storeName } : {}),
        postalCode: normalizeZip(zipEl.value).slice(0, 5),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.productsLinkUrl) throw new Error(body.error || "Instacart did not return a link.");
    window.open(body.productsLinkUrl, "_blank", "noopener");
  } catch (error) {
    planErrorEl.hidden = false;
    planErrorEl.textContent = error instanceof Error ? error.message : "Could not open Instacart.";
    tripEl.prepend(planErrorEl);
  } finally {
    button.disabled = false;
  }
}

async function startKroger(storeName, button) {
  const store = lastOptimize?.stores?.find((entry) => entry.storeName === storeName);
  if (!store) return;
  button.disabled = true;
  try {
    const response = await fetch("/api/kroger/cart/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: store.handoff?.items ?? store.items, locationId: store.items?.[0]?.locationId }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Kroger cart did not start.");
    if (body.authorizeUrl) {
      window.location.assign(body.authorizeUrl);
      return;
    }
    toast(body.status === "added" ? "Kroger accepted the cart." : "Kroger cart updated.");
  } catch (error) {
    toast(error instanceof Error ? error.message : "Kroger cart failed.");
  } finally {
    button.disabled = false;
  }
}

function applyTheme(theme) {
  const choice = parseThemeChoice(theme);
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = themeIsDark(choice, systemDark);
  document.documentElement.dataset.theme = choice;
  document.documentElement.dataset.resolved = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  localStorage.setItem(THEME_KEY, choice);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColor(choice, systemDark));
  const glyph = $("theme-glyph");
  if (glyph) glyph.textContent = themeGlyph(choice);
  $("theme-btn")?.setAttribute("aria-label", themeButtonLabel(choice, systemDark));
}

async function restoreList() {
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(LIST_KEY) || "[]");
  } catch {
    saved = [];
  }
  await Promise.all(
    saved.map(async (row) => {
      if (!row?.id) return;
      try {
        const response = await fetch(`/api/catalog/products/${encodeURIComponent(row.id)}`);
        if (!response.ok) return;
        const body = await response.json();
        if (body.product?.id) {
          productsById.set(body.product.id, body.product);
          const offer = bestOffer(body.product);
          const storedBaseline = Number(row.baselinePrice);
          list.set(body.product.id, {
            product: body.product,
            quantity: Math.max(1, Number(row.quantity) || 1),
            baselinePrice: storedBaseline > 0 ? storedBaseline : offer?.price ?? null,
            baselineStore: row.baselineStore || offer?.storeName || "",
            watch: row.watch === "on" || row.watch === "off" ? row.watch : "inherit",
            targetPrice: Number(row.targetPrice) > 0 ? Number(row.targetPrice) : null,
          });
        }
      } catch {
        /* ignore a stale local id */
      }
    })
  );
  renderEstimate();
}

async function addSample() {
  const response = await fetch("/api/catalog/browse?limit=48");
  const body = await response.json();
  const wanted = [
    { name: "Bananas", brand: "Fresh" },
    { name: "Whole Milk", brand: "Dairy Pure" },
    { name: "Spaghetti Pasta", brand: "Barilla" },
    { name: "Large Eggs", brand: "Goldhen" },
  ];
  for (const item of body.items ?? []) {
    productsById.set(item.id, item);
  }
  for (const want of wanted) {
    const product = (body.items ?? []).find((item) => item.name === want.name && item.brand === want.brand);
    if (product) addProduct(product, 1);
  }
  openList(true);
}

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  if (!target.closest(".search") && !suggestPanel.hidden) closeSuggestions();
  const dept = target.closest("[data-dept]");
  if (dept) {
    selectDepartment(dept.getAttribute("data-dept"));
    return;
  }
  const open = target.closest("[data-open]");
  if (open) {
    const product = productsById.get(open.getAttribute("data-open"));
    if (product) openProduct(product);
    return;
  }
  const inc = target.closest("[data-inc]");
  if (inc) {
    const id = inc.getAttribute("data-inc");
    const product = productsById.get(id);
    if (!product) return;
    if (!list.has(id)) addProduct(product, 1);
    else setQuantity(id, list.get(id).quantity + 1);
    return;
  }
  const dec = target.closest("[data-dec]");
  if (dec) {
    const id = dec.getAttribute("data-dec");
    const entry = list.get(id);
    if (!entry) return;
    setQuantity(id, entry.quantity - 1);
    return;
  }
  const listInc = target.closest("[data-list-inc]");
  if (listInc) {
    const id = listInc.getAttribute("data-list-inc");
    setQuantity(id, (list.get(id)?.quantity ?? 1) + 1);
    return;
  }
  const listDec = target.closest("[data-list-dec]");
  if (listDec) {
    const id = listDec.getAttribute("data-list-dec");
    setQuantity(id, (list.get(id)?.quantity ?? 1) - 1);
    return;
  }
  const suggest = target.closest("[data-suggest]");
  if (suggest) {
    chooseSuggestion(Number(suggest.getAttribute("data-suggest")));
    return;
  }
  if (target.closest("[data-kroger]")) {
    void startKroger(target.closest("[data-kroger]").getAttribute("data-kroger"), target.closest("[data-kroger]"));
    return;
  }
  if (target.closest(".instacart-cta")) {
    void openInstacart(target.closest(".instacart-cta"));
  }
});

gridEl.addEventListener("change", (event) => {
  const box = event.target;
  if (!(box instanceof HTMLInputElement) || !box.dataset.check) return;
  const product = productsById.get(box.dataset.check);
  if (!product) return;
  if (box.checked) addProduct(product, 1);
  else setQuantity(product.id, 0);
});

$("search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  query = searchEl.value.trim();
  if (query) {
    activeDepartment = "all";
    renderDepartments();
  }
  closeSuggestions();
  void loadPage(true);
});

searchEl.addEventListener("input", () => {
  window.clearTimeout(searchTimer);
  window.clearTimeout(suggestLoadingTimer);
  const value = searchEl.value;
  if (!value.trim()) {
    suggestAbort?.abort();
    suggestions = [];
    suggestionQuery = "";
    activeSuggest = -1;
    if (document.activeElement === searchEl) showSuggestStatus("Type a product, brand, or aisle.");
    else closeSuggestions();
    return;
  }
  searchTimer = window.setTimeout(() => void loadSuggestions(value), SUGGEST_DEBOUNCE_MS);
});

searchEl.addEventListener("focus", () => {
  if (!searchEl.value.trim()) showSuggestStatus("Type a product, brand, or aisle.");
  else if (suggestions.length > 0 && suggestionQuery === searchEl.value.trim()) renderSuggestionRows(suggestionQuery);
});

searchEl.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!suggestPanel.hidden) {
      event.preventDefault();
      closeSuggestions();
    }
    return;
  }
  const open = !suggestPanel.hidden && !suggestionsEl.hidden && suggestions.length > 0;
  if (!open) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    activeSuggest = nextSuggestIndex(activeSuggest, suggestions.length, event.key);
    paintActiveSuggest();
  } else if (event.key === "Enter" && activeSuggest >= 0) {
    event.preventDefault();
    chooseSuggestion(activeSuggest);
  }
});

suggestPanel.addEventListener("mousedown", (event) => {
  event.preventDefault();
});

sortEl.addEventListener("change", () => void loadPage(true));
$("filters").addEventListener("submit", (event) => {
  event.preventDefault();
  openFilters(false);
  void loadPage(true);
});
$("filters-clear").addEventListener("click", () => {
  $("filter-store").value = "";
  $("filter-brand").value = "";
  $("filter-sub").value = "";
  $("filter-size").value = "any";
  $("filter-min").value = "";
  $("filter-max").value = "";
  $("filter-sale").checked = false;
  $("filter-store-brand").checked = false;
  openFilters(false);
  void loadPage(true);
});
$("filters-open").addEventListener("click", () => openFilters(!$("filters").classList.contains("open")));
$("filters-close").addEventListener("click", () => openFilters(false));
$("list-toggle").addEventListener("click", () => openList(!listPanel.classList.contains("open")));
$("list-bar-btn").addEventListener("click", () => openList(true));
$("list-close").addEventListener("click", () => openList(false));
$("coverage-open").addEventListener("click", openCoverage);
planBtn.addEventListener("click", () => void planTrip());
$("sample-btn").addEventListener("click", () => void addSample());
allowSubsEl.addEventListener("change", () => {
  localStorage.setItem(SUBS_KEY, allowSubsEl.checked ? "1" : "0");
  renderEstimate();
});
listAlertsEl?.addEventListener("change", () => {
  localStorage.setItem(ALERTS_KEY, listAlertsEl.checked ? "1" : "0");
  renderListRows();
  saveList();
});
listItemsEl.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.dataset.watch) {
    const entry = list.get(target.dataset.watch);
    if (!entry) return;
    entry.watch = nextItemWatch(Boolean(listAlertsEl?.checked), target.checked);
    saveList();
    return;
  }
  if (target.dataset.target) {
    const entry = list.get(target.dataset.target);
    if (!entry) return;
    entry.targetPrice = parseTargetPrice(target.value);
    saveList();
  }
});
alertsToggle?.addEventListener("click", () => void openAlerts(!alertsDialog?.open));
$("alerts-close")?.addEventListener("click", () => openAlerts(false));
alertsDialog?.addEventListener("close", () => alertsToggle?.setAttribute("aria-expanded", "false"));
$("push-btn")?.addEventListener("click", () => void enablePush());
zipEl.addEventListener("change", () => {
  const zip = normalizeZip(zipEl.value);
  zipEl.value = zip;
  if (ZIP_PATTERN.test(zip)) localStorage.setItem(ZIP_KEY, zip);
  scheduleWatchSync();
  void loadPage(true);
});
$("theme-btn").addEventListener("click", () => {
  applyTheme(nextTheme(document.documentElement.dataset.theme || "system"));
});

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (parseThemeChoice(document.documentElement.dataset.theme) === "system") applyTheme("system");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
    event.preventDefault();
    searchEl.focus();
  }
});

const observer = new IntersectionObserver((entries) => {
  if (entries.some((entry) => entry.isIntersecting)) void loadPage(false);
});
observer.observe(sentinelEl);

function paintAlertBadge() {
  const badge = $("alerts-badge");
  if (!badge || !alertsToggle) return;
  if (unreadAlerts > 0) {
    badge.hidden = false;
    badge.textContent = unreadAlerts > 9 ? "9+" : String(unreadAlerts);
    alertsToggle.setAttribute("aria-label", `Price alerts, ${unreadAlerts} new`);
  } else {
    badge.hidden = true;
    badge.textContent = "0";
    alertsToggle.setAttribute("aria-label", "Price alerts");
  }
}

function paintAlertList() {
  if (!alertsListEl || !alertsEmptyEl) return;
  alertsEmptyEl.hidden = priceAlerts.length > 0;
  alertsListEl.innerHTML = priceAlerts
    .map((alert) => {
      const target = alert.hitTarget ? `<p class="muted">Under your target</p>` : "";
      return `<li class="alert-row">
        <div>
          <strong>${escapeHtml(alert.itemName)}</strong>
          <p class="muted">${escapeHtml(alert.storeName)}</p>
          ${target}
        </div>
        <div class="alert-prices">
          <p><span class="muted">Old</span> ${money(alert.oldPrice)}</p>
          <p><span class="muted">New</span> <strong>${money(alert.newPrice)}</strong></p>
          <p class="savings-badge">Save ${money(alert.savings)}</p>
        </div>
      </li>`;
    })
    .join("");
}

async function refreshAlerts() {
  try {
    const response = await fetch(`/api/price-alerts?deviceId=${encodeURIComponent(deviceId())}`);
    if (!response.ok) return;
    const body = await response.json();
    priceAlerts = Array.isArray(body.alerts) ? body.alerts : [];
    unreadAlerts = Number(body.unread) || 0;
    paintAlertBadge();
    if (alertsDialog?.open) paintAlertList();
  } catch {
    /* the badge updates on the next pass */
  }
}

async function openAlerts(show) {
  if (!alertsDialog || !alertsToggle) return;
  alertsToggle.setAttribute("aria-expanded", show ? "true" : "false");
  if (!show) {
    if (alertsDialog.open) alertsDialog.close();
    return;
  }
  await refreshAlerts();
  paintAlertList();
  if (!alertsDialog.open) alertsDialog.showModal();
  const unseen = priceAlerts.filter((alert) => !alert.seen).map((alert) => alert.id);
  if (unseen.length === 0) return;
  try {
    await fetch("/api/price-alerts/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: deviceId(), ids: unseen }),
    });
    priceAlerts = priceAlerts.map((alert) => ({ ...alert, seen: true }));
    unreadAlerts = 0;
    paintAlertBadge();
  } catch {
    /* the badge clears the next time the panel opens */
  }
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index);
  return output;
}

async function loadPushStatus() {
  const row = $("push-row");
  try {
    const response = await fetch("/api/price-alerts/status");
    if (!response.ok) return;
    const body = await response.json();
    pushPublicKey = body.webPush?.publicKey || "";
    if (row) row.hidden = !body.webPush?.enabled;
    const button = $("push-btn");
    if (button && localStorage.getItem(PUSH_KEY) === "1") button.textContent = "Notifications on";
  } catch {
    if (row) row.hidden = true;
  }
}

async function enablePush() {
  const note = $("push-note");
  const button = $("push-btn");
  if (!pushPublicKey || !("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined") {
    if (note) note.textContent = "This browser cannot receive notifications. Alerts still show in this panel.";
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    if (note) note.textContent = "Notifications stay off until you allow them. Alerts still show in this panel.";
    return;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(pushPublicKey),
    });
    const json = subscription.toJSON();
    const response = await fetch("/api/price-alerts/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: deviceId(), subscription: json }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Could not save this device.");
    localStorage.setItem(PUSH_KEY, "1");
    if (button) button.textContent = "Notifications on";
    if (note) note.textContent = "This browser will get a notification when a price drops.";
  } catch (error) {
    if (note) note.textContent = error instanceof Error ? error.message : "Could not turn on notifications.";
  }
}

async function boot() {
  applyTheme(localStorage.getItem(THEME_KEY) || "system");
  zipEl.value = localStorage.getItem(ZIP_KEY) || "";
  allowSubsEl.checked = localStorage.getItem(SUBS_KEY) === "1";
  if (listAlertsEl) listAlertsEl.checked = localStorage.getItem(ALERTS_KEY) === "1";
  let savedRows = [];
  try {
    savedRows = JSON.parse(localStorage.getItem(LIST_KEY) || "[]");
  } catch {
    savedRows = [];
  }
  listLoading = Array.isArray(savedRows) && savedRows.some((row) => row?.id);
  renderEstimate();
  const deptResponse = await fetch("/api/catalog/departments");
  const deptBody = await deptResponse.json();
  departments = deptBody.departments ?? [];
  renderDepartments();
  await restoreList();
  listLoading = false;
  listReady = true;
  renderEstimate();
  saveList();
  await refreshAlerts();
  await loadPushStatus();
  await loadPage(true);
  if (new URLSearchParams(location.search).get("alerts") === "1") void openAlerts(true);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "price-alerts") void openAlerts(true);
    });
  }
  window.setInterval(() => void refreshAlerts(), 60_000);
}

void boot();
