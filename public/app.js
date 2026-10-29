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
  themeShortLabel,
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
import { ONBOARDING_KEY } from "./shopper/onboarding.js";
import { getUserProfile, mergeProfiles, profileIsStored, saveUserProfile, shouldPromptProfile } from "./shopper/profile.js";
import {
  defaultHeadcount,
  exclusionWarning,
  filterTiles,
  firstListId,
  pinnedUsualRows,
  profileToConstraints,
  shapeImportReview,
  slotIsExcluded,
} from "./shopper/profileConstraints.js";
import {
  acceptAlways,
  declineAlways,
  familyFromQuery,
  familyLabel,
  guideSlot,
  learnPreference,
  resolveProductPreference,
  shouldAskAlways,
} from "./shopper/productPreference.js";
import { mountProfileOnboarding } from "./shopper/profileOnboardingUi.js";
import { mountAlwaysPrompt, mountMyProducts } from "./shopper/myProductsUi.js";
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
  writeCheck,
} from "./shopper/tripPlan.js";
import {
  couponPageFor,
  couponSavingsSummary,
  couponSummaryMarkup,
  isClipped,
  parseCouponForm,
  readCoupons,
  removeCoupon,
  saleBadgeMarkup,
  couponLineLabel,
  shopCouponHint,
  storeCouponMarkup,
  todayKey,
  upsertCoupon,
  writeClipped,
  writeCoupons,
} from "./shopper/coupons.js";
import { pathWithoutSession, sessionFromSearch, SESSION_KEY } from "./shopper/account.js";
import { packageChoices, paywallView, platformOf, sdkKeyFor } from "./shopper/billing.js";
import { displayProductName, listItemTitle, stagedQuantity } from "./shopper/familyTile.js";
import { selectBestValue, unitSortLabel, valueRow } from "./shopper/bestValue.js";
import { bottomChrome, planBarCopy, readFlowStep, shouldAskToSignIn, stepTitle } from "./shopper/flow.js";
import { nextTrapTarget, swipeClosesDrawer } from "./shopper/drawer.js";
import { zipPlaceLabel } from "./shopper/zipPlace.js";
import {
  KROGER_CART_URL,
  KROGER_CONNECTED_KEY,
  krogerBrowserShouldClose,
  krogerCallbackSucceeded,
  krogerReturnMarksConnected,
  parseKrogerReturn,
} from "./shopper/krogerReturn.js";
import { matchPick, readUsuals, rememberUsuals, starterList } from "./shopper/usuals.js";
import { mountImport } from "./shopper/import.js";
import { askIntent } from "./shopper/askIntent.js";
import { describeMeal } from "./shopper/mealIdeas.js";
import { createListHome } from "./shopper/listHome.js";
import { calmPriceNote, ESTIMATE_NOTE, fewerStopsOffer, plainSwap, priceFigure, savingsCard, shelfNote, shopperCopy } from "./shopper/calmPlan.js";
import { cachedTrip, doneMessage, shopProgress, shopSections, swapChoices } from "./shopper/inStore.js";
import { keepAwake, keyboardOverlap, lightTap, moreChips, pullDistance, pullShouldRefresh, pullStatusText } from "./shopper/phone.js";
import { fetchWithTimeout, PLAN_TIMEOUT_MS, planTimedOut } from "./shopper/planLoad.js";
import { isHomeScreenApp, shouldApplyShellUpdate } from "./shopper/shellUpdate.js";

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

const STEP_KEY = "gg-step";
const SHELL_UPDATED_KEY = "gg-shell-updated";
const WALMART_RETURN_KEY = "gg-walmart-return";
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
let browseOpen = false;
let importer = null;
let profileUi = null;
let myProducts = null;
let alwaysPrompt = null;
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
let shelfTimer = 0;
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
  return Boolean($("filter-brand").value || $("filter-sale").checked || $("filter-budget").checked);
}

function refineCount() {
  let count = 0;
  if ($("filter-brand")?.value) count += 1;
  if ($("filter-sale")?.checked) count += 1;
  if ($("filter-budget")?.checked) count += 1;
  if (sortEl?.value && sortEl.value !== "relevance") count += 1;
  return count;
}

function paintRefine() {
  const count = refineCount();
  const badge = $("refine-count");
  const button = $("filters-open");
  if (badge) {
    badge.hidden = count === 0;
    badge.textContent = String(count);
  }
  if (button) button.setAttribute("aria-label", count ? `Refine, ${count} active` : "Refine");
}

function shelfRequested() {
  return browseOpen || Boolean(String(query || "").trim());
}

function syncBrowse() {
  const add = flowStep === "add";
  const showShelf = add && shelfRequested();
  const panel = $("browse-panel");
  const toggle = $("browse-toggle");
  const label = $("browse-label");
  const hint = $("ask-hint");
  const browse = $("browse");
  if (panel) panel.hidden = !showShelf;
  if (browse) browse.hidden = !add;
  if (hint) hint.hidden = !add || Boolean(query);
  const start = $("start-here");
  if (start) start.hidden = !add || Boolean(query);
  if (label) label.textContent = browseOpen ? "Hide the aisle" : "Browse all items";
  if (toggle) {
    toggle.hidden = !add || Boolean(query);
    toggle.setAttribute("aria-expanded", browseOpen ? "true" : "false");
  }
  document.body.dataset.browse = browseOpen ? "open" : "closed";
  document.body.dataset.results = query ? "search" : "";
  paintRefine();
}

function openBrowse() {
  browseOpen = true;
  syncBrowse();
  if (gridEl && !gridEl.querySelector(".card, .empty-state, .skeleton")) void loadPage(true);
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
    await armKrogerBrowserWatch();
    await openExternal(url);
    return;
  }
  window.location.assign(url);
}

function paintZipPlace() {
  const el = $("zip-place");
  if (!el) return;
  const zip = normalizeZip(zipEl.value);
  el.textContent = ZIP_PATTERN.test(zip) ? zipPlaceLabel(zip) : "Add a ZIP for nearby stores";
}

function applyZip(zip, { reload = true } = {}) {
  const normalized = normalizeZip(zip);
  zipEl.value = normalized;
  paintZipPlace();
  if (!ZIP_PATTERN.test(normalized)) return;
  localStorage.setItem(ZIP_KEY, normalized);
  scheduleWatchSync();
  if (reload) void loadPage(true);
}

let toastTimer = 0;
let flowStep = "add";
let planning = false;
/** @type {AbortController | null} */
let planAbort = null;
let wakeLock = null;
let showReturnBanner = false;
let sawAppHidden = false;
let accountAskNext = null;
let accountAskDeclined = false;
let pullStart = null;
let pullTravel = 0;
let pullActive = false;
let lastBarTotal = 0;

function toast(message, durationMs = 1600) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), durationMs);
}

function setBusy(el, on) {
  if (!(el instanceof HTMLElement)) return;
  el.classList.toggle("is-busy", Boolean(on));
  if (on) el.setAttribute("aria-busy", "true");
  else el.removeAttribute("aria-busy");
}

function hidePullStatus() {
  pullActive = false;
  pullStart = null;
  pullTravel = 0;
  const status = $("pull-status");
  if (status) status.hidden = true;
}

function syncPullStatus() {
  const status = $("pull-status");
  if (!status) return;
  const label = pullStatusText(pullTravel, pullActive);
  status.hidden = !label;
  if (label) status.textContent = label;
}

function markWalmartHandoff() {
  try {
    sessionStorage.setItem(WALMART_RETURN_KEY, "1");
  } catch {
    /* private browsing */
  }
}

function takeWalmartReturn() {
  let pending = false;
  try {
    pending = sessionStorage.getItem(WALMART_RETURN_KEY) === "1";
    if (pending) sessionStorage.removeItem(WALMART_RETURN_KEY);
  } catch {
    pending = false;
  }
  return pending;
}

function showWalmartReturn() {
  if (!takeWalmartReturn()) return;
  showReturnBanner = true;
  if (flowStep !== "shop") showStep("shop");
  else renderShop();
  toast("Back in Grocery Gitter: mark what you bought.", 4200);
}

function noteAppHidden() {
  sawAppHidden = true;
}

function noteAppVisible() {
  if (flowStep === "shop") void engageWake();
  if (sawAppHidden) showWalmartReturn();
}

function toastShellUpdate() {
  try {
    if (localStorage.getItem(SHELL_UPDATED_KEY) !== "1") return;
    localStorage.removeItem(SHELL_UPDATED_KEY);
  } catch {
    return;
  }
  toast("Updated.", 2400);
}

function shellFlag(key) {
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function setShellFlag(key, on) {
  try {
    if (on) sessionStorage.setItem(key, "1");
    else sessionStorage.removeItem(key);
  } catch {
    /* private browsing */
  }
}

function markShellPending() {
  try {
    localStorage.setItem(SHELL_UPDATED_KEY, "1");
  } catch {
    /* private browsing */
  }
  setShellFlag("gg-apply-shell", true);
}

function applyShellOnOpen() {
  const homeScreen = isHomeScreenApp(
    typeof navigator === "undefined" ? null : navigator,
    typeof window.matchMedia === "function" ? (query) => window.matchMedia(query) : undefined
  );
  if (
    !shouldApplyShellUpdate({
      pending: shellFlag("gg-apply-shell"),
      hidden: document.visibilityState === "hidden",
      homeScreen,
      alreadyReloaded: shellFlag("gg-shell-reloaded"),
      sawHidden: sawAppHidden,
    })
  ) {
    return;
  }
  setShellFlag("gg-shell-reloaded", true);
  setShellFlag("gg-apply-shell", false);
  window.location.reload();
}

function nudgeShell(registration) {
  if (!registration) return;
  if (registration.waiting && navigator.serviceWorker.controller) {
    registration.waiting.postMessage({ type: "skip-waiting" });
  }
  void registration.update().catch(() => {});
}

function watchShellUpdates() {
  if (isNative() || !("serviceWorker" in navigator)) return;
  let hadController = Boolean(navigator.serviceWorker.controller);
  /** @type {ServiceWorkerRegistration | null} */
  let registration = null;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) {
      hadController = true;
      return;
    }
    if (shellFlag("gg-shell-reloaded")) return;
    markShellPending();
    // A tap can focus the window. Reloading here would swallow that tap.
    if (document.visibilityState === "hidden") return;
  });
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "price-alerts") void openAlerts(true);
    if (event.data?.type === "shell-updated" && hadController && !shellFlag("gg-shell-reloaded")) markShellPending();
  });
  const onOpen = () => {
    nudgeShell(registration);
    applyShellOnOpen();
  };
  window.addEventListener("pageshow", onOpen);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") onOpen();
  });
  navigator.serviceWorker
    .register("/sw.js", { updateViaCache: "none" })
    .then((next) => {
      registration = next;
      nudgeShell(next);
      next.addEventListener("updatefound", () => {
        const worker = next.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            worker.postMessage({ type: "skip-waiting" });
          }
        });
      });
    })
    .catch(() => {});
}

let landedFromKroger = false;
/** @type {Promise<void> | null} */
let krogerWatch = null;

