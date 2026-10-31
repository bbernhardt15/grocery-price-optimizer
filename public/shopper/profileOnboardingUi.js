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
  goBack,
  optionLabel,
  primaryLabel,
  profileSteps,
  progressLabel,
  resumeStep,
  skipForNow,
  skipStep,
  stepById,
  summarySections,
} from "./profileOnboarding.js";
import { learnPreference, forgetPreference } from "./productPreference.js";
import { applyCheapestDefaults, asksNameBrand, nameBrandsFor, preferenceCategories, setCategoryPreference } from "./categoryPreference.js";
import { isProduceFamily } from "./brandNames.js";
import { categoryDetailHtml, categoryGateHtml } from "./categoryStage.js";
import { normalizeZipInput, zipAdvanceError } from "./onboarding.js";
import { applyLearnedReceipts } from "./receiptApply.js";
import { learnedEditorHtml, learnedSummaryHtml, receiptUploadHtml } from "./receiptCopy.js";
import { planningStoreNames } from "./tripPlan.js";

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
  let lazyFamily = "";
  let resumeStatus = "";

  function blankCategory() {
    return { mode: "", brand: "", productId: "", attributes: [], product: null };
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
    const current = stepById(stepId).index;
    host.innerHTML = profileSteps()
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
    if (step.kind === "place") {
      const zip = escapeText(deps.getZip?.() || "");
      const selected = new Set(draft.shopStores || []);
      const open = !draft.shopStores?.length;
      const stores = planningStoreNames()
        .map((name) => {
          const on = open || selected.has(name);
          return `<label class="check-row"><input type="checkbox" data-place-store="${escapeText(name)}" ${on ? "checked" : ""} /> ${escapeText(name)}</label>`;
        })
        .join("");
      return `<label class="profile-field" for="profile-zip">ZIP<input id="profile-zip" inputmode="numeric" maxlength="10" autocomplete="postal-code" placeholder="45202" value="${zip}" /></label>
        <p id="profile-zip-error" class="status" role="alert" hidden></p>
        <fieldset class="store-picker"><legend>Stores to shop</legend>${stores}</fieldset>`;
    }
    if (step.kind === "receipts") {
      if (receiptPhase === "learned") {
        const editor = editingFamily ? learnedEditorHtml(learnedRows.find((row) => row.family === editingFamily)) : "";
        const warning = receiptWarning ? `<p class="paper-note" role="status">${escapeText(receiptWarning)}</p>` : "";
        return `${warning}${learnedSummaryHtml(learnedRows, { paper: paperReceipt, paperNote, lines: receiptLines })}${editor}`;
      }
      return receiptUploadHtml();
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
      return `${ready ? "" : `<p class="muted">Looking on the shelf…</p>`}${categoryDetailHtml({
        category: current,
        index: lazy ? 0 : categoryIndex,
        total: lazy ? 1 : categories.length,
        mode,
        brand,
        attributes,
        attributeChoices: current?.attributes || [],
        brands: brands.map((row) => ({ brand: row.brand, imageUrl: row.imageUrl, productId: row.productId || row.product?.id || "" })),
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

  function render() {
    const step = stepById(stepId);
    const title = $("profile-title");
    const hint = $("profile-hint");
    const progress = $("profile-progress");
    const back = $("profile-back");
    const next = $("profile-next");
    const skip = $("profile-skip");
    const stage = $("profile-stage");
    const learned = step.id === "receipts" && receiptPhase === "learned";
    if (title) title.textContent = learned ? "Here's what we learned" : step.title;
    if (hint) hint.textContent = learned ? "Grouped by what you buy. Allergies and diets stay in charge." : step.hint;
    if (progress) progress.textContent = progressLabel(step.id);
    if (back) back.hidden = step.index === 0 && !returnTo && receiptPhase !== "learned";
    if (next) next.textContent = returnTo ? "Save" : learned ? "Confirm" : primaryLabel(step.id);
    if (skip) {
      skip.textContent = SKIP_LABEL;
      skip.disabled = false;
    }
    if (stage) stage.innerHTML = stageHtml(step);
    bindReceiptInput();
    dots();
    if (step.kind === "products") void loadProducts();
  }

  function bindReceiptInput() {
    const input = $("profile-receipt-input");
    if (!input || input.dataset.bound === "1") return;
    input.dataset.bound = "1";
    input.addEventListener("change", () => {
      pendingFiles = [...(input.files || [])];
      const label = $("profile-receipt-files");
      if (label) label.textContent = pendingFiles.map((file) => file.name).filter(Boolean).join(", ");
      input.value = "";
    });
  }

  function readPlace() {
    const zipInput = $("profile-zip");
    const error = zipAdvanceError(zipInput?.value || "");
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
    const zip = normalizeZipInput(zipInput?.value || "");
    if (zip) deps.setZip?.(zip);
    const boxes = [...document.querySelectorAll("[data-place-store]")];
    const picked = boxes.map((box) => (box.checked ? box.getAttribute("data-place-store") : "")).filter(Boolean);
    if (boxes.length && !picked.length) {
      deps.toast?.("Pick at least one store.");
      return null;
    }
    return { stores: picked.length === boxes.length ? [] : picked };
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
        brand: chosen === "brand" ? categoryDraft.brand || "" : "",
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
  }

  async function runReceipts(text, files) {
    const status = $("profile-receipt-status");
    if (status) status.textContent = "Reading the order…";
    const next = $("profile-next");
    if (next) next.disabled = true;
    try {
      const result = await deps.readReceipts?.({ text, files });
      pendingFiles = [];
      if (!result || result.error || !result.lines?.length) {
        if (status) status.textContent = result?.error || result?.photoMessage || "We couldn't read that. You can paste the order text, or skip for now.";
        return;
      }
      learnedRows = result.learned || [];
      receiptLines = result.lines || [];
      paperReceipt = Boolean(result.paper);
      paperNote = result.paperNote || "";
      receiptWarning = result.photoMessage || "";
      receiptPhase = "learned";
      editingFamily = "";
      render();
      focusTitle();
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : "We couldn't read that. You can paste the order text, or skip for now.";
    } finally {
      if (next) next.disabled = false;
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
    const input = document.querySelector("[data-learned-brand]");
    const family = input?.getAttribute("data-learned-brand") || editingFamily;
    const brand = String(input?.value || "").trim();
    if (!family || !brand) return;
    learnedRows = learnedRows.map((row) => (row.family === family ? { ...row, mode: "brand", brand } : row));
  }

  async function advance(skipped, skipRest) {
    const at = Date.now();
    if (lazyFamily && stepId === "products") {
      saveCategory(skipped ? "skip" : categoryDraft.mode || "skip", at);
      closeLazy();
      return;
    }
    if (stepId === "diets") rememberDietNotes();
    if (stepId === "place" && !skipped) {
      const place = readPlace();
      if (!place) return;
      draft.shopStores = place.stores;
    }
    if (stepId === "receipts") {
      if (receiptPhase === "learned") {
        rememberBrandEdit();
        if (!skipped) {
          const applied = applyLearnedReceipts(draft, learnedRows, at);
          draft = applied.profile;
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
        finish(at);
        return;
      }
      const text = $("profile-receipt-paste")?.value || "";
      if ((pendingFiles.length || String(text).trim()) && deps.readReceipts) {
        await runReceipts(text, pendingFiles);
        return;
      }
      if (!returnTo) {
        finish(at);
        return;
      }
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
          if (existing?.mode === "brand" || existing?.mode === "storeBrand" || existing?.mode === "cheapest" || existing?.mode === "never") continue;
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
    stepId = draft.onboarding.step;
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
    if (stepId === "receipts" && receiptPhase === "learned" && !returnTo) {
      receiptPhase = "upload";
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
    render();
    focusTitle();
  });
  $("profile-stage")?.addEventListener("mousedown", (event) => {
    const target = event.target instanceof Element ? event.target.closest("button") : null;
    if (target) event.preventDefault();
  });
  $("profile-stage")?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("button") : null;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    if (target.id === "profile-receipt-pick") {
      $("profile-receipt-input")?.click();
      return;
    }
    if (target.dataset.learnedRemove) {
      learnedRows = learnedRows.filter((row) => row.family !== target.dataset.learnedRemove);
      if (editingFamily === target.dataset.learnedRemove) editingFamily = "";
      render();
      return;
    }
    if (target.dataset.learnedChange) {
      editingFamily = editingFamily === target.dataset.learnedChange ? "" : target.dataset.learnedChange;
      render();
      return;
    }
    if (target.dataset.learnedMode && target.dataset.learnedFamily) {
      const mode = target.dataset.learnedMode;
      learnedRows = learnedRows.map((row) =>
        row.family === target.dataset.learnedFamily ? { ...row, mode, brand: mode === "brand" ? row.brand : "" } : row
      );
      editingFamily = "";
      render();
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
      stepId = target.dataset.edit;
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
      categoryDraft = {
        ...categoryDraft,
        mode: "brand",
        touched: true,
        brand: target.dataset.buyBrand,
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

  dialog.addEventListener("close", () => {
    if (lazyFamily) {
      lazyFamily = "";
      return;
    }
    if (draft.onboarding.status === "done" || draft.onboarding.status === "skipped") return;
    draft = persist({ ...draft, onboarding: { status: "in_progress", step: stepId, updatedAt: Date.now() } });
  });

  return {
    open() {
      openAt(resumeStep(getUserProfile(storage)));
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
  };
}
