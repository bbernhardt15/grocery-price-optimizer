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
import {
  attributionLine,
  deliverShare,
  isShareCancel,
  listTokenFromPath,
  mergeSnapshot,
  sharePageUrl,
  visibleItems,
} from "./shopper/shareList.js";
import {
  alertsEmptyChoice,
  catalogEmptyKind,
  emptyState,
  emptyStateInner,
  emptyStateMarkup,
  networkKind,
  searchEmpty,
  tripStoreEmpty,
} from "./shopper/emptyStates.js";
import { mountWelcome } from "./shopper/onboardingUi.js";
import {
  applyTripEdits,
  formatTripText,
  groupForAisle,
  moveOptionLabel,
  priceSourceLabel,
  readChecks,
  readTripSnapshot,
  saveTripSnapshot,
  shareItemId,
  consolidateStops,
  singleStoreSavings,
  swapSentence,
  tripFingerprint,
  tripStory,
  writeCheck,
} from "./shopper/tripPlan.js";
import { pathWithoutSession, sessionFromSearch, SESSION_KEY } from "./shopper/account.js";
import { packageChoices, paywallView, platformOf, sdkKeyFor } from "./shopper/billing.js";
import { listItemTitle, stagedQuantity } from "./shopper/familyTile.js";
import { selectBestValue, unitSortLabel, valueRow } from "./shopper/bestValue.js";

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
const WATCH_LIST_KEY = "gg-watch-list";
const SHARE_KEY = "gg-share";
const OWNER_KEY = "gg-owner";
const NAME_KEY = "gg-display-name";
const PERSONAL_KEY = "gg-list-personal";
const REMOVED_KEY = "gg-list-removed";
const REVISION_KEY = "gg-list-revision";
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
const familiesByKey = new Map();
let departments = [];
let activeDepartment = "all";
let query = "";
let nextCursor = null;
let loading = false;
let total = 0;
let coverage = [];
let weeklyAdBanners = [];
let catalogSource = "demo";
let instacartEnabled = false;
/** @type {Record<string, any> | null} */
let lastOptimize = null;
let tripEdits = { lockedStore: null, moves: {} };
let searchTimer = 0;
let suggestLoadingTimer = 0;
let suggestAbort = null;
let activeSuggest = -1;
let listLoading = false;
let listReady = false;
let watchTimer = 0;
let deletingData = false;
let unreadAlerts = 0;
/** @type {Array<Record<string, any>>} */
let priceAlerts = [];
let alertsLoadError = "";
let pushPublicKey = "";
/** @type {Array<Record<string, any>>} */
let suggestions = [];
/** Query the current suggestion rows belong to. */
let suggestionQuery = "";
/** @type {{ shareToken: string, mode?: string, role?: string, canEdit: boolean, seq: number, revoked: boolean, title?: string } | null} */
let shareState = null;
let applyingRemote = false;
let shareBusy = false;
let shareProblem = "";
let shareProblemToken = "";
/** @type {Map<string, Record<string, any>>} */
const pendingWrites = new Map();
let pushTimer = 0;
let pushChain = Promise.resolve();
let pollTimer = 0;
/** @type {EventSource | null} */
let listEvents = null;
let syncGeneration = 0;
/** @type {{ id: string, email?: string, displayName?: string, providers?: string[] } | null} */
let accountState = null;
/** @type {Record<string, any> | null} */
let authStatus = null;
let listRevision = 0;
let listSyncTimer = 0;
let applyingAccount = false;
let arrivedWithSession = false;

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

function fillEmpty(el, state, role) {
  if (!el) return;
  el.className = "empty-state";
  if (role) el.setAttribute("role", role);
  else el.removeAttribute("role");
  el.innerHTML = emptyStateInner(state, escapeHtml);
}

function hasActiveFilters() {
  return Boolean(
    activeDepartment !== "all" ||
      $("filter-store").value ||
      $("filter-brand").value ||
      $("filter-sub").value ||
      ($("filter-size").value && $("filter-size").value !== "any") ||
      $("filter-sale").checked ||
      $("filter-store-brand").checked ||
      $("filter-min").value.trim() ||
      $("filter-max").value.trim()
  );
}

function paintListEmpty() {
  if (!listEmptyEl) return;
  const show = list.size === 0 && !listLoading;
  listEmptyEl.hidden = !show;
  if (!show) return;
  if (listIsLocked()) {
    fillEmpty(listEmptyEl, {
      title: "This list is view-only",
      body: "You can look, but only the owner can add items.",
      action: "Browse the aisle",
      actionId: "browse",
    });
    return;
  }
  fillEmpty(listEmptyEl, emptyState("list"));
}

async function readDeviceCoords() {
  const geo = window.Capacitor?.Plugins?.Geolocation;
  if (geo?.requestPermissions) {
    const perm = await geo.requestPermissions({ permissions: ["coarseLocation"] });
    const state = perm?.coarseLocation || perm?.location;
    if (state === "denied") {
      const error = new Error("Location permission denied");
      error.code = 1;
      throw error;
    }
  }
  if (geo?.getCurrentPosition) {
    const pos = await geo.getCurrentPosition({ enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  }
  if (!navigator.geolocation) throw new Error("Location is unavailable");
  const pos = await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 12000,
      maximumAge: 60000,
    });
  });
  return { lat: pos.coords.latitude, lng: pos.coords.longitude };
}

async function openAuthorize(url) {
  if (isNative()) {
    await openExternal(url);
    return;
  }
  window.location.assign(url);
}

function applyZip(zip, { reload = true } = {}) {
  const normalized = normalizeZip(zip);
  zipEl.value = normalized;
  if (!ZIP_PATTERN.test(normalized)) return;
  localStorage.setItem(ZIP_KEY, normalized);
  scheduleWatchSync();
  if (reload) void loadPage(true);
}

let toastTimer = 0;

function toast(message, durationMs = 1600) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), durationMs);
}

