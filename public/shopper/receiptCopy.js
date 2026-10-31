/**
 * Words on the receipt step. Paper checkout slips are a poor source:
 * the names are shortened and the barcode is missing.
 */

export const RECEIPT_TITLE = "Upload receipts";

export const RECEIPT_HINT = "We'll learn the brands you already buy.";

export const PAPER_WARNING =
  "Photos of paper receipts usually fail: the name is shortened and the barcode is missing.";

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
  if (row?.mode === "cheapest") return "Cheapest";
  return row?.brand || "Name brand";
}

const LEARNED_MODES = new Set(["brand", "storeBrand", "cheapest", "never"]);

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
  if (mode === "brand" && !brand) return list;
  return list.map((row) => {
    if (row?.family !== family) return row;
    if (mode === "brand") return { ...row, mode: "brand", brand };
    return { ...row, mode, brand: "" };
  });
}

export function receiptUploadHtml() {
  const hints = STORE_HINTS.map(
    (row) =>
      `<details class="store-find"><summary>${escapeText(row.store)}</summary><p>${escapeText(row.hint)}</p></details>`
  ).join("");
  return `<div class="receipt-upload">
    <p class="paper-note">${escapeText(PAPER_WARNING)}</p>
    <details class="where-find">
      <summary>Where do I find it?</summary>
      <div class="store-finds">${hints}</div>
    </details>
    <p class="receipt-privacy">${escapeText(PRIVACY_NOTE)}</p>
    <button type="button" class="ghost" id="profile-receipt-pick">Upload receipts</button>
    <div id="profile-receipt-files" class="receipt-files"></div>
    <label class="profile-field">Or paste the order text
      <textarea id="profile-receipt-paste" maxlength="50000" placeholder="Paste a Kroger, Walmart, Target, Instacart, or emailed order"></textarea>
    </label>
    <div id="profile-receipt-progress" class="read-progress" hidden>
      <div class="read-progress-row">
        <span class="spinner" aria-hidden="true"></span>
        <p id="profile-receipt-status" class="status" role="status"></p>
      </div>
      <progress id="profile-receipt-meter" max="1" value="0"></progress>
    </div>
    <input id="profile-receipt-input" type="file" accept="image/*,.pdf,.txt,.csv,text/plain,application/pdf" multiple hidden />
  </div>`;
}

function learnedPickerHtml(row, brands) {
  const family = escapeText(row?.family || "");
  const current = String(row?.brand || "");
  const nameButtons = (brands || [])
    .map((brand) => {
      const on = row?.mode === "brand" && current.toLowerCase() === String(brand).toLowerCase();
      return `<button type="button" class="mini-chip" data-learned-mode="brand" data-learned-family="${family}" data-learned-brand="${escapeText(brand)}" aria-pressed="${on ? "true" : "false"}">${escapeText(brand)}</button>`;
    })
    .join("");
  const names = nameButtons ? `<p class="profile-label">Name brand</p><div class="mini-row brand-picks">${nameButtons}</div>` : "";
  const option = (mode, label) =>
    `<button type="button" class="choice-card" data-learned-mode="${mode}" data-learned-family="${family}" aria-pressed="${row?.mode === mode ? "true" : "false"}">${label}</button>`;
  return `<div class="learned-picker" data-editor="${family}">
    ${names}
    ${option("storeBrand", "Store brand")}
    ${option("cheapest", "Cheapest")}
    ${option("never", "I don't buy it")}
  </div>`;
}

export function learnedSummaryHtml(learned, options = {}) {
  const rows = learned || [];
  const editing = options.editingFamily || "";
  const brandsByFamily = options.brandsByFamily || {};
  const paper = options.paper ? `<p class="paper-note" role="status">${escapeText(options.paperNote || "")}</p>` : "";
  const cards = rows
    .map((row) => {
      const guess = row.confidence === "low" ? `<p class="muted">Guess from one order. You can change it.</p>` : "";
      const picker = editing && editing === row.family ? learnedPickerHtml(row, brandsByFamily[row.family] || []) : "";
      return `<section class="summary-row learned-row" data-learned-row="${escapeText(row.family)}">
        <div>
          <h3>${escapeText(row.label || row.family)}</h3>
          <p>${escapeText(learnedChoice(row))}</p>
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
  const lines = options.paper
    ? `<p class="profile-label">Check each line</p><ul class="learned-lines">${(options.lines || [])
        .map(
          (line, index) =>
            `<li><span>${escapeText(line.brand ? `${line.brand} ${line.name}` : line.name)}</span> <button type="button" class="text-btn" data-line-remove="${index}">Remove</button></li>`
        )
        .join("")}</ul>`
    : "";
  const empty = rows.length ? "" : `<p class="muted">Nothing to save from that. Allergies and diets still come first.</p>`;
  return `<div class="learned-summary">${paper}${empty}<div class="summary-list">${cards}</div>${lines}</div>`;
}