function krogerConnectedNow() {
  try {
    return localStorage.getItem(KROGER_CONNECTED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Drop sign-in sheets, the drawer scrim, and scroll locks so the dock can take taps. */
function releasePageForTaps() {
  document.querySelectorAll("dialog[open]").forEach((dialog) => {
    try {
      dialog.close();
    } catch {
      /* already closing */
    }
  });
  document.querySelector(".filters")?.classList.remove("open");
  document.querySelector(".list-panel")?.classList.remove("open");
  $("filters-open")?.setAttribute("aria-expanded", "false");
  $("list-toggle")?.setAttribute("aria-expanded", "false");
  closeDrawer({ restoreFocus: false });
  const scrim = $("drawer-scrim");
  if (scrim) scrim.hidden = true;
  document.body.inert = false;
  document.querySelector(".shell")?.removeAttribute("inert");
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
  document.body.style.position = "";
  document.body.style.pointerEvents = "";
  document.documentElement.style.pointerEvents = "";
  document.body.classList.remove("modal-open");
}

function paintKrogerConnected(connected) {
  const on = Boolean(connected);
  const card = $("kroger-card");
  if (card) card.hidden = !on;
  const line = $("settings-kroger");
  const connect = $("settings-kroger-connect");
  const ready = $("settings-kroger-ready");
  if (on) {
    if (line) line.textContent = "Kroger connected";
    if (connect) connect.hidden = true;
    if (ready) ready.hidden = false;
  }
}

function rememberKrogerConnected() {
  try {
    localStorage.setItem(KROGER_CONNECTED_KEY, "1");
  } catch {
    /* private browsing */
  }
  paintKrogerConnected(true);
  if (flowStep === "plan" && lastOptimize) paintTrip();
  if (flowStep === "shop") renderShop();
}

function krogerBannerHtml() {
  if (!krogerConnectedNow()) return "";
  return `<section class="kroger-card" data-kroger-banner>
    <h2>Kroger connected</h2>
    <button type="button" class="primary" data-kroger-send>Send to Kroger cart</button>
    <a href="${KROGER_CART_URL}" data-kroger-cart rel="noopener">Open Kroger cart</a>
  </section>`;
}

function applyKrogerReturn(parsed) {
  if (!parsed) return;
  landedFromKroger = true;
  try {
    localStorage.setItem(ONBOARDING_KEY, "1");
  } catch {
    /* private browsing */
  }
  releasePageForTaps();
  if (krogerReturnMarksConnected(parsed.kind)) rememberKrogerConnected();
  if (parsed.step) showStep(parsed.step);
  toast(parsed.message, 6500);
}

/** OAuth callback lands on /?kroger=connected|added|error&step=…&message=… */
function consumeKrogerReturn() {
  const parsed = parseKrogerReturn(window.location.search);
  if (!parsed) return;
  const params = new URLSearchParams(window.location.search);
  params.delete("kroger");
  params.delete("message");
  params.delete("step");
  const query = params.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  history.replaceState({}, "", next);
  applyKrogerReturn(parsed);
}

async function refreshKrogerFromServer() {
  try {
    const response = await apiFetch("/api/kroger/auth-status", {
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    const body = await response.json().catch(() => ({}));
    if (body.connected) {
      rememberKrogerConnected();
      return;
    }
    if (response.ok && body.oauthConfigured && body.connected === false && !apiOrigin()) {
      try {
        localStorage.removeItem(KROGER_CONNECTED_KEY);
      } catch {
        /* private browsing */
      }
    }
  } catch {
    /* the phone can still show the connected state from this device */
  }
  paintKrogerConnected(krogerConnectedNow());
}

async function armKrogerBrowserWatch() {
  const browser = window.Capacitor?.Plugins?.Browser;
  if (!isNative() || !browser?.addListener || krogerWatch) return;
  let sawCode = false;
  let applied = false;
  /** @type {Array<{ remove?: () => Promise<void> | void }>} */
  const handles = [];
  const stop = async () => {
    krogerWatch = null;
    for (const handle of handles.splice(0)) {
      try {
        await handle.remove?.();
      } catch {
        /* listener already removed */
      }
    }
  };
  const applyOnce = (parsed) => {
    if (!parsed || applied) return;
    applied = true;
    applyKrogerReturn(parsed);
  };
  krogerWatch = Promise.resolve();
  try {
    handles.push(
      await browser.addListener("browserPageLoaded", (event) => {
        const url = String(event?.url || "");
        if (krogerCallbackSucceeded(url)) sawCode = true;
        if (!krogerBrowserShouldClose(url)) return;
        applyOnce(parseKrogerReturn(url));
        void browser.close?.();
        void stop();
      })
    );
    handles.push(
      await browser.addListener("browserFinished", () => {
        if (!applied && sawCode) {
          applyOnce({
            kind: "connected",
            message: "Kroger connected.",
            step: "plan",
          });
        } else {
          releasePageForTaps();
        }
        void refreshKrogerFromServer();
        void stop();
      })
    );
  } catch {
    krogerWatch = null;
  }
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
    lastBarTotal = 0;
    renderListRows();
    paintPlanBar();
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
  lastBarTotal = meter.status === "empty" ? 0 : meter.splitTotal;
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
  paintPlanBar();
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
        <div class="list-copy">
          <label class="got-it">
            <input type="checkbox" data-list-check="${escapeHtml(itemId)}" ${entry.checked ? "checked" : ""} ${locked ? "disabled" : ""} aria-label="Check off ${escapeHtml(heading.title)}" />
            <strong>${escapeHtml(heading.title)}</strong>
          </label>
          <p class="muted">${escapeHtml(heading.detail)}</p>
          ${entry.preferenceFamily ? `<button type="button" class="text-btn" data-pref-change="${escapeHtml(entry.preferenceFamily)}">Change</button>` : ""}
          ${credit ? `<p class="muted attribution">${escapeHtml(credit)}</p>` : ""}
          <button type="button" class="watch-opt" data-watch-open="${escapeHtml(itemId)}" aria-expanded="${watched || targetValue ? "true" : "false"}" aria-controls="watch-${escapeHtml(itemId)}" aria-label="Price watch for ${escapeHtml(heading.title)}">${watched || targetValue ? "Hide price watch" : "Price watch"}</button>
          <div class="alert-controls" id="watch-${escapeHtml(itemId)}"${watched || targetValue ? "" : " hidden"}>
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

function addProduct(product, quantity = 1, options = {}) {
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
  if (options.preference?.swapped) {
    entry.preferenceSwap = options.preference.swapped;
    entry.preferenceFamily = options.preference.family;
  } else if (options.preference?.family) {
    entry.preferenceFamily = options.preference.family;
  } else if (options.preferenceFamily) {
    entry.preferenceFamily = options.preferenceFamily;
  }
  const family = entry.preferenceFamily || familyFromQuery(`${product.familyName || ""} ${product.name || ""}`);
  if (family) entry.preferenceFamily = family;
  if (options.learn !== false && family && !options.skipLearn) {
    const profile = getUserProfile(localStorage);
    const learned = learnPreference(profile, product, {
      family,
      locked: Boolean(options.lock),
      source: options.source || "add",
      replace: Boolean(options.replace),
    });
    saveUserProfile(localStorage, learned);
    scheduleAccountSync();
  }
  const added = listItemTitle(product);
  if (!options.quiet) toast(`Added ${added.title}${added.detail ? ` (${added.detail})` : ""}`);
  if (!options.quiet && !options.skipAsk && shouldAskAlways(getUserProfile(localStorage), product)) {
    alwaysPrompt?.ask(product, familyLabel(family) || added.title);
  }
  paintPlanBar();
  paintUsuals();
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
  if (!brand || String(title).toLowerCase().startsWith(brand.toLowerCase())) return "";
  return brand;
}

function priceText(variant) {
  const amount = variant?.typicalPrice ?? variant?.bestOffer?.price ?? variant?.price;
  return Number.isFinite(Number(amount)) ? money(amount) : "";
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

/** Nudge a tall card's add row above the plan bar. The row also sticks while the card scrolls. */
function settleCard(card) {
  if (!card || !phoneShelf()) return;
  const actions = card.querySelector(".card-actions");
  const bar = document.querySelector(".list-bar");
  if (!actions || !bar || getComputedStyle(bar).display === "none") return;
  const limit = bar.getBoundingClientRect().top - 8;
  const rect = actions.getBoundingClientRect();
  if (rect.bottom > limit + 1) window.scrollBy({ top: rect.bottom - limit, left: 0 });
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
  if (priceEl) priceEl.textContent = priceText(variant);
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
  const brand = $("filter-brand").value;
  if (brand) params.set("brand", brand);
  if ($("filter-sale").checked) params.set("onSale", "1");
  if ($("filter-budget").checked) params.set("storeBrand", "1");
  params.set("sort", sortEl.value || "relevance");
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
    <div class="card-lead">
      <button class="card-open" type="button" data-open="${escapeHtml(selected.id)}" aria-label="Details for ${escapeHtml(title)}">
        <img src="${escapeHtml(mediaUrl(image))}" data-rest="${escapeHtml((selected.imageUrls || tile.imageUrls || []).slice(1).join("\n"))}" alt="" />
      </button>
      <div class="card-summary">
        ${brand ? `<p class="brand">${escapeHtml(brand)}</p>` : ""}
        <h3>${escapeHtml(title)}</h3>
        <p class="price" data-price>${escapeHtml(priceText(selected))}</p>
        <div class="card-actions">
          <label class="check card-add">
            <input type="checkbox" data-check="${escapeHtml(selected.id)}" ${checked} aria-label="Add ${escapeHtml(title)}${variantNote ? `, ${escapeHtml(variantNote)},` : ""} to my list" />
            Add
          </label>
          <div class="stepper">
            <button type="button" data-dec="${escapeHtml(selected.id)}" aria-label="Decrease quantity of ${escapeHtml(title)}">−</button>
            <output>${qty}</output>
            <button type="button" data-inc="${escapeHtml(selected.id)}" aria-label="Increase quantity of ${escapeHtml(title)}">+</button>
          </div>
        </div>
      </div>
    </div>
    <div class="card-body">
      ${flavorRow}
      ${sizeRow}
    </div>
  </article>`;
}

function skeletons() {
  gridEl.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton" aria-hidden="true"></div>').join("");
}

function fillFacets(facets) {
  const brand = $("filter-brand");
  if (!brand) return;
  const current = brand.value;
  const values = facets.brands ?? [];
  brand.innerHTML = [`<option value="">All brands</option>`]
    .concat(values.map((value) => `<option ${value === current ? "selected" : ""}>${escapeHtml(value)}</option>`))
    .join("");
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
  requestAnimationFrame(syncChipHint);
}

function syncChipHint() {
  const row = $("dept-chips");
  const hint = $("chip-hint");
  if (!row || !hint) return;
  hint.hidden = !moreChips(row.scrollLeft, row.clientWidth, row.scrollWidth);
}

function bindKeyboardInset() {
  const apply = () => {
    const viewport = window.visualViewport;
    const overlap = viewport ? keyboardOverlap(window.innerHeight, viewport.height, viewport.offsetTop) : 0;
    document.documentElement.style.setProperty("--keyboard", `${overlap}px`);
  };
  apply();
  window.visualViewport?.addEventListener("resize", apply);
  window.visualViewport?.addEventListener("scroll", apply);
}

function showCatalogError(message) {
  catalogErrorEl.hidden = !message;
  catalogErrorEl.textContent = message;
}

function showProfileWarning(message) {
  const el = $("profile-warning");
  if (!el) return;
  el.hidden = !message;
  el.textContent = message || "";
}

function shelfForProfile(items, search) {
  const profile = getUserProfile(localStorage);
  const warning = search ? exclusionWarning(profile, search) : "";
  if (warning) return { items, warning, resolved: null };
  const filtered = filterTiles(profile, items, search);
  if (!search) return { items: filtered, warning: "", resolved: null };
  const resolved = resolveProductPreference({ profile, query: search, products: flattenTiles(filtered) });
  if (!resolved.product || (resolved.status !== "preferred" && resolved.status !== "brand" && resolved.status !== "swapped")) {
    return { items: filtered, warning: "", resolved: null };
  }
  const id = resolved.product.id;
  const only = filtered.filter((tile) => {
    const variants = Array.isArray(tile.variants) ? tile.variants : [];
    return tile.id === id || tile.defaultVariantId === id || variants.some((variant) => variant.id === id);
  });
  return { items: only.length ? only : [resolved.product], warning: "", resolved };
}

async function loadPage(reset) {
  if (loading) return;
  if (!reset && !nextCursor) return;
  loading = true;
  if (reset) {
    if (flowStep === "add" && !gridEl.querySelector(".card")) skeletons();
    nextCursor = null;
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
    const viewed = reset ? shelfForProfile(items, query) : { items, warning: "", resolved: null };
    if (reset) showProfileWarning(viewed.warning);
    const banner = viewed.resolved
      ? `<p class="swap-quiet">Your ${escapeHtml(familyLabel(viewed.resolved.family) || "usual")}. <button type="button" class="linkish" data-pref-change="${escapeHtml(viewed.resolved.family)}">Change</button></p>`
      : "";
    const html = viewed.items.map(cardHtml).join("");
    gridEl.innerHTML = reset ? banner + html : gridEl.innerHTML + html;
    if (!viewed.items.length && reset) {
      const kind = catalogEmptyKind({ query, filtered: hasActiveFilters() });
      const state = kind === "search" ? searchEmpty(query) : emptyState(kind);
      gridEl.innerHTML = emptyStateMarkup(state, escapeHtml);
      resultCountEl.textContent = state.title;
    } else {
      if (viewed.resolved) {
        resultCountEl.textContent = `Your ${familyLabel(viewed.resolved.family) || "usual"}`;
      } else {
        const label = query ? `Results for “${query}”` : activeDepartment === "all" ? "All departments" : departments.find((d) => d.id === activeDepartment)?.name || "Aisle";
        resultCountEl.textContent = `${total} ${total === 1 ? "product" : "products"} · ${label}`;
      }
    }
    const more = $("show-more");
    if (more) more.hidden = !nextCursor;
    const zipOk = ZIP_PATTERN.test(normalizeZip(zipEl.value));
    const weeklyAds = (coverage || []).some((store) => store.mode === "weekly_ad_only");
    if (coverageBannerEl) {
      coverageBannerEl.textContent = shelfNote({
        demo: catalogSource === "demo",
        zipOk,
        weeklyAds,
      });
    }
    const hardWarnings = (body.warnings ?? [])
      .map((warning) => shopperCopy(warning))
      .filter((warning) => warning && !/5-digit US ZIP/i.test(warning));
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
    syncStepVisibility();
    if (reset && nextCursor && sentinelEl.getBoundingClientRect().top < window.innerHeight + 40) {
      void loadPage(false);
    }
  }
}

function selectDepartment(id) {
  browseOpen = true;
  activeDepartment = id;
  query = "";
  searchEl.value = "";
  closeSuggestions();
  renderDepartments();
  syncBrowse();
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

function mealLabel(meal) {
  return meal.namedPeople ? `${meal.title} for ${meal.people}` : meal.title;
}

function showMealIdea(meal) {
  suggestions = [];
  suggestionQuery = searchEl.value.trim();
  activeSuggest = -1;
  suggestStatus.hidden = true;
  suggestionsEl.hidden = false;
  suggestionsEl.innerHTML = `<li role="presentation"><button type="button" class="suggest-option meal-idea" role="option" id="suggest-meal" data-meal="1" aria-selected="false">
    <span>
      <span class="suggest-name">${escapeHtml(mealLabel(meal))}</span>
      <span class="suggest-meta">${escapeHtml(meal.blurb)}</span>
    </span>
  </button></li>`;
  suggestPanel.hidden = false;
  searchEl.setAttribute("aria-expanded", "true");
  searchEl.removeAttribute("aria-activedescendant");
}

function showListAsk(value) {
  const meal = describeMeal(value);
  if (meal) {
    showMealIdea(meal);
    return;
  }
  showSuggestStatus("Press Enter to match these items.");
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
      const price = suggestionPriceLabel(item.bestPrice, "", (value) => money(value));
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
  syncBrowse();
  void loadPage(true);
}

async function loadSuggestions(text) {
  const q = text.trim();
  if (!q) {
    suggestions = [];
    suggestionQuery = "";
    activeSuggest = -1;
    showSuggestStatus("Type a product, or a meal like taco night for 6.");
    return;
  }
  if (askIntent(q) === "list") {
    suggestAbort?.abort();
    suggestions = [];
    suggestionQuery = q;
    activeSuggest = -1;
    showListAsk(q);
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
    const profile = getUserProfile(localStorage);
    const warning = exclusionWarning(profile, q);
    showProfileWarning(warning);
    suggestions = warning ? body.suggestions ?? [] : filterTiles(profile, body.suggestions ?? [], q);
    suggestionQuery = q;
    activeSuggest = -1;
    if (suggestions.length === 0) {
      showSuggestStatus(warning || `No matches for “${q}”. Press Enter to search the shelves.`);
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
  paintRefine();
  if (open) $("sort")?.focus();
}

function openProduct(product) {
  const title = product.familyName || product.name;
  const note = product.variantLabel || product.sizeLabel || "";
  productDialog.innerHTML = `<div class="sheet-body">
    <img class="hero" src="${escapeHtml(mediaUrl(product.imageUrls?.[0] || ""))}" alt="" />
    <h2 id="dialog-title">${escapeHtml(title)}</h2>
    ${note ? `<p class="muted">${escapeHtml(note)}</p>` : ""}
    <p class="price">${escapeHtml(priceText(product))}</p>
    <p class="muted estimate-note">${escapeHtml(ESTIMATE_NOTE)}</p>
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
    ? `<p class="muted">This week's ads for this ZIP: ${escapeHtml(weeklyAdBanners.map((banner) => banner.storeName).join(", "))}. Those prices are the ad, not the shelf.</p>`
    : "";
  coverageDialog.innerHTML = `<div class="sheet-body">
    <h2 id="coverage-title">Catalog coverage</h2>
    ${found}
    <ul class="offer-list">
      ${(coverage || [])
        .map((store) => {
          const detail = shopperCopy(store.detail);
          return `<li><span><strong>${escapeHtml(store.storeName)}</strong> · ${escapeHtml(store.label)}${detail ? `<br /><span class="muted">${escapeHtml(detail)}</span>` : ""}</span></li>`;
        })
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
  if (flowStep === "shop") renderShop();
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
  if (!store?.storeName) return "";
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

function addOwnCoupon(button) {
  const form = button.closest("form");
  const error = form?.querySelector("[data-coupon-error]");
  const line = form?.querySelector("[data-coupon-line]");
  const selected = line?.selectedOptions?.[0];
  const parsed = parseCouponForm({
    storeName: form?.dataset.couponStore || "",
    lineId: line?.value || "",
    itemName: selected?.textContent || "",
    kind: form?.querySelector("[data-coupon-kind]")?.value,
    amount: form?.querySelector("[data-coupon-amount]")?.value,
    expiresOn: form?.querySelector("[data-coupon-expires]")?.value,
  });
  if (!parsed.ok) {
    if (error) {
      error.hidden = false;
      error.textContent = parsed.error;
    }
    return;
  }
  upsertCoupon(localStorage, parsed.coupon);
  scheduleAccountSync();
  paintTrip();
}

function renderTrip(payload) {
  lastOptimize = payload;
  tripEdits = { lockedStore: null, moves: {} };
  rememberTrip();
  if (flowStep === "shop") renderShop();
  else paintTrip();
}

function annotatePreference(item) {
  const noted = item || {};
  const name = String(noted.name || "").toLowerCase();
  for (const entry of list.values()) {
    if (!entry.preferenceFamily) continue;
    const productName = String(entry.product?.familyName || entry.product?.name || "").toLowerCase();
    const swappedTo = String(entry.preferenceSwap?.to || "").toLowerCase();
    const matches = (name && productName && (name.includes(productName) || productName.includes(name))) || (swappedTo && name.includes(swappedTo));
    if (!matches) continue;
    if (entry.preferenceSwap?.from && entry.preferenceSwap?.to) {
      return {
        ...noted,
        matchKind: "swap",
        preferenceSwap: true,
        preferenceFamily: entry.preferenceFamily,
        substitutedFor: entry.preferenceSwap.from,
      };
    }
    return { ...noted, preferenceFamily: entry.preferenceFamily };
  }
  return noted;
}

function reviewItemLine(item) {
  const noted = annotatePreference(lists().annotate(item));
  const label = displayProductName(noted.name, noted.brand) || noted.name || "Item";
  const amount = Number(noted.itemTotal ?? noted.price);
  const price = Number.isFinite(amount) ? priceFigure(amount) : "";
  return `${noted.quantity} × ${label}${price ? ` · ${price}` : ""}`;
}

function reviewSwapLines(store) {
  return (store.items || [])
    .map((item) => {
      const noted = annotatePreference(lists().annotate(item));
      const swap = plainSwap(noted);
      if (!swap) return "";
      const change = noted.preferenceFamily
        ? ` <button type="button" class="linkish" data-pref-change="${escapeHtml(noted.preferenceFamily)}">${escapeHtml(swap.change)}</button>`
        : noted.lineId
          ? ` <button type="button" class="linkish" data-change-line="${escapeHtml(noted.lineId)}">${escapeHtml(swap.change)}</button>`
          : "";
      return `<p class="swap-quiet">${escapeHtml(swap.text)}${change}</p>`;
    })
    .join("");
}

function calmItemRow(item) {
  item = annotatePreference(lists().annotate(item));
  const swap = plainSwap(item);
  const rawNote = calmPriceNote(item.priceSource);
  const note = rawNote === "sample price" ? "" : rawNote;
  const size = item.size ? `, ${item.size}` : "";
  const amount = Number(item.itemTotal ?? item.price);
  const price = Number.isFinite(amount) ? priceFigure(amount) : "Price unavailable";
  const change = swap
    ? item.preferenceFamily
      ? ` <button type="button" class="linkish" data-pref-change="${escapeHtml(item.preferenceFamily)}">${escapeHtml(swap.change)}</button>`
      : item.lineId
        ? ` <button type="button" class="linkish" data-change-line="${escapeHtml(item.lineId)}">${escapeHtml(swap.change)}</button>`
        : ""
    : "";
  const sale = saleBadgeMarkup(item);
  return `<li class="calm-item">
    <p class="item-name">${item.quantity} × ${escapeHtml(item.name)}${escapeHtml(size)}${note ? ` <span class="muted">${escapeHtml(note)}</span>` : ""}</p>
    <p class="item-price">${sale}<strong>${escapeHtml(price)}</strong></p>
    ${swap ? `<p class="swap-quiet">${escapeHtml(swap.text)}${change}</p>` : ""}
  </li>`;
}

function customizeBlock(stores) {
  const moves = (stores || [])
    .flatMap((store) => store.items || [])
    .map((item) => {
      const control = moveControl(item);
      if (!control) return "";
      return `<div data-customize-line="${escapeHtml(item.lineId || "")}">${control}</div>`;
    })
    .join("");
  const locks = planLimited("multiStoreSplit")
    ? ""
    : (stores || [])
        .map((store) =>
          tripEdits.lockedStore === store.storeName
            ? `<button type="button" class="ghost" data-unlock-store>Unlock ${escapeHtml(store.storeName)}</button>`
            : `<button type="button" class="ghost" data-lock-store="${escapeHtml(store.storeName)}">Prefer ${escapeHtml(store.storeName)}</button>`
        )
        .join("");
  return `<details class="customize" id="customize">
    <summary>Customize</summary>
    <p class="muted">We already picked the lowest prices. Change a store only if you want to.</p>
    ${tripEdits.lockedStore ? `<p class="lock-note">${escapeHtml(tripEdits.lockedStore)} is preferred for this trip.</p>` : ""}
    ${locks}
    ${moves}
    <label class="check-row"><input id="customize-subs" type="checkbox" ${allowSubsEl.checked ? "checked" : ""} /> Allow a different product when a store is missing it</label>
    ${exportRow("trip")}
  </details>`;
}

function paintTrip() {
  const view = currentTrip();
  if (!view) return;
  const stores = view.stores ?? [];
  const lines = stores.flatMap((store) => store.items || []);
  const card = savingsCard(singleStoreSavings(lines));
  const fewer = fewerStopsOffer(stores, lastOptimize?.capabilities || {});
  const coupons = readCoupons(localStorage);
  const couponSummary = couponSavingsSummary(stores, coupons, todayKey());
  const hasCoupons = (couponSummary.byStore || []).some((row) => (row.rows || []).length);
  const showCouponEstimate = hasCoupons;
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  syncStepVisibility();
  if (tripStoreEmpty(lastOptimize)) {
    tripEl.innerHTML = emptyStateMarkup(emptyState("stores"), escapeHtml);
    paintPlanBar();
    return;
  }
  const lineItems = (card.lines || [])
    .map((line) => `<li><span>${escapeHtml(line.label)}</span><strong>${escapeHtml(line.value)}</strong></li>`)
    .join("");
  const fewerHtml = fewer
    ? `<section class="fewer-card"><p>${escapeHtml(fewer.text)}</p><button type="button" class="ghost" id="use-fewer-stops">${escapeHtml(fewer.action)}</button></section>`
    : "";
  const storeHtml = stores
    .map((store) => {
      const total = Number.isFinite(Number(store.subtotal)) ? priceFigure(store.subtotal) : "";
      const storeSummary = (couponSummary.byStore || []).find((row) => row.storeName === store.storeName);
      const couponsHtml = storeCouponMarkup(store, {
        page: store.handoff?.coupon?.url ? store.handoff.coupon : couponPageFor(store.storeName),
        rows: storeSummary?.rows || [],
        storeSummary,
        clipped: isClipped(localStorage, tripId(), store.storeName),
        canEnter: !planLimited("ownCoupons"),
        open: false,
        coupons,
      });
      const names = (store.items || []).map((item) => reviewItemLine(item)).join(", ");
      return `<article class="calm-store">
        <header><h3>${escapeHtml(store.storeName)}</h3>${total ? `<p>${escapeHtml(total)}</p>` : ""}</header>
        ${names ? `<p class="review-items">${escapeHtml(names)}</p>` : ""}
        ${reviewSwapLines(store)}
        ${couponsHtml}
        <div class="shop-actions">${primaryAction(store)}</div>
      </article>`;
    })
    .join("");
  const missing = (lastOptimize?.unavailable ?? []).length
    ? `<p class="muted">We couldn't price ${escapeHtml(lastOptimize.unavailable.join(", "))}.</p>`
    : "";
  tripEl.innerHTML = `
    ${krogerBannerHtml()}
    <p class="estimate-note">${escapeHtml(ESTIMATE_NOTE)}</p>
    <div class="store-grid">${storeHtml}</div>
    ${missing}
    <section class="savings-card">
      <h2>${escapeHtml(card.title)}</h2>
      ${lineItems ? `<ul class="savings-lines">${lineItems}</ul>` : ""}
      ${card.saved ? `<p>${escapeHtml(card.saved)}</p>` : ""}
      ${card.note && card.note !== ESTIMATE_NOTE ? `<p class="muted">${escapeHtml(card.note)}</p>` : ""}
    </section>
    ${showCouponEstimate ? `<section class="coupon-estimate">${couponSummaryMarkup(couponSummary)}</section>` : ""}
    ${fewerHtml}
    ${lastOptimize?.entitlement?.plan === "free" ? `<p class="muted">This plan uses one store. <button type="button" class="linkish" data-open-paywall="1">See Grocery Gitter Pro</button> to split the list.</p>` : ""}
    ${offline ? `<p class="offline-note">You're offline. This is the last plan saved on this phone.</p>` : ""}
    ${shopperCopy(lastOptimize?.pricingWarning) ? `<p class="muted">${escapeHtml(shopperCopy(lastOptimize.pricingWarning))}</p>` : ""}
    ${customizeBlock(stores)}
  `;
  const fewerButton = $("use-fewer-stops");
  if (fewerButton && fewer) {
    fewerButton.onclick = () => {
      tripEdits = { ...tripEdits, moves: { ...tripEdits.moves, ...fewer.moves } };
      rememberTrip();
      paintTrip();
      if (flowStep === "shop") renderShop();
      haptic();
    };
  }
  const subs = $("customize-subs");
  if (subs) {
    subs.onchange = () => {
      allowSubsEl.checked = subs.checked;
      localStorage.setItem(SUBS_KEY, subs.checked ? "1" : "0");
      renderEstimate();
      void planTrip();
    };
  }
  paintPlanBar();
}

function renderStore(store, checks, coupons, couponSummary, openCoupons) {
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
          ${saleBadgeMarkup(item)}
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
        ${shopperCopy(store.pricing?.detail) ? `<p class="muted">${escapeHtml(shopperCopy(store.pricing.detail))}</p>` : ""}
      </div>
      <p class="store-total"><span>Store total</span><strong>${money(store.subtotal)}</strong></p>
    </header>
    <ul class="item-list">${rows}</ul>
    ${storeCouponMarkup(store, {
      page: store.handoff?.coupon?.url ? store.handoff.coupon : couponPageFor(store.storeName),
      rows: (couponSummary?.byStore || []).find((row) => row.storeName === store.storeName)?.rows || [],
      storeSummary: (couponSummary?.byStore || []).find((row) => row.storeName === store.storeName),
      clipped: isClipped(localStorage, tripId(), store.storeName),
      canEnter: !planLimited("ownCoupons"),
      open: openCoupons,
      coupons,
    })}
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

function couponExportText(stores) {
  const summary = couponSavingsSummary(stores, readCoupons(localStorage), todayKey());
  const lines = [];
  for (const store of summary.byStore) {
    for (const row of store.rows) lines.push(`${store.storeName}: ${couponLineLabel(row)}`);
  }
  return lines.length ? `\n\nYour coupons (estimated)\n${lines.join("\n")}` : "";
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
  const text = `${formatTripText(stores, { headed: !storeName })}${couponExportText(stores)}`;
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

function loadCachedTrip() {
  const saved = cachedTrip(localStorage);
  if (!saved) return false;
  lastOptimize = saved.payload;
  tripEdits = {
    lockedStore: saved.edits?.lockedStore || null,
    moves: { ...(saved.edits?.moves || {}) },
    fewerStops: Boolean(saved.edits?.fewerStops),
  };
  return true;
}

function restoreOfflineTrip() {
  if (!loadCachedTrip()) return false;
  showStep("shop");
  return true;
}

function paintLocalPreview(note) {
  const rows = [...list.values()]
    .map((entry) => {
      const name = displayProductName(entry.product.familyName || entry.product.name, entry.product.brand) || "Item";
      return `<li class="calm-item"><p class="item-name">${entry.quantity} × ${escapeHtml(name)}</p><p class="item-price"><strong>…</strong></p></li>`;
    })
    .join("");
  tripEl.innerHTML = `
    ${krogerBannerHtml()}
    <section class="calm-store" id="plan-preview">
      <header><h3>Your list</h3><p class="muted">Prices coming</p></header>
      <ul class="item-list">${rows}</ul>
      <p class="muted" id="plan-status-line">${escapeHtml(note || "Checking store prices…")}</p>
      <button type="button" class="ghost" id="plan-retry" hidden>Try again</button>
    </section>
  `;
}

function ensurePlanRetry(message) {
  planErrorEl.hidden = false;
  planErrorEl.textContent = message;
  const line = $("plan-status-line");
  if (line) line.textContent = message;
  let retry = $("plan-retry");
  if (!retry && tripEl) {
    retry = document.createElement("button");
    retry.id = "plan-retry";
    retry.type = "button";
    retry.className = "ghost";
    retry.textContent = "Try again";
    tripEl.append(retry);
  }
  if (retry) retry.hidden = false;
}

function paintPlanNow() {
  if (!lastOptimize) loadCachedTrip();
  if (lastOptimize) paintTrip();
  else if (list.size) paintLocalPreview("Checking store prices…");
  else if (tripEl) tripEl.innerHTML = `${krogerBannerHtml()}${emptyStateMarkup(emptyState("list"), escapeHtml)}`;
}

async function planTrip({ stay = false, trigger = null } = {}) {
  planErrorEl.hidden = true;
  const zip = normalizeZip(zipEl.value);
  zipEl.value = zip;
  if (!stay) {
    flowStep = "plan";
    try {
      localStorage.setItem(STEP_KEY, flowStep);
    } catch {
      /* private browsing */
    }
    syncStepVisibility();
  }
  if (!ZIP_PATTERN.test(zip)) {
    planning = false;
    tripEl.innerHTML = emptyStateMarkup(
      {
        title: "Add a ZIP",
        body: "A ZIP lets us use nearby stores. You can also find them from this phone.",
        action: "Find nearby stores",
        actionId: "find-stores",
      },
      escapeHtml
    );
    planErrorEl.hidden = false;
    planErrorEl.textContent = "Enter a 5-digit ZIP so the trip can use your nearest stores.";
    const sheetCoversZip = window.matchMedia("(max-width: 1099px)").matches && listPanel.classList.contains("open");
    if (sheetCoversZip) openList(false);
    openDrawer({ focus: "zip" });
    toast(planErrorEl.textContent, 4200);
    paintPlanBar();
    return "fail";
  }
  if (!list.size) {
    paintPlanNow();
    paintPlanBar();
    return "ok";
  }
  localStorage.setItem(ZIP_KEY, zip);
  const items = [...list.values()].map((entry) => ({
    name: entry.product.catalogName || entry.product.name,
    brand: entry.product.brand,
    quantity: entry.quantity,
    catalogId: entry.product.id,
    upc: entry.product.upc,
  }));
  if (planAbort) planAbort.abort();
  const controller = new AbortController();
  planAbort = controller;
  planning = true;
  planBtn.disabled = false;
  planBtn.textContent = "Updating…";
  setBusy(trigger, true);
  setBusy(document.querySelector('[data-flow="plan"]'), true);
  paintPlanNow();
  paintPlanBar();
  const instacartTask = fetchWithTimeout(fetch, apiUrl("/api/instacart/status"), { signal: controller.signal }, 4000)
    .then((response) => response.json().catch(() => ({ enabled: false })))
    .then((status) => {
      instacartEnabled = Boolean(status?.enabled);
    })
    .catch(() => {
      instacartEnabled = false;
    });
  let result = "ok";
  try {
    const response = await fetchWithTimeout(
      fetch,
      apiUrl("/api/optimize-list"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, zipCode: zip, allowSubstitutes: allowSubsEl.checked }),
        signal: controller.signal,
      },
      PLAN_TIMEOUT_MS
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Trip plan failed (${response.status})`);
    renderTrip(body);
    rememberListAsUsuals();
    openList(false);
    void instacartTask.then(() => {
      if (planAbort && planAbort !== controller) return;
      if (flowStep === "shop") renderShop();
      else if (flowStep === "plan") paintTrip();
    });
  } catch (error) {
    if (planAbort !== controller) return "replaced";
    result = "fail";
    if (navigator.onLine === false && !lastOptimize && loadCachedTrip()) {
      showStep("shop");
      toast("You're offline. Showing the last plan on this phone.");
      return "fail";
    }
    const timedOut = planTimedOut(error);
    const kind = timedOut ? null : networkKind(error, navigator.onLine);
    const message = timedOut
      ? "Prices are taking too long. Showing what we have."
      : kind
        ? `${emptyState(kind).title}. ${emptyState(kind).body}`
        : error instanceof Error
          ? error.message
          : "Could not plan the trip.";
    if (!lastOptimize && !list.size) {
      const state = emptyState(kind || "network");
      tripEl.innerHTML = emptyStateMarkup(state, escapeHtml, "alert");
    } else if (!lastOptimize) {
      paintLocalPreview(message);
    }
    ensurePlanRetry(message);
    toast(timedOut ? "Prices are taking too long. Try again." : message);
  } finally {
    if (planAbort === controller) {
      planning = false;
      planAbort = null;
      planBtn.disabled = list.size === 0;
      planBtn.textContent = "Review the split";
      setBusy(trigger, false);
      setBusy(document.querySelector('[data-flow="plan"]'), false);
      paintPlanBar();
      if (stay && flowStep === "shop") renderShop();
    }
  }
  return result;
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
  setBusy(button, true);
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
    const message = error instanceof Error ? error.message : "Could not open Instacart.";
    planErrorEl.hidden = false;
    planErrorEl.textContent = message;
    toast(message);
  } finally {
    button.disabled = false;
    setBusy(button, false);
  }
}

async function startKroger(storeName, button) {
  const store = currentTrip()?.stores?.find((entry) => entry.storeName === storeName);
  if (!store) return;
  button.disabled = true;
  setBusy(button, true);
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
        await armKrogerBrowserWatch();
        await openExternal(body.authorizeUrl);
        return;
      }
      window.location.assign(body.authorizeUrl);
      return;
    }
    if (body.status === "added" || body.krogerCartUrl) rememberKrogerConnected();
    toast(body.status === "added" ? "Kroger accepted the cart." : "Kroger cart updated.");
  } catch (error) {
    toast(error instanceof Error ? error.message : "Kroger cart failed.");
  } finally {
    button.disabled = false;
    setBusy(button, false);
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
  const themeLabel = $("theme-label");
  if (themeLabel) themeLabel.textContent = themeShortLabel(choice);
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
  if (lists().onClick(target)) return;
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
  const mealIdea = target.closest("[data-meal]");
  if (mealIdea) {
    event.preventDefault();
    $("search-form")?.requestSubmit();
    return;
  }
  const suggest = target.closest("[data-suggest]");
  if (suggest) {
    chooseSuggestion(Number(suggest.getAttribute("data-suggest")));
    return;
  }
  const couponLink = target.closest("[data-coupon-link]");
  if (couponLink) {
    event.preventDefault();
    void openExternal(couponLink.getAttribute("data-coupon-link"));
    return;
  }
  if (target.closest("[data-coupon-remove]")) {
    removeCoupon(localStorage, target.closest("[data-coupon-remove]").getAttribute("data-coupon-remove"));
    scheduleAccountSync();
    paintTrip();
    return;
  }
  const showCouponForm = target.closest("[data-show-coupon-form]");
  if (showCouponForm) {
    const body = showCouponForm.closest(".coupon-body");
    const wrap = body?.querySelector(".coupon-form-wrap");
    if (wrap) wrap.hidden = false;
    showCouponForm.hidden = true;
    const field = wrap?.querySelector("[data-coupon-line]");
    if (field instanceof HTMLElement) field.focus();
    return;
  }
  if (target.closest("[data-add-coupon]")) {
    if (planLimited("ownCoupons")) {
      openPaywall();
      return;
    }
    addOwnCoupon(target.closest("[data-add-coupon]"));
    return;
  }
  const flowButton = target.closest("[data-flow]");
  if (flowButton) {
    haptic();
    showStep(flowButton.getAttribute("data-flow"));
    return;
  }
  const watchOpen = target.closest("[data-watch-open]");
  if (watchOpen) {
    const panel = watchOpen.closest(".list-row")?.querySelector(".alert-controls");
    if (panel) {
      panel.hidden = !panel.hidden;
      watchOpen.textContent = panel.hidden ? "Price watch" : "Hide price watch";
      watchOpen.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
    }
    return;
  }
  const starter = target.closest("[data-starter]");
  if (starter) {
    void addStarter(starter.getAttribute("data-starter"));
    return;
  }
  const prefChange = target.closest("[data-pref-change]");
  if (prefChange) {
    void openPreferenceChange(prefChange.getAttribute("data-pref-change") || "");
    return;
  }
  const prefPick = target.closest("[data-pref-pick]");
  if (prefPick) {
    const family = prefPick.getAttribute("data-pref-family") || "";
    const product = productsById.get(prefPick.getAttribute("data-pref-pick") || "");
    if (product) choosePreference(family, product);
    return;
  }
  const changeLine = target.closest("[data-change-line]");
  if (changeLine) {
    const details = $("customize");
    if (details) details.open = true;
    const lineId = changeLine.getAttribute("data-change-line") || "";
    const select = tripEl.querySelector(`[data-move-line="${CSS.escape(lineId)}"]`);
    if (select instanceof HTMLElement) select.focus();
    return;
  }
  const notHere = target.closest("[data-not-here]");
  if (notHere) {
    const choices = notHere.closest(".shop-line")?.querySelector(".swap-choices");
    if (choices) choices.hidden = !choices.hidden;
    return;
  }
  const shopSwap = target.closest("[data-shop-swap]");
  if (shopSwap) {
    moveLine(shopSwap.getAttribute("data-shop-swap"), shopSwap.getAttribute("data-shop-store"));
    haptic();
    return;
  }
  const krogerCartLink = target.closest("[data-kroger-cart], #kroger-cart-link, #settings-kroger-cart");
  if (krogerCartLink instanceof HTMLAnchorElement) {
    event.preventDefault();
    void openExternal(krogerCartLink.href || KROGER_CART_URL);
    return;
  }
  const krogerSend = target.closest("[data-kroger-send], #kroger-send, #settings-kroger-send");
  if (krogerSend instanceof HTMLButtonElement) {
    void sendToKrogerCart(krogerSend);
    return;
  }
  const walmartCart = target.closest('a.handoff-btn[href*="walmart.com"]');
  if (walmartCart instanceof HTMLAnchorElement) {
    event.preventDefault();
    maybeAskAccount("cart", () => {
      markWalmartHandoff();
      setBusy(walmartCart, true);
      void openExternal(walmartCart.href)
        .catch(() => {
          try {
            sessionStorage.removeItem(WALMART_RETURN_KEY);
          } catch {
            /* private browsing */
          }
          toast("Couldn't open Walmart.");
        })
        .finally(() => setBusy(walmartCart, false));
    });
    return;
  }
  if (target.closest("#plan-retry")) {
    const retry = target.closest("#plan-retry");
    setBusy(retry, true);
    void planTrip({ stay: true, trigger: retry });
    return;
  }
  if (target.closest("[data-kroger]")) {
    const button = target.closest("[data-kroger]");
    maybeAskAccount("cart", () => {
      void startKroger(button.getAttribute("data-kroger"), button);
    });
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
    const storeButton = target.closest("[data-shop-list]");
    setBusy(storeButton, true);
    openChecklist(storeButton.getAttribute("data-shop-list"));
    setBusy(storeButton, false);
    const dialog = $("trip-dialog");
    if (!dialog?.open) toast("Couldn't open that store list.");
    return;
  }
  if (target.closest("[data-instore]")) {
    showStep("shop");
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
    const kind = exportButton.getAttribute("data-export");
    const storeName = exportButton.getAttribute("data-export-store") || "";
    const run = () => {
      void exportTrip(kind, storeName).catch((error) => {
        if (isShareCancel(error)) return;
        toast(error instanceof Error ? error.message : "Could not share that list.");
      });
    };
    if (kind === "link" || kind === "share") maybeAskAccount("save", run);
    else run();
    return;
  }
  if (target.closest(".instacart-cta")) {
    if (planLimited("cartHandoffs")) {
      openPaywall();
      return;
    }
    const button = target.closest(".instacart-cta");
    maybeAskAccount("cart", () => {
      void openInstacart(button);
    });
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
  if (target instanceof HTMLInputElement && target.dataset.couponClipped) {
    writeClipped(localStorage, tripId(), target.dataset.couponClipped, target.checked);
    return;
  }
  if (target instanceof HTMLInputElement && target.dataset.tripCheck) {
    const checks = writeCheck(localStorage, tripId(), target.dataset.tripCheck, target.checked);
    document.querySelectorAll(`[data-trip-check="${CSS.escape(target.dataset.tripCheck)}"]`).forEach((box) => {
      if (box instanceof HTMLInputElement) box.checked = Boolean(checks[target.dataset.tripCheck]);
    });
    document.querySelectorAll(`[data-shop-line="${CSS.escape(target.dataset.tripCheck)}"] .shop-row`).forEach((row) => {
      row.classList.toggle("is-done", Boolean(checks[target.dataset.tripCheck]));
    });
    paintShopChrome();
    haptic();
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
  const text = searchEl.value.trim();
  closeSuggestions();
  if (!text) {
    searchEl.focus();
    return;
  }
  if (askIntent(text) === "list") {
    window.clearTimeout(shelfTimer);
    query = "";
    syncBrowse();
    if (importer?.find) importer.find(text);
    else toast("Paste the list from Import.");
    return;
  }
  query = text;
  activeDepartment = "all";
  renderDepartments();
  syncBrowse();
  void (async () => {
    await addResolvedQuery(text);
    void loadPage(true);
  })();
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
    window.clearTimeout(shelfTimer);
    query = "";
    syncBrowse();
    if (browseOpen) void loadPage(true);
    else if (gridEl) gridEl.innerHTML = "";
    if (document.activeElement === searchEl) showSuggestStatus("Type a product, or a meal like taco night for 6.");
    else closeSuggestions();
    return;
  }
  if (askIntent(value) === "list") {
    window.clearTimeout(shelfTimer);
    suggestAbort?.abort();
    suggestions = [];
    if (query) {
      query = "";
      activeDepartment = "all";
      renderDepartments();
      syncBrowse();
      if (browseOpen) void loadPage(true);
      else if (gridEl) gridEl.innerHTML = "";
    }
    showListAsk(value);
    return;
  }
  searchTimer = window.setTimeout(() => void loadSuggestions(value), SUGGEST_DEBOUNCE_MS);
  window.clearTimeout(shelfTimer);
  const shelfQuery = value.trim();
  if (shelfQuery.length >= 2) {
    shelfTimer = window.setTimeout(() => {
      if (searchEl.value.trim() !== shelfQuery || askIntent(shelfQuery) !== "search") return;
      query = shelfQuery;
      activeDepartment = "all";
      renderDepartments();
      syncBrowse();
      void loadPage(true);
    }, 280);
  }
});

searchEl.addEventListener("focus", () => {
  if (!searchEl.value.trim()) showSuggestStatus("Type a product, or a meal like taco night for 6.");
  else if (askIntent(searchEl.value) === "list") showListAsk(searchEl.value);
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

sortEl.addEventListener("change", () => {
  paintRefine();
  if (shelfRequested()) void loadPage(true);
});
$("filters")?.addEventListener("change", paintRefine);
$("filters").addEventListener("submit", (event) => {
  event.preventDefault();
  openFilters(false);
  void loadPage(true);
});
$("filters-clear").addEventListener("click", () => {
  $("filter-brand").value = "";
  $("filter-sale").checked = false;
  $("filter-budget").checked = false;
  if (sortEl) sortEl.value = "relevance";
  openFilters(false);
  void loadPage(true);
});
$("filters-open").addEventListener("click", () => openFilters(!$("filters").classList.contains("open")));
$("filters-close").addEventListener("click", () => openFilters(false));
$("list-toggle").addEventListener("click", () => {
  if (window.matchMedia("(min-width: 1100px)").matches) {
    $("list-panel")?.querySelector("h2")?.focus();
    return;
  }
  openList(!listPanel.classList.contains("open"));
});
$("browse-toggle")?.addEventListener("click", () => {
  browseOpen = !browseOpen;
  if (!browseOpen && $("filters")?.classList.contains("open")) openFilters(false);
  syncBrowse();
  if (browseOpen) openBrowse();
});
$("usuals-list")?.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest("[data-usual]") : null;
  if (!button) return;
  const row = readUsuals(localStorage)[Number(button.getAttribute("data-usual"))];
  if (!row) return;
  setBusy(button, true);
  void addOneUsual(row).finally(() => setBusy(button, false));
});
$("list-bar-btn").addEventListener("click", () => openList(true));
$("list-close").addEventListener("click", () => openList(false));
$("coverage-open").addEventListener("click", openCoverage);
planBtn.addEventListener("click", () => {
  haptic();
  setBusy(planBtn, true);
  void planTrip({ trigger: planBtn });
});
$("bar-primary")?.addEventListener("click", onPrimary);
$("shop-done")?.addEventListener("click", onPrimary);
$("shop-status")?.addEventListener("click", onPrimary);
$("refresh-prices")?.addEventListener("click", () => void refreshPrices());
$("find-stores")?.addEventListener("click", () => void findNearbyStores());
$("settings-find-stores")?.addEventListener("click", () => {
  $("settings-dialog")?.close();
  void findNearbyStores();
});
$("add-usuals")?.addEventListener("click", () => void addUsualList());
$("account-ask-skip")?.addEventListener("click", () => {
  accountAskDeclined = true;
  const next = accountAskNext;
  accountAskNext = null;
  $("account-ask")?.close();
  next?.();
});
$("account-ask-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  accountAskNext = null;
  $("account-ask")?.close();
  openSettings();
});
$("sample-btn").addEventListener("click", () => void addSample());
$("share-btn")?.addEventListener("click", () => {
  maybeAskAccount("save", () => {
    void onShareClick();
  });
});
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
alertsToggle?.addEventListener("click", () => {
  closeDrawer({ restoreFocus: false });
  void openAlerts(!alertsDialog?.open);
});
$("alerts-close")?.addEventListener("click", () => openAlerts(false));
alertsDialog?.addEventListener("close", () => alertsToggle?.setAttribute("aria-expanded", "false"));
$("push-btn")?.addEventListener("click", () => void enablePush());
for (const button of document.querySelectorAll(".settings-open")) {
  button.addEventListener("click", () => {
    closeDrawer({ restoreFocus: false });
    openSettings();
  });
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
  paintZipPlace();
  if (ZIP_PATTERN.test(zip)) localStorage.setItem(ZIP_KEY, zip);
  scheduleWatchSync();
  if (shelfRequested()) void loadPage(true);
});
zipEl.addEventListener("input", paintZipPlace);
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
    return;
  }
  if (event.key === "Escape" && $("filters")?.classList.contains("open") && !document.querySelector("dialog[open]")) {
    event.preventDefault();
    openFilters(false);
    $("filters-open")?.focus();
    return;
  }
  const drawer = $("app-drawer");
  const open = drawer?.classList.contains("is-open");
  if (!open) return;
  if (event.key === "Escape") {
    if (document.querySelector("dialog[open]")) return;
    event.preventDefault();
    closeDrawer();
    return;
  }
  if (event.key !== "Tab") return;
  const next = nextTrapTarget(drawerFocusIds(), document.activeElement?.id, event.shiftKey);
  if (!next) return;
  event.preventDefault();
  document.getElementById(next)?.focus();
});

