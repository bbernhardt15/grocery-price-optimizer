/**
 * Markup for themed lists. Tiles here never show a price or a store.
 */

import { activeChoice, scaleQuantity, slotMatches } from "./themedLists.js";

function text(escapeHtml, value) {
  return escapeHtml(value || "");
}

export function choiceDetail(choice) {
  const title = String(choice?.familyName || choice?.name || "Item").trim();
  const brand = String(choice?.brand || "").trim();
  const size = String(choice?.sizeLabel || "").trim();
  const showBrand = brand && !title.toLowerCase().includes(brand.toLowerCase());
  return { title, detail: [showBrand ? brand : "", size].filter(Boolean).join(" · ") };
}

export function sourceNote(source) {
  if (source === "override") return "Only on this list";
  if (source === "favorite") return "Your favorite";
  return "Suggested";
}

/**
 * One family tile for the slot picker. Price and store fields on the
 * tile are ignored on purpose.
 */
export function pickerTileHtml(tile, selectedId, escapeHtml, imageSrc) {
  const title = tile?.familyName || tile?.name || "Item";
  const brand = tile?.brand && !String(title).toLowerCase().includes(String(tile.brand).toLowerCase()) ? tile.brand : "";
  const variants = Array.isArray(tile?.variants) && tile.variants.length ? tile.variants : [tile];
  const selected = variants.find((variant) => variant?.id === selectedId) || variants[0] || tile;
  const sizes = variants
    .filter((variant) => variant?.id)
    .map((variant) => {
      const on = variant.id === selected?.id;
      const label = variant.label || variant.variantLabel || variant.sizeLabel || "Size";
      return `<button type="button" class="choice-chip" role="radio" aria-checked="${on ? "true" : "false"}" data-pick-size="${text(escapeHtml, variant.id)}" data-pick-family="${text(escapeHtml, tile?.familyKey || "")}">${text(escapeHtml, label)}</button>`;
    })
    .join("");
  const rawImage = selected?.imageUrls?.[0] || tile?.imageUrls?.[0] || "";
  const image = imageSrc ? imageSrc(rawImage) : rawImage;
  return `<article class="pick-tile">
    <img src="${text(escapeHtml, image)}" alt="" />
    <div class="pick-copy">
      ${brand ? `<p class="brand">${text(escapeHtml, brand)}</p>` : ""}
      <h3>${text(escapeHtml, title)}</h3>
      <div class="pick-sizes" role="radiogroup" aria-label="Size for ${text(escapeHtml, title)}">${sizes}</div>
      <div class="pick-actions">
        <button type="button" class="primary" data-pick-scope="all" data-pick-family="${text(escapeHtml, tile?.familyKey || "")}">Remember for every list</button>
        <button type="button" class="ghost" data-pick-scope="list" data-pick-family="${text(escapeHtml, tile?.familyKey || "")}">Only on this list</button>
      </div>
    </div>
  </article>`;
}

export function listCardHtml(list, escapeHtml) {
  return `<article class="starter-card">
    <button type="button" class="starter" data-list-add="${text(escapeHtml, list.id)}">
      <span>${text(escapeHtml, list.title)}</span>
      <span class="muted">${text(escapeHtml, list.blurb)}</span>
    </button>
    <button type="button" class="text-btn" data-list-open="${text(escapeHtml, list.id)}">Customize</button>
  </article>`;
}

export function myListCardHtml(list, escapeHtml) {
  const blurb = (list.slots || []).map((row) => row.label).filter(Boolean).slice(0, 4).join(", ") || "No items yet";
  return `<article class="starter-card">
    <button type="button" class="starter" data-my-open="${text(escapeHtml, list.id)}">
      <span>${text(escapeHtml, list.name)}</span>
      <span class="muted">${text(escapeHtml, blurb)}</span>
    </button>
    <div class="starter-actions">
      <button type="button" class="text-btn" data-list-add="${text(escapeHtml, list.id)}">Add</button>
      <button type="button" class="text-btn" data-my-open="${text(escapeHtml, list.id)}">Edit</button>
    </div>
  </article>`;
}

