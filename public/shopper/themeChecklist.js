/**
 * Editable checklist for a built-in themed list.
 * Ticks, quantities, and extra items live on the open sheet.
 * The template itself stays unchanged.
 */

import { savedFlavor } from "./categoryPreference.js";
import { activeChoice, partySize, scaleQuantity } from "./themedLists.js";
import { themeIcon } from "./themedListsUi.js";
import { inlineLoaderHtml } from "./addTabIcons.js";

const MAX_ITEMS = 24;

function clean(value, max = 40) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function text(escapeHtml, value) {
  return escapeHtml(String(value ?? ""));
}

function itemCopy(book, listId, slotDef, profile) {
  const picked = activeChoice(book, listId, slotDef);
  const flavor = picked.source === "suggested" ? savedFlavor(profile, slotDef) : null;
  if (flavor?.name) {
    const brand = flavor.brand && !flavor.name.toLowerCase().includes(flavor.brand.toLowerCase()) ? flavor.brand : "";
    return { title: flavor.name, detail: brand, note: "Your flavor" };
  }
  const choice = picked.choice || {};
  const title = clean(choice.familyName || choice.name || slotDef.label, 80) || slotDef.label;
  const brand = clean(choice.brand, 40);
  const size = clean(choice.sizeLabel, 40);
  const showBrand = brand && !title.toLowerCase().includes(brand.toLowerCase());
  const detail = [showBrand ? brand : "", size].filter(Boolean).join(" · ");
  const note = picked.source === "favorite" ? "Your favorite" : picked.source === "override" ? "Only on this list" : "";
  return { title, detail, note, brand };
}

/**
 * @param {{ id: string, title: string, slots: Array<object> }} model
 * @param {object} book
 * @param {number} people
 * @param {{ isBlocked?: (slot: object) => boolean }} [options]
 */
export function checklistFromList(model, book, people, options = {}) {
  const blocked = options.isBlocked || (() => false);
  const party = partySize(people);
  const items = [];
  for (const slotDef of model?.slots || []) {
    if (blocked(slotDef)) continue;
    const copy = itemCopy(book, model.id, slotDef, options.profile);
    items.push({
      id: slotDef.id,
      label: slotDef.label,
      title: copy.title,
      detail: copy.detail,
      note: copy.note,
      brand: copy.brand || "",
      checked: true,
      quantity: scaleQuantity(slotDef.serves, party),
      touched: false,
      custom: Boolean(slotDef.custom),
      serves: slotDef.serves || 4,
      slot: slotDef,
    });
  }
  return {
    listId: model?.id || "",
    title: model?.title || "List",
    people: party,
    draft: "",
    items,
  };
}

export function checkedCount(state) {
  return (state?.items || []).filter((item) => item.checked).length;
}

export function addTripLabel(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n === 1) return "Add 1 item to my trip";
  return `Add ${n} items to my trip`;
}

function mapItem(state, id, change) {
  let found = false;
  const items = (state?.items || []).map((item) => {
    if (item.id !== id) return item;
    found = true;
    return change(item);
  });
  if (!found) return state;
  return { ...state, items };
}

export function toggleCheck(state, id) {
  return mapItem(state, id, (item) => ({ ...item, checked: !item.checked }));
}

export function stepQuantity(state, id, delta) {
  const step = Math.trunc(Number(delta) || 0);
  if (!step) return state;
  return mapItem(state, id, (item) => ({
    ...item,
    touched: true,
    quantity: Math.min(99, Math.max(1, item.quantity + step)),
  }));
}

export function setDraft(state, value) {
  return { ...state, draft: clean(value, 40) };
}

export function setChecklistBrand(state, id, brand) {
  return mapItem(state, id, (item) => ({ ...item, brand: clean(brand, 40) }));
}

export function rescaleParty(state, people) {
  const next = partySize(people);
  return {
    ...state,
    people: next,
    items: (state?.items || []).map((item) =>
      item.touched || item.custom ? item : { ...item, quantity: scaleQuantity(item.serves, next) }
    ),
  };
}

/**
 * @returns {{ state: object, added: boolean, reason: "empty" | "duplicate" | "full" | "" }}
 */
export function addCustomItem(state, label) {
  const name = clean(label ?? state?.draft, 40);
  if (!name) return { state, added: false, reason: "empty" };
  const items = state?.items || [];
  if (items.some((item) => item.label.toLowerCase() === name.toLowerCase())) {
    return { state: { ...state, draft: "" }, added: false, reason: "duplicate" };
  }
  if (items.length >= MAX_ITEMS) return { state, added: false, reason: "full" };
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24) || "item";
  const id = `cs-${slug}-${items.length}`;
  const slot = {
    id,
    label: name,
    search: name,
    serves: 4,
    suggested: { name, brand: "", sizeLabel: "" },
    custom: true,
  };
  return {
    added: true,
    reason: "",
    state: {
      ...state,
      draft: "",
      items: [
        ...items,
        {
          id,
          label: name,
          title: name,
          detail: "",
          note: "Added by you",
          checked: true,
          quantity: 1,
          touched: true,
          custom: true,
          serves: 4,
          slot,
        },
      ],
    },
  };
}