$("menu-open")?.addEventListener("click", () => {
  if ($("app-drawer")?.classList.contains("is-open")) closeDrawer();
  else openDrawer();
});
$("drawer-close")?.addEventListener("click", () => closeDrawer());
$("drawer-scrim")?.addEventListener("click", () => closeDrawer());

let drawerSwipeStart = null;
$("app-drawer")?.addEventListener(
  "touchstart",
  (event) => {
    drawerSwipeStart = event.touches[0]?.clientX ?? null;
  },
  { passive: true }
);
$("app-drawer")?.addEventListener("touchend", (event) => {
  const end = event.changedTouches[0]?.clientX;
  if (drawerSwipeStart != null && swipeClosesDrawer(drawerSwipeStart, end)) closeDrawer();
  drawerSwipeStart = null;
});
window.addEventListener("resize", syncDrawerMode);

const observer = new IntersectionObserver((entries) => {
  if (entries.some((entry) => entry.isIntersecting)) void loadPage(false);
});
observer.observe(sentinelEl);

function paintAlertBadge() {
  const badge = $("alerts-badge");
  const dot = $("menu-badge");
  const menu = $("menu-open");
  if (badge && alertsToggle) {
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
  if (dot) dot.hidden = unreadAlerts <= 0;
  if (menu) menu.setAttribute("aria-label", unreadAlerts > 0 ? "Menu, new price alerts" : "Menu");
}

function drawerFocusIds() {
  const drawer = $("app-drawer");
  if (!drawer) return [];
  return [...drawer.querySelectorAll("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])")]
    .filter((el) => el.getClientRects().length > 0)
    .map((el) => {
      if (!el.id) el.id = `drawer-focus-${Math.random().toString(36).slice(2, 8)}`;
      return el.id;
    });
}

function syncDrawerMode() {
  const drawer = $("app-drawer");
  const scrim = $("drawer-scrim");
  const menu = $("menu-open");
  if (!drawer) return;
  const wide = window.matchMedia("(min-width: 1100px)").matches;
  const toggle = $("list-toggle");
  if (listPanel) {
    if (wide) {
      listPanel.classList.add("open");
      listPanel.dataset.wide = "1";
      toggle?.setAttribute("aria-expanded", "true");
    } else if (listPanel.dataset.wide === "1") {
      listPanel.classList.remove("open");
      delete listPanel.dataset.wide;
      toggle?.setAttribute("aria-expanded", "false");
    }
  }
  const open = drawer.classList.contains("is-open");
  drawer.setAttribute("aria-hidden", open ? "false" : "true");
  if (open) drawer.removeAttribute("inert");
  else drawer.setAttribute("inert", "");
  if (scrim) scrim.hidden = !open;
  menu?.setAttribute("aria-expanded", open ? "true" : "false");
}

function openDrawer(options = {}) {
  const drawer = $("app-drawer");
  if (!drawer) return;
  drawer.classList.add("is-open");
  syncDrawerMode();
  const target = options.focus === "zip" ? zipEl : $("drawer-title");
  if (target) {
    target.focus();
  }
}

function closeDrawer(options = {}) {
  const drawer = $("app-drawer");
  if (!drawer) return;
  const wasOpen = drawer.classList.contains("is-open");
  drawer.classList.remove("is-open");
  syncDrawerMode();
  if (wasOpen && options.restoreFocus !== false) $("menu-open")?.focus();
}

function focusZipField() {
  openDrawer({ focus: "zip" });
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
    coupons: readCoupons(localStorage),
    starterBook: lists().payload(),
    ...(profileIsStored(localStorage) ? { tasteProfile: getUserProfile(localStorage) } : {}),
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
    if (Array.isArray(body.list?.coupons)) writeCoupons(localStorage, body.list.coupons);
    if (body.list?.starterBook) lists().applyServer(body.list.starterBook);
    if (body.list?.tasteProfile) saveUserProfile(localStorage, mergeProfiles(getUserProfile(localStorage), body.list.tasteProfile));
    localStorage.removeItem(REMOVED_KEY);
  } catch {
    /* the list stays on this device and tries again on the next edit */
  }
}