export function partyHtml(people, escapeHtml) {
  return `<div class="party" role="group" aria-label="How many people">
    <span id="party-label">How many people</span>
    <button type="button" data-party="-1" aria-label="Fewer people">−</button>
    <output id="party-count" aria-live="polite" aria-labelledby="party-label">${text(escapeHtml, String(people))}</output>
    <button type="button" data-party="1" aria-label="More people">+</button>
  </div>`;
}

export function nudgeHtml(escapeHtml) {
  return `<div class="nudge" id="favorites-nudge">
    <p>Set your favorites once and we'll remember them.</p>
    <button type="button" class="text-btn" data-nudge-dismiss>Not now</button>
  </div>`;
}

export function emptyMyListsHtml(escapeHtml) {
  return `<div class="empty-state">
    <h3>No lists yet</h3>
    <p>Save a copy of a starter list, or start your own. Your favorites stay with you.</p>
    <button type="button" class="primary" data-my-new>New list</button>
  </div>`;
}

function slotRowHtml(model, slotDef, book, people, quantities, escapeHtml) {
  const picked = activeChoice(book, model.id, slotDef);
  const shown = choiceDetail(picked.choice);
  const quantity = quantities[slotDef.id] ?? scaleQuantity(slotDef.serves, people);
  const move = model.mine
    ? `<div class="slot-move">
        <button type="button" class="text-btn" data-slot-move="${text(escapeHtml, slotDef.id)}" data-slot-dir="-1" aria-label="Move ${text(escapeHtml, slotDef.label)} up">Up</button>
        <button type="button" class="text-btn" data-slot-move="${text(escapeHtml, slotDef.id)}" data-slot-dir="1" aria-label="Move ${text(escapeHtml, slotDef.label)} down">Down</button>
        <button type="button" class="text-btn" data-slot-remove="${text(escapeHtml, slotDef.id)}" aria-label="Remove ${text(escapeHtml, slotDef.label)}">Remove</button>
      </div>`
    : "";
  return `<li class="slot-row">
    <div class="slot-copy">
      <p class="slot-need">${text(escapeHtml, slotDef.label)}</p>
      <p class="slot-product">${text(escapeHtml, shown.title)}</p>
      ${shown.detail ? `<p class="muted">${text(escapeHtml, shown.detail)}</p>` : ""}
      <p class="muted">${text(escapeHtml, sourceNote(picked.source))}</p>
      ${move}
    </div>
    <div class="slot-controls">
      <div class="stepper" role="group" aria-label="Quantity for ${text(escapeHtml, slotDef.label)}">
        <button type="button" data-slot-dec="${text(escapeHtml, slotDef.id)}" aria-label="Decrease ${text(escapeHtml, slotDef.label)}">−</button>
        <output>${quantity}</output>
        <button type="button" data-slot-inc="${text(escapeHtml, slotDef.id)}" aria-label="Increase ${text(escapeHtml, slotDef.label)}">+</button>
      </div>
      <button type="button" class="text-btn" data-slot-change="${text(escapeHtml, slotDef.id)}">Change</button>
    </div>
  </li>`;
}

