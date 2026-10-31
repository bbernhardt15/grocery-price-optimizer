/**
 * Words on the receipt step. Paper checkout slips are a poor source:
 * the names are shortened and the barcode is missing.
 */

export const RECEIPT_TITLE = "Upload past receipts or order screenshots";

export const RECEIPT_HINT = "Optional, about a minute. This is the fastest way to learn the brands you already buy.";

export const PAPER_WARNING =
  "Photos of paper receipts from the checkout lane usually don't work. Those slips shorten the item name and leave off the barcode.";

export const DIGITAL_ASK =
  "Upload an online order or a digital receipt instead. Kroger purchases, Walmart purchase history, Target orders, Instacart orders, Amazon Fresh or Whole Foods orders, and receipts that were emailed to you all work.";

export const PRIVACY_NOTE =
  "We read the pictures only to pick out grocery items. We don't keep the pictures after this step, and we don't save your address, loyalty card, or order number.";

export const PHOTO_OFF_RECEIPT =
  "Photo reading isn't switched on yet. Paste the order text, or upload a PDF or a text file.";

export const STORE_HINTS = [
  { store: "Kroger", hint: "Kroger app: Account, Purchases or Order History, open an order, screenshot or save as PDF." },
  { store: "Walmart", hint: "Walmart app: Account, Purchase history, open an order, screenshot." },
  { store: "Target", hint: "Target app: Account, Orders, open an order, screenshot." },
  { store: "Instacart", hint: "Instacart: Orders, open an order, screenshot." },
  { store: "Amazon", hint: "Amazon Fresh or Whole Foods: Your Orders, open the order, screenshot." },
  { store: "Email", hint: "Email: open the store's receipt and screenshot it, or save the PDF." },
];

function escapeText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function learnedChoice(row) {
  if (row?.mode === "storeBrand") return "Store brand";
  if (row?.mode === "cheapest") return "Cheapest";
  return row?.brand || "Name brand";
}

export function receiptUploadHtml() {
  const hints = STORE_HINTS.map((row) => `<li>${escapeText(row.hint)}</li>`).join("");
  return `<div class="receipt-upload">
    <p>${escapeText(PAPER_WARNING)}</p>
    <p>${escapeText(DIGITAL_ASK)}</p>
    <p class="profile-label">Where to find it</p>
    <ul class="store-hints">${hints}</ul>
    <p class="receipt-privacy">${escapeText(PRIVACY_NOTE)}</p>
    <button type="button" class="primary" id="profile-receipt-pick">Upload receipts</button>
    <p id="profile-receipt-files" class="muted"></p>
    <label class="profile-field">Or paste the order text
      <textarea id="profile-receipt-paste" maxlength="50000" placeholder="Paste a Kroger, Walmart, Target, Instacart, or emailed order"></textarea>
    </label>
    <p id="profile-receipt-status" class="status" role="status"></p>
    <input id="profile-receipt-input" type="file" accept="image/*,.pdf,.txt,.csv,text/plain,application/pdf" multiple hidden />
  </div>`;
}

export function learnedSummaryHtml(learned, options = {}) {
  const rows = learned || [];
  const paper = options.paper ? `<p class="paper-note" role="status">${escapeText(options.paperNote || "")}</p>` : "";
  const cards = rows
    .map((row) => {
      const guess = row.confidence === "low" ? `<p class="muted">Guess from one order. You can change it.</p>` : "";
      return `<section class="summary-row learned-row">
        <div>
          <h3>${escapeText(row.label || row.family)}</h3>
          <p>${escapeText(learnedChoice(row))}</p>
          ${guess}
        </div>
        <div class="learned-actions">
          <button type="button" class="text-btn" data-learned-change="${escapeText(row.family)}">Change</button>
          <button type="button" class="text-btn" data-learned-remove="${escapeText(row.family)}">Remove</button>
        </div>
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

export function learnedEditorHtml(row) {
  const brand = row?.mode === "brand" ? row.brand || "" : "";
  return `<div class="learned-editor" data-editor="${escapeText(row?.family || "")}">
    <button type="button" class="mini-chip" data-learned-mode="storeBrand" data-learned-family="${escapeText(row?.family || "")}">Store brand</button>
    <button type="button" class="mini-chip" data-learned-mode="cheapest" data-learned-family="${escapeText(row?.family || "")}">Cheapest</button>
    <label class="profile-field">Name brand
      <input data-learned-brand="${escapeText(row?.family || "")}" type="text" maxlength="80" value="${escapeText(brand)}" placeholder="Tide" />
    </label>
  </div>`;
}