function rememberServerList(server) {
  if (!server) return;
  if (Array.isArray(server.coupons)) writeCoupons(localStorage, server.coupons);
  listRevision = server.revision || listRevision;
  if (server.revision) localStorage.setItem(REVISION_KEY, String(server.revision));
  if (server.listId) localStorage.setItem(LIST_ID_KEY, server.listId);
  if (server.starterBook) lists().applyServer(server.starterBook);
  if (server.tasteProfile) {
    saveUserProfile(localStorage, mergeProfiles(getUserProfile(localStorage), server.tasteProfile));
    paintUsuals();
  }
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
    : "One store and one shared list are free. Coupon links stay free. Pro adds the multi-store split, price alerts, unlimited shared lists, cart handoffs, and typing in a coupon you already have.";
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

function haptic() {
  const plugins = window.Capacitor?.Plugins;
  void lightTap({
    haptics: plugins?.Haptics,
    vibrate: typeof navigator !== "undefined" && typeof navigator.vibrate === "function" ? (ms) => navigator.vibrate(ms) : undefined,
  });
}

async function engageWake() {
  if (wakeLock?.active) return;
  const request = typeof navigator !== "undefined" && navigator.wakeLock?.request ? (type) => navigator.wakeLock.request(type) : undefined;
  wakeLock = await keepAwake({ requestWakeLock: request });
}

async function releaseWake() {
  if (wakeLock) await wakeLock.release();
  wakeLock = null;
}

function syncStepVisibility() {
  const start = $("start-here");
  const shop = $("shop");
  const add = flowStep === "add";
  if (gridEl) gridEl.hidden = !add;
  if (sentinelEl) sentinelEl.hidden = !add;
  if (start) start.hidden = !add;
  const showMore = $("show-more");
  if (showMore && !add) showMore.hidden = true;
  if (tripEl) tripEl.hidden = flowStep !== "plan";
  if (shop) shop.hidden = flowStep !== "shop";
  document.body.dataset.step = flowStep;
  syncBrowse();
}

function showStep(step) {
  hidePullStatus();
  flowStep = readFlowStep(step);
  try {
    localStorage.setItem(STEP_KEY, flowStep);
  } catch {
    /* private browsing */
  }
  syncStepVisibility();
  if (flowStep !== "add") {
    document.querySelector(".filters")?.classList.remove("open");
    $("filters-open")?.setAttribute("aria-expanded", "false");
    document.querySelector(".list-panel")?.classList.remove("open");
  }
  if (flowStep === "plan") {
    paintPlanNow();
    if (list.size) {
      const tab = document.querySelector('[data-flow="plan"]');
      setBusy(tab, true);
      void planTrip({ stay: true, trigger: tab });
    }
  }
  if (flowStep === "shop") {
    if (!lastOptimize) loadCachedTrip();
    renderShop();
    void engageWake();
  } else {
    void releaseWake();
  }
  paintUsuals();
  paintPlanBar();
}

function paintPlanBar() {
  const count = [...list.values()].reduce((sum, entry) => sum + entry.quantity, 0);
  const view = currentTrip();
  const checks = readChecks(localStorage, tripId());
  const progress = view ? shopProgress(view.stores || [], checks) : { left: count, complete: false, total: 0 };
  const total = flowStep === "add" || !view ? lastBarTotal : view.total;
  const copy = planBarCopy({
    step: flowStep,
    itemCount: flowStep === "shop" && progress.total ? progress.total : count,
    total,
    hasPlan: Boolean(view?.stores?.length),
    planning,
    left: progress.left,
    complete: progress.complete,
  });
  const about = copy.totalLabel ? `about ${copy.totalLabel}` : "";
  const countEl = $("bar-count");
  const totalEl = $("bar-total");
  const primary = $("bar-primary");
  if (countEl) countEl.textContent = copy.countLabel;
  if (totalEl) totalEl.textContent = about;
  if (primary) {
    primary.textContent = copy.button;
    primary.disabled = !copy.enabled;
  }
  const shopCount = $("shop-count");
  const shopTotal = $("shop-total");
  const shopDone = $("shop-done");
  if (shopCount) shopCount.textContent = copy.countLabel;
  if (shopTotal) shopTotal.textContent = about;
  if (shopDone) shopDone.disabled = !copy.enabled;
  document.body.dataset.chrome = bottomChrome(flowStep);
  document.querySelectorAll("[data-flow]").forEach((button) => {
    if (button.getAttribute("data-flow") === flowStep) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  });
  const title = $("brand-title");
  if (title) title.textContent = stepTitle(flowStep);
}

function renderShop() {
  const shop = $("shop");
  if (!shop) return;
  const view = currentTrip();
  if (!view?.stores?.length) {
    const backPrompt = showReturnBanner
      ? `<section class="return-banner" id="walmart-return"><p>Back in Grocery Gitter: mark what you bought.</p></section>`
      : "";
    shop.innerHTML = `${krogerBannerHtml()}${backPrompt}${emptyStateMarkup(emptyState("shop"), escapeHtml)}`;
    paintPlanBar();
    return;
  }
  const checks = readChecks(localStorage, tripId());
  const progress = shopProgress(view.stores, checks);
  const done = doneMessage(progress);
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  const html = shopSections(view.stores)
    .map((section) => {
      const groups = section.groups
        .map((group) => {
          const aisle = group.aisle ? ` · ${escapeHtml(group.aisle)}` : "";
          const rows = group.items
            .map((item) => {
              const noted = lists().annotate(item);
              const favoriteSwap = noted !== item ? plainSwap(noted) : null;
              const on = Boolean(item.lineId && checks[item.lineId]);
              const size = item.size ? `, ${escapeHtml(item.size)}` : "";
              const itemLabel = displayProductName(item.name, item.brand) || item.name;
              const amount = Number(item.itemTotal ?? item.price);
              const price = Number.isFinite(amount) ? priceFigure(amount) : "Price unavailable";
              const choices = swapChoices(item);
              const swap = choices.length
                ? `<div class="swap-choices" hidden>${choices
                    .map((choice) => {
                      const label = Number.isFinite(choice.price)
                        ? `${choice.name} at ${choice.storeName}, ${priceFigure(choice.price)}`
                        : `${choice.name} at ${choice.storeName}`;
                      return `<button type="button" class="ghost" data-shop-swap="${escapeHtml(item.lineId || "")}" data-shop-store="${escapeHtml(choice.storeName)}">${escapeHtml(label)}</button>`;
                    })
                    .join("")}</div>`
                : "";
              const notHere = choices.length
                ? `<button type="button" class="ghost" data-not-here="${escapeHtml(item.lineId || "")}">Not here</button>`
                : "";
              return `<div class="shop-line" data-shop-line="${escapeHtml(item.lineId || "")}">
                <label class="shop-row${on ? " is-done" : ""}">
                  <input type="checkbox" data-trip-check="${escapeHtml(item.lineId || "")}"${on ? " checked" : ""} />
                  <span class="shop-copy"><span class="shop-name">${item.quantity} × ${escapeHtml(itemLabel)}${size}</span><span class="muted">${escapeHtml(price)}</span></span>
                </label>
                ${favoriteSwap ? `<p class="swap-quiet">${escapeHtml(favoriteSwap.text)}</p>` : ""}
                ${notHere}
                ${swap}
              </div>`;
            })
            .join("");
          return `<h3 class="shop-aisle">${escapeHtml(group.department || "Other")}${aisle}</h3>${rows}`;
        })
        .join("");
      const store = (view.stores || []).find((row) => row.storeName === section.storeName);
      const hintItems = section.groups.flatMap((group) =>
        (group.items || []).map((item) => ({
          ...item,
          name: displayProductName(item.name, item.brand) || item.name,
        }))
      );
      const hintText = shopCouponHint(hintItems);
      const showHint = Boolean(hintText) && !hintText.startsWith("Nothing on");
      const page = store?.handoff?.coupon?.url ? store.handoff.coupon : couponPageFor(section.storeName);
      const couponLink = page?.url
        ? `<a class="shop-coupon-link" href="${escapeHtml(page.url)}" data-coupon-link="${escapeHtml(page.url)}">${escapeHtml(`Open ${page.label}`)}</a>`
        : "";
      const hint =
        showHint || couponLink
          ? `<p class="shop-coupon-hint">${showHint ? `<span>${escapeHtml(hintText)}</span>` : ""}${couponLink}</p>`
          : "";
      return `<section class="shop-store"><h2>${escapeHtml(section.storeName)}</h2>${hint}${groups}<div class="shop-actions">${store ? primaryAction(store) : ""}</div></section>`;
    })
    .join("");
  const backPrompt = showReturnBanner
    ? `<section class="return-banner" id="walmart-return"><p>Back in Grocery Gitter: mark what you bought.</p></section>`
    : "";
  shop.innerHTML = `
    ${krogerBannerHtml()}
    ${backPrompt}
    <p class="shop-leave"><button type="button" class="text-btn" data-flow="plan">Review the split</button></p>
    <p class="estimate-note">${escapeHtml(ESTIMATE_NOTE)}</p>
    ${done ? `<section class="done-banner"><h2>${escapeHtml(done.title)}</h2><p>${escapeHtml(done.body)}</p></section>` : ""}
    ${offline ? `<p class="offline-note">You're offline. This is the last plan saved on this phone.</p>` : ""}
    ${html}
  `;
  paintPlanBar();
}

function paintShopChrome() {
  if (flowStep !== "shop") {
    paintPlanBar();
    return;
  }
  const view = currentTrip();
  const progress = view ? shopProgress(view.stores || [], readChecks(localStorage, tripId())) : { complete: false };
  const shop = $("shop");
  const existing = shop?.querySelector(".done-banner");
  if (progress.complete && shop && !existing) renderShop();
  else if (!progress.complete && existing) existing.remove();
  paintPlanBar();
}

function rememberListAsUsuals() {
  const items = [...list.values()].map((entry) => ({
    name: entry.product.familyName || entry.product.catalogName || entry.product.name,
    brand: entry.product.brand,
    catalogId: entry.product.id,
    quantity: entry.quantity,
  }));
  rememberUsuals(localStorage, items);
  paintUsuals();
}

let listHome = null;
function lists() {
  if (!listHome) {
    listHome = createListHome({
      escapeHtml,
      toast,
      haptic,
      addProduct,
      loadShelf: loadStarterShelf,
      searchTiles: async (query) => {
        const response = await fetchWithTimeout(fetch, apiUrl(`/api/catalog/browse?q=${encodeURIComponent(query)}&limit=12`), {}, PLAN_TIMEOUT_MS);
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "The shelf didn't load.");
        for (const tile of body.items || []) rememberTile(tile);
        return body.items || [];
      },
      productById: (id) => productsById.get(id),
      hasProduct: (id) => Boolean(findListEntry(id)),
      locked: () => listIsLocked(),
      onChange: () => scheduleAccountSync(),
      mediaUrl,
      profile: () => getUserProfile(localStorage),
      slotBlocked: (slot) => slotIsExcluded(getUserProfile(localStorage), slot),
      guideSlot: (input) => guideSlot({ ...input, profile: getUserProfile(localStorage) }),
      onFavorite: (product, slotId) => {
        const next = learnPreference(getUserProfile(localStorage), product, { family: slotId, source: "swap", replace: true });
        saveUserProfile(localStorage, next);
        if (shouldAskAlways(next, product)) alwaysPrompt?.ask(product, familyLabel(slotId) || slotId);
      },
    });
  }
  return listHome;
}

function paintStarterLists() {
  lists().paint();
}

function paintUsuals() {
  const block = $("usuals-block");
  const listEl = $("usuals-list");
  if (!block || !listEl) return;
  const profile = getUserProfile(localStorage);
  const rows = readUsuals(localStorage).filter((row) => !slotIsExcluded(profile, { label: row.name, search: row.name }));
  block.hidden = rows.length === 0;
  listEl.innerHTML = rows
    .slice(0, 8)
    .map(
      (row, index) =>
        `<li><button type="button" class="quick-chip" data-usual="${index}">${escapeHtml(displayProductName(row.name, row.brand) || row.name)}</button></li>`
    )
    .join("");
}

async function addOneUsual(row) {
  if (!row) return;
  if (listIsLocked()) {
    toast("This list is view-only.");
    return;
  }
  try {
    const product = await resolveUsual(row);
    if (!product?.id) {
      toast("That usual isn't on the shelf right now.");
      return;
    }
    if (findListEntry(product.id)) {
      toast("Already on your list.");
      return;
    }
    addProduct(productsById.get(product.id) || product, row.quantity || 1);
    haptic();
  } catch {
    toast("That usual isn't on the shelf right now.");
  }
}

function flattenTiles(tiles) {
  const rows = [];
  for (const tile of tiles || []) {
    const variants = Array.isArray(tile.variants) && tile.variants.length ? tile.variants : [tile];
    for (const variant of variants) {
      rows.push({
        ...variant,
        name: variant.catalogName || variant.name || tile.name,
        familyName: variant.familyName || tile.familyName || tile.name,
        brand: variant.brand || tile.brand,
      });
    }
  }
  return rows;
}

async function openPreferenceChange(family) {
  const label = familyLabel(family) || "that item";
  let tiles = [];
  try {
    const response = await fetch(apiUrl(`/api/catalog/browse?q=${encodeURIComponent(label)}&limit=8`));
    const body = await response.json().catch(() => ({}));
    tiles = filterTiles(getUserProfile(localStorage), body.items || []);
    for (const tile of tiles) rememberTile(tile);
  } catch {
    tiles = [];
  }
  const buttons = tiles.slice(0, 6).map((tile) => {
    const variant = selectedVariant(tile);
    const name = tile.familyName || tile.name || label;
    const meta = [tile.brand, variant.variantLabel || variant.sizeLabel || ""].filter(Boolean).join(" · ");
    const image = variant.imageUrls?.[0] || tile.imageUrls?.[0] || "";
    return `<button type="button" class="staple-tile" data-pref-pick="${escapeHtml(variant.id)}" data-pref-family="${escapeHtml(family)}">
      ${image ? `<img src="${escapeHtml(mediaUrl(image))}" alt="" />` : ""}
      <span class="staple-name">${escapeHtml(name)}</span>
      <span class="staple-meta">${escapeHtml(meta)}</span>
    </button>`;
  }).join("");
  productDialog.innerHTML = `<div class="sheet-body">
    <h2 id="dialog-title">Change ${escapeHtml(label.toLowerCase())}</h2>
    <p class="muted">Pick the one you buy. No store prices.</p>
    <div class="staple-row">${buttons || `<p class="muted">Nothing else is on the shelf right now.</p>`}</div>
    <button type="button" class="ghost" id="dialog-close">Close</button>
  </div>`;
  productDialog.showModal();
  productDialog.querySelector("#dialog-close").onclick = () => productDialog.close();
}

function choosePreference(family, product) {
  const profile = getUserProfile(localStorage);
  const locked = Boolean(profile.productPreferences?.[family]?.locked);
  for (const [id, entry] of [...list]) {
    if (entry.preferenceFamily === family) list.delete(id);
  }
  productDialog.close();
  addProduct(product, 1, {
    preference: { family, status: "preferred" },
    source: "swap",
    replace: true,
    lock: locked,
    skipAsk: true,
  });
  if (!locked) alwaysPrompt?.ask(product, familyLabel(family) || family);
}

async function addResolvedQuery(text) {
  const profile = getUserProfile(localStorage);
  if (exclusionWarning(profile, text)) return false;
  try {
    const shelf = await loadStarterShelf([{ name: text }]);
    const resolved = resolveProductPreference({ profile, query: text, products: shelf });
    if (!resolved.product) return false;
    if (resolved.status !== "preferred" && resolved.status !== "brand" && resolved.status !== "swapped") return false;
    const product = productsById.get(resolved.product.id) || resolved.product;
    addProduct(product, 1, { preference: resolved, source: resolved.locked ? "manual" : "add" });
    return true;
  } catch {
    return false;
  }
}

async function loadStarterShelf(picks) {
  const response = await fetchWithTimeout(fetch, apiUrl("/api/catalog/browse?limit=80"), {}, PLAN_TIMEOUT_MS);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The shelf didn't load.");
  let tiles = body.items || [];
  let flat = flattenTiles(tiles);
  for (const pick of picks || []) {
    if (matchPick(pick, flat)) continue;
    const search = await fetchWithTimeout(fetch, apiUrl(`/api/catalog/browse?q=${encodeURIComponent(pick.name)}&limit=12`), {}, PLAN_TIMEOUT_MS);
    const found = await search.json().catch(() => ({}));
    tiles = tiles.concat(found.items || []);
    flat = flattenTiles(tiles);
  }
  for (const tile of tiles) rememberTile(tile);
  return flat;
}

async function addStarter(id) {
  const listDef = starterList(id);
  if (!listDef) return;
  if (listIsLocked()) {
    toast("This list is view-only.");
    return;
  }
  try {
    const shelf = await loadStarterShelf(listDef.picks);
    let added = 0;
    const missing = [];
    for (const pick of listDef.picks) {
      const product = matchPick(pick, shelf);
      const stored = product?.id ? productsById.get(product.id) || product : null;
      if (!stored?.id) {
        missing.push(pick.name);
        continue;
      }
      if (findListEntry(stored.id)) continue;
      addProduct(stored, 1, { quiet: true });
      added += 1;
    }
    if (!added && missing.length) toast("Those items aren't on the shelf yet. Try browsing.");
    else if (missing.length) toast(`Added ${listDef.title}. ${missing.length} weren't on the shelf.`);
    else if (added) toast(`Added ${listDef.title}.`);
    else toast(`${listDef.title} is already on your list.`);
    haptic();
  } catch (error) {
    const kind = networkKind(error, navigator.onLine);
    if (kind) {
      const state = emptyState(kind);
      toast(`${state.title}. ${state.body}`);
    } else toast("Couldn't add that list. Try again.");
  }
}