/** OAuth callback lands on /?kroger=added|error&message=… after the cart write. */
function consumeKrogerReturn() {
  const params = new URLSearchParams(window.location.search);
  const kind = params.get("kroger");
  if (kind !== "added" && kind !== "error") return;
  const message = String(params.get("message") || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  params.delete("kroger");
  params.delete("message");
  const query = params.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  history.replaceState({}, "", next);
  const fallback = kind === "added" ? "Kroger accepted the cart." : "Kroger did not add those items.";
  toast(message || fallback, 6500);
}

function readSessionToken() {
  return localStorage.getItem(SESSION_KEY) || "";
}

function apiFetch(path, init = {}) {
  const headers = new Headers(init.headers || {});
  const token = readSessionToken();
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  return globalThis.fetch(apiUrl(path), {
    ...init,
    headers,
    credentials: init.credentials ?? (apiOrigin() ? "omit" : "include"),
  });
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
  if (source === "weekly_ad") return "Weekly ad, not shelf price";
  return "Demo";
}

function badgeLabel(source) {
  if (source === "weekly_ad") return "Weekly ad";
  return sourceLabel(source);
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

function activeListId() {
  if (shareState?.shareToken && !shareState.revoked) return shareState.shareToken;
  return savedListId();
}

function alertFields(source, product) {
  const offer = product?.offers?.length ? bestOffer(product) : null;
  const stored = Number(source?.baselinePrice);
  return {
    baselinePrice: stored > 0 ? stored : offer?.price ?? null,
    baselineStore: source?.baselineStore || offer?.storeName || "",
    watch: source?.watch === "on" || source?.watch === "off" ? source.watch : "inherit",
    targetPrice: Number(source?.targetPrice) > 0 ? Number(source.targetPrice) : null,
  };
}

function findListEntry(id) {
  if (!id) return null;
  return list.get(id) || [...list.values()].find((entry) => entry.product?.id === id || entry.itemId === id) || null;
}

function saveList() {
  if (deletingData) return;
  const rows = [...list.values()].map((entry) => ({
    id: entry.product.id,
    itemId: entry.itemId || entry.product.id,
    quantity: entry.quantity,
    checked: Boolean(entry.checked),
    addedBy: entry.addedBy,
    checkedBy: entry.checkedBy,
    writtenAt: entry.writtenAt || 0,
    name: entry.product.familyName || entry.product.name,
    catalogName: entry.product.catalogName || entry.product.name,
    familyName: entry.product.familyName || entry.product.name,
    brand: entry.product.brand,
    sizeLabel: entry.product.variantLabel || entry.product.sizeLabel,
    variantLabel: entry.product.variantLabel || entry.product.sizeLabel,
    baselinePrice: entry.baselinePrice,
    baselineStore: entry.baselineStore,
    watch: entry.watch || "inherit",
    targetPrice: entry.targetPrice ?? null,
  }));
  localStorage.setItem(LIST_KEY, JSON.stringify(rows));
  scheduleWatchSync();
  scheduleAccountSync();
}

function scheduleWatchSync() {
  if (!listReady) return;
  window.clearTimeout(watchTimer);
  watchTimer = window.setTimeout(() => void syncWatch(), 400);
}

async function syncWatch() {
  if (deletingData) return;
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
  const listId = activeListId();
  const previous = localStorage.getItem(WATCH_LIST_KEY);
  let retired = !previous || previous === listId;
  if (previous && previous !== listId) {
    try {
      const off = await apiFetch("/api/price-alerts/watches", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: deviceId(),
          listId: previous,
          listName: "My list",
          zip: "",
          enabled: false,
          items: [],
        }),
      });
      retired = off.ok;
    } catch {
      retired = false;
    }
  }
  try {
    const response = await apiFetch("/api/price-alerts/watches", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: deviceId(),
        listId,
        listName: shareState?.title || "My list",
        zip: ZIP_PATTERN.test(zip) ? zip.slice(0, 5) : "",
        enabled: listOn,
        items,
      }),
    });
    if (response.status === 402) {
      const body = await response.json().catch(() => ({}));
      toast(body.error || "Price alerts are part of Grocery Gitter Pro.");
      openPaywall();
      return;
    }
    if (response.ok) {
      localStorage.setItem(SYNC_FLAG, "1");
      if (retired) localStorage.setItem(WATCH_LIST_KEY, listId);
    }
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
  paintListEmpty();

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
      const watched = itemWatched(Boolean(listAlertsEl?.checked), entry.watch || "inherit");
      const targetValue = entry.targetPrice ? String(entry.targetPrice) : "";
      const credit = attributionLine(entry);
      const itemId = entry.itemId || entry.product.id;
      const image = mediaUrl(entry.product.imageUrls?.[0] || "");
      const heading = listItemTitle(entry.product);
      return `<li class="list-row${entry.checked ? " done" : ""}">
        <img src="${escapeHtml(image)}" alt="" />
        <div>
          <label class="got-it">
            <input type="checkbox" data-list-check="${escapeHtml(itemId)}" ${entry.checked ? "checked" : ""} ${locked ? "disabled" : ""} aria-label="Check off ${escapeHtml(heading.title)}" />
            <strong>${escapeHtml(heading.title)}</strong>
          </label>
          <p class="muted">${escapeHtml(heading.detail)}</p>
          ${credit ? `<p class="muted attribution">${escapeHtml(credit)}</p>` : ""}
          <div class="alert-controls">
            <label class="check-row item-watch">
              <input type="checkbox" data-watch="${escapeHtml(entry.product.id)}" ${watched ? "checked" : ""} />
              Watch price
            </label>
            <label class="target-price">Target $
              <input data-target="${escapeHtml(entry.product.id)}" inputmode="decimal" value="${escapeHtml(targetValue)}" placeholder="optional" aria-label="Target price for ${escapeHtml(heading.title)}" />
            </label>
          </div>
        </div>
        <div class="stepper">
          <button type="button" data-list-dec="${escapeHtml(itemId)}" aria-label="Decrease ${escapeHtml(heading.title)}" ${locked ? "disabled" : ""}>−</button>
          <output>${entry.quantity}</output>
          <button type="button" data-list-inc="${escapeHtml(itemId)}" aria-label="Increase ${escapeHtml(heading.title)}" ${locked ? "disabled" : ""}>+</button>
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
    if (!shareState?.shareToken) noteRemoved(entry.itemId || id, entry.writtenAt);
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
  const existing = list.get(product.id) || findListEntry(product.id);
  const next = Math.min(99, (existing?.quantity ?? 0) + quantity);
  const entry = {
    product,
    quantity: existing ? next : Math.max(1, quantity),
    itemId: existing?.itemId || product.id,
    checked: existing?.checked ?? false,
    addedBy: existing?.addedBy || readDisplayName() || undefined,
    checkedBy: existing?.checkedBy,
    writtenAt: Date.now(),
    ...alertFields(existing, product),
  };
  const key = existing?.itemId || product.id;
  for (const [storedId, stored] of [...list]) {
    if (storedId !== key && (stored === existing || stored.product?.id === product.id)) list.delete(storedId);
  }
  list.set(key, entry);
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
  const added = listItemTitle(product);
  toast(`Added ${added.title}${added.detail ? ` (${added.detail})` : ""}`);
}

function syncCards() {
  for (const card of gridEl.querySelectorAll("[data-product-id]")) {
    const id = card.getAttribute("data-product-id");
    const entry = findListEntry(id);
    const box = card.querySelector("input[type=checkbox]");
    const output = card.querySelector("output");
    if (box) box.checked = Boolean(entry);
    if (output) output.textContent = String(entry?.quantity ?? card.dataset.qty ?? 1);
  }
}

function rememberTile(tile) {
  if (!tile) return;
  if (tile.familyKey) familiesByKey.set(tile.familyKey, tile);
  const variants = Array.isArray(tile.variants) && tile.variants.length ? tile.variants : [tile];
  for (const variant of variants) {
    if (!variant?.id) continue;
    productsById.set(variant.id, {
      ...variant,
      catalogName: variant.catalogName || variant.name,
      familyKey: tile.familyKey || variant.familyKey,
      familyName: tile.familyName || variant.familyName || tile.name,
      flavorLabel: variant.flavorLabel || "",
      variantLabel: variant.variantLabel || variant.label || tile.variantLabel || variant.sizeLabel,
    });
  }
}

function variantChoices(tile) {
  return Array.isArray(tile?.variants) ? tile.variants : [];
}

function selectedVariant(tile) {
  const variants = variantChoices(tile);
  return variants.find((variant) => variant.id === tile.defaultVariantId) || variants[0] || tile;
}

function brandLine(tile, title) {
  const brand = String(tile.brand || "").trim();
  const parts = [];
  if (brand && !String(title).toLowerCase().startsWith(brand.toLowerCase())) parts.push(brand);
  if (tile.storeBrand) parts.push("store brand");
  return parts.join(" · ");
}

function aboutMoney(variant) {
  const amount = variant?.typicalPrice ?? variant?.bestOffer?.price ?? variant?.price;
  return Number.isFinite(Number(amount)) ? `about ${money(amount)}` : "";
}

function flavorVariants(family, flavorKey) {
  const all = family?.variants || [];
  const matched = all.filter((variant) => (variant.flavorKey || "") === (flavorKey || ""));
  return matched.length ? matched : all;
}

function paintChoice(card, selector, value) {
  card.querySelectorAll(selector).forEach((button) => {
    const on = button.getAttribute(selector.slice(1, -1)) === value;
    button.setAttribute("aria-checked", String(on));
  });
}

function phoneShelf() {
  return window.matchMedia("(max-width: 1099px)").matches;
}

/** Bring a tall family card up under the sticky header so size and quantity sit above the list bar. */
function settleCard(card) {
  if (!card || !phoneShelf()) return;
  const bar = document.querySelector(".list-bar");
  if (!bar || getComputedStyle(bar).display === "none") return;
  const safeTop = (document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0) + 8;
  const safeBottom = bar.getBoundingClientRect().top - 8;
  const covered = [...card.querySelectorAll(".size-option, .choice-chip, .card-actions, .size")].some((node) => {
    const rect = node.getBoundingClientRect();
    return rect.height > 0 && (rect.bottom > safeBottom + 1 || rect.top < safeTop - 1);
  });
  if (!covered) return;
  const delta = card.getBoundingClientRect().top - safeTop;
  if (delta > 1) window.scrollBy({ top: delta, left: 0 });
}

function applyFlavor(card, flavorKey) {
  if (!card) return;
  const family = familiesByKey.get(card.dataset.familyKey || "");
  if (!family) return;
  const choices = flavorVariants(family, flavorKey);
  const current = productsById.get(card.dataset.productId);
  const sameSize = choices.find((variant) => variant.label && variant.label === current?.label);
  const verdict = selectBestValue(choices.map(valueRow), card.dataset.sizeSort || "unit");
  const best = choices.find((variant) => variant.id === verdict.winnerId);
  const next = sameSize || best || choices[0];
  if (next) applyVariant(card, next.id);
  settleCard(card);
}

function applyVariant(card, variantId) {
  if (!card) return;
  const family = familiesByKey.get(card.dataset.familyKey || "");
  const variant = family?.variants?.find((item) => item.id === variantId) || productsById.get(variantId);
  if (!variant) return;
  const showFlavor = (family?.flavors?.length || 0) > 1;
  const stored = {
    ...variant,
    familyKey: family?.familyKey || variant.familyKey,
    familyName: family?.familyName || variant.familyName || variant.name,
    flavorLabel: showFlavor ? variant.flavorLabel || "" : "",
    variantLabel: variant.variantLabel || variant.label,
  };
  productsById.set(variant.id, stored);
  card.dataset.productId = variant.id;
  card.dataset.selectedFlavor = variant.flavorKey || "";
  const title = stored.familyName || stored.name;
  const images = variant.imageUrls?.length ? variant.imageUrls : family?.imageUrls || [];
  const img = card.querySelector("img");
  if (img) {
    img.src = mediaUrl(images[0] || "");
    img.dataset.rest = images.slice(1).join("\n");
  }
  const open = card.querySelector("[data-open]");
  if (open) {
    open.setAttribute("data-open", variant.id);
    open.setAttribute("aria-label", `Details for ${title}`);
  }
  const priceEl = card.querySelector("[data-price]");
  if (priceEl) priceEl.textContent = aboutMoney(variant);
  const sizeHost = card.querySelector("[data-size-row]");
  if (sizeHost && family) {
    const sizes = flavorVariants(family, variant.flavorKey || "");
    sizeHost.innerHTML = sizePanel(title, sizes, variant.id, card.dataset.sizeSort || "unit");
  }
  paintChoice(card, "[data-flavor]", variant.flavorKey || "");
  paintChoice(card, "[data-size-id]", variant.id);
  const note = stored.variantLabel || variant.label || "selected size";
  const box = card.querySelector("[data-check]");
  if (box) {
    box.setAttribute("data-check", variant.id);
    box.setAttribute("aria-label", `Add ${title}, ${note}, to my list`);
  }
  const dec = card.querySelector("[data-dec]");
  const inc = card.querySelector("[data-inc]");
  if (dec) {
    dec.setAttribute("data-dec", variant.id);
    dec.setAttribute("aria-label", `Decrease quantity of ${title}`);
  }
  if (inc) {
    inc.setAttribute("data-inc", variant.id);
    inc.setAttribute("aria-label", `Increase quantity of ${title}`);
  }
  syncCards();
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

function choiceChips(title, kind, choices, selected) {
  return choices
    .map((choice) => {
      const on = choice.value === selected;
      return `<button type="button" class="choice-chip" role="radio" aria-checked="${on}" data-${kind}="${escapeHtml(choice.value)}">${escapeHtml(choice.label)}</button>`;
    })
    .join("");
}

function sizeChips(title, sizes, selectedId) {
  return sizePanel(title, sizes, selectedId, "unit");
}

function sizePanel(title, sizes, selectedId, sort) {
  const list = sizes || [];
  const rows = list.map(valueRow);
  const hasUnits = rows.filter((row) => row.totalAmount != null && row.totalDimension).length >= 2;
  const mode = hasUnits && sort !== "item" ? "unit" : "item";
  const verdict = selectBestValue(rows, list.length > 1 ? mode : "unit");
  const byId = new Map(list.map((variant) => [variant.id, variant]));
  const ordered = (verdict.orderedIds.length ? verdict.orderedIds : list.map((variant) => variant.id))
    .map((id) => byId.get(id))
    .filter(Boolean);
  if (ordered.length <= 1) {
    const only = ordered[0];
    const label = only?.label || only?.sizeLabel || "";
    const unit = only?.valueText ? ` · ${only.valueText}` : "";
    return label ? `<p class="size">${escapeHtml(label)}${escapeHtml(unit)}</p>` : "";
  }
  const basis = verdict.basis && verdict.basis !== "item" ? verdict.basis : ordered.find((variant) => variant.valueBasis)?.valueBasis || null;
  const showUnitToggle = hasUnits;
  const active = showUnitToggle && mode === "unit" ? "unit" : "item";
  const options = ordered
    .map((variant) => {
      const on = variant.id === selectedId;
      const badge = verdict.winnerId === variant.id ? `<span class="best-badge">Best value</span>` : "";
      const unit = active === "item" ? "" : variant.valueText ? `<span class="size-unit">${escapeHtml(variant.valueText)}</span>` : "";
      const pack = active === "item" ? `<span class="size-unit">${escapeHtml(money(variant.price))}</span>` : unit;
      return `<li><button type="button" class="size-option" role="radio" aria-checked="${on}" data-size-id="${escapeHtml(variant.id)}"><span class="size-name">${escapeHtml(variant.label || variant.sizeLabel || "Size")}</span>${badge}${pack}</button></li>`;
    })
    .join("");
  const toggle = showUnitToggle
    ? `<div class="value-toggle" role="group" aria-label="Sort sizes for ${escapeHtml(title)}"><button type="button" data-value-sort="unit" aria-pressed="${active === "unit"}">${escapeHtml(unitSortLabel(basis))}</button><button type="button" data-value-sort="item" aria-pressed="${active === "item"}">Per item</button></div>`
    : "";
  const reason = verdict.reason ? `<p class="value-reason">${escapeHtml(verdict.reason)}</p>` : "";
  const flag = verdict.largePackNote ? `<p class="value-flag">${escapeHtml(verdict.largePackNote)}</p>` : "";
  return `${toggle}<ul class="size-list" role="radiogroup" aria-label="Size for ${escapeHtml(title)}">${options}</ul>${reason}${flag}`;
}

function cardHtml(tile) {
  const selected = selectedVariant(tile);
  const entry = findListEntry(selected.id);
  const checked = entry ? "checked" : "";
  const qty = entry?.quantity ?? 1;
  const title = tile.familyName || tile.name;
  const brand = brandLine(tile, title);
  const flavors = Array.isArray(tile.flavors) ? tile.flavors : [];
  const flavorKey = selected.flavorKey || "";
  const sizes = flavorVariants(tile, flavorKey);
  const flavorRow =
    flavors.length > 1
      ? `<p class="choice-label">Flavor</p><div class="choice-row" role="radiogroup" aria-label="Flavor for ${escapeHtml(title)}">${choiceChips(
          title,
          "flavor",
          flavors.map((flavor) => ({ value: flavor.key, label: flavor.label })),
          flavorKey
        )}</div>`
      : "";
  const sizeRow = `<p class="choice-label">Size</p><div data-size-row>${sizePanel(title, sizes, selected.id, "unit")}</div>`;
  const variantNote = selected.variantLabel || selected.label || tile.variantLabel || "";
  const image = selected.imageUrls?.[0] || tile.imageUrls?.[0] || "";
  return `<article class="card" data-family-key="${escapeHtml(tile.familyKey || "")}" data-product-id="${escapeHtml(selected.id)}" data-selected-flavor="${escapeHtml(flavorKey)}" data-size-sort="unit" data-qty="1">
    <button class="card-open" type="button" data-open="${escapeHtml(selected.id)}" aria-label="Details for ${escapeHtml(title)}">
      <img src="${escapeHtml(mediaUrl(image))}" data-rest="${escapeHtml((selected.imageUrls || tile.imageUrls || []).slice(1).join("\n"))}" alt="" />
    </button>
    <div class="card-body">
      ${brand ? `<p class="brand">${escapeHtml(brand)}</p>` : ""}
      <h3>${escapeHtml(title)}</h3>
      ${flavorRow}
      ${sizeRow}
      <p class="price" data-price>${escapeHtml(aboutMoney(selected))}</p>
    </div>
    <div class="card-actions">
      <label class="check">
        <input type="checkbox" data-check="${escapeHtml(selected.id)}" ${checked} aria-label="Add ${escapeHtml(title)}${variantNote ? `, ${escapeHtml(variantNote)},` : ""} to my list" />
        Add
      </label>
      <div class="stepper">
        <button type="button" data-dec="${escapeHtml(selected.id)}" aria-label="Decrease quantity of ${escapeHtml(title)}">−</button>
        <output>${qty}</output>
        <button type="button" data-inc="${escapeHtml(selected.id)}" aria-label="Increase quantity of ${escapeHtml(title)}">+</button>
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
  const visible = departments.filter((department) => department.id !== "other" && !department.generalMerchandise);
  for (const department of visible) {
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
    weeklyAdBanners = Array.isArray(body.weeklyAdBanners) ? body.weeklyAdBanners : [];
    catalogSource = body.catalogSource || catalogSource;
    total = body.total ?? 0;
    nextCursor = body.nextCursor;
    if (reset) fillFacets(body.facets ?? {});
    const items = body.items ?? [];
    for (const product of items) rememberTile(product);
    const html = items.map(cardHtml).join("");
    gridEl.innerHTML = reset ? html : gridEl.innerHTML + html;
    if (!items.length && reset) {
      const kind = catalogEmptyKind({ query, filtered: hasActiveFilters() });
      const state = kind === "search" ? searchEmpty(query) : emptyState(kind);
      gridEl.innerHTML = emptyStateMarkup(state, escapeHtml);
      resultCountEl.textContent = state.title;
    } else {
      const label = query ? `Results for “${query}”` : activeDepartment === "all" ? "All departments" : departments.find((d) => d.id === activeDepartment)?.name || "Aisle";
      resultCountEl.textContent = `${total} ${total === 1 ? "product" : "products"} · ${label}`;
    }
    const more = $("show-more");
    if (more) more.hidden = !nextCursor;
    if (reset) settleCard(gridEl.querySelector(".card"));
    const demo = catalogSource === "demo";
    const zipOk = ZIP_PATTERN.test(normalizeZip(zipEl.value));
    const weeklyAds = (coverage || []).some((store) => store.mode === "weekly_ad_only");
    const zipWarning = (body.warnings ?? []).find((warning) => /5-digit US ZIP/i.test(warning));
    const foundNames = weeklyAdBanners.map((banner) => banner.storeName).filter(Boolean);
    const foundLine = !zipOk
      ? ""
      : foundNames.length
        ? ` Circulars Flipp returned for this ZIP: ${foundNames.join(", ")}. Each of those prices is the weekly ad, not a shelf price.`
        : Array.isArray(body.weeklyAdBanners)
          ? " Flipp returned no mapped grocery circular for this ZIP."
          : "";
    if (!zipOk && weeklyAds) {
      coverageBannerEl.textContent = zipWarning || "Enter a 5-digit ZIP to load this week’s Target, Aldi, and other circular prices. Without a ZIP those stores stay on the demo catalog. A weekly ad is not a full shelf.";
    } else if (demo) {
      coverageBannerEl.textContent = `Demo shelves — store prices here are samples until Walmart, Kroger, or a partner feed is configured. Open Coverage for what each store can actually browse.${foundLine}`;
    } else if (catalogSource === "database") {
      coverageBannerEl.textContent = `Prices from Grocery Gitter’s saved catalog, plus weekly-ad items when this ZIP has a circular. Target and Aldi are not a full live shelf.${foundLine}`;
    } else if (catalogSource === "mixed") {
      coverageBannerEl.textContent = `Live samples are mixed with the demo catalog. Weekly-ad prices are labeled weekly ad, not a shelf price.${foundLine}`;
    } else {
      coverageBannerEl.textContent = `Live catalog sample. This is not a full store assortment.${foundLine}`;
    }
    const hardWarnings = (body.warnings ?? []).filter((warning) => !/5-digit US ZIP/i.test(warning));
    if (hardWarnings.length) {
      showCatalogError(hardWarnings.join(" "));
    }
  } catch (error) {
    const kind = networkKind(error, navigator.onLine);
    if (reset && kind) {
      showCatalogError("");
      const state = emptyState(kind);
      gridEl.innerHTML = emptyStateMarkup(state, escapeHtml, "alert");
      resultCountEl.textContent = state.title;
    } else {
      showCatalogError(error instanceof Error ? error.message : "Could not load the catalog.");
      if (reset) gridEl.innerHTML = "";
    }
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
      const price = suggestionPriceLabel(item.bestPrice, "", (value) => `about ${money(value)}`);
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
    const kind = networkKind(error, navigator.onLine);
    if (kind) {
      const state = emptyState(kind);
      showSuggestStatus(`${state.title}. ${state.body}`);
      return;
    }
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

function openProduct(product) {
  const title = product.familyName || product.name;
  const note = product.variantLabel || product.sizeLabel || "";
  productDialog.innerHTML = `<div class="sheet-body">
    <img class="hero" src="${escapeHtml(mediaUrl(product.imageUrls?.[0] || ""))}" alt="" />
    <h2 id="dialog-title">${escapeHtml(title)}</h2>
    ${note ? `<p class="muted">${escapeHtml(note)}${product.storeBrand ? " · store brand" : ""}</p>` : ""}
    <p class="price">${escapeHtml(aboutMoney(product))}</p>
    <p class="muted">Pick the flavor and size on the shelf. Grocery Gitter chooses the store when you plan the trip.</p>
    <button type="button" class="primary" id="dialog-add">Add to my list</button>
    <button type="button" class="ghost" id="dialog-close">Close</button>
  </div>`;
  productDialog.showModal();
  productDialog.querySelector("#dialog-add").onclick = () => {
    addProduct(product, 1);
    productDialog.close();
  };
  productDialog.querySelector("#dialog-close").onclick = () => productDialog.close();
}

function openCoverage() {
  const found = weeklyAdBanners.length
    ? `<p class="muted">Circulars Flipp returned for this ZIP: ${escapeHtml(weeklyAdBanners.map((banner) => banner.storeName).join(", "))}. Weekly ad, not shelf price.</p>`
    : "";
  coverageDialog.innerHTML = `<div class="sheet-body">
    <h2 id="coverage-title">Catalog coverage</h2>
    ${found}
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

function summaryOf(stores) {
  if (!stores.length) return "No stores matched this list.";
  return stores
    .map((store) => {
      const count = store.itemCount ?? (store.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      return `${count} ${store.storeName}`;
    })
    .join(" + ");
}

function tripId() {
  return tripFingerprint(lastOptimize?.stores || []);
}

function currentTrip() {
  if (!lastOptimize) return null;
  const threshold = tripEdits.fewerStops ? 8 : 2;
  const base = applyTripEdits(lastOptimize.stores ?? [], tripEdits, lastOptimize.capabilities || {});
  if (planLimited("multiStoreSplit")) return base;
  return consolidateStops(base.stores, threshold, lastOptimize.capabilities || {});
}

function rememberTrip() {
  if (!lastOptimize) return;
  saveTripSnapshot(localStorage, lastOptimize, tripEdits);
}

function shareEnv() {
  return {
    capacitorShare: window.Capacitor?.Plugins?.Share,
    navigatorShare: typeof navigator.share === "function" ? (data) => navigator.share(data) : undefined,
    copy: copyText,
  };
}

function labelClass(label) {
  if (label === "Live shelf price" || label === "Partner feed") return "badge-live";
  if (label === "Weekly ad" || label === "Weekly ad, not shelf price") return "badge-ad";
  return "badge-demo";
}

function itemPriceLabel(item, store) {
  const source = item?.priceSource;
  if (source === "weekly_ad" || source === "cached_weekly_ad") return "Weekly ad, not shelf price";
  if (source) return priceSourceLabel(source);
  return store?.handoff?.priceLabel || store?.pricing?.label || priceSourceLabel(store?.pricing?.source);
}

function planLimited(feature) {
  return Boolean(lastOptimize?.entitlement?.limited?.includes(feature));
}

function exportRow(scope, storeName, actionType) {
  const storeAttr = storeName ? ` data-export-store="${escapeHtml(storeName)}"` : "";
  const instacartScope = scope === "store" ? "store" : "list";
  const showInstacart =
    instacartEnabled && !planLimited("cartHandoffs") && actionType !== "kroger_cart" && actionType !== "walmart_cart";
  const instacart = showInstacart
    ? `<button type="button" class="instacart-cta" data-instacart-scope="${instacartScope}"${storeName ? ` data-instacart-store="${escapeHtml(storeName)}"` : ""}><img src="/instacart-carrot.svg" alt="" />Add to Instacart</button>`
    : "";
  return `<div class="export-row" aria-label="${scope === "store" ? "Share this store" : "Share this trip"}">
    <button type="button" class="ghost" data-export="copy"${storeAttr}>Copy list</button>
    <button type="button" class="ghost" data-export="share"${storeAttr}>Share</button>
    <button type="button" class="ghost" data-export="print"${storeAttr}>Print or PDF</button>
    <button type="button" class="ghost" data-export="link"${storeAttr}>Shareable link</button>
    ${instacart}
  </div>`;
}

function changeControl(item) {
  const move = moveControl(item);
  if (!move) return "";
  const label = item.matchKind === "substitute" || item.matchKind === "swap" ? "Change this swap" : "Change store";
  return `<details class="move-details"><summary>${label}</summary>${move}</details>`;
}

function sameStoreName(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

function moveLine(lineId, storeName) {
  if (!lineId || !storeName) return;
  if (planLimited("multiStoreSplit")) {
    openPaywall();
    return;
  }
  const moves = { ...tripEdits.moves };
  const original = (lastOptimize?.stores || [])
    .flatMap((store) => store.items || [])
    .find((item) => item.lineId === lineId);
  const locked = tripEdits.lockedStore;
  const backToOriginal = original && sameStoreName(storeName, original.storeName) && !locked;
  const backToLock = locked && sameStoreName(storeName, locked);
  if (backToOriginal || backToLock) delete moves[lineId];
  else moves[lineId] = storeName;
  tripEdits = { ...tripEdits, moves };
  rememberTrip();
  paintTrip();
}

function moveControl(item) {
  if (planLimited("multiStoreSplit")) return "";
  const offers = item.offers || [];
  if (offers.length < 2 || !item.lineId) return "";
  const options = offers
    .map((offer) => {
      const selected = sameStoreName(offer.storeName, item.storeName) ? " selected" : "";
      return `<option value="${escapeHtml(offer.storeName)}"${selected}>${escapeHtml(moveOptionLabel(offer, item.price))}</option>`;
    })
    .join("");
  return `<label class="move">Move
    <select data-move-line="${escapeHtml(item.lineId)}" aria-label="Move ${escapeHtml(item.name)} to another store">${options}</select>
  </label>`;
}

function shopperButtonLabel(store) {
  const action = store.handoff?.action;
  if (action?.label) return action.label;
  const name = store.storeName || "the store";
  if (action?.type === "kroger_cart" || action?.type === "walmart_cart") return `Send to ${name} cart`;
  return `Open ${name} list`;
}

function swapLine(item) {
  const swapped = item.matchKind === "swap" || item.matchKind === "substitute";
  const note = item.swapNote || (swapped ? swapSentence(item.substitutedFor || item.query || item.name, item.storeName, item.name) : "");
  if (!note) return "";
  const back =
    item.exactStore && item.lineId && !sameStoreName(item.exactStore, item.storeName)
      ? `<button type="button" class="text-btn" data-switch-back="${escapeHtml(item.lineId)}" data-switch-store="${escapeHtml(item.exactStore)}">Switch back</button>`
      : "";
  return `<span class="swap-note">${escapeHtml(note)}${back}</span>`;
}

function primaryAction(store) {
  const action = store.handoff?.action;
  if (!action) return "";
  const label = shopperButtonLabel(store);
  if (planLimited("cartHandoffs")) {
    return `<button class="handoff-btn" type="button" data-open-paywall="1">${escapeHtml(action.label || "Grocery Gitter Pro")}</button>`;
  }
  if (action.type === "coming_soon") {
    return `<button class="handoff-btn" type="button" disabled>${escapeHtml(action.label || "Coming soon")}</button>`;
  }
  if (action.type === "kroger_cart") {
    return `<button class="handoff-btn" type="button" data-kroger="${escapeHtml(store.storeName)}">${escapeHtml(label)}</button>`;
  }
  if (action.type === "walmart_cart" && action.url) {
    return `<a class="handoff-btn" href="${escapeHtml(action.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  }
  return `<button class="handoff-btn" type="button" data-shop-list="${escapeHtml(store.storeName)}">${escapeHtml(label)}</button>`;
}

function renderTrip(payload) {
  lastOptimize = payload;
  tripEdits = { lockedStore: null, moves: {} };
  rememberTrip();
  paintTrip();
}

function paintTrip() {
  const view = currentTrip();
  if (!view) return;
  const stores = view.stores ?? [];
  const checks = readChecks(localStorage, tripId());
  const lines = stores.flatMap((store) => store.items || []);
  const comparison = singleStoreSavings(lines);
  const story = tripStory(comparison, { stops: stores.length, fewerStops: Boolean(tripEdits.fewerStops) });
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  gridEl.hidden = true;
  sentinelEl.hidden = true;
  tripEl.hidden = false;
  if (tripStoreEmpty(lastOptimize)) {
    tripEl.innerHTML = `
      <button type="button" class="ghost" id="trip-back">Back to shelves</button>
      ${emptyStateMarkup(emptyState("stores"), escapeHtml)}
    `;
    $("trip-back").onclick = () => {
      tripEl.hidden = true;
      gridEl.hidden = false;
      sentinelEl.hidden = false;
    };
    return;
  }
  const storeLines = (story.completeStores || [])
    .map(
      (store) =>
        `<li><span>All at ${escapeHtml(store.storeName)}</span><strong>${money(store.total)}</strong></li>`
    )
    .join("");
  const missingLines = (story.incompleteStores || [])
    .map((store) => `<li class="muted">${escapeHtml(store.storeName)} doesn't carry ${escapeHtml(store.missing.join(", "))}, so it isn't in the comparison.</li>`)
    .join("");
  tripEl.innerHTML = `
    <button type="button" class="ghost" id="trip-back">Back to shelves</button>
    <section class="savings-card">
      <p class="savings-kicker">Trip plan</p>
      <h2>${escapeHtml(story.headline)}</h2>
      <p>${escapeHtml(story.effort)}</p>
      <ul class="savings-lines">
        ${storeLines}
        <li class="trip-now"><span>This trip${stores.length > 1 ? ` · ${stores.length} stores` : ""}</span><strong>${money(view.total)}</strong></li>
        ${missingLines}
      </ul>
      ${story.versus ? `<p class="muted">${escapeHtml(story.versus)}</p>` : ""}
      ${
        stores.length > 1 || tripEdits.fewerStops
          ? `<label class="check-row fewer-stops"><input id="fewer-stops" type="checkbox" ${tripEdits.fewerStops ? "checked" : ""} /> Fewer stops <span class="muted">Only add a store when it saves at least ${tripEdits.fewerStops ? "$8" : "$2"}.</span></label>`
          : ""
      }
      ${lastOptimize?.entitlement?.plan === "free" ? `<p class="muted">This plan uses one store. <button type="button" class="linkish" data-open-paywall="1">See Grocery Gitter Pro</button> to split the list across stores.</p>` : ""}
    </section>
    ${offline ? `<p class="offline-note">You're offline. This trip is saved on this device, including what you've checked off.</p>` : ""}
    ${!planLimited("multiStoreSplit") && tripEdits.lockedStore ? `<p class="lock-note">${escapeHtml(tripEdits.lockedStore)} is locked for this trip. Items it sells stay there unless you move one.</p>` : ""}
    <div class="trip-actions">
      <button type="button" class="ghost" data-instore="trip">In-store mode</button>
      ${exportRow("trip")}
    </div>
    ${lastOptimize?.pricingWarning ? `<p class="muted">${escapeHtml(lastOptimize.pricingWarning)}</p>` : ""}
    <div class="store-grid">
      ${stores.map((store) => renderStore(store, checks)).join("")}
    </div>
    ${(lastOptimize?.unavailable ?? []).length ? `<p class="status">No price for: ${escapeHtml(lastOptimize.unavailable.join(", "))}</p>` : ""}
    ${checkedStoresHtml(lastOptimize || {}, stores)}
  `;
  $("trip-back").onclick = () => {
    tripEl.hidden = true;
    gridEl.hidden = false;
    sentinelEl.hidden = false;
  };
  const fewer = $("fewer-stops");
  if (fewer) {
    fewer.onchange = () => {
      tripEdits = { ...tripEdits, fewerStops: fewer.checked };
      rememberTrip();
      paintTrip();
    };
  }
}

function renderStore(store, checks) {
  const rows = (store.items ?? [])
    .map((item) => {
      const checked = item.lineId && checks[item.lineId] ? " checked" : "";
      const size = item.size ? ` · ${escapeHtml(item.size)}` : "";
      const priceLabel = itemPriceLabel(item, store);
      return `<li class="trip-item">
        <label class="check-line">
          <input type="checkbox" data-trip-check="${escapeHtml(item.lineId || "")}"${checked} />
          <span>
            <span class="item-name">${item.quantity}× ${escapeHtml(item.name)}</span>
            <span class="muted">${escapeHtml(item.brand || "")}${size}</span>
          </span>
        </label>
        ${swapLine(item)}
        <span class="item-price">
          <span class="${labelClass(priceLabel)}">${escapeHtml(priceLabel)}</span>
          <span>${money(item.price)} each</span>
          <strong>${money(item.itemTotal ?? item.price)}</strong>
        </span>
        ${changeControl(item)}
      </li>`;
    })
    .join("");
  const action = store.handoff?.action;
  const priceLabel = store.handoff?.priceLabel || store.pricing?.label || "Price";
  const nearby = store.nearbyStore?.name
    ? `<p class="store-nearby">Nearest store: ${escapeHtml(store.nearbyStore.name)}</p>`
    : "";
  const lock = planLimited("multiStoreSplit")
    ? ""
    : tripEdits.lockedStore === store.storeName
      ? `<button type="button" class="ghost" data-unlock-store>Unlock ${escapeHtml(store.storeName)}</button>`
      : `<button type="button" class="ghost" data-lock-store="${escapeHtml(store.storeName)}">Lock ${escapeHtml(store.storeName)} for this trip</button>`;
  return `<article class="store-card">
    <header>
      <div>
        <h3>${escapeHtml(store.storeName)}</h3>
        ${nearby}
        <span class="${labelClass(priceLabel)}">${escapeHtml(priceLabel)}</span>
        ${store.pricing?.detail ? `<p class="muted">${escapeHtml(store.pricing.detail)}</p>` : ""}
      </div>
      <p class="store-total"><span>Store total</span><strong>${money(store.subtotal)}</strong></p>
    </header>
    <ul class="item-list">${rows}</ul>
    <footer class="store-handoff">
      ${primaryAction(store)}
      ${lock}
      ${exportRow("store", store.storeName, action?.type)}
    </footer>
  </article>`;
}

function itemUrl(item) {
  if (planLimited("cartHandoffs")) return "";
  if (item?.url) return item.url;
  const offer = (item?.offers || []).find((row) => row.storeName === item.storeName);
  return offer?.url || "";
}

function checklistItems(storeName) {
  const view = currentTrip();
  const stores = storeName ? (view?.stores || []).filter((store) => store.storeName === storeName) : view?.stores || [];
  return stores.flatMap((store) => (store.items || []).map((item) => ({ ...item, storeName: store.storeName })));
}

function openChecklist(storeName) {
  const dialog = $("trip-dialog");
  if (!dialog) return;
  const instore = !storeName;
  const items = checklistItems(storeName);
  const groups = groupForAisle(items);
  const checks = readChecks(localStorage, tripId());
  const title = instore ? "In the store" : `${storeName} list`;
  const groupsHtml = groups
    .map((group) => {
      const aisle = group.aisle ? ` · ${escapeHtml(group.aisle)}` : "";
      const rows = group.items
        .map((item) => {
          const checked = item.lineId && checks[item.lineId] ? " checked" : "";
          const size = item.size ? `, ${escapeHtml(item.size)}` : "";
          const swap = item.swapNote ? `<span class="swap-note">${escapeHtml(item.swapNote)}</span>` : "";
          const where = instore ? `<span class="muted">${escapeHtml(item.storeName)}</span>` : "";
          const url = itemUrl(item);
          const link = url
            ? `<a class="text-btn" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open in ${escapeHtml(item.storeName)}</a>`
            : "";
          return `<li class="check-row-line">
            <label class="check-line">
              <input type="checkbox" data-trip-check="${escapeHtml(item.lineId || "")}"${checked} />
              <span>${item.quantity}× ${escapeHtml(item.name)}${size}${swap}</span>
            </label>
            ${where}
            <strong>${money(item.itemTotal ?? item.price)}</strong>
            ${link}
          </li>`;
        })
        .join("");
      return `<section><h3>${escapeHtml(group.department || "Other")}${aisle}</h3><ul class="check-list">${rows}</ul></section>`;
    })
    .join("");
  dialog.innerHTML = `<div class="sheet-body">
    <div class="list-head">
      <h2 id="trip-dialog-title">${escapeHtml(title)}</h2>
      <button type="button" class="text-btn" data-close-checklist>Close</button>
    </div>
    <p class="muted">${instore ? "Sorted by department and aisle. Checked items stay on this device, including offline." : "Check items off as you go. Open a link when this store has one."}</p>
    ${groupsHtml || "<p class='muted'>Nothing in this list.</p>"}
  </div>`;
  if (!dialog.open) dialog.showModal();
}

function storesForExport(storeName) {
  const view = currentTrip();
  if (!view) return [];
  if (!storeName) return view.stores;
  return view.stores.filter((store) => store.storeName === storeName);
}

function printTrip(title, text) {
  const root = $("print-root");
  if (!root) return;
  root.hidden = false;
  root.innerHTML = `<h1>${escapeHtml(title)}</h1><pre>${escapeHtml(text)}</pre>`;
  window.print();
}

async function shareTripLink(stores, title) {
  const checks = readChecks(localStorage, tripId());
  const items = [];
  stores.forEach((store) => {
    for (const item of store.items || []) {
      items.push({
        itemId: shareItemId(item, items.length),
        name: item.name,
        ...(item.brand ? { brand: item.brand } : {}),
        ...(item.size ? { sizeLabel: item.size } : {}),
        quantity: item.quantity || 1,
        checked: Boolean(item.lineId && checks[item.lineId]),
        writtenAt: Date.now(),
        deleted: false,
      });
    }
  });
  const response = await apiFetch("/api/lists", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, items }),
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 402) {
    openPaywall();
    return;
  }
  if (!response.ok || !body.shareToken) throw new Error(body.error || "Could not make a share link.");
  const url = sharePageUrl(body.shareToken, { apiOrigin: apiOrigin(), locationHref: window.location.href });
  const how = await deliverShare({ title, text: title, url, dialogTitle: "Share list" }, shareEnv());
  toast(how === "copy" ? "Link copied." : "Choose who to send the link to.");
}

