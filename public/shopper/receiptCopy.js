/**
 * Words on the receipt step. Paper checkout slips are a poor source:
 * the names are shortened and the barcode is missing.
 */

import { basketTeaserHtml, frequencyLine, learnedCategory, modeLine } from "./intakePresent.js";
import { learnedActionsHtml } from "./learnedActions.js";
import { learnedRulePillHtml } from "./learnedRule.js";
import { joinBrandName, tripAddHtml } from "./tripAdd.js";

export const RECEIPT_TITLE = "Teach Gitter your usual groceries";

export const ADD_TRIP_LABEL = "Add these items to my trip";
export const EMPTY_TRIP_LABEL = "Start with an empty trip";

export const RECEIPT_HINT = "We'll learn the brands you already buy.";

export const LEARNED_PURPOSE =
  "This teaches the brands you already buy. It does not add them to a trip until you say so.";

export const PAPER_WARNING =
  "Photos of paper receipts don't work well: names are abbreviated and there is no UPC or barcode.";

export const PRIVACY_NOTE =
  "We read the pictures only to pick out grocery items. We don't keep the pictures after this step, and we don't save your address, loyalty card, or order number.";

export const PHOTO_OFF_RECEIPT =
  "Photo reading isn't switched on yet. Paste the order text, or upload a PDF or a text file.";

export const STORE_HINTS = [
  { store: "Kroger", hint: "Account, then Purchases or Order History. Open an order and screenshot it, or save a PDF." },
  { store: "Walmart", hint: "Account, then Purchase history. Open an order and screenshot it." },
  { store: "Target", hint: "Account, then Orders. Open an order and screenshot it." },
  { store: "Instacart", hint: "Orders, then open an order and screenshot it." },
  { store: "Amazon", hint: "Amazon Fresh or Whole Foods: Your Orders, open the order, screenshot it." },
  { store: "Email", hint: "Open the store's receipt and screenshot it, or save the PDF." },
];

function joinLineName(line) {
  return joinBrandName(line?.brand, line?.name);
}

function escapeText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function learnedChoice(row) {
  if (row?.mode === "never") return "I don't buy it";
  if (row?.mode === "storeBrand") return "Store brand";
  if (row?.mode === "cheapestPicks") {
    const brands = (row.brands || []).filter(Boolean);
    return brands.length ? `Cheapest of ${brands.join(", ")}` : "Cheapest of my picks";
  }
  if (row?.mode === "cheapest") return "Cheapest overall";
  return row?.brand || "Name brand";
}

const LEARNED_MODES = new Set(["brand", "storeBrand", "cheapest", "cheapestPicks", "never"]);

/**
 * Change one row. A click with no family, or a mode we don't know,
 * returns the same list. It never clears the other rows.
 * @param {object[]} rows
 * @param {{ family?: string, mode?: string, brand?: string, brands?: string[], allowEmpty?: boolean }} choice
 */
