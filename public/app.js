import { describeSavings, estimateSavings, formatMoney } from "./shopper/savingsMeter.js";
import {
  highlightMatch,
  nextSuggestIndex,
  SUGGEST_DEBOUNCE_MS,
  suggestionFacts,
  suggestionPriceLabel,
} from "./shopper/typeahead.js";
import {
  nextTheme,
  parseThemeChoice,
  THEME_KEY,
  themeButtonLabel,
  themeColor,
  themeGlyph,
  themeIsDark,
} from "./shopper/theme.js";
import {
  attributionLine,
  deliverShare,
  isShareCancel,
  listTokenFromPath,
  mergeSnapshot,
  sharePageUrl,
  visibleItems,
} from "./shopper/shareList.js";

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
const listPanel = $("list-panel");
const toastEl = $("toast");
const productDialog = $("product-dialog");
const coverageDialog = $("coverage-dialog");

const ZIP_KEY = "gg-zip";
const LIST_KEY = "gg-list";
const SUBS_KEY = "gg-subs";
const SHARE_KEY = "gg-share";
const OWNER_KEY = "gg-owner";
const NAME_KEY = "gg-display-name";
const PERSONAL_KEY = "gg-list-personal";
const ZIP_PATTERN = /^\d{5}(?:-\d{4})?$/;

function isNative() {
  return window.Capacitor?.isNativePlatform?.() === true;
}

function apiOrigin() {
  return window.GroceryGitterNative.resolveApiOrigin({
    native: isNative(),
    location: window.location,
    configured: window.GROCERY_GITTER_API_ORIGIN,
  });
}

function apiUrl(path) {
  const origin = apiOrigin();
  return origin ? `${origin}${path}` : path;
}

function mediaUrl(url) {
  return window.GroceryGitterNative.resolveMediaUrl(url, apiOrigin());
}

async function openExternal(url) {
  const browser = window.Capacitor?.Plugins?.Browser;
  if (isNative() && browser?.open) {
    await browser.open({ url });
    return;
  }
  window.open(url, "_blank", "noopener");
}

async function syncSystemBars(dark) {
  const systemBars = window.Capacitor?.Plugins?.SystemBars;
  if (!isNative() || !systemBars?.setStyle) return;
  try {
    await systemBars.setStyle({ style: dark ? "DARK" : "LIGHT" });
  } catch {
    /* status bar styling is native-only */
  }
}

async function hideSplash() {
  const splash = window.Capacitor?.Plugins?.SplashScreen;
  if (!isNative() || !splash?.hide) return;
  try {
    await splash.hide();
  } catch {
    /* splash already hidden */
  }
}

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
/** @type {Array<Record<string, any>>} */
let suggestions = [];
/** Query the current suggestion rows belong to. */
let suggestionQuery = "";
/** @type {{ shareToken: string, mode?: string, role?: string, canEdit: boolean, seq: number, revoked: boolean, title?: string } | null} */
let shareState = null;
let applyingRemote = false;
let shareBusy = false;
/** @type {Map<string, Record<string, any>>} */
const pendingWrites = new Map();
let pushTimer = 0;
let pushChain = Promise.resolve();
let pollTimer = 0;
/** @type {EventSource | null} */
let listEvents = null;
let syncGeneration = 0;

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

function apiFetch(path, init) {
  return globalThis.fetch(apiUrl(path), init);
}

function readStoredJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function readDisplayName() {
  const typed = $("display-name")?.value;
  const value = String(typed ?? localStorage.getItem(NAME_KEY) ?? "").trim().slice(0, 40);
  return value;
}

function readOwned() {
  const owned = readStoredJson(OWNER_KEY);
  if (!owned?.ownerToken || !owned?.shareToken) return null;
  return owned;
}

function rememberOwner(shareToken, ownerToken) {
  localStorage.setItem(OWNER_KEY, JSON.stringify({ shareToken, ownerToken }));
}