async function resolveUsual(row) {
  if (row.catalogId && productsById.get(row.catalogId)) return productsById.get(row.catalogId);
  if (row.catalogId) {
    try {
      const response = await fetch(apiUrl(`/api/catalog/products/${encodeURIComponent(row.catalogId)}`));
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.product?.id) {
        productsById.set(body.product.id, body.product);
        return body.product;
      }
    } catch {
      /* search by name */
    }
  }
  const shelf = await loadStarterShelf([{ name: row.name, brand: row.brand }]);
  return matchPick(row, shelf);
}

async function addUsualList() {
  const rows = readUsuals(localStorage);
  if (!rows.length) return;
  if (listIsLocked()) {
    toast("This list is view-only.");
    return;
  }
  let added = 0;
  for (const row of rows) {
    try {
      const product = await resolveUsual(row);
      if (!product?.id || findListEntry(product.id)) continue;
      addProduct(productsById.get(product.id) || product, row.quantity || 1, { quiet: true });
      added += 1;
    } catch {
      /* skip a row the shelf doesn't have */
    }
  }
  if (!added) toast("Those usuals aren't on the shelf right now. Try a starter list.");
  else toast(added === 1 ? "Added 1 usual." : `Added ${added} usuals.`);
  haptic();
}

function maybeAskAccount(intent, next) {
  if (
    !shouldAskToSignIn({
      accountsEnabled: Boolean(authStatus?.enabled),
      signedIn: Boolean(accountState?.id),
      intent,
      declined: accountAskDeclined,
    })
  ) {
    next();
    return;
  }
  accountAskNext = next;
  const dialog = $("account-ask");
  if (!dialog) {
    next();
    return;
  }
  if (!dialog.open) dialog.showModal();
}