async function exportTrip(kind, storeName) {
  const stores = storesForExport(storeName);
  if (!stores.length) return;
  const title = storeName ? `${storeName} list` : "Grocery Gitter trip";
  const text = formatTripText(stores, { headed: !storeName });
  if (kind === "copy") {
    await copyText(text);
    toast("List copied.");
    return;
  }
  if (kind === "share") {
    const how = await deliverShare({ title, text, dialogTitle: "Share list" }, shareEnv());
    toast(how === "copy" ? "List copied." : "Choose who to send the list to.");
    return;
  }
  if (kind === "print") {
    printTrip(title, text);
    return;
  }
  if (kind === "link") {
    await shareTripLink(stores, title);
  }
}

function restoreOfflineTrip() {
  const saved = readTripSnapshot(localStorage);
  if (!saved?.payload?.stores?.length) return false;
  lastOptimize = saved.payload;
  tripEdits = {
    lockedStore: saved.edits?.lockedStore || null,
    moves: { ...(saved.edits?.moves || {}) },
  };
  paintTrip();
  return true;
}

async function planTrip() {
  planErrorEl.hidden = true;
  const zip = normalizeZip(zipEl.value);
  zipEl.value = zip;
  if (!ZIP_PATTERN.test(zip)) {
    planErrorEl.hidden = false;
    planErrorEl.textContent = "Enter a 5-digit ZIP so the trip can use your nearest stores.";
    // On a phone the list sheet covers the header ZIP, and the error sits below the sheet.
    const sheetCoversZip =
      window.matchMedia("(max-width: 1099px)").matches && listPanel.classList.contains("open");
    if (sheetCoversZip) {
      openList(false);
      toast(planErrorEl.textContent, 4200);
    }
    zipEl.focus();
    return;
  }
  localStorage.setItem(ZIP_KEY, zip);
  const items = [...list.values()].map((entry) => ({
    name: entry.product.catalogName || entry.product.name,
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
    const kind = networkKind(error, navigator.onLine);
    if (kind) {
      const state = emptyState(kind);
      planErrorEl.textContent = `${state.title}. ${state.body}`;
    } else {
      planErrorEl.textContent = error instanceof Error ? error.message : "Could not plan the trip.";
    }
  } finally {
    planBtn.disabled = list.size === 0;
    planBtn.textContent = "Plan the trip";
  }
}

async function openInstacart(button) {
  const scope = button.dataset.instacartScope;
  const storeName = button.dataset.instacartStore || "";
  const stores = currentTrip()?.stores ?? [];
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
    const response = await apiFetch("/api/instacart/shopping-list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items,
        ...(scope === "store" && storeName ? { storeName } : {}),
        postalCode: normalizeZip(zipEl.value).slice(0, 5),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 402) openPaywall();
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
  const store = currentTrip()?.stores?.find((entry) => entry.storeName === storeName);
  if (!store) return;
  button.disabled = true;
  try {
    const response = await apiFetch("/api/kroger/cart/start", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ items: store.handoff?.items ?? store.items, locationId: store.items?.[0]?.locationId }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 402) openPaywall();
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
  const heading = listItemTitle(entry.product);
  return {
    itemId: entry.itemId || entry.product.id,
    catalogId: entry.product.id,
    name: heading.title,
    brand: entry.product.brand || undefined,
    sizeLabel: heading.detail || entry.product.sizeLabel || undefined,
    quantity: Math.max(1, Number(entry.quantity) || 1),
    checked: Boolean(entry.checked),
    writtenAt: entry.writtenAt || Date.now(),
    deleted: Boolean(deleted),
  };
}

function stubFromItem(item) {
  const retailer = item.catalogName || item.name || "Item";
  return {
    id: item.catalogId || item.itemId || item.id,
    name: retailer,
    catalogName: retailer,
    familyName: item.familyName || item.name || "Item",
    brand: item.brand || "",
    sizeLabel: item.sizeLabel || item.variantLabel || "",
    variantLabel: item.variantLabel || item.sizeLabel || "",
    familyKey: item.familyKey || "",
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
  const previousAlerts = new Map();
  for (const entry of list.values()) {
    const prefs = {
      baselinePrice: entry.baselinePrice,
      baselineStore: entry.baselineStore,
      watch: entry.watch,
      targetPrice: entry.targetPrice,
    };
    if (entry.itemId) previousAlerts.set(entry.itemId, prefs);
    if (entry.product?.id) previousAlerts.set(entry.product.id, prefs);
  }
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
    const prefs = previousAlerts.get(item.itemId) || previousAlerts.get(item.catalogId) || previousAlerts.get(product.id);
    const entry = {
      product,
      quantity: Math.max(1, Number(item.quantity) || 1),
      itemId: item.itemId,
      checked: Boolean(item.checked),
      addedBy: item.addedBy,
      checkedBy: item.checkedBy,
      writtenAt: Number(item.writtenAt) || 0,
      ...alertFields(prefs, product),
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
        const previous = [...list.values()].find((row) => row.product?.id === body.product.id)?.product;
        const merged = {
          ...body.product,
          familyName: body.product.familyName || previous?.familyName,
          variantLabel: body.product.variantLabel || previous?.variantLabel,
          familyKey: body.product.familyKey || previous?.familyKey,
          catalogName: body.product.catalogName || body.product.name,
        };
        productsById.set(merged.id, merged);
        const entry = list.get(merged.id) || [...list.values()].find((row) => row.product?.id === merged.id);
        if (entry) {
          entry.product = merged;
          if (!(Number(entry.baselinePrice) > 0)) Object.assign(entry, alertFields(entry, merged));
        }
      } catch {
        /* the shared name still shows if the catalog misses */
      }
    })
  );
  saveList();
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
  scheduleWatchSync();
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
  } catch (error) {
    const kind = networkKind(error, navigator.onLine) || "network";
    shareProblem = kind;
    shareProblemToken = token;
    const state = emptyState(kind);
    toast(`${state.title}. ${state.body}`);
    renderShareChrome();
    openList(true);
    return;
  }
  shareProblem = "";
  shareProblemToken = "";
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
      deviceId: deviceId(),
      items: [...list.values()].map((entry) => toWrite(entry, false)),
      rotate: Boolean(extra.rotate),
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 402) openPaywall();
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
  const shareEmpty = $("share-empty");
  if (shareEmpty) {
    if (shareProblem && !shared) {
      const state = emptyState(shareProblem);
      state.actionId = "retry-share";
      fillEmpty(shareEmpty, state, "alert");
      shareEmpty.hidden = false;
    } else if (!shared) {
      const state = emptyState("shared");
      state.action = "";
      state.bodyId = "share-empty-body";
      fillEmpty(shareEmpty, state);
      shareEmpty.hidden = false;
    } else {
      shareEmpty.hidden = true;
    }
  }
  paintListEmpty();
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
  scheduleWatchSync();
  void syncAccountList();
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
    ...alertFields(row, product),
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
        const restored = {
          ...body.product,
          familyName: body.product.familyName || row.name,
          variantLabel: body.product.variantLabel || row.sizeLabel,
          catalogName: body.product.catalogName || body.product.name,
        };
        productsById.set(restored.id, restored);
        const itemId = row.itemId || restored.id;
        list.set(itemId, {
          product: restored,
          quantity: Math.max(1, Number(row.quantity) || 1),
          itemId,
          checked: Boolean(row.checked),
          addedBy: row.addedBy,
          checkedBy: row.checkedBy,
          writtenAt: Number(row.writtenAt) || 0,
          ...alertFields(row, body.product),
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
  for (const item of body.items ?? []) rememberTile(item);
  for (const want of wanted) {
    const tile = (body.items ?? []).find(
      (item) => item.brand === want.brand && (item.name === want.name || item.familyName === want.name || item.catalogName === want.name)
    );
    const variant = tile ? productsById.get(tile.defaultVariantId || tile.id) || tile : null;
    if (variant) addProduct(variant, 1);
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
  const sortPick = target.closest("button[data-value-sort]");
  if (sortPick && sortPick.closest("#grid")) {
    const card = sortPick.closest(".card");
    if (card) {
      card.dataset.sizeSort = sortPick.getAttribute("data-value-sort") || "unit";
      applyVariant(card, card.dataset.productId);
    }
    return;
  }
  const flavorPick = target.closest("[data-flavor]");
  if (flavorPick && flavorPick.closest("#grid")) {
    applyFlavor(flavorPick.closest(".card"), flavorPick.getAttribute("data-flavor") || "");
    return;
  }
  const sizePick = target.closest("[data-size-id]");
  if (sizePick) {
    applyVariant(sizePick.closest(".card"), sizePick.getAttribute("data-size-id"));
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
    const card = inc.closest(".card");
    const entry = findListEntry(id);
    if (entry) setQuantity(entry.itemId || id, entry.quantity + 1);
    else if (card) {
      card.dataset.qty = String(stagedQuantity(card.dataset.qty, 1));
      const output = card.querySelector("output");
      if (output) output.textContent = card.dataset.qty;
    }
    return;
  }
  const dec = target.closest("[data-dec]");
  if (dec) {
    const id = dec.getAttribute("data-dec");
    const card = dec.closest(".card");
    const entry = findListEntry(id);
    if (entry) setQuantity(entry.itemId || id, entry.quantity - 1);
    else if (card) {
      card.dataset.qty = String(stagedQuantity(card.dataset.qty, -1));
      const output = card.querySelector("output");
      if (output) output.textContent = card.dataset.qty;
    }
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
  if (target.closest("[data-open-paywall]")) {
    openPaywall();
    return;
  }
  if (target.closest("[data-shop-list]")) {
    if (planLimited("cartHandoffs")) {
      openPaywall();
      return;
    }
    openChecklist(target.closest("[data-shop-list]").getAttribute("data-shop-list"));
    return;
  }
  if (target.closest("[data-instore]")) {
    openChecklist("");
    return;
  }
  if (target.closest("[data-close-checklist]")) {
    $("trip-dialog")?.close();
    return;
  }
  if (target.closest("[data-lock-store]")) {
    if (planLimited("multiStoreSplit")) {
      openPaywall();
      return;
    }
    tripEdits = { ...tripEdits, lockedStore: target.closest("[data-lock-store]").getAttribute("data-lock-store") };
    rememberTrip();
    paintTrip();
    return;
  }
  if (target.closest("[data-unlock-store]")) {
    tripEdits = { ...tripEdits, lockedStore: null };
    rememberTrip();
    paintTrip();
    return;
  }
  const switchBack = target.closest("[data-switch-back]");
  if (switchBack) {
    moveLine(switchBack.getAttribute("data-switch-back"), switchBack.getAttribute("data-switch-store"));
    return;
  }
  const exportButton = target.closest("[data-export]");
  if (exportButton) {
    void exportTrip(exportButton.getAttribute("data-export"), exportButton.getAttribute("data-export-store") || "").catch((error) => {
      if (isShareCancel(error)) return;
      toast(error instanceof Error ? error.message : "Could not share that list.");
    });
    return;
  }
  if (target.closest(".instacart-cta")) {
    if (planLimited("cartHandoffs")) {
      openPaywall();
      return;
    }
    void openInstacart(target.closest(".instacart-cta"));
  }
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target instanceof HTMLSelectElement && target.dataset.moveLine) {
    if (planLimited("multiStoreSplit")) {
      openPaywall();
      return;
    }
    moveLine(target.dataset.moveLine, target.value);
    return;
  }
  if (target instanceof HTMLInputElement && target.dataset.tripCheck) {
    const checks = writeCheck(localStorage, tripId(), target.dataset.tripCheck, target.checked);
    document.querySelectorAll(`[data-trip-check="${CSS.escape(target.dataset.tripCheck)}"]`).forEach((box) => {
      if (box instanceof HTMLInputElement) box.checked = Boolean(checks[target.dataset.tripCheck]);
    });
  }
});

listItemsEl.addEventListener("change", (event) => {
  const box = event.target;
  if (!(box instanceof HTMLInputElement) || !box.dataset.listCheck) return;
  toggleChecked(box.dataset.listCheck, box.checked);
});

gridEl.addEventListener("change", (event) => {
  const target = event.target;
  if (target instanceof HTMLSelectElement && target.classList.contains("variant-select")) {
    applyVariant(target.closest(".card"), target.value);
    return;
  }
  const box = target;
  if (!(box instanceof HTMLInputElement) || !box.dataset.check) return;
  const product = productsById.get(box.dataset.check);
  if (!product) return;
  if (box.checked) {
    const card = box.closest(".card");
    addProduct(product, stagedQuantity(card?.dataset.qty || 1, 0));
  } else {
    const entry = findListEntry(product.id);
    setQuantity(entry?.itemId || product.id, 0);
  }
});

$("show-more")?.addEventListener("click", () => {
  void loadPage(false);
});

gridEl.addEventListener(
  "error",
  (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    const rest = (img.dataset.rest || "").split("\n").filter(Boolean);
    const next = rest.shift();
    if (!next) return;
    img.dataset.rest = rest.join("\n");
    img.src = mediaUrl(next);
  },
  true
);

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
listAlertsEl?.addEventListener("change", () => {
  localStorage.setItem(ALERTS_KEY, listAlertsEl.checked ? "1" : "0");
  renderListRows();
  saveList();
});
listItemsEl.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.dataset.watch) {
    const entry = findListEntry(target.dataset.watch);
    if (!entry) return;
    entry.watch = nextItemWatch(Boolean(listAlertsEl?.checked), target.checked);
    saveList();
    return;
  }
  if (target.dataset.target) {
    const entry = findListEntry(target.dataset.target);
    if (!entry) return;
    entry.targetPrice = parseTargetPrice(target.value);
    saveList();
  }
});
alertsToggle?.addEventListener("click", () => void openAlerts(!alertsDialog?.open));
$("alerts-close")?.addEventListener("click", () => openAlerts(false));
alertsDialog?.addEventListener("close", () => alertsToggle?.setAttribute("aria-expanded", "false"));
$("push-btn")?.addEventListener("click", () => void enablePush());
for (const button of document.querySelectorAll(".settings-open")) {
  button.addEventListener("click", openSettings);
}
$("settings-close")?.addEventListener("click", () => $("settings-dialog")?.close());
$("open-paywall")?.addEventListener("click", () => openPaywall());
$("paywall-close")?.addEventListener("click", () => $("paywall-dialog")?.close());
$("paywall-restore")?.addEventListener("click", () => void restorePurchases());
$("delete-confirm")?.addEventListener("input", () => {
  const button = $("delete-data-btn");
  const confirmEl = $("delete-confirm");
  if (button && confirmEl) button.disabled = confirmEl.value !== "DELETE";
});
$("delete-data-btn")?.addEventListener("click", () => void deleteMyData());
$("sign-in-apple")?.addEventListener("click", () => void signInWithApple());
$("sign-in-google")?.addEventListener("click", () => void signInWithGoogle());
$("sign-out")?.addEventListener("click", () => void signOut());
$("magic-link-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendMagicLink();
});
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
  if (alertsLoadError && priceAlerts.length === 0) {
    alertsEmptyEl.hidden = false;
    const state = emptyState(alertsLoadError);
    state.actionId = "retry-alerts";
    fillEmpty(alertsEmptyEl, state, "alert");
    alertsListEl.innerHTML = "";
    return;
  }
  alertsEmptyEl.hidden = priceAlerts.length > 0;
  if (priceAlerts.length === 0) {
    fillEmpty(
      alertsEmptyEl,
      alertsEmptyChoice({ billing: billingStatus, alertsOn: Boolean(listAlertsEl?.checked) })
    );
  }
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
    const response = await apiFetch(`/api/price-alerts?deviceId=${encodeURIComponent(deviceId())}`);
    if (!response.ok) throw new Error(`Alerts failed (${response.status})`);
    const body = await response.json();
    priceAlerts = Array.isArray(body.alerts) ? body.alerts : [];
    unreadAlerts = Number(body.unread) || 0;
    alertsLoadError = "";
    paintAlertBadge();
    if (alertsDialog?.open) paintAlertList();
  } catch (error) {
    const kind = networkKind(error, navigator.onLine);
    if (kind) alertsLoadError = kind;
    else if (priceAlerts.length === 0) alertsLoadError = "network";
    paintAlertBadge();
    if (alertsDialog?.open) paintAlertList();
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
    await apiFetch("/api/price-alerts/seen", {
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
    const response = await fetch(apiUrl("/api/price-alerts/status"));
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
    const response = await apiFetch("/api/price-alerts/push", {
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

function clearLocalShopperData() {
  const keys = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key && key.startsWith("gg-")) keys.push(key);
  }
  for (const key of keys) localStorage.removeItem(key);
}

async function unsubscribeLocalPush() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    if (subscription) await subscription.unsubscribe();
  } catch {
    /* the server still drops the stored subscription */
  }
}

function openSettings() {
  const dialog = $("settings-dialog");
  const confirmEl = $("delete-confirm");
  const errorEl = $("delete-error");
  const button = $("delete-data-btn");
  if (confirmEl) confirmEl.value = "";
  if (errorEl) {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }
  if (button) button.disabled = true;
  if (dialog && !dialog.open) dialog.showModal();
  confirmEl?.focus();
  void loadBilling();
}

async function dropKrogerInSystemBrowser() {
  if (!isNative()) return;
  const url = apiUrl("/api/kroger/logout");
  const browser = window.Capacitor?.Plugins?.Browser;
  try {
    if (browser?.open) await browser.open({ url });
    else window.open(url, "_blank", "noopener");
  } catch {
    /* this device's server data is already gone */
  }
}

async function deleteMyData() {
  const button = $("delete-data-btn");
  const errorEl = $("delete-error");
  const confirmEl = $("delete-confirm");
  if (!confirmEl || confirmEl.value !== "DELETE") return;
  deletingData = true;
  window.clearTimeout(watchTimer);
  stopSync();
  if (button) button.disabled = true;
  if (errorEl) errorEl.hidden = true;
  const device = deviceId();
  const owned = readOwned();
  const lists = owned?.shareToken && owned?.ownerToken ? [{ shareToken: owned.shareToken, ownerToken: owned.ownerToken }] : [];
  try {
    await unsubscribeLocalPush();
    const response = await fetch(apiUrl("/api/me/data"), {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(readSessionToken() ? { Authorization: `Bearer ${readSessionToken()}` } : {}),
      },
      credentials: apiOrigin() ? "omit" : "include",
      body: JSON.stringify({ deviceId: device, lists }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Could not delete your data.");
    clearLocalShopperData();
    await dropKrogerInSystemBrowser();
    if (window.location.pathname === "/" && !window.location.search && !window.location.hash) {
      window.location.reload();
    } else {
      window.location.replace("/");
    }
  } catch (error) {
    deletingData = false;
    if (shareState?.shareToken) startSync();
    if (errorEl) {
      errorEl.hidden = false;
      errorEl.textContent = error instanceof Error ? error.message : "Could not delete your data.";
    }
    if (button) button.disabled = confirmEl.value !== "DELETE";
  }
}

function readRemoved() {
  const rows = readStoredJson(REMOVED_KEY);
  return Array.isArray(rows) ? rows.filter((row) => row && typeof row.id === "string") : [];
}

function noteRemoved(id, writtenAt) {
  const rows = readRemoved().filter((row) => row.id !== id);
  rows.push({ id, writtenAt: Number(writtenAt) || Date.now() });
  localStorage.setItem(REMOVED_KEY, JSON.stringify(rows.slice(-100)));
}

function personalListPayload() {
  const source = shareState?.shareToken ? readStoredJson(PERSONAL_KEY) : null;
  const items = Array.isArray(source)
    ? source
    : [...list.values()].map((entry) => ({
        id: entry.product.id,
        itemId: entry.itemId || entry.product.id,
        name: listItemTitle(entry.product).title,
        brand: entry.product.brand || "",
        sizeLabel: listItemTitle(entry.product).detail || entry.product.sizeLabel || "",
        quantity: entry.quantity,
        checked: Boolean(entry.checked),
        addedBy: entry.addedBy,
        checkedBy: entry.checkedBy,
        writtenAt: entry.writtenAt || 0,
        baselinePrice: entry.baselinePrice,
        baselineStore: entry.baselineStore || "",
        watch: entry.watch || "inherit",
        targetPrice: entry.targetPrice ?? null,
      }));
  return {
    listId: savedListId(),
    listName: "My list",
    zip: ZIP_PATTERN.test(normalizeZip(zipEl.value)) ? normalizeZip(zipEl.value).slice(0, 5) : "",
    alertsEnabled: Boolean(listAlertsEl?.checked),
    items: items.filter((item) => item?.id && item?.name).slice(0, 100),
    removed: shareState?.shareToken ? [] : readRemoved(),
    baseRevision: listRevision || null,
  };
}

function authReturnTo() {
  if (!isNative()) return "/";
  return `${window.location.origin}/`;
}

function setAuthMessage(text) {
  const el = $("auth-message");
  if (!el) return;
  el.hidden = !text;
  el.textContent = text || "";
}

function paintAccount() {
  const signedIn = $("account-signed-in");
  const signedOut = $("account-signed-out");
  const who = $("account-who");
  const apple = $("sign-in-apple");
  const google = $("sign-in-google");
  const email = $("magic-link-form");
  if (apple) apple.hidden = !authStatus?.providers?.apple?.enabled;
  if (google) google.hidden = !authStatus?.providers?.google?.enabled;
  if (email) email.hidden = !authStatus?.providers?.email?.enabled;
  if (accountState) {
    if (signedOut) signedOut.hidden = true;
    if (signedIn) signedIn.hidden = false;
    const label = accountState.displayName || accountState.email || "Signed in";
    if (who) who.textContent = `Signed in as ${label}. This list and your alerts sync to your other devices.`;
  } else {
    if (signedIn) signedIn.hidden = true;
    if (signedOut) signedOut.hidden = false;
  }
}

function applyAccountRows(items) {
  applyingAccount = true;
  list.clear();
  for (const row of items ?? []) {
    if (row?.name) rememberLocalRow(row);
  }
  localStorage.removeItem(REMOVED_KEY);
  renderEstimate();
  renderListRows();
  saveList();
  applyingAccount = false;
}

function scheduleAccountSync() {
  if (applyingAccount || !accountState || shareState?.shareToken || !listReady) return;
  window.clearTimeout(listSyncTimer);
  listSyncTimer = window.setTimeout(() => void pushAccountList(), 500);
}

async function pushAccountList() {
  if (!accountState || shareState?.shareToken || applyingAccount) return;
  try {
    const response = await apiFetch("/api/me/list", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(personalListPayload()),
    });
    if (!response.ok) return;
    const body = await response.json();
    if (body.list?.revision) {
      listRevision = body.list.revision;
      localStorage.setItem(REVISION_KEY, String(listRevision));
    }
    if (body.list?.listId) localStorage.setItem(LIST_ID_KEY, body.list.listId);
    localStorage.removeItem(REMOVED_KEY);
  } catch {
    /* the list stays on this device and tries again on the next edit */
  }
}

function rememberServerList(server) {
  if (!server) return;
  listRevision = server.revision || listRevision;
  if (server.revision) localStorage.setItem(REVISION_KEY, String(server.revision));
  if (server.listId) localStorage.setItem(LIST_ID_KEY, server.listId);
  if (server.alertsEnabled && listAlertsEl) {
    listAlertsEl.checked = true;
    localStorage.setItem(ALERTS_KEY, "1");
  }
}

async function syncAccountList() {
  if (!accountState || shareState?.shareToken) return;
  try {
    if (!listRevision) {
      const response = await apiFetch("/api/me/list", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...personalListPayload(), baseRevision: null }),
      });
      if (!response.ok) return;
      const body = await response.json();
      rememberServerList(body.list);
      applyAccountRows(body.list?.items ?? []);
      return;
    }
    const response = await apiFetch("/api/me/list");
    if (!response.ok) return;
    const body = await response.json();
    const server = body.list;
    if (!server) {
      if (list.size) await pushAccountList();
      return;
    }
    if (server.revision > listRevision) {
      rememberServerList(server);
      applyAccountRows(server.items);
      return;
    }
    if (list.size) await pushAccountList();
  } catch {
    /* guest data on this device is unchanged */
  }
}