function rememberSession(state) {
  if (!state?.shareToken) {
    localStorage.removeItem(SHARE_KEY);
    return;
  }
  localStorage.setItem(SHARE_KEY, JSON.stringify({ shareToken: state.shareToken }));
  if (state.role === "owner") {
    const owned = readOwned();
    if (owned?.ownerToken) rememberOwner(state.shareToken, owned.ownerToken);
  }
}

function ownerHeaders(token) {
  const owned = readOwned();
  if (owned?.ownerToken && owned.shareToken === token) return { "x-list-owner": owned.ownerToken };
  return {};
}

function listIsLocked() {
  return Boolean(shareState?.shareToken && !shareState.canEdit);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error("Could not copy the link.");
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

function saveList() {
  const rows = [...list.values()].map((entry) => ({
    id: entry.product.id,
    itemId: entry.itemId || entry.product.id,
    quantity: entry.quantity,
    checked: Boolean(entry.checked),
    addedBy: entry.addedBy,
    checkedBy: entry.checkedBy,
    writtenAt: entry.writtenAt || 0,
    name: entry.product.name,
    brand: entry.product.brand,
    sizeLabel: entry.product.sizeLabel,
  }));
  localStorage.setItem(LIST_KEY, JSON.stringify(rows));
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
  renderShareChrome();
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
  const locked = listIsLocked();
  listItemsEl.innerHTML = [...list.values()]
    .map((entry) => {
      const offer = entry.product.offers?.length ? bestOffer(entry.product) : null;
      const gap = (entry.product.gaps ?? []).find((item) => item.substitute);
      const sub = gap?.substitute
        ? `<p class="gap">Not at ${escapeHtml(gap.storeName)} · substitute ${escapeHtml(gap.substitute.brand)} ${escapeHtml(gap.substitute.name)} ${money(gap.substitute.price)}</p>`
        : "";
      const price = offer ? `<p class="muted">${money(offer.price)} at ${escapeHtml(offer.storeName)}</p>` : "";
      const credit = attributionLine(entry);
      const itemId = entry.itemId || entry.product.id;
      const image = mediaUrl(entry.product.imageUrls?.[0] || "");
      return `<li class="list-row${entry.checked ? " done" : ""}">
        <img src="${escapeHtml(image)}" alt="" />
        <div>
          <label class="got-it">
            <input type="checkbox" data-list-check="${escapeHtml(itemId)}" ${entry.checked ? "checked" : ""} ${locked ? "disabled" : ""} aria-label="Check off ${escapeHtml(entry.product.name)}" />
            <strong>${escapeHtml(entry.product.name)}</strong>
          </label>
          <p class="muted">${escapeHtml(entry.product.brand || "")}${entry.product.sizeLabel ? ` · ${escapeHtml(entry.product.sizeLabel)}` : ""}</p>
          ${price}
          ${credit ? `<p class="muted attribution">${escapeHtml(credit)}</p>` : ""}
          ${sub}
        </div>
        <div class="stepper">
          <button type="button" data-list-dec="${escapeHtml(itemId)}" aria-label="Decrease ${escapeHtml(entry.product.name)}" ${locked ? "disabled" : ""}>−</button>
          <output>${entry.quantity}</output>
          <button type="button" data-list-inc="${escapeHtml(itemId)}" aria-label="Increase ${escapeHtml(entry.product.name)}" ${locked ? "disabled" : ""}>+</button>
        </div>
      </li>`;
    })
    .join("");
}

function setQuantity(id, quantity) {
  const entry = list.get(id);
  if (!entry) return;
  if (listIsLocked()) {
    toast("This list is view-only.");
    return;
  }
  if (quantity < 1) {
    entry.writtenAt = Date.now();
    entry.itemId = entry.itemId || id;
    queueWrite(entry, true);
    list.delete(id);
    toast("Removed from list");
  } else {
    entry.quantity = Math.min(99, quantity);
    entry.writtenAt = Date.now();
    entry.itemId = entry.itemId || entry.product.id;
    queueWrite(entry, false);
  }
  saveList();
  renderEstimate();
  syncCards();
}

function addProduct(product, quantity = 1) {
  if (listIsLocked()) {
    toast("This list is view-only.");
    return;
  }
  const existing = list.get(product.id);
  const next = Math.min(99, (existing?.quantity ?? 0) + quantity);
  const entry = {
    product,
    quantity: existing ? next : Math.max(1, quantity),
    itemId: existing?.itemId || product.id,
    checked: existing?.checked ?? false,
    addedBy: existing?.addedBy || readDisplayName() || undefined,
    checkedBy: existing?.checkedBy,
    writtenAt: Date.now(),
  };
  list.set(product.id, entry);
  productsById.set(product.id, product);
  saveList();
  renderEstimate();
  syncCards();
  queueWrite(entry, false);
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
      <img src="${escapeHtml(mediaUrl(product.imageUrls?.[0] || ""))}" alt="" />
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
    const response = await fetch(apiUrl(`/api/catalog/browse?${params.toString()}`));
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
    const zipOk = ZIP_PATTERN.test(normalizeZip(zipEl.value));
    const weeklyAds = (coverage || []).some((store) => store.mode === "weekly_ad_only");
    const zipWarning = (body.warnings ?? []).find((warning) => /5-digit US ZIP/i.test(warning));
    if (!zipOk && weeklyAds) {
      coverageBannerEl.textContent = zipWarning || "Enter a 5-digit ZIP to load this week’s Target, Aldi, and other circular prices. Without a ZIP those stores stay on the demo catalog. A weekly ad is not a full shelf.";
    } else if (demo) {
      coverageBannerEl.textContent = "Demo shelves — store prices here are samples until Walmart, Kroger, or a partner feed is configured. Open Coverage for what each store can actually browse.";
    } else if (catalogSource === "database") {
      coverageBannerEl.textContent = "Prices from Grocery Gitter’s saved catalog, plus weekly-ad items when this ZIP has a circular. Target and Aldi are not a full live shelf.";
    } else if (catalogSource === "mixed") {
      coverageBannerEl.textContent = "Live samples are mixed with the demo catalog. Weekly-ad prices are labeled Weekly ad, not a live shelf.";
    } else {
      coverageBannerEl.textContent = "Live catalog sample. This is not a full store assortment.";
    }
    const hardWarnings = (body.warnings ?? []).filter((warning) => !/5-digit US ZIP/i.test(warning));
    if (hardWarnings.length) {
      showCatalogError(hardWarnings.join(" "));
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
        ? `<img src="${escapeHtml(mediaUrl(item.imageUrl))}" alt="" />`
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
    const response = await fetch(apiUrl(`/api/catalog/suggest?q=${encodeURIComponent(q)}`), { signal: controller.signal });
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
    <img class="hero" src="${escapeHtml(mediaUrl(product.imageUrls?.[0] || ""))}" alt="" />
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
      const productToAdd = known || (await fetch(apiUrl(`/api/catalog/products/${encodeURIComponent(id)}`)).then((r) => r.json())).product;
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
  if (source === "unavailable") return "badge-demo";
  return "badge-demo";
}

function checkedStoresHtml(payload, shown) {
  const reports = payload.pricingByStore ?? [];
  const shownNames = new Set(shown.map((store) => store.storeName));
  const extras = reports.filter((report) => !shownNames.has(report.storeName));
  if (!extras.length) return "";
  return `<h3>Also checked</h3><ul class="offer-list">${extras
    .map(
      (report) => `<li><span><strong>${escapeHtml(report.storeName)}</strong> · ${escapeHtml(report.label || "Unavailable")}<br /><span class="muted">${escapeHtml(report.detail || "")}</span></span></li>`
    )
    .join("")}</ul>`;
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
    ${checkedStoresHtml(payload, stores)}
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
        ${store.pricing?.detail ? `<p class="muted">${escapeHtml(store.pricing.detail)}</p>` : ""}
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
    const status = await fetch(apiUrl("/api/instacart/status")).then((response) => response.json().catch(() => ({ enabled: false })));
    instacartEnabled = Boolean(status.enabled);
    const response = await fetch(apiUrl("/api/optimize-list"), {
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
    const response = await fetch(apiUrl("/api/instacart/shopping-list"), {
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
    await openExternal(body.productsLinkUrl);
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
    const response = await fetch(apiUrl("/api/kroger/cart/start"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: store.handoff?.items ?? store.items, locationId: store.items?.[0]?.locationId }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Kroger cart did not start.");
    if (body.authorizeUrl) {
      if (isNative()) {
        await openExternal(body.authorizeUrl);
        return;
      }
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
  void syncSystemBars(dark);
}

function queueWrite(entry, deleted = false) {
  if (applyingRemote || !shareState?.shareToken || !shareState.canEdit || shareState.revoked) return;
  const write = toWrite(entry, deleted);
  pendingWrites.set(write.itemId, write);
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    pushChain = pushChain.then(() => flushWrites()).catch(() => {});
  }, 250);
}

function toWrite(entry, deleted = false) {
  return {
    itemId: entry.itemId || entry.product.id,
    catalogId: entry.product.id,
    name: entry.product.name,
    brand: entry.product.brand || undefined,
    sizeLabel: entry.product.sizeLabel || undefined,
    quantity: Math.max(1, Number(entry.quantity) || 1),
    checked: Boolean(entry.checked),
    writtenAt: entry.writtenAt || Date.now(),
    deleted: Boolean(deleted),
  };
}

function stubFromItem(item) {
  return {
    id: item.catalogId || item.itemId || item.id,
    name: item.name || "Item",
    brand: item.brand || "",
    sizeLabel: item.sizeLabel || "",
    imageUrls: [],
    offers: [],
    gaps: [],
  };
}

function localSnapshot() {
  const byId = new Map();
  for (const entry of list.values()) {
    const item = toWrite(entry, false);
    byId.set(item.itemId, item);
  }
  for (const write of pendingWrites.values()) {
    const current = byId.get(write.itemId);
    if (!current || Number(write.writtenAt) >= Number(current.writtenAt)) byId.set(write.itemId, write);
  }
  return [...byId.values()];
}

function applyServerList(body) {
  if (!body?.shareToken || !Array.isArray(body.items)) return;
  const previousProducts = new Map(
    [...list.values()].map((entry) => [entry.itemId || entry.product.id, entry.product])
  );
  const remoteById = new Map(body.items.map((item) => [item.itemId, item]));
  for (const [id, write] of [...pendingWrites]) {
    const remote = remoteById.get(id);
    if (remote && Number(remote.writtenAt) >= Number(write.writtenAt)) pendingWrites.delete(id);
  }
  const merged = visibleItems(mergeSnapshot(localSnapshot(), body.items, new Set(pendingWrites.keys())));
  shareState = {
    shareToken: body.shareToken,
    mode: body.mode,
    role: body.role,
    canEdit: Boolean(body.canEdit),
    seq: Number(body.seq) || 0,
    revoked: Boolean(body.revoked),
    title: body.title || "Shopping list",
  };
  rememberSession(shareState);
  applyingRemote = true;
  list.clear();
  for (const item of merged) {
    const known = previousProducts.get(item.itemId);
    const product = known?.offers?.length ? known : productsById.get(item.catalogId || item.itemId)?.offers?.length
      ? productsById.get(item.catalogId || item.itemId)
      : stubFromItem(item);
    const entry = {
      product,
      quantity: Math.max(1, Number(item.quantity) || 1),
      itemId: item.itemId,
      checked: Boolean(item.checked),
      addedBy: item.addedBy,
      checkedBy: item.checkedBy,
      writtenAt: Number(item.writtenAt) || 0,
    };
    list.set(entry.itemId, entry);
    productsById.set(product.id, product);
  }
  applyingRemote = false;
  saveList();
  renderEstimate();
  syncCards();
  void hydrateSharedProducts();
}

async function hydrateSharedProducts() {
  const ids = [...new Set([...list.values()].map((entry) => entry.product?.id).filter(Boolean))];
  await Promise.all(
    ids.map(async (id) => {
      const known = productsById.get(id);
      if (known?.offers?.length) return;
      try {
        const response = await apiFetch(`/api/catalog/products/${encodeURIComponent(id)}`);
        if (!response.ok) return;
        const body = await response.json();
        if (!body.product?.id) return;
        productsById.set(body.product.id, body.product);
        const entry = list.get(body.product.id) || [...list.values()].find((row) => row.product?.id === body.product.id);
        if (entry) entry.product = body.product;
      } catch {
        /* the shared name still shows if the catalog misses */
      }
    })
  );
  renderEstimate();
  syncCards();
}

async function flushWrites() {
  if (!shareState?.shareToken || !shareState.canEdit || pendingWrites.size === 0) return;
  const writes = [...pendingWrites.values()];
  const token = shareState.shareToken;
  pendingWrites.clear();
  let response;
  try {
    response = await apiFetch(`/api/lists/${encodeURIComponent(token)}/items`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...ownerHeaders(token) },
      body: JSON.stringify({ displayName: readDisplayName() || undefined, items: writes }),
    });
  } catch {
    for (const write of writes) pendingWrites.set(write.itemId, write);
    toast("Could not reach the shared list.");
    return;
  }
  const body = await response.json().catch(() => ({}));
  if (response.status === 410) {
    handleRevoked(token);
    return;
  }
  if (response.status === 403) {
    shareState.canEdit = false;
    shareState.mode = "view";
    toast(body.error || "This list is view-only.");
    renderEstimate();
    void pullList();
    return;
  }
  if (response.status === 429 || response.status === 409) {
    for (const write of writes) {
      const newer = pendingWrites.get(write.itemId);
      if (!newer || write.writtenAt > newer.writtenAt) pendingWrites.set(write.itemId, write);
    }
    toast(body.error || "Could not update the shared list.");
    window.setTimeout(() => {
      pushChain = pushChain.then(() => flushWrites()).catch(() => {});
    }, 2000);
    return;
  }
  if (!response.ok) {
    for (const write of writes) {
      const newer = pendingWrites.get(write.itemId);
      if (!newer || write.writtenAt > newer.writtenAt) pendingWrites.set(write.itemId, write);
    }
    toast(body.error || "Could not update the shared list.");
    return;
  }
  applyServerList(body);
}

function stopSync() {
  syncGeneration += 1;
  window.clearInterval(pollTimer);
  pollTimer = 0;
  const source = listEvents;
  listEvents = null;
  source?.close();
}

function startPolling(generation) {
  window.clearInterval(pollTimer);
  pollTimer = window.setInterval(() => {
    if (generation !== syncGeneration || document.hidden) return;
    void pullList();
  }, 4000);
}

function startSync() {
  stopSync();
  if (!shareState?.shareToken || shareState.revoked) return;
  const generation = syncGeneration;
  const token = shareState.shareToken;
  if (typeof EventSource === "function") {
    try {
      const source = new EventSource(apiUrl(`/api/lists/${encodeURIComponent(token)}/events`));
      if (generation !== syncGeneration) {
        source.close();
        return;
      }
      listEvents = source;
      source.addEventListener("list", () => {
        if (generation === syncGeneration) void pullList();
      });
      source.onerror = () => {
        if (generation !== syncGeneration) return;
        source.close();
        if (listEvents === source) listEvents = null;
        startPolling(generation);
      };
      return;
    } catch {
      startPolling(generation);
      return;
    }
  }
  startPolling(generation);
}

async function pullList() {
  if (!shareState?.shareToken || shareState.revoked) return;
  const token = shareState.shareToken;
  let response;
  try {
    response = await apiFetch(`/api/lists/${encodeURIComponent(token)}?since=${shareState.seq || 0}`, {
      headers: ownerHeaders(token),
    });
  } catch {
    return;
  }
  if (response.status === 410) {
    handleRevoked(token);
    return;
  }
  if (!response.ok) return;
  const body = await response.json().catch(() => ({}));
  if (body.changed === false) {
    shareState.mode = body.mode ?? shareState.mode;
    shareState.canEdit = body.canEdit ?? shareState.canEdit;
    shareState.role = body.role ?? shareState.role;
    shareState.revoked = Boolean(body.revoked);
    renderShareChrome();
    return;
  }
  applyServerList(body);
}

function handleRevoked(token) {
  stopSync();
  const owner = readOwned()?.shareToken === token;
  shareState = {
    shareToken: token,
    revoked: true,
    canEdit: false,
    role: owner ? "owner" : "guest",
    mode: "view",
    seq: shareState?.seq || 0,
    title: shareState?.title || "Shopping list",
  };
  rememberSession(shareState);
  toast("This link was turned off.");
  renderShareChrome();
}

async function openSharedList(token, { mergeLocal = false } = {}) {
  const savedShare = readStoredJson(SHARE_KEY)?.shareToken;
  if (!mergeLocal && savedShare !== token) {
    const current = localStorage.getItem(LIST_KEY);
    if (current && current !== "[]" && !localStorage.getItem(PERSONAL_KEY)) {
      localStorage.setItem(PERSONAL_KEY, current);
    }
  } else {
    for (const entry of list.values()) {
      entry.itemId = entry.itemId || entry.product.id;
      if (!entry.writtenAt) entry.writtenAt = 1;
      pendingWrites.set(entry.itemId, toWrite(entry, false));
    }
  }
  let response;
  try {
    response = await apiFetch(`/api/lists/${encodeURIComponent(token)}`, { headers: ownerHeaders(token) });
  } catch {
    toast("Could not open that shared list.");
    return;
  }
  const body = await response.json().catch(() => ({}));
  if (response.status === 410) {
    handleRevoked(token);
    openList(true);
    return;
  }
  if (!response.ok) {
    toast(body.error || "That shared list could not be opened.");
    return;
  }
  applyServerList(body);
  if (shareState?.canEdit) await flushWrites();
  startSync();
  openList(true);
}

async function postList(extra = {}) {
  const owned = readOwned();
  const resuming = Boolean(extra.ownerToken || extra.shareToken || owned?.ownerToken);
  for (const entry of list.values()) {
    entry.itemId = entry.itemId || entry.product.id;
    entry.writtenAt = entry.writtenAt || (resuming ? 1 : Date.now());
    pendingWrites.set(entry.itemId, toWrite(entry, false));
  }
  const response = await apiFetch("/api/lists", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ownerToken: extra.ownerToken || owned?.ownerToken,
      shareToken: extra.shareToken || owned?.shareToken,
      displayName: readDisplayName() || undefined,
      title: "Shopping list",
      items: [...list.values()].map((entry) => toWrite(entry, false)),
      rotate: Boolean(extra.rotate),
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    toast(body.error || "Could not share this list.");
    return null;
  }
  if (body.ownerToken && body.shareToken) rememberOwner(body.shareToken, body.ownerToken);
  applyServerList(body.list);
  if (shareState?.canEdit) await flushWrites();
  startSync();
  return body.shareToken || null;
}

async function postSettings(body) {
  if (!shareState?.shareToken) return null;
  const owned = readOwned();
  const response = await apiFetch(`/api/lists/${encodeURIComponent(shareState.shareToken)}/settings`, {
    method: "POST",
    headers: { "content-type": "application/json", ...ownerHeaders(shareState.shareToken) },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    toast(payload.error || "Could not update the link.");
    return null;
  }
  if (payload.shareToken && owned?.ownerToken) rememberOwner(payload.shareToken, owned.ownerToken);
  applyServerList(payload.list);
  startSync();
  return payload;
}

function renderShareChrome() {
  const status = $("share-status");
  const viewBtn = $("share-viewonly");
  const revokeBtn = $("share-revoke");
  const ownBtn = $("share-own");
  const shareBtn = $("share-btn");
  if (!status || !shareBtn) return;
  const shared = Boolean(shareState?.shareToken);
  const owner = Boolean(shared && (shareState.role === "owner" || readOwned()?.shareToken === shareState.shareToken));
  if (!shared) {
    status.textContent = "Share a link so someone else can shop this list with you.";
  } else if (shareState.revoked) {
    status.textContent = owner ? "This link is off. Share again to make a new one." : "This link was turned off.";
  } else if (shareState.mode === "view") {
    status.textContent = owner ? "Anyone with the link can look. Only you can change it." : "This shared list is view-only.";
  } else {
    status.textContent = owner ? "Anyone with the link can change this list." : "You're editing a shared list.";
  }
  if (viewBtn) {
    viewBtn.hidden = !owner || shareState.revoked;
    viewBtn.textContent = shareState?.mode === "view" ? "Allow editing" : "Make view-only";
  }
  if (revokeBtn) revokeBtn.hidden = !owner || shareState.revoked;
  if (ownBtn) ownBtn.hidden = !(localStorage.getItem(PERSONAL_KEY) && shared && !owner);
  shareBtn.disabled = shareBusy;
  shareBtn.textContent = shareState?.revoked && owner ? "Share a new link" : "Share list";
  if (listEmptyEl) {
    listEmptyEl.textContent = listIsLocked()
      ? "This list is view-only."
      : shared
        ? "Changes here show up for everyone on the link."
        : "Check items while you browse. Quantities stay on this device until you share.";
  }
}

async function onShareClick() {
  if (shareBusy) return;
  shareBusy = true;
  renderShareChrome();
  try {
    await flushWrites();
    let token = shareState?.shareToken;
    const owned = readOwned();
    const ownerHere = shareState?.role === "owner" || owned?.shareToken === token;
    if (shareState?.revoked && ownerHere) {
      token = await postList({ rotate: true, ownerToken: owned?.ownerToken, shareToken: token });
    } else if (!token) {
      token = await postList(owned?.ownerToken && !owned.shareToken ? { rotate: true } : {});
    }
    if (!token) return;
    const url = sharePageUrl(token, { apiOrigin: apiOrigin(), locationHref: window.location.href });
    try {
      const how = await deliverShare(
        {
          title: "Grocery Gitter list",
          text: "Shop this list with me",
          url,
          dialogTitle: "Share list",
        },
        {
          capacitorShare: window.Capacitor?.Plugins?.Share,
          navigatorShare: typeof navigator.share === "function" ? (data) => navigator.share(data) : undefined,
          copy: copyText,
        }
      );
      toast(how === "copy" ? "Link copied." : "Choose who to send the list to.");
    } catch (error) {
      if (isShareCancel(error)) return;
      await copyText(url);
      toast("Link copied.");
    }
  } catch (error) {
    toast(error instanceof Error ? error.message : "Could not share the list.");
  } finally {
    shareBusy = false;
    renderShareChrome();
  }
}

async function useOwnList() {
  stopSync();
  pendingWrites.clear();
  shareState = null;
  localStorage.removeItem(SHARE_KEY);
  const personal = localStorage.getItem(PERSONAL_KEY);
  if (personal) {
    localStorage.setItem(LIST_KEY, personal);
    localStorage.removeItem(PERSONAL_KEY);
  }
  list.clear();
  if (window.location.pathname.startsWith("/list/")) {
    history.pushState({}, "", "/");
  }
  await restoreList();
  const owned = readOwned();
  if (owned?.shareToken) await openSharedList(owned.shareToken, { mergeLocal: true });
  else renderEstimate();
}

function toggleChecked(itemId, checked) {
  const entry = list.get(itemId);
  if (!entry) return;
  if (listIsLocked()) {
    toast("This list is view-only.");
    renderEstimate();
    return;
  }
  entry.checked = checked;
  entry.checkedBy = checked ? readDisplayName() || undefined : undefined;
  entry.writtenAt = Date.now();
  entry.itemId = entry.itemId || itemId;
  saveList();
  renderEstimate();
  queueWrite(entry, false);
}

function rememberLocalRow(row) {
  const product = stubFromItem(row);
  const itemId = row.itemId || row.id || product.id;
  list.set(itemId, {
    product,
    quantity: Math.max(1, Number(row.quantity) || 1),
    itemId,
    checked: Boolean(row.checked),
    addedBy: row.addedBy,
    checkedBy: row.checkedBy,
    writtenAt: Number(row.writtenAt) || 0,
  });
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
      if (!row?.id && !row?.itemId) return;
      const id = row.id || row.itemId;
      try {
        const response = await fetch(apiUrl(`/api/catalog/products/${encodeURIComponent(id)}`));
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.product?.id) {
          if (row.name) rememberLocalRow(row);
          return;
        }
        productsById.set(body.product.id, body.product);
        list.set(body.product.id, {
          product: body.product,
          quantity: Math.max(1, Number(row.quantity) || 1),
          itemId: row.itemId || body.product.id,
          checked: Boolean(row.checked),
          addedBy: row.addedBy,
          checkedBy: row.checkedBy,
          writtenAt: Number(row.writtenAt) || 0,
        });
      } catch {
        if (row.name) rememberLocalRow(row);
      }
    })
  );
  renderEstimate();
}

async function addSample() {
  if (listIsLocked()) {
    toast("This list is view-only.");
    return;
  }
  const response = await fetch(apiUrl("/api/catalog/browse?limit=48"));
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
  const anchor = target.closest("a[href]");
  if (anchor && isNative()) {
    const legal = window.GroceryGitterNative.bundledLegalPath(new URL(anchor.href).pathname);
    if (legal) {
      event.preventDefault();
      window.location.href = legal;
      return;
    }
    if (window.GroceryGitterNative.isExternalNavigation(anchor.href, window.location.href)) {
      event.preventDefault();
      void openExternal(anchor.href);
      return;
    }
  }
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

listItemsEl.addEventListener("change", (event) => {
  const box = event.target;
  if (!(box instanceof HTMLInputElement) || !box.dataset.listCheck) return;
  toggleChecked(box.dataset.listCheck, box.checked);
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
$("share-btn")?.addEventListener("click", () => void onShareClick());
$("share-viewonly")?.addEventListener("click", () => {
  if (!shareState) return;
  void postSettings({ mode: shareState.mode === "view" ? "edit" : "view" });
});
$("share-revoke")?.addEventListener("click", () => {
  if (!window.confirm("Turn off this link? People who have it will lose access.")) return;
  void postSettings({ revoke: true });
});
$("share-own")?.addEventListener("click", () => void useOwnList());
$("display-name")?.addEventListener("change", () => {
  localStorage.setItem(NAME_KEY, readDisplayName());
});
allowSubsEl.addEventListener("change", () => {
  localStorage.setItem(SUBS_KEY, allowSubsEl.checked ? "1" : "0");
  renderEstimate();
});
zipEl.addEventListener("change", () => {
  const zip = normalizeZip(zipEl.value);
  zipEl.value = zip;
  if (ZIP_PATTERN.test(zip)) localStorage.setItem(ZIP_KEY, zip);
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

async function boot() {
  applyTheme(localStorage.getItem(THEME_KEY) || "system");
  zipEl.value = localStorage.getItem(ZIP_KEY) || "";
  allowSubsEl.checked = localStorage.getItem(SUBS_KEY) === "1";
  const nameEl = $("display-name");
  if (nameEl) nameEl.value = localStorage.getItem(NAME_KEY) || "";
  const urlToken = listTokenFromPath(window.location.pathname);
  let savedRows = [];
  try {
    savedRows = JSON.parse(localStorage.getItem(LIST_KEY) || "[]");
  } catch {
    savedRows = [];
  }
  listLoading = !urlToken && Array.isArray(savedRows) && savedRows.some((row) => row?.id || row?.itemId);
  renderEstimate();
  const deptResponse = await fetch(apiUrl("/api/catalog/departments"));
  const deptBody = await deptResponse.json();
  departments = deptBody.departments ?? [];
  renderDepartments();
  const savedShare = readStoredJson(SHARE_KEY)?.shareToken;
  const ownedShare = readOwned()?.shareToken;
  if (urlToken) {
    const sameList = savedShare === urlToken || ownedShare === urlToken;
    if (sameList) await restoreList();
    await openSharedList(urlToken, { mergeLocal: sameList });
  } else {
    await restoreList();
    const resumeToken = savedShare || ownedShare;
    if (resumeToken) await openSharedList(resumeToken, { mergeLocal: true });
  }
  listLoading = false;
  renderEstimate();
  await loadPage(true);
  if (!isNative() && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

void boot().finally(() => {
  void hideSplash();
});