async function findNearbyStores() {
  openDrawer({ focus: "zip" });
  const button = $("find-stores");
  if (button) {
    button.disabled = true;
    setBusy(button, true);
  }
  try {
    const coords = await readDeviceCoords();
    const response = await fetch(apiUrl(`/api/geo/zip?lat=${encodeURIComponent(coords.lat)}&lng=${encodeURIComponent(coords.lng)}`));
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !/^\d{5}/.test(String(body.zip || ""))) {
      toast("Couldn't read a ZIP from this location. Type it instead.");
      return;
    }
    applyZip(body.zip);
    toast(`Nearby stores for ${body.zip}.`);
    haptic();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const denied = Number(error?.code) === 1 || /denied|permission/i.test(message);
    toast(denied ? "Location stayed off. Type a ZIP instead." : "Couldn't use location. Type a ZIP instead.");
  } finally {
    if (button) {
      button.disabled = false;
      setBusy(button, false);
    }
  }
}

function onPrimary() {
  haptic();
  if (flowStep === "add") {
    showStep("plan");
    return;
  }
  if (flowStep === "plan") {
    if (lastOptimize) showStep("shop");
    else void planTrip();
    return;
  }
  const view = currentTrip();
  const progress = view ? shopProgress(view.stores || [], readChecks(localStorage, tripId())) : null;
  if (progress?.complete) {
    toast("Nice. That trip is done.", 4500);
    return;
  }
  const left = Math.max(0, Number(progress?.left) || 0);
  const message = left === 1 ? "1 left." : left > 0 ? `${left} left.` : "Nothing to shop yet.";
  toast(message, 4500);
  const next = document.querySelector("#shop .shop-row:not(.is-done)");
  if (next instanceof HTMLElement) {
    next.classList.add("shop-ack");
    next.scrollIntoView({ block: "center" });
    window.setTimeout(() => next.classList.remove("shop-ack"), 4500);
  }
}