async function mergeThisDevice() {
  if (!readSessionToken()) return;
  const owned = readOwned();
  await apiFetch("/api/auth/merge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deviceId: deviceId(),
      lists: owned?.shareToken && owned?.ownerToken ? [{ shareToken: owned.shareToken, ownerToken: owned.ownerToken }] : [],
      list: personalListPayload(),
    }),
  });
}

let billingStatus = null;
let purchasesConfigured = false;

function paywallError(text) {
  const el = $("paywall-error");
  if (!el) return;
  el.hidden = !text;
  el.textContent = text || "";
}

function paintPlan() {
  const status = $("plan-status");
  if (!status || !billingStatus) return;
  if (!billingStatus.enforced) {
    status.textContent = "Subscriptions are not turned on yet, so every feature stays available.";
    return;
  }
  status.textContent = billingStatus.pro
    ? "Grocery Gitter Pro is active on this account."
    : "One store and one shared list are free. Pro adds the multi-store split, price alerts, unlimited shared lists, and cart handoffs.";
}

function paintPaywall() {
  const note = $("paywall-note");
  const restore = $("paywall-restore");
  const manage = $("paywall-manage");
  const terms = $("paywall-terms");
  const privacy = $("paywall-privacy");
  const view = paywallView({
    status: billingStatus,
    platform: platformOf(window.Capacitor),
    signedIn: Boolean(accountState?.id || readSessionToken()),
  });
  if (terms) terms.href = view.terms;
  if (privacy) privacy.href = view.privacy;
  if (manage) {
    manage.hidden = !view.manageUrl;
    if (view.manageUrl) manage.href = view.manageUrl;
  }
  if (restore) restore.hidden = !view.native;
  const lines = [];
  if (!view.enforced) lines.push("Subscriptions are not turned on yet, so every feature stays available.");
  if (view.showWebNote) lines.push(view.webNote);
  if (view.needsSignIn) lines.push("Sign in from Settings, then subscribe.");
  if (view.unconfigured) lines.push("Subscriptions are not configured in this build yet.");
  if (view.pro) lines.push("Grocery Gitter Pro is active on this account.");
  if (note) note.textContent = lines.join(" ");
  return view;
}

