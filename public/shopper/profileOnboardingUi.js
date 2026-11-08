/**
 * Full-screen guide. One question, big tap targets, progress dots, Back,
 * and Skip for now. Closing it keeps the step for the next visit.
 */

import { getUserProfile, saveUserProfile, shouldPromptProfile } from "./profile.js";
import {
  AISLE_LABELS,
  SKIP_LABEL,
  answerStep,
  completeProfile,
  dietSteps,
  goBack,
  markDietPrompt,
  optionLabel,
  primaryLabel,
  profileSteps,
  progressLabel,
  resumeStep,
  shouldAskDietPrompt,
  skipForNow,
  skipStep,
  stepById,
  summarySections,
} from "./profileOnboarding.js";
import { learnPreference, forgetPreference, isStoreBrand } from "./productPreference.js";
import { applyCheapestDefaults, asksNameBrand, categorySearch, nameBrandsFor, preferenceCategories, setCategoryPreference } from "./categoryPreference.js";
import { brandKey, displayBrand, isProduceFamily } from "./brandNames.js";
import { categoryDetailHtml, categoryGateHtml } from "./categoryStage.js";
import { normalizeZipInput, zipAdvanceError } from "./onboarding.js";
import { applyLearnedReceipts } from "./receiptApply.js";
import { applyLearnedChoice, learnedCardInnerHtml, learnedSummaryHtml, learnedTripChoiceHtml, receiptUploadHtml, rememberedNameBrand } from "./receiptCopy.js";
import { importStageHtml, learnedViewReady } from "./learnedGate.js";
import { commitLearnedCard } from "./learnedStable.js";
import { syncTripAddBar } from "./tripActionBar.js";
import { bindZipEntry, syncZipPlaceholder, zipEntryFieldHtml } from "./zipEntry.js";
import { APPROXIMATE_ZIP_NOTE, fiveDigitZip } from "./deviceZip.js";
import { orderTitle, readLiveHtml, readingPhaseText, storeChoiceHtml, foundLabel } from "./intakePresent.js";
import { READING_RECEIPT, readCardTitle } from "./receiptReading.js";
import { captureRuleScroll, restoreRuleScroll, revealInside } from "./ruleScroll.js";
import { lightTap } from "./phone.js";
import { knownBrandNames } from "./stapleFamilies.js";
import { storesForZip, zipContinueDecision } from "./nearbyStores.js";
import { adStoresVisible, mergeSavedStores, visibleStoreNames } from "./storeScope.js";
import { receiptBackPhase, receiptReadCurrent } from "./receiptNav.js";
import { PROFILE_CONNECT_KEY, storeConnectCopy } from "./storeConnect.js";
import { suggestZipChoices } from "./zipSuggest.js";
import { fieldZip, ZIP_PLACEHOLDER } from "./zipField.js";
import { installChainColors } from "./chainColors.js";
import { jumpHidden, tripAddStatus, tripSelectFromScroll } from "./tripAdd.js";

function escapeText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {{
 *   storage?: Storage,
 *   loadStaple?: (search: string) => Promise<object[]>,
 *   onDone?: (profile: object) => void,
 *   toast?: (message: string) => void,
 * }} deps
 */