async function refreshPrices() {
  const button = $("refresh-prices");
  if (button) button.disabled = true;
  setBusy(button, true);
  const step = flowStep;
  try {
    await loadPage(true);
    let planned = "ok";
    if (list.size && (step === "plan" || step === "shop")) {
      planned = await planTrip({ stay: true, trigger: button });
      if (step === "shop" && flowStep !== "shop") showStep("shop");
      else if (step === "shop") renderShop();
    }
    if (planned !== "fail") {
      toast("Prices refreshed.");
      haptic();
    }
  } catch {
    toast("Couldn't refresh prices.");
  } finally {
    if (button) button.disabled = false;
    setBusy(button, false);
  }
}

async function sendToKrogerCart(button) {
  const stores = currentTrip()?.stores || [];
  const krogerStore = stores.find(
    (store) => store?.handoff?.action?.type === "kroger_cart" || /kroger/i.test(String(store?.storeName || ""))
  );
  if (!krogerStore) {
    toast("Add items and open your plan. Send to Kroger cart is there when the list includes Kroger.");
    if (list.size) showStep("plan");
    return;
  }
  if (planLimited("cartHandoffs")) {
    openPaywall();
    return;
  }
  maybeAskAccount("cart", () => {
    void startKroger(krogerStore.storeName, button);
  });
}