async function loadBilling() {
  try {
    const response = await apiFetch("/api/billing/status");
    if (!response.ok) return;
    billingStatus = await response.json();
    paintPlan();
  } catch {
    /* the trip still works; Settings can try again */
  }
}

function purchasesPlugin() {
  return window.Capacitor?.Plugins?.Purchases || null;
}

async function configurePurchases(view) {
  const plugin = purchasesPlugin();
  if (!plugin?.configure || !view.canPurchase) return null;
  const appUserID = accountState?.id;
  if (!appUserID) return null;
  const apiKey = sdkKeyFor(billingStatus, view.native ? platformOf(window.Capacitor) : "web");
  if (!purchasesConfigured) {
    await plugin.configure({ apiKey, appUserID });
    purchasesConfigured = true;
  } else if (plugin.logIn) {
    await plugin.logIn({ appUserID });
  }
  return plugin;
}

async function refreshEntitlement() {
  const response = await apiFetch("/api/billing/refresh", { method: "POST" });
  if (!response.ok) return;
  await loadBilling();
  paintPaywall();
}

async function loadOfferings() {
  const view = paintPaywall();
  const box = $("paywall-packages");
  if (!box) return;
  box.innerHTML = "";
  if (!view.canPurchase) return;
  paywallError("");
  try {
    const plugin = await configurePurchases(view);
    if (!plugin?.getOfferings) {
      paywallError("Subscriptions are available in the iOS and Android apps.");
      return;
    }
    const offerings = await plugin.getOfferings();
    const choices = packageChoices(offerings);
    if (!choices.length) {
      paywallError("No subscription is available yet.");
      return;
    }
    for (const choice of choices) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ghost";
      button.textContent = choice.price ? `${choice.title} · ${choice.price}` : choice.title;
      button.addEventListener("click", () => void purchasePackage(plugin, choice.raw));
      box.appendChild(button);
    }
  } catch (error) {
    paywallError(error instanceof Error ? error.message : "Could not load subscriptions.");
  }
}