export function mountProfileOnboarding(deps = {}) {
  installChainColors(document);
  const dialog = document.getElementById("profile-onboard");
  if (!dialog) return { open() {}, shouldPrompt() { return false; }, openEditor() {} };
  const storage = deps.storage || localStorage;
  const $ = (id) => document.getElementById(id);
  let draft = getUserProfile(storage);
  let stepId = resumeStep(draft);
  let returnTo = "";
  /** @type {Record<string, object>} */
  let picks = {};
  let categoryIndex = 0;
  let shelf = [];
  let loadedFor = "";
  let categoryDraft = blankCategory();
  let phase = "gate";
  /** @type {Set<string>} */
  let neverIds = new Set();
  let receiptPhase = "upload";
  let motion = "forward";
  /** @type {object[]} */
  let readCards = [];
  /** @type {Map<number, object[]>} */
  let fileLinesByIndex = new Map();
  /** @type {object[]} */
  let learnedRows = [];
  /** @type {object[]} */
  let receiptLines = [];
  let paperReceipt = false;
  let paperNote = "";
  let receiptWarning = "";
  /** @type {File[]} */
  let pendingFiles = [];
  let editingFamily = "";
  /** @type {Record<string, object[]>} */
  let brandShelves = {};
  let lazyFamily = "";
  let resumeStatus = "";
  let dietMode = false;
  let zipApproximate = false;
  /** @type {(() => void) | null} */
  let skipBeat = null;
  let beatToken = 0;
  let connectStatus = null;
  /** Parsing and brand grouping must both finish before the learned screen exists. */
  let importGate = { parsing: false, grouping: false, revealed: false };
  let beatMarkup = "";
  /** Families whose rule button should keep Saved. */
  const savedRules = new Set();
  let readTick = 0;
  let readTimer = 0;
  /** @type {(() => void) | null} */
  let dietDone = null;

  function blankCategory() {
    return { mode: "", brand: "", brands: [], productId: "", attributes: [], product: null };
  }

  function persist(next) {
    draft = saveUserProfile(storage, next);
    return draft;
  }

  function focusTitle() {
    const title = $("profile-title");
    if (!title) return;
    title.tabIndex = -1;
    title.focus();
  }

  function dots() {
    const host = $("profile-dots");
    if (!host) return;
    const list = dietMode ? dietSteps() : profileSteps();
    const current = Math.max(0, list.findIndex((step) => step.id === stepId));
    host.innerHTML = list
      .map((step, index) => {
        const state = index === current ? "true" : "false";
        const done = index < current ? "true" : "false";
        return `<span data-current="${state}" data-done="${done}"></span>`;
      })
      .join("");
  }

  function choiceButton(id, label, pressed, extra = "") {
    return `<button type="button" class="choice-card" data-choice="${escapeText(id)}" aria-pressed="${pressed ? "true" : "false"}" ${extra}>${escapeText(label)}</button>`;
  }

  function stageHtml(step) {
    if (step.kind === "multi" || step.kind === "single") {
      const selected = new Set(step.kind === "single" ? [draftValue(step.id)].filter(Boolean) : draftList(step.id));
      const grid = `<div class="${step.kind === "single" ? "choice-stack" : "choice-grid"}" role="group">${step.choices
        .map((choice) => choiceButton(choice.id, choice.label, selected.has(choice.id)))
        .join("")}</div>`;
      if (step.id === "diets") {
        return `${grid}<label class="profile-field">Other diet<input id="profile-diet-other" type="text" maxlength="80" placeholder="Or type one" value="${escapeText((draft.dietNotes || []).join(", "))}" /></label>`;
      }
      return grid;
    }
    if (step.kind === "household") {
      const size = draft.household?.size;
      const sizes = [1, 2, 3, 4, 5]
        .map((count) => choiceButton(String(count), count === 5 ? "5+" : String(count), size === count))
        .join("");
      return `<p class="profile-label">How many people</p><div class="choice-grid" role="group" aria-label="Household size">${sizes}</div>`;
    }
    if (step.kind === "cuisine") {
      return `<div class="choice-grid" role="group">${stepById("cuisines") && PROFILE_CUISINES()
        .map((id) => {
          const stance = draft.cuisines?.[id] || "";
          const pressed = stance === "like" || stance === "dislike";
          return `<button type="button" class="choice-card${stance === "dislike" ? " dislike" : ""}" data-cuisine="${escapeText(id)}" data-stance="${escapeText(stance)}" aria-pressed="${pressed ? "true" : "false"}">${escapeText(optionLabel(id))}${stance === "dislike" ? " · no" : stance === "like" ? " · yes" : ""}</button>`;
        })
        .join("")}</div>`;
    }
    if (step.kind === "text") {
      return `<label class="profile-field">Always buy<input id="profile-always" type="text" maxlength="200" placeholder="oat milk, sourdough" value="${escapeText((draft.always || []).join(", "))}" /></label>
        <label class="profile-field">Never buy<input id="profile-never" type="text" maxlength="200" placeholder="cilantro, anchovies" value="${escapeText((draft.never || []).join(", "))}" /></label>`;
    }
    if (step.kind === "brand") {
      const modes = [
        ["name", "Name brand"],
        ["store", "Store brand"],
        ["cheaper", "Whichever is cheaper"],
      ];
      const current = draft.brand?.default;
      const cards = modes.map(([id, label]) => choiceButton(id, label, current === id)).join("");
      const organic = draft.brand?.organicIfClose === true;
      const aisles = AISLE_LABELS.map((aisle) => {
        const picked = draft.brand?.overrides?.[aisle.id] || "";
        const chips = modes
          .map(
            ([id, label]) =>
              `<button type="button" class="mini-chip" data-aisle="${escapeText(aisle.id)}" data-mode="${id}" aria-pressed="${picked === id ? "true" : "false"}">${escapeText(label)}</button>`
          )
          .join("");
        return `<div class="aisle-override"><p>${escapeText(aisle.label)}</p><div class="mini-row">${chips}</div></div>`;
      }).join("");
      return `<div class="choice-stack" role="group">${cards}</div>
        <button type="button" class="choice-card" id="profile-organic" aria-pressed="${organic ? "true" : "false"}">Organic if the price is close</button>
        <p class="profile-label">Different for an aisle</p>${aisles}`;
    }
    if (step.kind === "welcome") return "";
    if (step.kind === "place" || step.kind === "zip") {
      const zip = fieldZip(deps.getZip?.() || "");
      return `<div class="zip-row">
          ${zipEntryFieldHtml({ id: "profile-zip", value: zip, placeholder: ZIP_PLACEHOLDER })}
          <button type="button" class="zip-done" id="profile-zip-done" aria-label="Done">✓</button>
        </div>
        <p id="profile-zip-approx" class="zip-approx"${zipApproximate ? "" : " hidden"}>${escapeText(APPROXIMATE_ZIP_NOTE)}</p>
        <p id="profile-zip-hint" class="muted"${zip ? "" : " hidden"}>Not right? Edit it.</p>
        <div id="profile-zip-choices" class="zip-choices" hidden></div>
        <p id="profile-zip-error" class="status" role="alert" hidden></p>
        <button type="button" class="ghost" id="profile-use-location">Use my location</button>
        <p id="profile-store-note" class="muted">Stores within about 25 miles show up here.</p>
        <div id="profile-store-list" class="store-choices"></div>
        <div id="store-connect"></div>`;
    }
    if (step.kind === "receipts") {
      const importing = importGate.parsing || importGate.grouping || receiptPhase === "reading" || (receiptPhase === "learned" && !learnedViewReady(importGate));
      if (importing) {
        return importStageHtml({
          parsing: importGate.parsing || receiptPhase === "reading",
          grouping: importGate.grouping,
          revealed: false,
          spinnerHtml: `<div class="read-live" data-reading-screen="1">${beatMarkup || readLiveHtml(readCards)}</div>`,
          learnedHtml: "",
        });
      }
      if (receiptPhase === "trip") return learnedTripChoiceHtml(receiptLines);
      if (receiptPhase === "learned" && learnedViewReady(importGate)) {
        const warning = receiptWarning ? `<p class="paper-note" role="status">${escapeText(receiptWarning)}</p>` : "";
        const brandsByFamily = {};
        const pendingFamilies = {};
        for (const row of learnedRows) {
          brandsByFamily[row.family] = brandChoices(row);
          pendingFamilies[row.family] = !brandShelves[row.family];
        }
        return `${warning}${learnedSummaryHtml(learnedRows, {
          paper: paperReceipt,
          paperNote,
          lines: receiptLines,
          editingFamily,
          brandsByFamily,
          pendingFamilies,
          savedFamilies: savedRules,
        })}`;
      }
      const restore = learnedRows.length
        ? `<p class="paper-note">This order is already read.</p><button type="button" class="ghost" id="receipt-restore">Back to what we learned</button>`
        : "";
      return `${restore}${receiptUploadHtml()}`;
    }
    if (step.kind === "products") {
      const categories = preferenceCategories();
      if (phase === "gate") return categoryGateHtml({ categories, declined: [...neverIds] });
      const current = categories[categoryIndex] || categories[0];
      const saved = draft.categoryPreferences?.[current?.id] || {};
      const mode = categoryDraft.mode || (!categoryDraft.touched ? saved.mode : "") || "";
      const brand = categoryDraft.brand || (!categoryDraft.touched ? saved.brand : "") || "";
      const attributes = categoryDraft.attributes?.length ? categoryDraft.attributes : !categoryDraft.touched ? saved.attributes || [] : categoryDraft.attributes || [];
      const lazy = Boolean(lazyFamily);
      const ready = loadedFor === current?.id;
      const brands = ready ? nameBrandsFor(shelf, current?.id || "") : [];
      const askBrand = ready && asksNameBrand(shelf, current?.id || "");
      return `${ready ? "" : `<div class="read-skel" aria-hidden="true"><span></span><span></span><span></span></div>`}${categoryDetailHtml({
        category: current,
        index: lazy ? 0 : categoryIndex,
        total: lazy ? 1 : categories.length,
        mode,
        brand,
        attributes,
        attributeChoices: current?.attributes || [],
        brands: brands.map((row) => ({ brand: row.brand, imageUrl: row.imageUrl, productId: row.productId || row.product?.id || "" })),
        selectedBrands: categoryDraft.brands?.length ? categoryDraft.brands : brand ? [brand] : [],
        askBrand,
        produce: isProduceFamily(current?.id),
        pending: !ready,
        compact: lazy,
      })}`;
    }
    const sections = summarySections(draft)
      .map(
        (section) => `<section class="summary-row">
          <div><h3>${escapeText(section.label)}</h3><p>${escapeText(section.value)}</p></div>
          <button type="button" class="text-btn" data-edit="${escapeText(section.step)}">Edit</button>
        </section>`
      )
      .join("");
    return `<div class="summary-list">${sections}</div>`;
  }

  function PROFILE_CUISINES() {
    return stepById("cuisines").choices.map((choice) => choice.id);
  }

  function yesNo(label, key, value) {
    return `<p class="profile-label">${escapeText(label)}</p><div class="choice-grid" role="group" aria-label="${escapeText(label)}">
      ${choiceButton(`${key}-yes`, "Yes", value === true, `data-yesno="${key}" data-value="yes"`)}
      ${choiceButton(`${key}-no`, "No", value === false, `data-yesno="${key}" data-value="no"`)}
    </div>`;
  }

  function draftList(id) {
    if (id === "why") return draft.why || [];
    if (id === "loves") return draft.loves || [];
    if (id === "avoids") return draft.avoids || [];
    if (id === "allergies") return draft.allergies || [];
    if (id === "diets") return draft.diets || [];
    return [];
  }

  function draftValue(id) {
    if (id === "shopping") return draft.style?.shopping;
    if (id === "cooking") return draft.style?.cooking;
    if (id === "time") return draft.style?.time;
    if (id === "stops") return draft.style?.stops;
    return null;
  }

  function render(options = {}) {
    const step = stepById(stepId);
    const title = $("profile-title");
    const hint = $("profile-hint");
    const progress = $("profile-progress");
    const back = $("profile-back");
    const next = $("profile-next");
    const skip = $("profile-skip");
    const stage = $("profile-stage");
    const top = document.querySelector("#profile-onboard .profile-top");
    const learned = step.id === "receipts" && receiptPhase === "learned" && learnedViewReady(importGate);
    const reading = step.id === "receipts" && !learned && (receiptPhase === "reading" || importGate.parsing || importGate.grouping || (receiptPhase === "learned" && !learnedViewReady(importGate)));
    const tripChoice = step.id === "receipts" && receiptPhase === "trip" && !importGate.parsing && !importGate.grouping;
    const welcome = step.id === "welcome" && !dietMode;
    if (dialog) {
      dialog.dataset.step = learned ? "learned" : reading ? "reading" : tripChoice ? "trip" : step.id;
      dialog.dataset.dir = motion;
    }
    if (top) top.hidden = welcome;
    if (title) title.textContent = tripChoice ? "Add them to this trip?" : learned ? "Here's what we learned" : step.title;
    if (hint) {
      const hintText = tripChoice
        ? "Pick the lines to shop, or start empty."
        : learned
          ? ""
          : reading
            ? "We'll handle the math."
            : step.hint;
      hint.textContent = hintText;
      hint.hidden = !hintText;
    }
    if (progress) progress.textContent = welcome ? "" : progressLabel(step.id);
    if (back) back.hidden = welcome || ((dietMode ? stepId === "allergies" : step.index === 0) && !returnTo && receiptPhase === "upload");
    const readingBusy = reading && (importGate.parsing || importGate.grouping || readCards.some((card) => card.status === "reading"));
    const readingReady = reading && !readingBusy && !beatMarkup && learnedViewReady({ ...importGate, revealed: true }) && (learnedRows.length > 0 || receiptLines.length > 0);
    if (next) {
      next.hidden = tripChoice || Boolean(beatMarkup) || importGate.parsing || importGate.grouping || (reading && !readingReady);
      next.textContent = returnTo ? "Save" : learned || reading ? "Continue" : step.id === "receipts" ? "Read my receipts" : primaryLabel(step.id);
    }
    if (skip) {
      skip.hidden = welcome;
      skip.textContent = SKIP_LABEL;
      skip.disabled = false;
    }
    if (next && dietMode && step.id === "diets") next.textContent = "Save";
    if (stage) stage.innerHTML = stageHtml(step);
    bindPlaceInput();
    bindReceiptInput();
    if ((step.kind === "place" || step.kind === "zip") && !options.deferStores) paintStoreList();
    else if (options.deferStores) showStoreSkeleton();
    if (step.kind === "welcome") warmStores();
    if (next && !(dietMode && step.id === "diets")) {
      if (reading) next.disabled = !readingReady;
      else next.disabled = step.id === "receipts" && !learned ? !receiptReady() : false;
    }
    syncZipContinue();
    dots();
    const dotHost = $("profile-dots");
    if (dotHost) dotHost.hidden = welcome;
    if (step.kind === "products") void loadProducts();
    if (tripChoice || (step.id === "receipts" && receiptPhase === "upload")) resetStageScroll();
    if (tripChoice && typeof requestAnimationFrame === "function") requestAnimationFrame(() => syncTripJump());
  }

  function rerenderLearned() {
    const stage = $("profile-stage");
    const sheet = document.querySelector("#profile-onboard .sheet-body");
    const saved = captureRuleScroll({
      stage: stage instanceof HTMLElement ? stage.scrollTop : 0,
      sheet: sheet instanceof HTMLElement ? sheet.scrollTop : 0,
      page: window.scrollY || 0,
    });
    if (dialog) dialog.dataset.holdScroll = "1";
    render();
    const nextStage = $("profile-stage");
    restoreRuleScroll(
      {
        stage: nextStage,
        sheet: document.querySelector("#profile-onboard .sheet-body"),
        scrollTo: (y) => window.scrollTo(0, y),
        frame: (fn) => {
          if (typeof requestAnimationFrame === "function") requestAnimationFrame(fn);
        },
      },
      saved
    );
    if (dialog) {
      const clearHold = () => {
        if (dialog.dataset.holdScroll) delete dialog.dataset.holdScroll;
      };
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(clearHold);
      else clearHold();
    }
    return nextStage;
  }

  function resetStageScroll() {
    const stage = $("profile-stage");
    if (stage) stage.scrollTop = 0;
    const body = document.querySelector("#profile-onboard .sheet-body");
    if (body) body.scrollTop = 0;
    const list = $("trip-add-body");
    if (list) list.scrollTop = 0;
  }

  function syncTripJump() {
    const stage = $("trip-add-body") || $("profile-stage");
    const jump = $("trip-jump");
    if (!jump) return;
    if (!stage) {
      jump.hidden = true;
      return;
    }
    jump.hidden = jumpHidden(stage.scrollTop, stage.clientHeight, stage.scrollHeight);
  }

  function paintTripTotal() {
    const root = $("profile-stage") || document;
    const boxes = [...root.querySelectorAll("[data-trip-pick]")].filter((box) => box instanceof HTMLInputElement);
    const selected = boxes.filter((box) => box.checked).length;
    const total = boxes.reduce((sum, box) => sum + (box.checked ? Number(box.dataset.estimate) || 0 : 0), 0);
    const status = tripAddStatus(Math.round(total * 100) / 100, selected);
    syncTripAddBar(root, { ...status, selected });
  }

  function currentZipRaw() {
    return String($("profile-zip")?.value || deps.getZip?.() || "").trim();
  }

  let storesWarmed = "";
  function warmStores() {
    const zip = normalizeZipInput(currentZipRaw());
    if (!/^\d{5}/.test(zip) || storesWarmed === zip) return;
    storesWarmed = zip;
    const run = () => {
      try {
        storesForZip(zip);
      } catch {
        storesWarmed = "";
      }
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 500 });
    else setTimeout(run, 0);
  }

  function showStoreSkeleton() {
    const host = $("profile-store-list");
    if (host) host.innerHTML = `<div class="read-skel" aria-busy="true" aria-label="Loading stores"><span></span><span></span><span></span></div>`;
    const note = $("profile-store-note");
    if (note) note.textContent = "Finding stores near you…";
  }

  function paintStoreList() {
    const host = $("profile-store-list");
    const note = $("profile-store-note");
    if (!host) return;
    const raw = currentZipRaw();
    const zip = normalizeZipInput(raw);
    if (!/^\d{5}/.test(zip)) {
      host.innerHTML = "";
      if (note) note.textContent = "Stores within about 25 miles show up here.";
      return;
    }
    const nearby = storesForZip(zip);
    const names = visibleStoreNames(nearby.stores);
    const selected = new Set(draft.shopStores || []);
    const open = !draft.shopStores?.length;
    host.innerHTML = storeChoiceHtml(names, { selected, open });
    if (note) note.textContent = nearby.note || "Stores within about 25 miles. Uncheck one to leave it out.";
    paintStoreConnect(names);
  }

  function paintStoreConnect(names) {
    const host = $("store-connect");
    if (!host) return;
    if (!names?.length) {
      host.innerHTML = "";
      return;
    }
    const copy = storeConnectCopy({
      stores: names,
      oauthConfigured: Boolean(connectStatus?.oauthConfigured),
      connected: Boolean(connectStatus?.connected),
    });
    const now = copy.showNow ? `<button type="button" class="primary" id="store-connect-now">${escapeText(copy.now)}</button>` : "";
    const walmart = copy.walmart ? `<p class="muted">${escapeText(copy.walmart)}</p>` : "";
    host.innerHTML = `<section class="store-connect" aria-labelledby="store-connect-title">
      <h3 id="store-connect-title">${escapeText(copy.title)}</h3>
      <p>${escapeText(copy.body)}</p>
      ${walmart}
      <div class="choice-stack">
        ${now}
        <button type="button" class="ghost" id="store-connect-later">${escapeText(copy.later)}</button>
      </div>
    </section>`;
    if (!connectStatus) void loadConnectStatus(names);
  }

  async function loadConnectStatus(names) {
    try {
      const response = await fetch("/api/kroger/auth-status", { headers: { Accept: "application/json" } });
      connectStatus = response.ok ? await response.json() : { oauthConfigured: false, connected: false };
    } catch {
      connectStatus = { oauthConfigured: false, connected: false };
    }
    if (stepId === "place" || stepId === "zip") paintStoreConnect(names);
  }

  async function connectStoresNow() {
    const zip = readZip();
    if (!zip) return;
    const place = readPlace();
    if (place) draft.shopStores = place.stores;
    draft = persist({
      ...draft,
      onboarding: { ...(draft.onboarding || {}), status: "in_progress", step: "place", updatedAt: Date.now() },
    });
    try {
      sessionStorage.setItem(PROFILE_CONNECT_KEY, "connected");
    } catch {
      /* private browsing */
    }
    try {
      const response = await fetch("/api/kroger/connect", { method: "POST", headers: { Accept: "application/json" } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.authorizeUrl) {
        try {
          sessionStorage.removeItem(PROFILE_CONNECT_KEY);
        } catch {
          /* private browsing */
        }
        deps.toast?.(body.error || "Kroger sign-in isn't available. You can do this at checkout.");
        return;
      }
      window.location.assign(body.authorizeUrl);
    } catch {
      try {
        sessionStorage.removeItem(PROFILE_CONNECT_KEY);
      } catch {
        /* private browsing */
      }
      deps.toast?.("Couldn't open Kroger sign-in. You can do this at checkout.");
    }
  }

  function syncZipContinue() {
    const next = $("profile-next");
    const field = $("profile-zip");
    const onZip = stepId === "zip" || stepId === "place";
    if (dialog) dialog.dataset.zipTyping = onZip && (!fiveDigitZip(field?.value) || document.activeElement === field) ? "1" : "0";
    if (!next || !onZip) return;
    const ready = Boolean(fiveDigitZip(field?.value)) && document.activeElement !== field;
    next.hidden = !ready;
    const chip = $("profile-zip-done");
    if (chip) chip.classList.toggle("is-set", Boolean(fiveDigitZip(field?.value)));
  }

  function paintZipChoices(choices) {
    const host = $("profile-zip-choices");
    if (!host) return;
    const codes = (choices || []).filter((code) => /^\d{5}$/.test(String(code || "")));
    host.hidden = codes.length === 0;
    host.innerHTML = codes
      .map((code) => `<button type="button" class="zip-choice" data-zip-choice="${escapeText(code)}">${escapeText(code)}</button>`)
      .join("");
  }

  function bindPlaceInput() {
    const zipInput = $("profile-zip");
    if (zipInput) bindZipEntry(zipInput);
    if (zipInput && zipInput.dataset.bound !== "1") {
      zipInput.dataset.bound = "1";
      const finishZip = () => {
        const five = fiveDigitZip(zipInput.value);
        if (five) zipInput.value = five;
        syncZipPlaceholder(zipInput, ZIP_PLACEHOLDER);
        zipInput.blur();
        const hint = $("profile-zip-hint");
        if (hint) hint.hidden = !String(zipInput.value || "").trim();
        paintStoreList();
        syncZipContinue();
      };
      zipInput.addEventListener("focus", () => syncZipContinue());
      zipInput.addEventListener("blur", () => syncZipContinue());
      zipInput.addEventListener("input", () => {
        zipApproximate = false;
        const approx = $("profile-zip-approx");
        if (approx) approx.hidden = true;
        paintZipChoices([]);
        const error = $("profile-zip-error");
        if (error) error.hidden = true;
        const hint = $("profile-zip-hint");
        if (hint) hint.hidden = !String(zipInput.value || "").trim();
        syncZipContinue();
        if (fiveDigitZip(zipInput.value)) finishZip();
        else paintStoreList();
      });
      $("profile-zip-done")?.addEventListener("click", finishZip);
    }
    const location = $("profile-use-location");
    if (location && location.dataset.bound !== "1") {
      location.dataset.bound = "1";
      location.addEventListener("click", () => {
        void (async () => {
          if (!deps.locateZip) {
            deps.toast?.("Type a ZIP. Location isn't available here.");
            return;
          }
          location.disabled = true;
          try {
            const located = await deps.locateZip();
            const rawZip = typeof located === "string" ? located : located?.zip || "";
            const suggestion = suggestZipChoices({
              lat: located?.lat,
              lng: located?.lng,
              zip: rawZip,
              approximate: true,
            });
            const zip = suggestion.choices?.[0] || "";
            zipApproximate = Boolean(zip);
            const field = $("profile-zip");
            if (field) {
              field.value = zip ? String(zip).replace(/\D/g, "").slice(0, 5) : "";
              syncZipPlaceholder(field, ZIP_PLACEHOLDER);
            }
            if (!zip) deps.toast?.("No ZIP within about 15 miles. Type yours.");
            const hint = $("profile-zip-hint");
            if (hint) hint.hidden = !zip;
            const approx = $("profile-zip-approx");
            if (approx) {
              approx.hidden = !zip;
              if (zip) approx.textContent = APPROXIMATE_ZIP_NOTE;
            }
            paintZipChoices(suggestion.choices?.length ? suggestion.choices : zip ? [zip] : []);
            field?.blur();
            paintStoreList();
            syncZipContinue();
          } catch (error) {
            deps.toast?.(error instanceof Error ? error.message : "Couldn't use location. Type a ZIP.");
          } finally {
            location.disabled = false;
          }
        })();
      });
    }
  }

  function softTap() {
    const vibrate = typeof navigator !== "undefined" && typeof navigator.vibrate === "function" ? (ms) => navigator.vibrate(ms) : undefined;
    const haptics = typeof window !== "undefined" ? window.Capacitor?.Plugins?.Haptics : undefined;
    void lightTap({ haptics, vibrate });
  }

  function brandChoices(row) {
    const known = knownBrandNames(row?.family).map((name) => displayBrand(name)).filter(Boolean);
    const shelfNames = nameBrandsFor(brandShelves[row?.family] || [], row?.family).map((item) => item.brand);
    const detected = row?.mode === "brand" || row?.mode === "cheapestPicks" ? (row.brands || []).concat(row.brand || []) : [];
    const names = [];
    const seen = new Set();
    for (const name of [...detected, ...known, ...shelfNames].map((item) => displayBrand(item)).filter(Boolean)) {
      if (!name || isStoreBrand(name) || isProduceFamily(row?.family)) continue;
      const key = brandKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
    return names.slice(0, 24);
  }

  function receiptReady() {
    const text = $("profile-receipt-paste")?.value || "";
    return pendingFiles.length > 0 || String(text).trim().length > 0;
  }

  function syncReceiptButton() {
    const next = $("profile-next");
    if (!next || stepId !== "receipts" || receiptPhase !== "upload") return;
    next.disabled = !receiptReady();
  }

  function paintReceiptFiles() {
    const host = $("profile-receipt-files");
    if (host) {
      host.innerHTML = pendingFiles
        .map((file, index) => {
          const name = file.name || "Receipt";
          return `<span class="file-chip"><span>${escapeText(name)}</span><button type="button" class="text-btn" data-file-remove="${index}" aria-label="Remove ${escapeText(name)}">×</button></span>`;
        })
        .join("");
    }
    syncReceiptButton();
  }

  function addPendingFile(file) {
    if (!file) return;
    const key = `${file.name}|${file.size}|${file.lastModified}`;
    if (pendingFiles.some((have) => `${have.name}|${have.size}|${have.lastModified}` === key)) return;
    pendingFiles.push(file);
  }

  function bindReceiptInput() {
    const input = $("profile-receipt-input");
    const drop = document.querySelector("#profile-onboard .drop-zone");
    if (drop && drop.dataset.bound !== "1") {
      drop.dataset.bound = "1";
      drop.addEventListener("dragover", (event) => {
        event.preventDefault();
        drop.classList.add("is-drag");
      });
      drop.addEventListener("dragleave", () => drop.classList.remove("is-drag"));
      drop.addEventListener("drop", (event) => {
        event.preventDefault();
        drop.classList.remove("is-drag");
        for (const file of event.dataTransfer?.files || []) addPendingFile(file);
        paintReceiptFiles();
      });
    }
    if (input && input.dataset.bound !== "1") {
      input.dataset.bound = "1";
      input.addEventListener("change", () => {
        for (const file of input.files || []) addPendingFile(file);
        input.value = "";
        paintReceiptFiles();
      });
    }
    const paste = $("profile-receipt-paste");
    if (paste && paste.dataset.bound !== "1") {
      paste.dataset.bound = "1";
      paste.addEventListener("input", () => syncReceiptButton());
    }
    if (stepId === "receipts" && receiptPhase === "upload") paintReceiptFiles();
  }

  function readZip() {
    const zipInput = $("profile-zip");
    const raw = String(zipInput?.value || "").trim();
    const error = !raw ? "Enter a 5-digit ZIP." : zipAdvanceError(raw);
    const zipError = $("profile-zip-error");
    if (error) {
      if (zipError) {
        zipError.hidden = false;
        zipError.textContent = error;
      }
      zipInput?.focus();
      return null;
    }
    if (zipError) zipError.hidden = true;
    const zip = normalizeZipInput(raw);
    if (!/^\d{5}/.test(zip)) {
      if (zipError) {
        zipError.hidden = false;
        zipError.textContent = "Enter a 5-digit ZIP.";
      }
      return null;
    }
    deps.setZip?.(zip);
    return zip;
  }

  function readPlace() {
    const boxes = [...document.querySelectorAll("[data-place-store]")];
    const picked = boxes.map((box) => (box.checked ? box.getAttribute("data-place-store") : "")).filter(Boolean);
    if (!boxes.length) {
      const note = $("profile-zip-error");
      if (note) {
        note.hidden = false;
        note.textContent = "Stores are still loading. Wait a moment, then save.";
      }
      deps.toast?.("Stores are still loading. Wait a moment, then save.");
      return null;
    }
    if (!picked.length) {
      deps.toast?.("Pick at least one store.");
      return null;
    }
    return { stores: mergeSavedStores(picked, draft.shopStores, picked.length === boxes.length) };
  }

  async function loadBrandShelf(family) {
    if (!family || brandShelves[family] || !deps.loadStaple) return;
    let tiles = [];
    try {
      tiles = await deps.loadStaple(categorySearch(family) || family);
    } catch {
      tiles = [];
    }
    brandShelves[family] = tiles || [];
    if (editingFamily === family && stepId === "receipts" && learnedViewReady(importGate)) {
      paintLearnedCard(family, { saved: savedRules.has(family) });
    }
  }

  async function loadProducts() {
    const current = preferenceCategories()[categoryIndex];
    if (!current || !deps.loadStaple || loadedFor === current.id) return;
    const request = current.id;
    let tiles = [];
    try {
      tiles = await deps.loadStaple(current.search);
    } catch {
      tiles = [];
    }
    if (stepId !== "products" || preferenceCategories()[categoryIndex]?.id !== request) return;
    shelf = tiles || [];
    loadedFor = request;
    const stage = $("profile-stage");
    if (stage) stage.innerHTML = stageHtml(stepById("products"));
  }

  function rememberDietNotes() {
    const field = $("profile-diet-other");
    if (!field) return;
    draft.dietNotes = String(field.value || "")
      .split(/[\n,]/)
      .map((part) => part.replace(/\s+/g, " ").trim())
      .filter((part) => part.length >= 3)
      .slice(0, 8);
  }

  function syncNever() {
    neverIds = new Set(
      Object.values(draft.categoryPreferences || {})
        .filter((row) => row?.mode === "never")
        .map((row) => row.family)
    );
  }

  function saveNevers(at) {
    for (const id of neverIds) {
      draft = setCategoryPreference(draft, { family: id, mode: "never", brand: "", productId: "", size: "", attributes: [] }, at);
    }
    return draft;
  }

  function nextDetailIndex(from) {
    const categories = preferenceCategories();
    for (let index = from; index < categories.length; index += 1) {
      if (!neverIds.has(categories[index].id)) return index;
    }
    return -1;
  }

  function showCategory(index) {
    const categories = preferenceCategories();
    phase = "detail";
    categoryIndex = Math.max(0, Math.min(index, categories.length - 1));
    const saved = draft.categoryPreferences?.[categories[categoryIndex]?.id] || {};
    categoryDraft = {
      mode: saved.mode && saved.mode !== "never" ? saved.mode : "",
      brand: saved.brand || "",
      productId: saved.productId || "",
      attributes: saved.attributes || [],
      product: null,
      touched: false,
    };
    shelf = [];
    loadedFor = "";
    render();
  }

  function saveCategory(mode, at) {
    const current = preferenceCategories()[categoryIndex];
    if (!current) return draft;
    const chosen = mode || categoryDraft.mode || "skip";
    draft = setCategoryPreference(
      draft,
      {
        family: current.id,
        mode: chosen,
        brand: chosen === "brand" || chosen === "cheapestPicks" ? categoryDraft.brand || "" : "",
        brands: chosen === "cheapestPicks" ? categoryDraft.brands || (categoryDraft.brand ? [categoryDraft.brand] : []) : [],
        productId: chosen === "brand" ? categoryDraft.productId || "" : "",
        size: categoryDraft.product?.sizeLabel || "",
        attributes: categoryDraft.attributes || [],
        source: "manual",
        label: current.label || "",
      },
      at
    );
    if (chosen === "brand" && categoryDraft.product?.id) {
      draft = learnPreference(draft, categoryDraft.product, { family: current.id, locked: true, source: "onboarding", at });
    } else if (chosen !== "brand") {
      draft = forgetPreference(draft, current.id, at);
    }
    return draft;
  }

  function currentAnswer() {
    const step = stepById(stepId);
    if (step.kind === "multi") return draftList(step.id);
    if (step.kind === "single") return draftValue(step.id);
    if (step.kind === "household") return draft.household;
    if (step.kind === "cuisine") return draft.cuisines;
    if (step.kind === "text") {
      return {
        always: $("profile-always")?.value || "",
        never: $("profile-never")?.value || "",
      };
    }
    if (step.id === "diets") {
      rememberDietNotes();
      return { diets: draft.diets || [], notes: (draft.dietNotes || []).join(", ") };
    }
    if (step.kind === "brand") return draft.brand;
    return null;
  }

  function rememberPicks(at) {
    let next = draft;
    for (const [family, product] of Object.entries(picks)) {
      if (!product?.id) continue;
      next = learnPreference(next, product, { family, locked: true, source: "onboarding", at });
    }
    return next;
  }

  function finishProducts(at) {
    saveNevers(at);
    draft = applyCheapestDefaults(draft, at);
    return draft;
  }

  function finish(at) {
    draft = persist(completeProfile(draft, at));
    if (dialog.open) dialog.close();
    deps.onDone?.(draft);
  }

  function closeLazy() {
    const family = lazyFamily;
    lazyFamily = "";
    if ((resumeStatus === "done" || resumeStatus === "skipped") && draft.onboarding.status !== resumeStatus) {
      draft = { ...draft, onboarding: { ...draft.onboarding, status: resumeStatus } };
    }
    draft = persist(draft);
    if (family && dialog.open) dialog.close();
    if (family) queueMicrotask(() => deps.onLazyDone?.(family));
  }

  function linesWithPrices(result) {
    const raw = (result?.files || []).flatMap((row) => row.lines || []);
    if (raw.some((line) => Number(line?.price) > 0)) return raw;
    return result?.lines || [];
  }

  function rememberReadResult(result) {
    learnedRows = result?.learned || [];
    receiptLines = linesWithPrices(result);
    paperReceipt = Boolean(result?.paper);
    paperNote = result?.paperNote || "";
    receiptWarning = result?.photoMessage || "";
    fileLinesByIndex = new Map();
    for (const report of result?.files || []) {
      if ((report?.lines || []).length) fileLinesByIndex.set(report.index, report.lines);
    }
  }

  function stopReadTicker() {
    if (readTimer) window.clearInterval(readTimer);
    readTimer = 0;
  }

  function startReadTicker() {
    stopReadTicker();
    readTick = 0;
    readTimer = window.setInterval(() => {
      if (receiptPhase !== "reading") {
        stopReadTicker();
        return;
      }
      readTick += 1;
      for (const card of readCards) {
        if (card.status === "reading") patchReadCard(card);
      }
    }, 2200);
  }

  function applyReadProgress(event) {
    if (event?.stage === "grouping" || event?.stage === "matching") {
      for (const card of readCards) {
        if (card.status === "error") continue;
        const found = Math.max(card.found || 0, (card.items || []).length);
        card.status = "reading";
        card.hideItems = true;
        card.message = found ? `Matching brands…` : "Matching brands…";
        card.ratio = Math.max(Number(card.ratio) || 0, Number(event.ratio) || 0.9);
        patchReadCard(card);
      }
      if (!Number.isFinite(Number(event?.fileIndex))) return;
    }
    if (!event || !Number.isFinite(Number(event.fileIndex))) return;
    const card = readCards.find((row) => row.index === Number(event.fileIndex));
    if (!card) return;
    if (event.message) card.message = String(event.message);
    if (typeof event.found === "number") card.found = event.found;
    if (Array.isArray(event.items)) {
      const seen = new Set(card.items);
      for (const name of event.items) {
        if (!name || seen.has(name)) continue;
        seen.add(name);
        card.items.push(name);
      }
    }
    if (Number.isFinite(Number(event.fileRatio))) card.ratio = Math.max(0, Math.min(1, Number(event.fileRatio)));
    if (event.status === "error") {
      card.status = "error";
      card.error = event.error || event.message || "Couldn't read that file.";
      card.ratio = 1;
      card.hideItems = false;
    } else if (event.status === "done") {
      // Stay on the reading card. The learned screen is the next paint.
      card.status = "reading";
      card.hideItems = true;
      card.ratio = 1;
      const found = Math.max(card.found || 0, (card.items || []).length);
      card.message = found ? "Matching brands…" : "Matching brands…";
    }
    card.tick = readTick;
    patchReadCard(card);
  }

  function patchReadCard(card) {
    card.tick = readTick;
    const node = document.querySelector(`[data-read-card="${card.index}"]`);
    if (!node || card.status === "error") {
      const stage = $("profile-stage");
      if (stage && receiptPhase === "reading") stage.innerHTML = readLiveHtml(readCards.map((row) => ({ ...row, tick: readTick })));
      return;
    }
    node.dataset.state = card.status;
    const title = node.querySelector("h3");
    const reading = card.status === "reading" || card.status === "pending";
    if (title) title.textContent = reading ? READING_RECEIPT : readCardTitle(card, foundLabel);
    const phase = readingPhaseText(card, readTick);
    let stage = node.querySelector(".read-stage");
    if (phase) {
      if (!stage) {
        stage = document.createElement("p");
        stage.className = "read-stage";
        stage.setAttribute("data-read-phase", "1");
        title?.insertAdjacentElement("afterend", stage);
      }
      stage.textContent = phase;
    }
    const meter = node.querySelector("progress");
    if (meter) {
      const ratio = Math.max(0, Math.min(1, Number(card.ratio) || 0));
      if (ratio > 0) meter.value = String(ratio);
      else meter.removeAttribute("value");
    }
    const list = node.querySelector(".read-items");
    if (list && !card.hideItems) {
      const have = list.children.length;
      for (const name of card.items.slice(have)) {
        const item = document.createElement("li");
        item.className = "read-item";
        item.textContent = name;
        list.appendChild(item);
      }
    }
    if (card.items.length || phase) node.querySelector(".read-skel")?.remove();
  }

  function showLearned() {
    if (!learnedViewReady(importGate)) return;
    stopReadTicker();
    beatMarkup = "";
    receiptPhase = "learned";
    motion = "forward";
    editingFamily = "";
    render();
    focusTitle();
    pushReceiptHistory();
    for (const row of learnedRows) void loadBrandShelf(row.family);
  }

  let receiptHistory = 0;
  function pushReceiptHistory() {
    try {
      history.pushState({ ggReceipt: receiptPhase }, "");
      receiptHistory += 1;
    } catch {
      /* private browsing or a missing history API */
    }
  }

  function paintLearnedCard(family, options = {}) {
    const stage = $("profile-stage");
    const row = learnedRows.find((item) => item.family === family);
    const cssFamily = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(family) : String(family).replace(/["\\]/g, "");
    const card = stage?.querySelector(`[data-learned-row="${cssFamily}"]`);
    if (!stage || !row || !(card instanceof HTMLElement)) {
      rerenderLearned();
      return card instanceof HTMLElement ? card : null;
    }
    commitLearnedCard(card, (node) => {
      node.innerHTML = learnedCardInnerHtml(row, {
        editing: editingFamily === family,
        brands: brandChoices(row),
        pending: !brandShelves[row.family],
        saved: Boolean(options.saved),
      });
    });
    if (options.reveal) {
      const picker = card.querySelector(".learned-picker");
      if (picker) revealInside(stage, picker);
    }
    return card;
  }

  async function holdThenLearned() {
    beatMarkup = "";
    if (receiptPhase !== "reading") return;
    if (importGate.parsing || importGate.grouping) return;
    importGate = { parsing: false, grouping: false, revealed: true };
    showLearned();
  }

  async function retryReadFile(index) {
    const card = readCards.find((row) => row.index === Number(index));
    if (!card?.file || !deps.readReceipts) return;
    card.status = "reading";
    card.error = "";
    card.ratio = 0.12;
    card.items = [];
    card.found = 0;
    beatToken += 1;
    const readToken = beatToken;
    beatMarkup = "";
    importGate = { parsing: true, grouping: false, revealed: false };
    motion = "forward";
    receiptPhase = "reading";
    render();
    try {
      const result = await deps.readReceipts({
        files: [card.file],
        onProgress: (event) => {
          if (!receiptReadCurrent(readToken, beatToken, receiptPhase)) return;
          applyReadProgress({ ...event, fileIndex: card.index });
        },
      });
      if (!receiptReadCurrent(readToken, beatToken, receiptPhase)) return;
      if (!result?.lines?.length) {
        card.status = "error";
        card.error = result?.error || "Couldn't read that file.";
        card.ratio = 1;
        render();
        return;
      }
      fileLinesByIndex.set(card.index, result.lines);
      card.status = "done";
      card.found = result.lines.length;
      card.ratio = 1;
      card.items = result.lines.map((line) => line.name).filter(Boolean);
      const merged = [...fileLinesByIndex.values()].flat();
      importGate = { parsing: false, grouping: true, revealed: false };
      const learned = deps.readLines ? await deps.readLines(merged) : result;
      importGate = { parsing: false, grouping: false, revealed: false };
      rememberReadResult({ ...result, ...(learned || {}), lines: learned?.lines || merged });
      if (readCards.some((row) => row.status === "error")) {
        render();
        return;
      }
      void holdThenLearned();
    } catch (error) {
      card.status = "error";
      card.error = error instanceof Error ? error.message : "Couldn't read that file.";
      render();
    }
  }

  async function runReceipts(text, files) {
    const list = (files || []).slice();
    const pasted = String(text || "").trim();
    readCards = [];
    fileLinesByIndex = new Map();
    if (pasted) {
      readCards.push({ index: -1, name: orderTitle(pasted), ratio: 0.2, found: 0, items: [], status: "reading", error: "", file: null });
    }
    list.forEach((file, index) => {
      readCards.push({ index, name: file.name || "Order", ratio: 0.08, found: 0, items: [], status: "reading", error: "", file });
    });
    if (!readCards.length) return;
    beatToken += 1;
    const readToken = beatToken;
    beatMarkup = "";
    startReadTicker();
    learnedRows = [];
    receiptLines = [];
    importGate = { parsing: true, grouping: false, revealed: false };
    receiptPhase = "reading";
    motion = "forward";
    render();
    focusTitle();
    try {
      const result = await deps.readReceipts?.({
        text,
        files: list,
        onProgress: (event) => {
          if (!receiptReadCurrent(readToken, beatToken, receiptPhase)) return;
          if (event?.stage === "grouping") {
            importGate = { parsing: false, grouping: true, revealed: false };
            const stage = $("profile-stage");
            if (receiptPhase === "learned" || stage?.querySelector(".learned-summary, [data-learned-row]")) {
              beatMarkup = "";
              receiptPhase = "reading";
              render();
            }
          }
          applyReadProgress(event);
        },
      });
      if (!receiptReadCurrent(readToken, beatToken, receiptPhase)) return;
      pendingFiles = [];
      if (!result || (result.error && !result.lines?.length)) {
        const message = result?.error || result?.photoMessage || "We couldn't read that. You can paste the order text, or skip for now.";
        if (!readCards.some((card) => card.status === "error")) {
          for (const card of readCards) {
            if (card.status === "reading") {
              card.status = "error";
              card.error = message;
              card.ratio = 1;
            }
          }
        }
        importGate = { parsing: false, grouping: false, revealed: false };
        beatMarkup = "";
        render();
        return;
      }
      rememberReadResult(result);
      for (const report of result.files || []) {
        const card = readCards.find((row) => row.index === report.index);
        if (!card) continue;
        if (report.error && !(report.lines || []).length) {
          card.status = "error";
          card.error = report.error;
          card.ratio = 1;
        } else if ((report.lines || []).length) {
          card.status = "done";
          card.found = report.lines.length;
          card.ratio = 1;
          card.items = report.lines.map((line) => line.name).filter(Boolean);
        }
      }
      for (const card of readCards) {
        if (card.status === "reading") {
          card.status = "done";
          card.ratio = 1;
        }
      }
      if (readCards.some((card) => card.status === "error")) {
        importGate = { parsing: false, grouping: false, revealed: false };
        beatMarkup = "";
        render();
        return;
      }
      if (!receiptReadCurrent(readToken, beatToken, receiptPhase)) return;
      importGate = { parsing: false, grouping: false, revealed: false };
      void holdThenLearned();
    } catch (error) {
      const message = error instanceof Error ? error.message : "We couldn't read that. You can paste the order text, or skip for now.";
      for (const card of readCards) {
        if (card.status === "reading") {
          card.status = "error";
          card.error = message;
          card.ratio = 1;
        }
      }
      importGate = { parsing: false, grouping: false, revealed: false };
      beatMarkup = "";
      render();
    }
  }

  async function refreshLines() {
    if (!deps.readLines) return;
    const result = await deps.readLines(receiptLines);
    if (!result) return;
    learnedRows = result.learned || [];
    receiptLines = result.lines || receiptLines;
    paperReceipt = Boolean(result.paper);
    paperNote = result.paperNote || "";
    render();
  }

  function rememberBrandEdit() {
    const input = document.querySelector("input[data-learned-brand]");
    const family = input?.getAttribute("data-learned-brand") || "";
    const brand = String(input?.value || "").trim();
    if (!family || !brand) return;
    learnedRows = applyLearnedChoice(learnedRows, { family, mode: "brand", brand });
  }

  function closeDiet(value) {
    if (!dietMode && !dietDone) return;
    dietMode = false;
    if (value) draft = persist(markDietPrompt(draft, value));
    const done = dietDone;
    dietDone = null;
    if (dialog.open) dialog.close();
    done?.();
  }

  async function advance(skipped, skipRest) {
    const at = Date.now();
    if (dietMode) {
      if (skipped) {
        closeDiet("skipped");
        return;
      }
      if (stepId === "allergies") {
        const saved = answerStep(draft, "allergies", currentAnswer(), at);
        draft = persist({ ...saved, onboarding: draft.onboarding });
        stepId = "diets";
        render();
        focusTitle();
        return;
      }
      if (stepId === "diets") {
        rememberDietNotes();
        const saved = answerStep(draft, "diets", currentAnswer(), at);
        draft = { ...saved, onboarding: draft.onboarding };
        closeDiet("asked");
        return;
      }
    }
    if (lazyFamily && stepId === "products") {
      saveCategory(skipped ? "skip" : categoryDraft.mode || "skip", at);
      closeLazy();
      return;
    }
    if (stepId === "diets") rememberDietNotes();
    if ((stepId === "zip" || stepId === "place") && !skipped) {
      if (!readZip()) return;
    }
    if (stepId === "place" && !skipped) {
      const zip = normalizeZipInput(currentZipRaw());
      const nearby = /^\d{5}/.test(zip) ? storesForZip(zip) : { stores: [] };
      const names = visibleStoreNames(nearby.stores);
      const decision = zipContinueDecision({ stores: names });
      paintStoreList();
      if (!decision.advance) {
        const hiddenOnly = !adStoresVisible() && nearby.stores.length > 0;
        deps.toast?.(hiddenOnly ? "Kroger and Walmart aren't near that ZIP." : "No stores near that ZIP. Try another.");
        return;
      }
    }
    if ((stepId === "stores" || stepId === "place") && !skipped) {
      const place = readPlace();
      if (!place) return;
      draft.shopStores = place.stores;
    }
    if (stepId === "receipts") {
      if (receiptPhase === "reading") {
        if (importGate.parsing || importGate.grouping || beatMarkup) return;
        if (learnedRows.length || receiptLines.length) {
          importGate = { parsing: false, grouping: false, revealed: true };
          showLearned();
        }
        return;
      }
      if (receiptPhase === "learned") {
        rememberBrandEdit();
        if (!skipped) {
          const applied = applyLearnedReceipts(draft, learnedRows, at);
          draft = applied.profile;
          softTap();
        }
        if (returnTo) {
          returnTo = "";
          receiptPhase = "upload";
          stepId = "summary";
          persist(draft);
          render();
          focusTitle();
          return;
        }
        receiptPhase = "trip";
        motion = "forward";
        render();
        pushReceiptHistory();
        resetStageScroll();
        focusTitle();
        resetStageScroll();
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => syncTripJump());
        return;
      }
      if (receiptPhase === "trip") return;
      const text = $("profile-receipt-paste")?.value || "";
      if ((pendingFiles.length || String(text).trim()) && deps.readReceipts) {
        await runReceipts(text, pendingFiles);
        return;
      }
      if (!returnTo) return;
    }
    if (stepId === "products" && !returnTo) {
      const categories = preferenceCategories();
      if (phase === "gate") {
        saveNevers(at);
        if (!skipped && !skipRest) {
          const first = nextDetailIndex(0);
          persist(draft);
          if (first >= 0) {
            showCategory(first);
            focusTitle();
            return;
          }
        } else if (skipRest) {
          draft = finishProducts(at);
        }
      } else if (skipRest) {
        saveCategory(categoryDraft.mode || "skip", at);
        for (let index = categoryIndex + 1; index < categories.length; index += 1) {
          if (neverIds.has(categories[index].id)) continue;
          const existing = draft.categoryPreferences?.[categories[index].id];
          if (existing?.mode === "brand" || existing?.mode === "storeBrand" || existing?.mode === "cheapest" || existing?.mode === "cheapestPicks" || existing?.mode === "never") continue;
          draft = setCategoryPreference(draft, { family: categories[index].id, mode: "skip", brand: "", productId: "", size: "", attributes: [] }, at);
        }
      } else if (nextDetailIndex(categoryIndex + 1) >= 0) {
        saveCategory(skipped ? "skip" : categoryDraft.mode || "skip", at);
        persist(draft);
        showCategory(nextDetailIndex(categoryIndex + 1));
        focusTitle();
        return;
      } else {
        saveCategory(skipped ? "skip" : categoryDraft.mode || "skip", at);
      }
    }
    if (stepId === "products" && !skipped) draft = rememberPicks(at);
    const answer = skipped ? undefined : currentAnswer();
    if (returnTo && stepId !== "summary") {
      draft = skipped ? skipStep(draft, stepId, at) : answerStep(draft, stepId, answer, at);
      if (stepId === "allergies" || stepId === "diets") draft = markDietPrompt(draft, "asked", at);
      if (!skipped && stepId === "products") draft = rememberPicks(at);
      stepId = "summary";
      returnTo = "";
      persist(draft);
      render();
      focusTitle();
      return;
    }
    if (stepId === "summary") {
      if (!skipped) draft = rememberPicks(at);
      draft = persist(completeProfile(draft, at));
      if (dialog.open) dialog.close();
      if (!skipped) deps.onDone?.(draft);
      return;
    }
    draft = skipped ? skipStep(draft, stepId, at) : answerStep(draft, stepId, answer, at);
    if (!skipped && stepById(stepId).kind === "products") draft = rememberPicks(at);
    const leavingWelcome = stepId === "welcome";
    stepId = draft.onboarding.step;
    motion = "forward";
    if (leavingWelcome) {
      render({ deferStores: true });
      focusTitle();
      const nextDraft = draft;
      persist(nextDraft);
      const paint = () => paintStoreList();
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(paint));
      else setTimeout(paint, 0);
      return;
    }
    persist(draft);
    render();
    focusTitle();
  }

  function openAt(id) {
    draft = getUserProfile(storage);
    picks = {};
    for (const [family, pref] of Object.entries(draft.productPreferences || {})) {
      if (pref?.catalogId) {
        picks[family] = {
          id: pref.catalogId,
          name: pref.name,
          brand: pref.brand,
          sizeLabel: pref.sizeLabel,
          imageUrl: pref.imageUrl,
          upc: pref.upc,
        };
      }
    }
    stepId = stepById(id || resumeStep(draft)).id;
    returnTo = "";
    resumeStatus = draft.onboarding.status;
    receiptPhase = "upload";
    learnedRows = [];
    receiptLines = [];
    paperReceipt = false;
    paperNote = "";
    receiptWarning = "";
    pendingFiles = [];
    editingFamily = "";
    lazyFamily = "";
    categoryIndex = 0;
    categoryDraft = blankCategory();
    shelf = [];
    loadedFor = "";
    phase = "gate";
    syncNever();
    render();
    if (!dialog.open) dialog.showModal();
    focusTitle();
  }

  $("profile-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void advance(false);
  });
  $("profile-skip")?.addEventListener("click", () => {
    if (dietMode) {
      closeDiet("skipped");
      return;
    }
    if (lazyFamily) {
      void advance(true);
      return;
    }
    if (draft.onboarding.status === "done") {
      if (dialog.open) dialog.close();
      return;
    }
    draft = persist(skipForNow(draft));
    if (dialog.open) dialog.close();
    deps.onDone?.(draft);
  });
  $("profile-back")?.addEventListener("click", () => {
    if (dietMode && stepId === "diets") {
      stepId = "allergies";
      render();
      focusTitle();
      return;
    }
    if (dietMode) {
      closeDiet("skipped");
      return;
    }
    if (stepId === "receipts" && (receiptPhase === "learned" || receiptPhase === "reading" || receiptPhase === "trip") && !returnTo) {
      const nextPhase = receiptBackPhase(receiptPhase);
      if (receiptPhase === "reading") {
        beatToken += 1;
        stopReadTicker();
        importGate = { parsing: false, grouping: false, revealed: false };
      }
      receiptPhase = nextPhase;
      motion = "back";
      render();
      focusTitle();
      return;
    }
    if (stepId === "products" && categoryIndex > 0 && !returnTo && !lazyFamily) {
      showCategory(categoryIndex - 1);
      focusTitle();
      return;
    }
    if (returnTo) {
      stepId = "summary";
      returnTo = "";
      render();
      focusTitle();
      return;
    }
    draft = persist(goBack(draft, stepId));
    stepId = draft.onboarding.step;
    motion = "back";
    render();
    focusTitle();
  });
  $("profile-stage")?.addEventListener("mousedown", (event) => {
    const target = event.target instanceof Element ? event.target.closest("button") : null;
    if (!target) return;
    const card = target.closest("[data-learned-row]");
    if (card instanceof HTMLElement && (target.dataset.learnedChange || target.dataset.learnedMode || target.dataset.learnedToggle || target.dataset.learnedRemove)) {
      event.preventDefault();
      card.setAttribute("tabindex", "-1");
      try {
        card.focus({ preventScroll: true });
      } catch {
        card.focus();
      }
      return;
    }
    if (target.dataset.fileRemove || target.dataset.readRetry != null) return;
    event.preventDefault();
  });
  $("profile-stage")?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("button") : null;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    if (target.id === "receipt-restore") {
      if (!learnedRows.length) return;
      importGate = { parsing: false, grouping: false, revealed: true };
      showLearned();
      return;
    }
    if (target.id === "store-connect-later") {
      const host = $("store-connect");
      if (host) host.innerHTML = `<p class="muted">You can connect Kroger at checkout. That sign-in still opens on Kroger's site.</p>`;
      return;
    }
    if (target.id === "store-connect-now") {
      void connectStoresNow();
      return;
    }
    if (target.id === "read-beat-continue" || target.id === "read-beat-skip") {
      skipBeat?.();
      return;
    }
    if (target.id === "trip-jump") {
      $("learned-add-trip")?.scrollIntoView({ block: "end" });
      return;
    }
    if (target.dataset.tripAll) {
      if (!tripSelectFromScroll(tripPointer.moved, 0, Date.now())) return;
      const on = target.dataset.tripAll === "all";
      for (const box of document.querySelectorAll("[data-trip-pick]")) {
        if (box instanceof HTMLInputElement) box.checked = on;
      }
      paintTripTotal();
      return;
    }
    if (target.id === "learned-empty-trip") {
      finish(Date.now());
      return;
    }
    if (target.dataset.zipChoice) {
      const field = $("profile-zip");
      if (field) {
        field.value = target.dataset.zipChoice;
        syncZipPlaceholder(field, ZIP_PLACEHOLDER);
      }
      const hint = $("profile-zip-hint");
      if (hint) hint.hidden = false;
      paintStoreList();
      syncZipContinue();
      return;
    }
    if (target.dataset.tripQtyStep) {
      const index = target.dataset.tripQtyStep;
      const input = document.querySelector(`[data-trip-qty="${index}"]`);
      if (input instanceof HTMLInputElement) {
        const dir = Number(target.dataset.dir) || 0;
        const next = Math.max(1, Math.min(99, (Number(input.value) || 1) + dir));
        input.value = String(next);
      }
      return;
    }
    if (target.dataset.tripAdd != null || target.id === "learned-add-trip" || target.id === "learned-add-trip-top") {
      if (target instanceof HTMLButtonElement && target.disabled) return;
      const picks = [...document.querySelectorAll("[data-trip-pick]")];
      const picked = (picks.length ? picks : [...document.querySelectorAll("[data-learned-trip]")])
        .filter((box) => box instanceof HTMLInputElement && box.checked)
        .map((box) => {
          const index = Number(box.getAttribute("data-trip-pick") || box.getAttribute("data-learned-trip"));
          const line = receiptLines[index];
          if (!line) return null;
          const qtyField = document.querySelector(`[data-trip-qty="${index}"]`);
          const quantity = Math.max(1, Math.min(99, Math.floor(Number(qtyField instanceof HTMLInputElement ? qtyField.value : line.quantity) || 1)));
          return { ...line, quantity };
        })
        .filter(Boolean);
      if (!picked.length) return;
      deps.holdGuide?.();
      finish(Date.now());
      void Promise.resolve(deps.addLearnedLines?.(picked)).catch(() => {
        deps.toast?.("Couldn't add those items.");
      });
      return;
    }
    if (target.dataset.readRetry != null && target.dataset.readRetry !== "") {
      void retryReadFile(target.dataset.readRetry);
      return;
    }
    if (target.dataset.fileRemove != null && target.dataset.fileRemove !== "") {
      const index = Number(target.dataset.fileRemove);
      if (Number.isInteger(index) && index >= 0 && index < pendingFiles.length) {
        pendingFiles = pendingFiles.filter((_, fileIndex) => fileIndex !== index);
        paintReceiptFiles();
      }
      return;
    }
    if (target.dataset.learnedRemove) {
      const family = target.dataset.learnedRemove;
      const next = learnedRows.filter((row) => row.family !== family);
      if (!family || next.length < learnedRows.length - 1) return;
      learnedRows = next;
      if (editingFamily === family) editingFamily = "";
      rerenderLearned();
      return;
    }
    if (target.dataset.learnedChange) {
      editingFamily = editingFamily === target.dataset.learnedChange ? "" : target.dataset.learnedChange;
      const family = target.dataset.learnedChange;
      paintLearnedCard(family, { reveal: Boolean(editingFamily) });
      if (editingFamily) void loadBrandShelf(editingFamily);
      return;
    }
    if (target.dataset.learnedToggle === "brand") {
      const family = target.dataset.learnedFamily || "";
      const brand = target.dataset.learnedBrand || "";
      learnedRows = learnedRows.map((row) => {
        if (row.family !== family) return row;
        const current = row.brands?.length ? row.brands.slice() : row.mode === "brand" && row.brand ? [row.brand] : [];
        const nextBrands = current.some((item) => item.toLowerCase() === brand.toLowerCase())
          ? current.filter((item) => item.toLowerCase() !== brand.toLowerCase())
          : [...current, brand].slice(0, 12);
        return { ...row, brands: nextBrands, brand: nextBrands[0] || "", mode: nextBrands.length ? "cheapestPicks" : row.mode };
      });
      paintLearnedCard(family, { saved: true });
      deps.toast?.("Saved");
      return;
    }
    if (target.dataset.learnedMode) {
      const family = target.dataset.learnedFamily || "";
      const row = learnedRows.find((item) => item.family === family);
      const picked = row?.brands?.length ? row.brands : row?.brand ? [row.brand] : [];
      const mode = target.dataset.learnedMode;
      const remembered = rememberedNameBrand(row) || picked[0] || brandChoices(row)[0] || "";
      const next = applyLearnedChoice(learnedRows, {
        family,
        mode,
        brand: mode === "brand" ? remembered : target.dataset.learnedBrand || row?.brand || picked[0] || "",
        brands: mode === "cheapestPicks" ? picked : mode === "brand" ? (remembered ? [remembered] : []) : undefined,
        allowEmpty: mode === "brand",
      });
      if (next === learnedRows) return;
      savedRules.add(family);
      const stage = $("profile-stage");
      const sheet = document.querySelector("#profile-onboard .sheet-body");
      const savedScroll = captureRuleScroll({
        stage: stage instanceof HTMLElement ? stage.scrollTop : 0,
        sheet: sheet instanceof HTMLElement ? sheet.scrollTop : 0,
        page: window.scrollY || 0,
      });
      learnedRows = next;
      paintLearnedCard(family, { saved: true });
      restoreRuleScroll(
        {
          stage,
          sheet,
          scrollTo: (y) => window.scrollTo(0, y),
        },
        savedScroll
      );
      return;
    }
    if (target.dataset.lineRemove != null && target.dataset.lineRemove !== "") {
      const index = Number(target.dataset.lineRemove);
      receiptLines = receiptLines.filter((_, lineIndex) => lineIndex !== index);
      void refreshLines();
      return;
    }
    if (target.dataset.edit) {
      returnTo = "summary";
      stepId = target.dataset.edit === "stores" ? "place" : target.dataset.edit;
      render();
      focusTitle();
      return;
    }
    if (target.id === "profile-use-defaults") {
      const at = Date.now();
      if (phase === "detail") saveCategory(categoryDraft.mode || "cheapest", at);
      saveNevers(at);
      draft = applyCheapestDefaults(draft, at);
      persist(draft);
      stepId = "summary";
      phase = "gate";
      render();
      focusTitle();
      return;
    }
    if (target.id === "profile-skip-rest") {
      advance(true, true);
      return;
    }
    if (target.dataset.gate) {
      if (neverIds.has(target.dataset.gate)) neverIds.delete(target.dataset.gate);
      else neverIds.add(target.dataset.gate);
      const stage = $("profile-stage");
      if (stage) stage.innerHTML = stageHtml(stepById("products"));
      return;
    }
    if (target.dataset.buy) {
      categoryDraft = {
        ...categoryDraft,
        mode: target.dataset.buy,
        touched: true,
        brand: categoryDraft.brand || "",
        productId: categoryDraft.productId || "",
        attributes: categoryDraft.attributes || [],
      };
      const stage = $("profile-stage");
      if (stage) stage.innerHTML = stageHtml(stepById("products"));
      return;
    }
    if (target.dataset.buyBrand) {
      const product = (shelf || []).find((item) => (item.id || item.defaultVariantId) === target.dataset.buyProduct) || {
        id: target.dataset.buyProduct,
        brand: target.dataset.buyBrand,
        name: target.dataset.buyBrand,
      };
      const current = categoryDraft.brands?.length ? categoryDraft.brands.slice() : categoryDraft.brand ? [categoryDraft.brand] : [];
      const brand = target.dataset.buyBrand;
      const brands = current.some((item) => item.toLowerCase() === brand.toLowerCase())
        ? current.filter((item) => item.toLowerCase() !== brand.toLowerCase())
        : [...current, brand].slice(0, 12);
      categoryDraft = {
        ...categoryDraft,
        mode: brands.length ? "cheapestPicks" : categoryDraft.mode,
        touched: true,
        brand: brands[0] || "",
        brands,
        productId: product.id || "",
        product,
      };
      const stage = $("profile-stage");
      if (stage) stage.innerHTML = stageHtml(stepById("products"));
      return;
    }
    if (target.dataset.buyAttr) {
      const attributes = new Set(categoryDraft.attributes || []);
      if (attributes.has(target.dataset.buyAttr)) attributes.delete(target.dataset.buyAttr);
      else attributes.add(target.dataset.buyAttr);
      categoryDraft = { ...categoryDraft, attributes: [...attributes], touched: true, mode: categoryDraft.mode || "" };
      const stage = $("profile-stage");
      if (stage) stage.innerHTML = stageHtml(stepById("products"));
      return;
    }
    if (target.dataset.choice && !target.dataset.yesno && !target.dataset.buy) {
      const step = stepById(stepId);
      const id = target.dataset.choice;
      if (step.kind === "single") {
        if (step.id === "shopping") draft.style = { ...draft.style, shopping: id };
        if (step.id === "cooking") draft.style = { ...draft.style, cooking: id };
        if (step.id === "time") draft.style = { ...draft.style, time: id };
        if (step.id === "stops") draft.style = { ...draft.style, stops: id };
        if (step.id === "brand") draft.brand = { ...draft.brand, default: id };
      } else if (step.kind === "multi") {
        const list = new Set(draftList(step.id));
        if (list.has(id)) list.delete(id);
        else list.add(id);
        const values = [...list];
        if (step.id === "why") draft.why = values;
        if (step.id === "loves") draft.loves = values;
        if (step.id === "avoids") draft.avoids = values;
        if (step.id === "allergies") draft.allergies = values;
        if (step.id === "diets") {
          rememberDietNotes();
          draft.diets = values;
        }
      } else if (step.kind === "household" && /^[1-5]$/.test(id)) {
        draft.household = { ...draft.household, size: Number(id) };
      } else if (step.kind === "brand") {
        draft.brand = { ...draft.brand, default: id };
      }
      render();
      return;
    }
    if (target.dataset.yesno) {
      const key = target.dataset.yesno;
      const value = target.dataset.value === "yes";
      draft.household = { ...draft.household, [key]: draft.household?.[key] === value ? null : value };
      render();
      return;
    }
    if (target.dataset.cuisine) {
      const id = target.dataset.cuisine;
      const current = draft.cuisines?.[id] || "";
      const stance = current === "" ? "like" : current === "like" ? "dislike" : "";
      const cuisines = { ...draft.cuisines };
      if (!stance) delete cuisines[id];
      else cuisines[id] = stance;
      draft.cuisines = cuisines;
      render();
      return;
    }
    if (target.id === "profile-organic") {
      draft.brand = { ...draft.brand, organicIfClose: !draft.brand?.organicIfClose };
      render();
      return;
    }
    if (target.dataset.aisle && target.dataset.mode) {
      const overrides = { ...(draft.brand?.overrides || {}) };
      if (overrides[target.dataset.aisle] === target.dataset.mode) delete overrides[target.dataset.aisle];
      else overrides[target.dataset.aisle] = target.dataset.mode;
      draft.brand = { ...draft.brand, overrides };
      render();
      return;
    }
    if (target.dataset.staple && target.dataset.product) {
      const family = target.dataset.staple;
      const catalogId = target.dataset.product;
      const tileButton = target;
      const name = tileButton.querySelector(".staple-name")?.textContent || "";
      const meta = tileButton.querySelector(".staple-meta")?.textContent || "";
      const [brand, sizeLabel] = meta.split(" · ");
      const image = tileButton.querySelector("img")?.getAttribute("src") || "";
      if (picks[family]?.id === catalogId) delete picks[family];
      else picks[family] = { id: catalogId, name, brand: brand || "", sizeLabel: sizeLabel || "", imageUrl: image, imageUrls: image ? [image] : [] };
      const row = tileButton.parentElement;
      row?.querySelectorAll("[data-staple]").forEach((button) => {
        button.setAttribute("aria-pressed", button.dataset.product === picks[family]?.id ? "true" : "false");
      });
    }
  });

  let tripScrollAt = 0;
  let tripPointer = { x: 0, y: 0, moved: false };
  const markTripScroll = () => {
    tripScrollAt = Date.now();
    syncTripJump();
  };
  $("profile-stage")?.addEventListener("scroll", markTripScroll, { passive: true });
  dialog.addEventListener("scroll", markTripScroll, { passive: true, capture: true });
  dialog.addEventListener(
    "pointerdown",
    (event) => {
      tripPointer = { x: event.clientX, y: event.clientY, moved: false };
    },
    true
  );
  dialog.addEventListener(
    "pointermove",
    (event) => {
      if (Math.hypot(event.clientX - tripPointer.x, event.clientY - tripPointer.y) > 10) tripPointer.moved = true;
    },
    true
  );
  $("profile-stage")?.addEventListener("change", (event) => {
    const box = event.target;
    if (!(box instanceof HTMLInputElement) || box.dataset.tripPick == null) return;
    paintTripTotal();
  });

  dialog.addEventListener("close", () => {
    beatToken += 1;
    skipBeat?.();
    if (dietMode) {
      dietMode = false;
      draft = persist(markDietPrompt(draft, "skipped"));
      const done = dietDone;
      dietDone = null;
      done?.();
      return;
    }
    if (lazyFamily) {
      lazyFamily = "";
      deps.onLazyDone?.(null, { cancelled: true });
      return;
    }
    if (draft.onboarding.status === "done" || draft.onboarding.status === "skipped") return;
    draft = persist({ ...draft, onboarding: { status: "in_progress", step: stepId, updatedAt: Date.now() } });
  });

  window.addEventListener("popstate", () => {
    if (!dialog?.open || receiptHistory <= 0) return;
    receiptHistory -= 1;
    if (stepId !== "receipts") return;
    const nextPhase = receiptBackPhase(receiptPhase);
    if (nextPhase === receiptPhase) return;
    if (receiptPhase === "reading") {
      beatToken += 1;
      stopReadTicker();
      importGate = { parsing: false, grouping: false, revealed: false };
    }
    receiptPhase = nextPhase;
    motion = "back";
    render();
    focusTitle();
  });

  return {
    open() {
      openAt(resumeStep(getUserProfile(storage)));
    },
    resumeAfterConnect() {
      try {
        sessionStorage.removeItem(PROFILE_CONNECT_KEY);
      } catch {
        /* private browsing */
      }
      draft = getUserProfile(storage);
      stepId = "receipts";
      receiptPhase = "upload";
      returnTo = "";
      draft = persist({
        ...draft,
        onboarding: { ...(draft.onboarding || {}), status: "in_progress", step: "receipts", updatedAt: Date.now() },
      });
      render();
      if (!dialog.open) dialog.showModal();
      focusTitle();
    },
    redo() {
      openAt("welcome");
    },
    openEditor() {
      openAt("summary");
    },
    openCategory(familyId) {
      openAt("products");
      lazyFamily = familyId || "";
      const index = preferenceCategories().findIndex((category) => category.id === familyId);
      if (index >= 0) showCategory(index);
    },
    askCategory(familyId) {
      const profile = getUserProfile(storage);
      const mode = profile.categoryPreferences?.[familyId]?.mode;
      if (mode && mode !== "skip") return;
      this.openCategory(familyId);
    },
    openFavorites() {
      openAt("products");
    },
    shouldPrompt() {
      return shouldPromptProfile(storage);
    },
    shouldAskDiets() {
      return shouldAskDietPrompt(getUserProfile(storage));
    },
    openDietPrompt(done) {
      if (!shouldAskDietPrompt(getUserProfile(storage))) {
        done?.();
        return;
      }
      if (dialog.open && !dietMode) {
        done?.();
        return;
      }
      dietMode = true;
      dietDone = typeof done === "function" ? done : null;
      draft = getUserProfile(storage);
      returnTo = "";
      stepId = "allergies";
      render();
      if (!dialog.open) dialog.showModal();
      focusTitle();
    },
  };
}