export function detailHtml({ model, book, people, quantities, confirmDelete, finder, escapeHtml }) {
  const rows = model.slots.map((slotDef) => slotRowHtml(model, slotDef, book, people, quantities, escapeHtml)).join("");
  const finderHtml = model.mine ? slotFinderHtml(finder, model, escapeHtml) : "";
  const rename = model.mine
    ? `<label class="list-rename">List name
        <input id="list-rename" maxlength="40" value="${text(escapeHtml, model.title)}" autocomplete="off" />
      </label>
      <div class="starter-actions">
        <button type="button" class="ghost" data-my-move-list="-1">Move list up</button>
        <button type="button" class="ghost" data-my-move-list="1">Move list down</button>
      </div>`
    : "";
  const copy = model.mine
    ? ""
    : `<button type="button" class="ghost" data-list-dup="${text(escapeHtml, model.id)}">Save a copy to My lists</button>`;
  const remove = model.mine
    ? confirmDelete
      ? `<button type="button" class="text-btn danger" data-my-delete-yes="${text(escapeHtml, model.id)}">Yes, delete this list</button>`
      : `<button type="button" class="text-btn" data-my-delete="${text(escapeHtml, model.id)}">Delete this list</button>`
    : "";
  const empty = model.slots.length
    ? ""
    : `<div class="empty-state"><h3>This list is empty</h3><p>Add an item below. We'll remember what you pick.</p></div>`;
  return `<div class="sheet-body">
    <div class="list-head">
      <h2 id="list-sheet-title">${text(escapeHtml, model.title)}</h2>
      <button type="button" class="text-btn" data-sheet-close>Close</button>
    </div>
    ${rename}
    ${partyHtml(people, escapeHtml)}
    ${empty}
    <ul class="slot-list">${rows}</ul>
    ${finderHtml}
    <div class="sheet-actions">
      <button type="button" class="primary" data-sheet-add="${text(escapeHtml, model.id)}" ${model.slots.length ? "" : "disabled"}>Add all to my trip</button>
      ${copy}
      ${remove}
    </div>
  </div>`;
}

export function slotMatchHtml(query, model, escapeHtml) {
  const matches = slotMatches(query).filter((slotDef) => !model.slots.some((row) => row.id === slotDef.id));
  const chips = matches
    .map(
      (slotDef) =>
        `<button type="button" class="choice-chip" data-add-known="${text(escapeHtml, slotDef.id)}">${text(escapeHtml, slotDef.label)}</button>`
    )
    .join("");
  const typed = String(query || "").trim();
  const custom =
    typed && !matches.some((slotDef) => slotDef.label.toLowerCase() === typed.toLowerCase())
      ? `<button type="button" class="ghost" data-add-custom="${text(escapeHtml, typed)}">Add “${text(escapeHtml, typed)}”</button>`
      : "";
  return `${chips}${custom}`;
}

function slotFinderHtml(query, model, escapeHtml) {
  const typed = String(query || "").trim();
  return `<div class="slot-finder">
    <label>Add an item
      <input id="slot-finder" maxlength="40" value="${text(escapeHtml, typed)}" placeholder="Ketchup, soda, bread" autocomplete="off" />
    </label>
    <div id="slot-matches" class="pick-sizes">${slotMatchHtml(query, model, escapeHtml)}</div>
  </div>`;
}

export function pickerHtml({ slotLabel, query, tiles, selected, escapeHtml, mediaUrl }) {
  const body = pickerResultsHtml(tiles, selected, escapeHtml, mediaUrl);
  return `<div class="sheet-body">
    <div class="list-head">
      <h2 id="list-sheet-title">Choose ${text(escapeHtml, slotLabel)}</h2>
      <button type="button" class="text-btn" data-pick-back>Back</button>
    </div>
    <label>Search the shelf
      <input id="pick-query" maxlength="60" value="${text(escapeHtml, query)}" autocomplete="off" />
    </label>
    <div id="pick-results" class="pick-results">${body}</div>
  </div>`;
}

export function pickerResultsHtml(tiles, selected, escapeHtml, mediaUrl) {
  if (!tiles.length) {
    return `<div class="empty-state"><h3>Nothing matched</h3><p>Try a shorter name, like the brand or the kind of food.</p></div>`;
  }
  return tiles
    .map((tile) => pickerTileHtml(tile, selected[tile.familyKey] || tile.defaultVariantId, escapeHtml, mediaUrl))
    .join("");
}