async function purchasePackage(plugin, aPackage) {
  paywallError("");
  try {
    await plugin.purchasePackage({ aPackage });
    await refreshEntitlement();
    toast("Grocery Gitter Pro is active.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "The purchase did not finish.";
    if (!/cancel/i.test(message)) paywallError(message);
  }
}

async function restorePurchases() {
  const view = paintPaywall();
  if (!view.canPurchase) {
    paywallError(view.showWebNote ? view.webNote : "Sign in from Settings, then restore purchases.");
    return;
  }
  paywallError("");
  try {
    const plugin = await configurePurchases(view);
    if (!plugin?.restorePurchases) {
      paywallError("Subscriptions are available in the iOS and Android apps.");
      return;
    }
    await plugin.restorePurchases();
    await refreshEntitlement();
    toast(billingStatus?.pro ? "Purchases restored." : "No active subscription was found.");
  } catch (error) {
    paywallError(error instanceof Error ? error.message : "Could not restore purchases.");
  }
}

function openPaywall() {
  const dialog = $("paywall-dialog");
  paintPaywall();
  if (dialog && !dialog.open) dialog.showModal();
  void loadOfferings();
}

async function loadAccount() {
  const box = $("account-box");
  try {
    const statusResponse = await apiFetch("/api/auth/status");
    if (!statusResponse.ok) return;
    authStatus = await statusResponse.json();
    if (!authStatus?.enabled) {
      if (box) box.hidden = true;
      return;
    }
    if (box) box.hidden = false;
    const meResponse = await apiFetch("/api/auth/me");
    const me = await meResponse.json().catch(() => ({}));
    accountState = me.account || null;
    paintAccount();
    if (accountState && (arrivedWithSession || localStorage.getItem("gg-merged") !== accountState.id)) {
      await mergeThisDevice();
      localStorage.setItem("gg-merged", accountState.id);
    }
    arrivedWithSession = false;
    if (accountState) await syncAccountList();
  } catch {
    if (box) box.hidden = true;
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load sign-in."));
    document.head.appendChild(script);
  });
}