export function checkedPicks(state) {
  return (state?.items || [])
    .filter((item) => item.checked)
    .map((item) => ({
      slot: item.slot,
      quantity: item.quantity,
      title: item.title || "",
      name: item.title || item.slot?.search || item.label,
    }));
}

function rowHtml(item, escapeHtml) {
  const off = item.checked ? "false" : "true";
  const product = item.title && item.title.toLowerCase() !== String(item.label || "").toLowerCase() ? item.title : "";
  const meta = [product, item.detail, item.note].filter(Boolean).join(" · ");
  return `<li class="theme-check" data-off="${off}">
    <label class="theme-check-hit" data-theme-check="${text(escapeHtml, item.id)}">
      <input type="checkbox" ${item.checked ? "checked" : ""} tabindex="0" aria-label="${text(escapeHtml, item.label)}" />
      <span class="theme-check-copy">
        <strong>${text(escapeHtml, item.label)}</strong>
        ${meta ? `<span class="muted">${text(escapeHtml, meta)}</span>` : ""}
      </span>
    </label>
    <div class="stepper" role="group" aria-label="Quantity for ${text(escapeHtml, item.label)}">
      <button type="button" data-theme-dec="${text(escapeHtml, item.id)}" aria-label="Decrease ${text(escapeHtml, item.label)}">−</button>
      <output>${item.quantity}</output>
      <button type="button" data-theme-inc="${text(escapeHtml, item.id)}" aria-label="Increase ${text(escapeHtml, item.label)}">+</button>
    </div>
    <button type="button" class="text-btn" data-slot-change="${text(escapeHtml, item.id)}">Change</button>
  </li>`;
}

/**
 * @param {ReturnType<typeof checklistFromList>} state
 * @param {(value: string) => string} escapeHtml
 * @param {{ dietNote?: boolean }} [options]
 */
export function checklistHtml(state, escapeHtml, options = {}) {
  const count = checkedCount(state);
  const rows = (state.items || []).map((item) => rowHtml(item, escapeHtml)).join("");
  const empty = state.items?.length
    ? ""
    : `<div class="empty-state theme-empty"><h3>Nothing on this list</h3><p>Add something you want for this trip. We'll look for it on the shelf.</p></div>`;
  const diet = options.dietNote
    ? `<p class="diet-note"><button type="button" class="text-btn" data-add-diets>Add allergies or diets</button></p>`
    : "";
  const disabled = count ? "" : "disabled";
  return `<div class="sheet-body theme-sheet">
    <div class="list-head">
      <h2 id="list-sheet-title"><span class="theme-icon" aria-hidden="true">${themeIcon(state.listId)}</span> ${text(escapeHtml, state.title)}</h2>
      <button type="button" class="text-btn" data-sheet-close>Close</button>
    </div>
    <p class="theme-lead">Untick anything you don't need.</p>
    ${diet}
    <div class="party" role="group" aria-label="How many people">
      <span id="theme-party-label">How many people</span>
      <button type="button" data-theme-party="-1" aria-label="Fewer people">−</button>
      <output id="theme-party-count" aria-live="polite" aria-labelledby="theme-party-label">${state.people}</output>
      <button type="button" data-theme-party="1" aria-label="More people">+</button>
    </div>
    ${empty}
    <ul class="theme-checks">${rows}</ul>
    <div class="sheet-actions">
      <button type="button" class="primary theme-check-add" data-sheet-add="${text(escapeHtml, state.listId)}" ${disabled}>
        <span class="theme-check-label">${text(escapeHtml, addTripLabel(count))}</span>
        ${inlineLoaderHtml()}
      </button>
    </div>
  </div>`;
}

/**
 * Clicks inside an open themed checklist.
 * Sheet close, diet prompt, and "add to trip" stay with the list home.
 * @returns {{ state: object, handled: boolean, kind: string, toast: string }}
 */
export function onChecklistClick(state, target) {
  const idle = { state, handled: false, kind: "", toast: "" };
  if (!target || typeof target.closest !== "function" || !state) return idle;
  const check = target.closest("[data-theme-check]");
  if (check) {
    // A label click is followed by a second click on the checkbox.
    // Handle only the checkbox so one tap toggles once.
    const box = typeof target.matches === "function" && target.matches("input");
    if (!box) return idle;
    return { state: toggleCheck(state, check.getAttribute("data-theme-check")), handled: true, kind: "check", toast: "" };
  }
  const inc = target.closest("[data-theme-inc]");
  if (inc) {
    return { state: stepQuantity(state, inc.getAttribute("data-theme-inc"), 1), handled: true, kind: "qty", toast: "" };
  }
  const dec = target.closest("[data-theme-dec]");
  if (dec) {
    return { state: stepQuantity(state, dec.getAttribute("data-theme-dec"), -1), handled: true, kind: "qty", toast: "" };
  }
  const party = target.closest("[data-theme-party]");
  if (party) {
    const delta = Number(party.getAttribute("data-theme-party")) || 0;
    return { state: rescaleParty(state, (state.people || 4) + delta), handled: true, kind: "party", toast: "" };
  }
  return idle;
}

export function checklistAddMessage(reason) {
  if (reason === "duplicate") return "That item is already on this list.";
  if (reason === "full") return "This list is full.";
  return "Type an item to add.";
}
