/**
 * Full-screen guide. One question, big tap targets, progress dots, Back,
 * and Skip this one. Closing it keeps the step for the next visit.
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
  skipStep,
  stepById,
  summarySections,
} from "./profileOnboarding.js";
import { STAPLES, learnPreference } from "./productPreference.js";

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
      return `<div class="${step.kind === "single" ? "choice-stack" : "choice-grid"}" role="group">${step.choices
        .map((choice) => choiceButton(choice.id, choice.label, selected.has(choice.id)))
        .join("")}</div>`;
    }
    if (step.kind === "household") {
      const size = draft.household?.size;
      const sizes = [1, 2, 3, 4, 5]
        .map((count) => choiceButton(String(count), count === 5 ? "5+" : String(count), size === count))
        .join("");
      return `<p class="profile-label">How many people</p><div class="choice-grid" role="group" aria-label="Household size">${sizes}</div>
        ${yesNo("Kids", "kids", draft.household?.kids)}
        ${yesNo("Picky eaters", "picky", draft.household?.picky)}`;
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
    if (step.kind === "products") {
      return `<div id="staple-host"><p class="muted">Looking on the shelf…</p></div>`;
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
    if (title) title.textContent = step.title;
    if (hint) hint.textContent = step.hint;
    if (progress) progress.textContent = progressLabel(step.id);
    if (back) back.hidden = step.index === 0 && !returnTo;
    if (next) next.textContent = returnTo ? "Save" : primaryLabel(step.id);
    if (skip) skip.textContent = SKIP_LABEL;
    if (stage) stage.innerHTML = stageHtml(step);
    dots();
    if (step.kind === "products") void loadProducts();
  }

  async function loadProducts() {
    const host = $("staple-host");
    if (!host || !deps.loadStaple) {
      if (host) host.innerHTML = `<p class="muted">The shelf isn't available right now. You can skip this one.</p>`;
      return;
    }
    const blocks = [];
    for (const staple of STAPLES) {
      let tiles = [];
      try {
        tiles = await deps.loadStaple(staple.search);
      } catch {
        tiles = [];
      }
      if (stepId !== "products") return;
      const saved = draft.productPreferences?.[staple.id];
      const buttons = (tiles || []).slice(0, 4).map((tile) => {
        const id = tile.id || tile.defaultVariantId;
        const name = tile.familyName || tile.name || staple.label;
        const brand = tile.brand || "";
        const size = tile.variantLabel || tile.sizeLabel || "";
        const image = tile.imageUrls?.[0] || tile.imageUrl || "";
        const pressed = picks[staple.id]?.id === id || (!picks[staple.id] && saved?.catalogId === id);
        return `<button type="button" class="staple-tile" data-staple="${escapeText(staple.id)}" data-product="${escapeText(id)}" aria-pressed="${pressed ? "true" : "false"}">
          ${image ? `<img src="${escapeText(image)}" alt="" />` : `<span class="staple-fallback" aria-hidden="true"></span>`}
          <span class="staple-name">${escapeText(name)}</span>
          <span class="staple-meta">${escapeText([brand, size].filter(Boolean).join(" · "))}</span>
        </button>`;
      });
      blocks.push(
        `<section class="staple-block"><h3>${escapeText(staple.label)}</h3>${
          buttons.length ? `<div class="staple-row">${buttons.join("")}</div>` : `<p class="muted">Nothing on the shelf for ${escapeText(staple.label.toLowerCase())} right now.</p>`
        }</section>`
      );
    }
    if ($("staple-host")) $("staple-host").innerHTML = blocks.join("");
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

  function advance(skipped) {
    const at = Date.now();
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
    render();
    if (!dialog.open) dialog.showModal();
    focusTitle();
  }

  $("profile-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    advance(false);
  });
  $("profile-skip")?.addEventListener("click", () => advance(true));
  $("profile-back")?.addEventListener("click", () => {
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
  $("profile-stage")?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("button") : null;
    if (!target) return;
    if (target.dataset.edit) {
      returnTo = "summary";
      stepId = target.dataset.edit;
      render();
      focusTitle();
      return;
    }
    if (target.dataset.choice && !target.dataset.yesno) {
      const step = stepById(stepId);
      const id = target.dataset.choice;
      if (step.kind === "single") {
        if (step.id === "shopping") draft.style = { ...draft.style, shopping: id };
        if (step.id === "cooking") draft.style = { ...draft.style, cooking: id };
        if (step.id === "time") draft.style = { ...draft.style, time: id };
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
        if (step.id === "diets") draft.diets = values;
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
    if (draft.onboarding.status === "done") return;
    draft = persist({ ...draft, onboarding: { status: "in_progress", step: stepId, updatedAt: Date.now() } });
  });

  return {
    open() {
      openAt(resumeStep(getUserProfile(storage)));
    },
    openEditor() {
      openAt("summary");
    },
    shouldPrompt() {
      return shouldPromptProfile(storage);
    },
  };
}