async function finishIdentity(path, extra) {
  setAuthMessage("");
  const owned = readOwned();
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...extra,
      deviceId: deviceId(),
      lists: owned?.shareToken && owned?.ownerToken ? [{ shareToken: owned.shareToken, ownerToken: owned.ownerToken }] : [],
      list: personalListPayload(),
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Could not sign in.");
  if (body.token) localStorage.setItem(SESSION_KEY, body.token);
  accountState = body.account || null;
  paintAccount();
  await syncAccountList();
  setAuthMessage("Signed in.");
}

async function signInWithApple() {
  setAuthMessage("");
  try {
    const plugin = window.Capacitor?.Plugins?.SignInWithApple;
    if (isNative() && plugin?.authorize) {
      const result = await plugin.authorize({
        clientId: authStatus?.providers?.apple?.clientId,
        redirectURI: `${apiOrigin() || window.location.origin}/api/auth/apple/callback`,
        scopes: "email name",
      });
      const identityToken = result?.response?.identityToken || result?.identityToken;
      const given = result?.response?.givenName || result?.givenName || "";
      const family = result?.response?.familyName || result?.familyName || "";
      if (identityToken) {
        await finishIdentity("/api/auth/apple", {
          identityToken,
          displayName: [given, family].filter(Boolean).join(" "),
        });
        return;
      }
    }
    if (!isNative() && authStatus?.providers?.apple?.clientId) {
      await loadScript("https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js");
      window.AppleID.auth.init({
        clientId: authStatus.providers.apple.clientId,
        scope: "name email",
        redirectURI: `${window.location.origin}/api/auth/apple/callback`,
        usePopup: true,
      });
      const result = await window.AppleID.auth.signIn();
      const name = [result?.user?.name?.firstName, result?.user?.name?.lastName].filter(Boolean).join(" ");
      await finishIdentity("/api/auth/apple", { identityToken: result.authorization.id_token, displayName: name });
      return;
    }
    const params = new URLSearchParams({ return: authReturnTo(), deviceId: deviceId() });
    window.location.assign(apiUrl(`/api/auth/apple/start?${params.toString()}`));
  } catch (error) {
    if (error?.error === "popup_closed_by_user") return;
    setAuthMessage(error instanceof Error ? error.message : "Could not sign in with Apple.");
  }
}

