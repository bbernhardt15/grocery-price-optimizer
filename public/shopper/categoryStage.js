/**
 * Markup for "What do you buy?".
 * Mode buttons stay on screen. Switching modes keeps the cut and the brand.
 */

function escapeText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function choiceButton(id, label, pressed, extra = "") {
  return `<button type="button" class="choice-card" data-choice="${escapeText(id)}" data-buy="${escapeText(id)}" aria-pressed="${pressed ? "true" : "false"}" ${extra}>${escapeText(label)}</button>`;
}

/**
 * Compact list of every category so the shopper can mark what they never buy.
 * @param {{ categories: Array<{ id: string, label: string }>, declined?: string[] }} input
 */
export function categoryGateHtml(input) {
  const declined = new Set(input?.declined || []);
  const chips = (input?.categories || [])
    .map((category) => {
      const on = declined.has(category.id);
      return `<button type="button" class="mini-chip gate-chip" data-gate="${escapeText(category.id)}" aria-pressed="${on ? "true" : "false"}">${escapeText(category.label)}</button>`;
    })
    .join("");
  return `<p class="profile-label">Tap a category you never buy. Everything else stays available.</p>
    <div class="mini-row gate-grid" role="group" aria-label="Categories you don't buy">${chips}</div>
    <button type="button" class="ghost" id="profile-use-defaults">Use defaults: cheapest for everything I skip</button>`;
}

/**
 * @param {{
 *   category: { id: string, label: string },
 *   index: number,
 *   total: number,
 *   mode: string,
 *   brand: string,
 *   attributes: string[],
 *   attributeChoices: Array<{ id: string, label: string }>,
 *   brands: Array<{ brand: string, imageUrl?: string }>,
 *   askBrand: boolean,
 *   produce: boolean,
 * }} input
 */
export function categoryDetailHtml(input) {
  const category = input?.category || { id: "", label: "This" };
  const label = String(category.label || "this");
  const mode = input?.mode || "";
  const brand = input?.brand || "";
  const attributes = input?.attributes || [];
  const askBrand = Boolean(input?.askBrand);
  const produce = Boolean(input?.produce);
  const total = input?.total || 1;
  const index = input?.index || 0;
  const cuts = (input?.attributeChoices || [])
    .map((row) => {
      const on = attributes.includes(row.id);
      return `<button type="button" class="mini-chip" data-buy-attr="${escapeText(row.id)}" aria-pressed="${on ? "true" : "false"}">${escapeText(row.label)}</button>`;
    })
    .join("");
  const modes = [];
  if (askBrand) modes.push(["brand", "Name brand"]);
  modes.push(["storeBrand", "Store brand"], ["cheapest", "Cheapest overall"], ["cheapestPicks", "Cheapest of my picks"]);
  const modeButtons = modes.map(([id, text]) => choiceButton(id, text, mode === id)).join("");
  const chosen =
    mode === "brand"
      ? `Chosen: Name brand${brand ? ` · ${brand}` : ""}`
      : mode === "storeBrand"
        ? "Chosen: Store brand"
        : mode === "cheapest"
          ? "Chosen: Cheapest overall"
          : mode === "cheapestPicks"
            ? "Chosen: Cheapest of my picks"
          : mode === "never"
            ? `Chosen: I don't buy ${label.toLowerCase()}`
            : "Choose one. You can switch without losing the cut.";
  const brandButtons = (input?.brands || [])
    .map((row) => {
      const on = brand.toLowerCase() === String(row.brand || "").toLowerCase();
      const image = row.imageUrl
        ? `<img class="brand-logo" src="${escapeText(row.imageUrl)}" alt="" />`
        : `<span class="brand-logo brand-logo-fallback" aria-hidden="true"></span>`;
      return `<button type="button" class="brand-chip" data-buy-brand="${escapeText(row.brand)}" data-buy-product="${escapeText(row.productId || "")}" aria-pressed="${on ? "true" : "false"}">${image}<span>${escapeText(row.brand)}</span></button>`;
    })
    .join("");
  const brandBlock = input?.pending
    ? ""
    : !askBrand
    ? produce
      ? `<p class="muted">Fresh produce doesn't use a name brand. Store brand, cheapest, or organic is enough.</p>`
      : `<p class="muted">Not enough name brands on the shelf. Store brand or cheapest, plus the cut.</p>`
    : mode === "brand"
      ? `<p class="profile-label">Which name brand?</p>${
          brandButtons
            ? `<div class="brand-row">${brandButtons}</div>`
            : `<p class="muted">No name brands are on the shelf for this one.</p>`
        }`
      : brand
        ? `<p class="muted">Name brand kept: ${escapeText(brand)}. Switch back to Name brand to change it.</p>`
        : "";
  const cutLabel = produce ? "Type, and packaged or loose" : "What kind?";
  const question = (input?.attributeChoices || []).length ? `What kind of ${label.toLowerCase()}?` : `How do you buy ${label.toLowerCase()}?`;
  return `<p class="profile-label">${escapeText(label)} · ${index + 1} of ${total}</p>
    <h3 class="buy-question">${escapeText(question)}</h3>
    ${cuts ? `<p class="profile-label">${escapeText(cutLabel)}</p><div class="mini-row">${cuts}</div>` : ""}
    <p class="chosen-mode" role="status">${escapeText(chosen)}</p>
    <div class="choice-stack" role="group" aria-label="How you buy this">
      ${choiceButton("never", `I don't buy ${label.toLowerCase()}`, mode === "never")}
      ${modeButtons}
    </div>
    ${brandBlock}
    ${
      input?.compact
        ? ""
        : `<button type="button" class="ghost" id="profile-use-defaults">Use defaults: cheapest for everything I skip</button>
    <button type="button" class="ghost" id="profile-skip-rest">Skip rest</button>`
    }`;
}