export function applyLearnedChoice(rows, choice) {
  const list = Array.isArray(rows) ? rows : [];
  const family = String(choice?.family || "").trim();
  const mode = String(choice?.mode || "");
  if (!family || !LEARNED_MODES.has(mode) || !list.some((row) => row?.family === family)) return list;
  const brand = String(choice?.brand || "").replace(/\s+/g, " ").trim();
  const brands = Array.isArray(choice?.brands)
    ? choice.brands.map((item) => String(item || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 12)
    : brand
      ? [brand]
      : [];
  if (mode === "brand" && !brand && !choice?.allowEmpty) return list;
  if (mode === "cheapestPicks" && !brands.length) return list;
  return list.map((row) => {
    if (row?.family !== family) return row;
    const remembered = String(row?.nameBrand || row?.brand || "").replace(/\s+/g, " ").trim();
    if (mode === "brand") {
      const named = brand || remembered;
      return { ...row, mode: "brand", brand: named, brands: named ? [named] : [], nameBrand: named };
    }
    if (mode === "cheapestPicks") return { ...row, mode, brand: brands[0] || "", brands, nameBrand: remembered };
    return { ...row, mode, brand: "", brands: row.brands || [], nameBrand: remembered };
  });
}

/** The name brand to restore after Store brand or Cheapest overall. */
export function rememberedNameBrand(row) {
  return String(row?.nameBrand || row?.brand || "").replace(/\s+/g, " ").trim();
}

export function receiptUploadHtml() {
  const hints = STORE_HINTS.map(
    (row) =>
      `<details class="store-find"><summary>${escapeText(row.store)}</summary><p>${escapeText(row.hint)}</p></details>`
  ).join("");
  return `<div class="receipt-upload">
    <label class="drop-zone drop-primary drop-hero">
      <input id="profile-receipt-input" type="file" accept="image/*,.pdf,.txt,.csv,text/plain,application/pdf" multiple />
      <span class="drop-title">Drop PDFs or screenshots</span>
      <span class="muted">Tap to upload. Skip is up top if you want to do this later.</span>
    </label>
    <div id="profile-receipt-files" class="receipt-files"></div>
    <p class="paper-note quiet">${escapeText(PAPER_WARNING)}</p>
    <details class="where-find faq-accordion" data-faq="1">
      <summary>Where do I find it?</summary>
      <div class="store-finds">${hints}</div>
    </details>
    <p class="receipt-privacy">${escapeText(PRIVACY_NOTE)}</p>
    <details class="receipt-paste">
      <summary>Paste order text instead</summary>
      <label class="profile-field">Order text
        <textarea id="profile-receipt-paste" maxlength="50000" placeholder="Paste a Kroger, Walmart, Target, Instacart, or emailed order"></textarea>
      </label>
    </details>
  </div>`;
}

const BRAND_FALLBACK = ["Kroger", "Simple Truth", "Great Value"];

export function brandChipMarkup(brands, options = {}) {
  const pending = Boolean(options.pending);
  const family = escapeText(options.family || "");
  if (pending) {
    return `<fieldset class="brand-group"><legend>Brands</legend><div class="brand-picks" role="group" aria-label="Brands" aria-busy="true"><p class="brand-loading" role="status">Loading brands</p><span class="brand-skel" aria-hidden="true"></span><span class="brand-skel" aria-hidden="true"></span><span class="brand-skel" aria-hidden="true"></span><span class="brand-skel" aria-hidden="true"></span></div></fieldset>`;
  }
  const given = (brands || []).map((brand) => String(brand || "").trim()).filter(Boolean);
  const names = given.length ? given : BRAND_FALLBACK;
  const buttons = names
    .map((brand) => {
      const on = Boolean(options.selected?.has?.(String(brand).toLowerCase()));
      return `<button type="button" class="brand-pick" data-learned-toggle="brand" data-learned-family="${family}" data-learned-brand="${escapeText(brand)}" aria-pressed="${on ? "true" : "false"}">${escapeText(brand)}</button>`;
    })
    .join("");
  const retry = options.retry
    ? `<button type="button" class="text-btn" data-brand-retry="${family}">Load brands again</button>`
    : "";
  return `<fieldset class="brand-group"><legend>Brands</legend><div class="brand-picks" role="group" aria-label="Brands">${buttons}</div>${retry}</fieldset>`;
}

/** Inner markup for one learned card. The section element stays put. */
export function learnedCardInnerHtml(row, options = {}) {
  const guess = row?.confidence === "low" ? `<p class="confidence">Is this right?</p>` : "";
  const choice = learnedChoice(row);
  const mode = modeLine(row);
  const metaBits = [mode !== choice ? mode : "", frequencyLine(row)].filter(Boolean);
  const meta = metaBits.length ? `<p class="learned-meta">${escapeText(metaBits.join(" · "))}</p>` : "";
  const pending = Boolean(options.pending);
  const picker = options.editing ? learnedPickerHtml(row, options.brands || [], { pending, saved: Boolean(options.saved), retry: Boolean(options.retry) }) : "";
  return `<div class="learned-copy">
          <h3>${escapeText(row?.label || row?.family)}</h3>
          ${learnedRulePillHtml(row)}
          <p>${escapeText(choice)}</p>
          ${meta}
          ${guess}
        </div>
        ${learnedActionsHtml(row?.family || "")}
        ${picker}`;
}

function learnedPickerHtml(row, brands, options = {}) {
  const family = escapeText(row?.family || "");
  const nameBrand = row?.mode === "brand" || row?.mode === "cheapestPicks";
  const selected = new Set(
    (row?.brands?.length ? row.brands : nameBrand && row?.brand ? [row.brand] : []).map((brand) => String(brand).toLowerCase())
  );
  const storeOnly = row?.mode === "storeBrand";
  const names = storeOnly ? "" : brandChipMarkup(brands, { pending: options.pending, selected, family: row?.family || "", retry: options.retry });
  const storeNote = storeOnly ? `<p class="muted store-brand-note">Store brand only. Name brands stay off this card.</p>` : "";
  const pickedCount = selected.size;
  const showPicks = pickedCount > 1 || row?.mode === "cheapestPicks";
  const rule = (mode, label) => {
    const on = mode === "brand" ? row?.mode === "brand" : row?.mode === mode;
    const saved = on && options.saved ? `<span class="rule-saved" data-rule-saved>Saved</span>` : "";
    return `<button type="button" class="rule-choice" data-learned-mode="${mode}" data-learned-family="${family}" aria-pressed="${on ? "true" : "false"}"><span class="rule-label">${label}</span>${saved}</button>`;
  };
  return `<div class="learned-picker" data-editor="${family}">
    <fieldset class="rule-group"><legend>Rule</legend>
      <div class="rule-list" role="radiogroup" aria-label="Rule">
        ${rule("brand", "Name brand")}
        ${rule("storeBrand", "Store brand")}
        ${showPicks ? rule("cheapestPicks", "Cheapest of my picks") : ""}
        ${rule("cheapest", "Cheapest overall")}
      </div>
    </fieldset>
    <button type="button" class="text-btn rule-never" data-learned-mode="never" data-learned-family="${family}">I don't buy it</button>
    ${storeNote}
    ${names}
  </div>`;
}

export function learnedSummaryHtml(learned, options = {}) {
  const rows = learned || [];
  const editing = options.editingFamily || "";
  const brandsByFamily = options.brandsByFamily || {};
  const paper = options.paper ? `<p class="paper-note" role="status">${escapeText(options.paperNote || "")}</p>` : "";
  const groups = new Map();
  for (const row of rows) {
    const category = learnedCategory(row).label;
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(row);
  }
  const cards = [...groups.entries()]
    .map(([category, groupRows]) => {
      const body = groupRows
        .map((row) => {
          const pending = Boolean(options.pendingFamilies?.[row.family]);
          const inner = learnedCardInnerHtml(row, {
            editing: Boolean(editing && editing === row.family),
            brands: brandsByFamily[row.family] || [],
            pending,
            retry: Boolean(options.retryFamilies?.[row.family]),
            saved: Boolean(options.savedFamilies?.has?.(row.family)),
          });
          return `<section class="summary-row learned-row" data-learned-row="${escapeText(row.family)}" tabindex="-1">${inner}</section>`;
        })
        .join("");
      return `<section class="learned-group"><p class="learned-group-title">${escapeText(category)}</p>${body}</section>`;
    })
    .join("");
  const lines = options.paper
    ? `<p class="profile-label">Check each line</p><ul class="learned-lines">${(options.lines || [])
        .map(
          (line, index) =>
            `<li><span>${escapeText(joinLineName(line))}</span> <button type="button" class="text-btn" data-line-remove="${index}">Remove</button></li>`
        )
        .join("")}</ul>`
    : "";
  const empty = rows.length ? "" : `<p class="muted">Nothing to save from that. Allergies and diets still come first.</p>`;
  const covered = new Set([...groups.keys()]);
  const missingDepts = [
    ["produce", "Produce"],
    ["meat", "Meat & Seafood"],
    ["frozen", "Frozen"],
    ["household", "Household"],
  ].filter(([, label]) => !covered.has(label));
  const skipped = options.skippedFamilies instanceof Set ? options.skippedFamilies : new Set(options.skippedFamilies || []);
  const missing = missingDepts.length
    ? `<section class="missing-depts"><p class="paper-note">Not on this receipt. The lowest price includes every item in that aisle. You can leave an aisle off.</p><div class="mini-row">${missingDepts
        .map(([id, label]) => {
          if (skipped.has(id)) return `<span class="missing-dept">${escapeText(label)} left off.</span>`;
          return `<span class="missing-dept"><button type="button" class="mini-chip" data-missing-dept="${escapeText(id)}" data-missing-label="${escapeText(label)}">Use the lowest ${escapeText(label)} price</button><button type="button" class="text-btn" data-missing-skip="${escapeText(id)}" data-missing-label="${escapeText(label)}">Leave ${escapeText(label)} off</button></span>`;
        })
        .join("")}</div></section>`
    : "";
  return `<div class="learned-summary"><p class="learned-purpose">${escapeText(LEARNED_PURPOSE)}</p>${paper}${empty}<div class="summary-list">${cards}</div>${lines}${missing}${basketTeaserHtml(options.lines)}</div>`;
}

/** After Confirm: pick which learned lines join this trip. */
export function learnedTripChoiceHtml(lines) {
  return tripAddHtml(lines);
}