async function signInWithGoogle() {
  setAuthMessage("");
  try {
    const plugin = window.Capacitor?.Plugins?.GoogleAuth;
    if (isNative() && plugin?.signIn) {
      const result = await plugin.signIn();
      const idToken = result?.authentication?.idToken || result?.idToken;
      if (idToken) {
        await finishIdentity("/api/auth/google", { idToken, displayName: result?.displayName || result?.name });
        return;
      }
    }
    if (authStatus?.providers?.google?.redirect) {
      const params = new URLSearchParams({ return: authReturnTo(), deviceId: deviceId() });
      window.location.assign(apiUrl(`/api/auth/google/start?${params.toString()}`));
      return;
    }
    const clientId = authStatus?.providers?.google?.clientId;
    if (!clientId) throw new Error("Google sign-in is not configured.");
    await loadScript("https://accounts.google.com/gsi/client");
    await new Promise((resolve, reject) => {
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          finishIdentity("/api/auth/google", { idToken: response.credential })
            .then(resolve)
            .catch(reject);
        },
      });
      window.google.accounts.id.prompt((notification) => {
        if (notification?.isNotDisplayed?.() || notification?.isSkippedMoment?.()) {
          reject(new Error("Google sign-in did not open. Try again."));
        }
      });
    });
  } catch (error) {
    setAuthMessage(error instanceof Error ? error.message : "Could not sign in with Google.");
  }
}

async function sendMagicLink() {
  setAuthMessage("");
  const email = $("magic-email")?.value?.trim() || "";
  try {
    const response = await apiFetch("/api/auth/email/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, return: "/" }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Could not send the email.");
    setAuthMessage(
      isNative()
        ? "Check your email. The link opens Grocery Gitter in the browser and expires in 20 minutes."
        : "Check your email for a sign-in link. It expires in 20 minutes."
    );
  } catch (error) {
    setAuthMessage(error instanceof Error ? error.message : "Could not send the email.");
  }
}

async function signOut() {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } catch {
    /* the token on this device is still dropped */
  }
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem("gg-merged");
  accountState = null;
  paintAccount();
  setAuthMessage("Signed out. This device can keep shopping without an account.");
}

function adoptSessionFromUrl() {
  const token = sessionFromSearch(window.location.search);
  if (!token) return;
  localStorage.setItem(SESSION_KEY, token);
  arrivedWithSession = true;
  const next = pathWithoutSession(window.location.pathname, window.location.search);
  history.replaceState({}, "", next);
}

async function boot() {
  try {
    adoptSessionFromUrl();
    consumeKrogerReturn();
    listRevision = Number(localStorage.getItem(REVISION_KEY) || "0") || 0;
    await bootApp();
  } finally {
    welcome.maybeAutoOpen();
    const wantsAlerts = new URLSearchParams(location.search).get("alerts") === "1";
    const onboard = $("onboarding");
    if (wantsAlerts && onboard?.open) {
      onboard.addEventListener("close", () => void openAlerts(true), { once: true });
    } else if (wantsAlerts) {
      void openAlerts(true);
    }
  }
}

async function bootApp() {
  applyTheme(localStorage.getItem(THEME_KEY) || "system");
  zipEl.value = localStorage.getItem(ZIP_KEY) || "";
  allowSubsEl.checked = localStorage.getItem(SUBS_KEY) === "1";
  if (listAlertsEl) listAlertsEl.checked = localStorage.getItem(ALERTS_KEY) === "1";
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
  if (typeof navigator !== "undefined" && navigator.onLine === false && restoreOfflineTrip()) {
    showCatalogError("You're offline. This trip is saved on this device.");
    if (resultCountEl) resultCountEl.textContent = "Saved on this device";
    listLoading = false;
    listReady = true;
    return;
  }
  try {
    const deptResponse = await fetch(apiUrl("/api/catalog/departments"));
    if (!deptResponse.ok) throw new Error(`Departments failed (${deptResponse.status})`);
    const deptBody = await deptResponse.json();
    departments = deptBody.departments ?? [];
  } catch (error) {
    departments = [];
    const kind = networkKind(error, navigator.onLine) || "network";
    const state = emptyState(kind);
    if (gridEl) {
      gridEl.innerHTML = emptyStateMarkup(state, escapeHtml, "alert");
      resultCountEl.textContent = state.title;
    }
  }
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
  listReady = true;
  renderEstimate();
  saveList();
  await loadAccount();
  await loadBilling();
  await refreshAlerts();
  await loadPushStatus();
  await loadPage(true);
  if (!isNative() && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "price-alerts") void openAlerts(true);
    });
  }
  window.setInterval(() => void refreshAlerts(), 60_000);
}

document.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest("[data-empty-action]") : null;
  if (!button) return;
  const action = button.getAttribute("data-empty-action");
  if (action === "browse") {
    openList(false);
    void openAlerts(false);
    searchEl.focus();
  } else if (action === "clear-search") {
    query = "";
    searchEl.value = "";
    closeSuggestions();
    void loadPage(true);
    searchEl.focus();
  } else if (action === "clear-filters") {
    activeDepartment = "all";
    query = "";
    searchEl.value = "";
    closeSuggestions();
    renderDepartments();
    $("filters-clear")?.click();
  } else if (action === "retry") {
    void loadPage(true);
  } else if (action === "retry-alerts") {
    void refreshAlerts().then(() => paintAlertList());
  } else if (action === "retry-share") {
    if (shareProblemToken) void openSharedList(shareProblemToken);
  } else if (action === "edit-zip") {
    $("trip-back")?.click();
    zipEl.focus();
  } else if (action === "enable-alerts") {
    if (listAlertsEl && !listAlertsEl.checked) {
      listAlertsEl.checked = true;
      listAlertsEl.dispatchEvent(new Event("change"));
    }
    void openAlerts(false);
    openList(true);
    listAlertsEl?.focus();
  } else if (action === "see-pro") {
    openPaywall();
  }
});

const welcome = mountWelcome({
  isNative,
  apiUrl,
  fetch: (...args) => globalThis.fetch(...args),
  getZip: () => normalizeZip(zipEl.value),
  setZip: (zip) => applyZip(zip),
  focusZip: () => zipEl.focus(),
  readCoords: readDeviceCoords,
  openAuthorize,
  toast,
  themeLabel: () => themeButtonLabel(document.documentElement.dataset.theme || "system", window.matchMedia("(prefers-color-scheme: dark)").matches),
  cycleTheme: () => applyTheme(nextTheme(document.documentElement.dataset.theme || "system")),
  accountsEnabled: () => Boolean(authStatus?.enabled),
  signedIn: () => Boolean(accountState?.id),
  getBilling: () => billingStatus,
});

void boot().finally(() => {
  void hideSplash();
});