async function boot() {
  try {
    adoptSessionFromUrl();
    consumeKrogerReturn();
    paintKrogerConnected(krogerConnectedNow());
    listRevision = Number(localStorage.getItem(REVISION_KEY) || "0") || 0;
    await bootApp();
  } finally {
    if (!landedFromKroger) {
      if (shouldPromptProfile(localStorage)) profileUi?.open();
      else welcome.maybeAutoOpen();
    }
    else releasePageForTaps();
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
  toastShellUpdate();
  watchShellUpdates();
  applyTheme(localStorage.getItem(THEME_KEY) || "system");
  bindKeyboardInset();
  $("dept-chips")?.addEventListener("scroll", syncChipHint, { passive: true });
  paintStarterLists();
  paintUsuals();
  paintPlanBar();
  zipEl.value = localStorage.getItem(ZIP_KEY) || "";
  paintZipPlace();
  syncDrawerMode();
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
    showCatalogError("You're offline. This trip is saved on this phone.");
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
  syncBrowse();
  paintKrogerConnected(krogerConnectedNow());
  void refreshKrogerFromServer();
  const browserPlugin = window.Capacitor?.Plugins?.Browser;
  if (isNative() && browserPlugin?.addListener) {
    void browserPlugin.addListener("browserFinished", () => {
      sawAppHidden = true;
      showWalmartReturn();
    });
  }
  window.setInterval(() => void refreshAlerts(), 60_000);
  const storedStep = readFlowStep(localStorage.getItem(STEP_KEY));
  if (storedStep !== "add") showStep(storedStep);
  else syncStepVisibility();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") noteAppHidden();
  if (document.visibilityState === "visible") noteAppVisible();
});
window.addEventListener("blur", noteAppHidden);
window.addEventListener("focus", () => {
  if (sawAppHidden) showWalmartReturn();
});
window.addEventListener("pageshow", () => {
  if (sawAppHidden) showWalmartReturn();
});

const pullHost = document.querySelector(".catalog");
pullHost?.addEventListener(
  "touchstart",
  (event) => {
    const blocked =
      window.scrollY > 8 ||
      $("app-drawer")?.classList.contains("is-open") ||
      document.querySelector("dialog[open]");
    if (blocked) {
      hidePullStatus();
      return;
    }
    pullActive = true;
    pullStart = event.touches[0]?.clientY ?? null;
    pullTravel = 0;
    syncPullStatus();
  },
  { passive: true }
);
pullHost?.addEventListener(
  "touchmove",
  (event) => {
    if (!pullActive || pullStart == null) return;
    pullTravel = pullDistance(pullStart, event.touches[0]?.clientY ?? pullStart, window.scrollY <= 8);
    syncPullStatus();
  },
  { passive: true }
);
pullHost?.addEventListener("touchend", () => {
  const should = pullActive && pullShouldRefresh(pullTravel);
  hidePullStatus();
  if (should) void refreshPrices();
});
pullHost?.addEventListener("touchcancel", () => {
  hidePullStatus();
});

document.addEventListener("input", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target) lists().onInput(target);
});

document.addEventListener("focusin", (event) => {
  const field = event.target;
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
  if (!field.closest(".filters.open, .list-panel.open, dialog.sheet")) return;
  field.scrollIntoView({ block: "center" });
});

document.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest("[data-empty-action]") : null;
  if (!button) return;
  const action = button.getAttribute("data-empty-action");
  if (action === "browse" || action === "add-items") {
    openList(false);
    void openAlerts(false);
    showStep("add");
    openBrowse();
    searchEl.focus();
  } else if (action === "find-stores") {
    $("find-stores")?.click();
  } else if (action === "clear-search") {
    query = "";
    searchEl.value = "";
    closeSuggestions();
    syncBrowse();
    if (browseOpen) void loadPage(true);
    else if (gridEl) gridEl.innerHTML = "";
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

window.addEventListener("popstate", () => consumeKrogerReturn());

const welcome = mountWelcome({
  isNative,
  apiUrl,
  fetch: (...args) => globalThis.fetch(...args),
  getZip: () => normalizeZip(zipEl.value),
  setZip: (zip) => applyZip(zip),
  focusZip: () => focusZipField(),
  readCoords: readDeviceCoords,
  openAuthorize,
  toast,
  krogerKnownConnected: () => krogerConnectedNow(),
  themeLabel: () => themeButtonLabel(document.documentElement.dataset.theme || "system", window.matchMedia("(prefers-color-scheme: dark)").matches),
  cycleTheme: () => applyTheme(nextTheme(document.documentElement.dataset.theme || "system")),
  accountsEnabled: () => Boolean(authStatus?.enabled),
  signedIn: () => Boolean(accountState?.id),
  getBilling: () => billingStatus,
});

function finishProfile(profile) {
  localStorage.setItem(ONBOARDING_KEY, "1");
  const rows = pinnedUsualRows(profile);
  if (rows.length) {
    rememberUsuals(localStorage, rows);
    paintUsuals();
  }
  const head = defaultHeadcount(profile);
  if (head && !localStorage.getItem("gg-party")) localStorage.setItem("gg-party", String(head));
  scheduleAccountSync();
  const id = firstListId(profile);
  void lists().addThemed(id);
}

profileUi = mountProfileOnboarding({
  storage: localStorage,
  toast,
  loadStaple: async (search) => {
    const response = await fetch(apiUrl(`/api/catalog/browse?q=${encodeURIComponent(search)}&limit=24`));
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return [];
    const want = familyFromQuery(search);
    return (body.items || []).filter((tile) => {
      if (!want) return true;
      return familyFromQuery(`${tile.familyName || ""} ${tile.name || ""} ${tile.brand || ""}`) === want;
    }).map((tile) => {
      const variant = Array.isArray(tile.variants) && tile.variants.length
        ? tile.variants.find((item) => item.id === tile.defaultVariantId) || tile.variants[0]
        : tile;
      return {
        id: variant.id || tile.id,
        name: tile.familyName || variant.name || tile.name,
        familyName: tile.familyName || variant.familyName || tile.name,
        brand: variant.brand || tile.brand || "",
        sizeLabel: variant.variantLabel || variant.sizeLabel || variant.label || "",
        imageUrl: (variant.imageUrls || tile.imageUrls || [])[0] || "",
        imageUrls: variant.imageUrls || tile.imageUrls || [],
        upc: variant.upc || tile.upc || "",
      };
    });
  },
  onDone: finishProfile,
});

alwaysPrompt = mountAlwaysPrompt({
  storage: localStorage,
  onAnswer(choice, product) {
    const profile = getUserProfile(localStorage);
    const next = choice === "always" ? acceptAlways(profile, product, "add") : declineAlways(profile, product);
    saveUserProfile(localStorage, next);
    scheduleAccountSync();
    myProducts?.paint?.();
  },
});

myProducts = mountMyProducts({
  storage: localStorage,
  onEditProfile: () => profileUi?.openEditor(),
  onChange: () => scheduleAccountSync(),
});

$("drawer-profile")?.addEventListener("click", () => {
  closeDrawer();
  profileUi?.openEditor();
});
$("drawer-products")?.addEventListener("click", () => {
  closeDrawer();
  myProducts?.open();
});

importer = mountImport({
  addProduct,
  showStep,
  remember(items) {
    rememberUsuals(localStorage, items);
    paintUsuals();
  },
  apiUrl,
  toast,
  mediaUrl,
  askConstraints() {
    return profileToConstraints(getUserProfile(localStorage));
  },
  shapeReview(review) {
    return shapeImportReview(review, getUserProfile(localStorage));
  },
  prepareAdd(item, product) {
    const profile = getUserProfile(localStorage);
    const shelf = [product, ...(item.choices || []).map((choice) => choice.product).filter(Boolean)];
    const resolved = resolveProductPreference({ profile, query: item.name || product?.name || "", products: shelf });
    if (resolved.status === "excluded") return null;
    if (resolved.product && (resolved.status === "preferred" || resolved.status === "swapped" || resolved.status === "brand")) {
      return { product: resolved.product, options: { quiet: true, preference: resolved, source: "import", skipAsk: true } };
    }
    return { product, options: { quiet: true, source: "import", skipAsk: true } };
  },
});

void boot().finally(() => {
  void hideSplash();
});
