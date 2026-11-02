/**
 * Words on the receipt step. Paper checkout slips are a poor source:
 * the names are shortened and the barcode is missing.
 */

import { basketTeaserHtml, frequencyLine, learnedCategory, modeLine } from "./intakePresent.js";

export const RECEIPT_TITLE = "Teach Gitter your usual groceries";

export const RECEIPT_HINT = "We'll learn the brands you already buy.";

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
 * @param {{ family?: string, mode?: string, brand?: string }} choice
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
  if (mode === "brand" && !brand) return list;
  if (mode === "cheapestPicks" && !brands.length) return list;
  return list.map((row) => {
    if (row?.family !== family) return row;
    if (mode === "brand") return { ...row, mode: "brand", brand, brands: [brand] };
    if (mode === "cheapestPicks") return { ...row, mode, brand: brands[0] || "", brands };
    return { ...row, mode, brand: "", brands: row.brands || [] };
  });
}

export function receiptUploadHtml() {
  const hints = STORE_HINTS.map(
    (row) =>
      `<details class="store-find"><summary>${escapeText(row.store)}</summary><p>${escapeText(row.hint)}</p></details>`
  ).join("");
  return `<div class="receipt-upload">
    <label class="drop-zone">
      <input id="profile-receipt-input" type="file" accept="image/*,.pdf,.txt,.csv,text/plain,application/pdf" multiple />
      <span class="drop-title">Drop PDFs or screenshots</span>
      <span class="muted">or tap to choose a few</span>
    </label>
    <div id="profile-receipt-files" class="receipt-files"></div>
    <p class="paper-note quiet">${escapeText(PAPER_WARNING)}</p>
    <details class="where-find">
      <summary>Where do I find it?</summary>
      <div class="store-finds">${hints}</div>
    </details>
    <p class="receipt-privacy">${escapeText(PRIVACY_NOTE)}</p>
    <label class="profile-field">Or paste the order text
      <textarea id="profile-receipt-paste" maxlength="50000" placeholder="Paste a Kroger, Walmart, Target, Instacart, or emailed order"></textarea>
    </label>
  </div>`;
}

function learnedPickerHtml(row, brands) {
  const family = escapeText(row?.family || "");
  const nameBrand = row?.mode === "brand" || row?.mode === "cheapestPicks";
  const selected = new Set(
    (row?.brands?.length ? row.brands : nameBrand && row?.brand ? [row.brand] : []).map((brand) => String(brand).toLowerCase())
  );
  const nameButtons = (brands || [])
    .map((brand) => {
      const on = selected.has(String(brand).toLowerCase());
      return `<button type="button" class="brand-pick" data-learned-toggle="brand" data-learned-family="${family}" data-learned-brand="${escapeText(brand)}" aria-pressed="${on ? "true" : "false"}">${escapeText(brand)}</button>`;
    })
    .join("");
  const names = nameButtons
    ? `<fieldset class="brand-group"><legend>Brands</legend><div class="brand-picks" role="group" aria-label="Brands">${nameButtons}</div></fieldset>`
    : "";
  const rule = (mode, label) => {
    const on = mode === "brand" ? nameBrand : row?.mode === mode;
    return `<button type="button" class="rule-choice" data-learned-mode="${mode}" data-learned-family="${family}" aria-pressed="${on ? "true" : "false"}">${label}</button>`;
  };
  return `<div class="learned-picker" data-editor="${family}">
    ${names}
    <fieldset class="rule-group"><legend>Rule</legend>
      <div class="rule-list" role="radiogroup" aria-label="Rule">
        ${rule("brand", "Name brand")}
        ${rule("storeBrand", "Store brand")}
        ${rule("cheapest", "Cheapest")}
      </div>
    </fieldset>
    <button type="button" class="text-btn rule-never" data-learned-mode="never" data-learned-family="${family}">I don't buy it</button>
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
          const guess = row.confidence === "low" ? `<p class="confidence">Is this right?</p>` : "";
          const choice = learnedChoice(row);
          const mode = modeLine(row);
          const metaBits = [mode !== choice ? mode : "", frequencyLine(row)].filter(Boolean);
          const meta = metaBits.length ? `<p class="learned-meta">${escapeText(metaBits.join(" · "))}</p>` : "";
          const picker = editing && editing === row.family ? learnedPickerHtml(row, brandsByFamily[row.family] || []) : "";
          return `<section class="summary-row learned-row" data-learned-row="${escapeText(row.family)}">
        <div>
          <h3>${escapeText(row.label || row.family)}</h3>
          <p>${escapeText(choice)}</p>
          ${meta}
          ${guess}
        </div>
        <div class="learned-actions">
          <button type="button" class="text-btn" data-learned-change="${escapeText(row.family)}">Change</button>
          <button type="button" class="text-btn" data-learned-remove="${escapeText(row.family)}">Remove</button>
        </div>
        ${picker}
      </section>`;
        })
        .join("");
      return `<section class="learned-group"><p class="learned-group-title">${escapeText(category)}</p>${body}</section>`;
    })
    .join("");
  const lines = options.paper
    ? `<p class="profile-label">Check each line</p><ul class="learned-lines">${(options.lines || [])
        .map(
          (line, index) =>
            `<li><span>${escapeText(line.brand ? `${line.brand} ${line.name}` : line.name)}</span> <button type="button" class="text-btn" data-line-remove="${index}">Remove</button></li>`
        )
        .join("")}</ul>`
    : "";
  const empty = rows.length ? "" : `<p class="muted">Nothing to save from that. Allergies and diets still come first.</p>`;
  return `<div class="learned-summary">${paper}${empty}<div class="summary-list">${cards}</div>${lines}${basketTeaserHtml(options.lines)}</div>`;
}
