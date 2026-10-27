/**
 * Starter lists, slot favorites, and My lists on the Add step.
 * The shopper taps a list to add it, or Customize to change a slot.
 */

import {
  BOOK_KEY,
  activeChoice,
  addListSlot,
  annotateFavoriteSwap,
  arrangeLists,
  choiceFromProduct,
  createList,
  deleteList,
  duplicateThemed,
  listModel,
  mergeBooks,
  moveList,
  moveListSlot,
  newSlotId,
  partySize,
  picksForShelf,
  readBook,
  readParty,
  readSwaps,
  rememberEverywhere,
  removeListSlot,
  renameList,
  resolveSlot,
  scaleQuantity,
  setOverride,
  slotById,
  writeBook,
  writeParty,
  writeSwaps,
} from "./themedLists.js";
import {
  detailHtml,
  emptyMyListsHtml,
  listCardHtml,
  myListCardHtml,
  nudgeHtml,
  partyHtml,
  pickerHtml,
  pickerResultsHtml,
  slotMatchHtml,
} from "./themedListsUi.js";

export { BOOK_KEY };

/**
 * @param {{
 *   escapeHtml: (value: string) => string,
 *   toast: (message: string) => void,
 *   haptic: () => void,
 *   addProduct: (product: object, quantity: number, options?: object) => void,
 *   loadShelf: (picks: Array<{ name?: string, brand?: string }>) => Promise<Array<Record<string, unknown>>>,
 *   searchTiles: (query: string) => Promise<Array<Record<string, unknown>>>,
 *   productById: (id: string) => object | undefined,
 *   hasProduct: (id: string) => boolean,
 *   locked: () => boolean,
 *   onChange: () => void,
 *   mediaUrl: (url: string) => string,
 *   storage?: Storage,
 * }} deps
 */
export function createListHome(deps) {
  const storage = deps.storage || localStorage;
  let book = readBook(storage);
  let party = readParty(storage);
  let swaps = readSwaps(storage);
  let view = null;
  let searchTimer = 0;
  let applying = false;

  function persist(next) {
    book = writeBook(storage, next);
    if (!applying) deps.onChange();
    return book;
  }

  function saveSwaps() {
    writeSwaps(storage, swaps);
  }

  function paintHome() {
    const root = document.getElementById("starter-lists");
    if (!root) return;
    const { featured, more } = arrangeLists(new Date());
    const showNudge = !book.nudged && Object.keys(book.favorites).length === 0;
    const seasonal = featured.length
      ? `<div id="seasonal-block"><h3>Right now</h3><div id="seasonal-lists" class="starter-row">${featured.map((list) => listCardHtml(list, deps.escapeHtml)).join("")}</div></div>`
      : `<p class="muted" id="seasonal-block">Nothing special on the calendar this week. Everyday lists are under More lists.</p>`;
    const mine = [...book.lists].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    const mineHtml = mine.length
      ? `<div id="my-lists" class="starter-row">${mine
          .map((list) => {
            const model = listModel(list.id, book);
            return myListCardHtml({ id: list.id, name: list.name, slots: model?.slots || [] }, deps.escapeHtml);
          })
          .join("")}</div>`
      : `<div id="my-lists">${emptyMyListsHtml(deps.escapeHtml)}</div>`;
    root.innerHTML = `
      ${partyHtml(party, deps.escapeHtml)}
      ${showNudge ? nudgeHtml(deps.escapeHtml) : ""}
      ${seasonal}
      <div class="start-head">
        <h3>My lists</h3>
        <button type="button" class="ghost" data-my-new>New list</button>
      </div>
      ${mineHtml}
      <h3>More lists</h3>
      <div id="more-lists" class="starter-row">${more.map((list) => listCardHtml(list, deps.escapeHtml)).join("")}</div>
    `;
  }

  function openDialog() {
    const dialog = document.getElementById("list-sheet");
    if (dialog && !dialog.open) dialog.showModal();
  }

  function closeDialog() {
    view = null;
    document.getElementById("list-sheet")?.close();
  }

  function quantitiesFor(model) {
    const quantities = { ...(view?.quantities || {}) };
    for (const slotDef of model.slots) {
      if (quantities[slotDef.id] == null) quantities[slotDef.id] = scaleQuantity(slotDef.serves, party);
    }
    return quantities;
  }

  function paintSheet() {
    const dialog = document.getElementById("list-sheet");
    if (!dialog || !view) return;
    if (view.kind === "picker") {
      dialog.innerHTML = pickerHtml({
        slotLabel: view.slotLabel,
        query: view.query,
        tiles: view.tiles || [],
        selected: view.selected || {},
        escapeHtml: deps.escapeHtml,
        mediaUrl: deps.mediaUrl,
      });
      return;
    }
    const model = listModel(view.listId, book);
    if (!model) {
      closeDialog();
      paintHome();
      return;
    }
    view.quantities = quantitiesFor(model);
    dialog.innerHTML = detailHtml({
      model,
      book,
      people: party,
      quantities: view.quantities,
      confirmDelete: view.confirmDelete,
      finder: view.finder || "",
      escapeHtml: deps.escapeHtml,
    });
  }

  function openList(listId) {
    const model = listModel(listId, book);
    if (!model) return;
    view = { kind: "list", listId, quantities: {}, touched: {}, confirmDelete: false, finder: "" };
    paintSheet();
    openDialog();
  }

  function setParty(next) {
    party = writeParty(storage, partySize(party + next));
    if (view?.kind === "list") {
      const model = listModel(view.listId, book);
      if (model) {
        for (const slotDef of model.slots) {
          if (!view.touched[slotDef.id]) view.quantities[slotDef.id] = scaleQuantity(slotDef.serves, party);
        }
      }
      paintSheet();
    }
    paintHome();
  }

  function changeQty(slotId, delta) {
    if (!view || view.kind !== "list") return;
    const model = listModel(view.listId, book);
    const slotDef = model?.slots.find((row) => row.id === slotId);
    if (!slotDef) return;
    const current = view.quantities[slotId] ?? scaleQuantity(slotDef.serves, party);
    view.quantities[slotId] = Math.min(99, Math.max(1, current + delta));
    view.touched[slotId] = true;
    paintSheet();
  }

  async function openPicker(slotId) {
    const model = listModel(view?.listId, book);
    const slotDef = model?.slots.find((row) => row.id === slotId) || slotById(slotId);
    if (!slotDef || !view) return;
    const picked = activeChoice(book, view.listId, slotDef);
    view = {
      kind: "picker",
      listId: view.listId,
      slotId: slotDef.id,
      slotLabel: slotDef.label,
      query: picked.choice?.name || slotDef.search,
      quantities: view.quantities,
      touched: view.touched,
      tiles: [],
      selected: {},
    };
    paintSheet();
    openDialog();
    await runSearch(view.query);
  }

  async function runSearch(query) {
    if (!view || view.kind !== "picker") return;
    view.query = query;
    const results = document.getElementById("pick-results");
    if (results) results.innerHTML = `<p class="muted">Looking on the shelf…</p>`;
    try {
      const tiles = await deps.searchTiles(query);
      if (!view || view.kind !== "picker" || view.query !== query) return;
      view.tiles = tiles;
      const host = document.getElementById("pick-results");
      if (host) host.innerHTML = pickerResultsHtml(tiles, view.selected, deps.escapeHtml, deps.mediaUrl);
    } catch {
      const host = document.getElementById("pick-results");
      if (host) {
        host.innerHTML = `<div class="empty-state"><h3>The shelf didn't load</h3><p>Check your connection and try the search again.</p></div>`;
      }
    }
  }

  function variantOn(tile) {
    const variants = Array.isArray(tile?.variants) && tile.variants.length ? tile.variants : [tile];
    const selectedId = view?.selected?.[tile?.familyKey] || tile?.defaultVariantId;
    return variants.find((variant) => variant?.id === selectedId) || variants[0];
  }

  function choose(scope, familyKey) {
    if (!view || view.kind !== "picker") return;
    const tile = (view.tiles || []).find((row) => (row.familyKey || "") === familyKey) || (view.tiles || [])[0];
    const variant = tile ? variantOn(tile) : null;
    const stored = variant?.id ? deps.productById(variant.id) || variant : null;
    const choice = choiceFromProduct(stored);
    if (!choice) {
      deps.toast("Pick a size on the shelf.");
      return;
    }
    const at = Date.now();
    if (scope === "list") book = persist(setOverride(book, view.listId, view.slotId, choice, at));
    else book = persist(rememberEverywhere(book, view.listId, view.slotId, choice, at));
    const listId = view.listId;
    const quantities = view.quantities;
    const touched = view.touched;
    view = { kind: "list", listId, quantities, touched, confirmDelete: false, finder: "" };
    paintSheet();
    paintHome();
    deps.haptic();
    deps.toast(scope === "list" ? "We'll use that on this list." : "We'll remember that favorite.");
  }

  async function addList(listId) {
    if (deps.locked()) {
      deps.toast("This list is view-only.");
      return;
    }
    const model = listModel(listId, book);
    if (!model) return;
    const quantities = view?.listId === listId ? view.quantities : {};
    try {
      const shelf = await deps.loadShelf(picksForShelf(model, book));
      let added = 0;
      const missing = [];
      const swapped = [];
      for (const slotDef of model.slots) {
        const override = book.overrides[model.id]?.[slotDef.id];
        const favorite = book.favorites[slotDef.id] || null;
        const resolved = resolveSlot({
          slot: slotDef,
          people: party,
          favorite: favorite && favorite.cleared !== true ? favorite : null,
          override: override && override.cleared !== true ? override : null,
          products: shelf,
          quantity: quantities[slotDef.id],
        });
        if (!resolved.product?.id) {
          missing.push(slotDef.label);
          continue;
        }
        const stored = deps.productById(resolved.product.id) || resolved.product;
        if (deps.hasProduct(stored.id)) continue;
        deps.addProduct(stored, resolved.quantity, { quiet: true });
        added += 1;
        if (resolved.swapped) {
          swaps[stored.id] = { from: resolved.swapped.from, to: stored.catalogName || stored.name || resolved.swapped.to };
          swapped.push(slotDef.label);
        }
      }
      saveSwaps();
      if (!added && missing.length) deps.toast("Those items aren't on the shelf yet. Try browsing.");
      else if (missing.length) {
        const phrase = missing.length === 1 ? `${missing[0]} wasn't on the shelf` : `${missing.join(", ")} weren't on the shelf`;
        deps.toast(`Added ${model.title}. ${phrase}.`);
      }
      else if (swapped.length) deps.toast(`Added ${model.title}. A favorite changed — you'll see it on the plan.`);
      else if (added) deps.toast(`Added ${model.title}.`);
      else deps.toast(`${model.title} is already on your list.`);
      deps.haptic();
      if (view) closeDialog();
    } catch {
      deps.toast("Couldn't add that list. Try again.");
    }
  }

  function refreshMatches() {
    const host = document.getElementById("slot-matches");
    const model = view ? listModel(view.listId, book) : null;
    if (!host || !model) return;
    host.innerHTML = slotMatchHtml(view.finder || "", model, deps.escapeHtml);
  }

  function onInput(target) {
    if (!(target instanceof HTMLElement) || !view) return;
    if (target.id === "pick-query" && view.kind === "picker") {
      window.clearTimeout(searchTimer);
      const query = target.value;
      view.query = query;
      searchTimer = window.setTimeout(() => void runSearch(query), 200);
    }
    if (target.id === "list-rename" && view.kind === "list") {
      book = persist(renameList(book, view.listId, target.value, Date.now()));
      const title = document.getElementById("list-sheet-title");
      const model = listModel(view.listId, book);
      if (title && model) title.textContent = model.title;
      paintHome();
    }
    if (target.id === "slot-finder" && view.kind === "list") {
      view.finder = target.value;
      refreshMatches();
    }
  }

  function onClick(target) {
    if (!(target instanceof Element)) return false;
    const partyButton = target.closest("[data-party]");
    if (partyButton) {
      setParty(Number(partyButton.getAttribute("data-party")) || 0);
      deps.haptic();
      return true;
    }
    if (target.closest("[data-nudge-dismiss]")) {
      book = persist({ ...book, nudged: true });
      paintHome();
      return true;
    }
    if (target.closest("[data-my-new]")) {
      book = persist(createList(book, "My list"));
      const created = book.lists[book.lists.length - 1];
      paintHome();
      if (created) openList(created.id);
      return true;
    }
    const add = target.closest("[data-list-add], [data-sheet-add]");
    if (add) {
      const id = add.getAttribute("data-list-add") || add.getAttribute("data-sheet-add");
      void addList(id);
      return true;
    }
    const open = target.closest("[data-list-open], [data-my-open]");
    if (open) {
      openList(open.getAttribute("data-list-open") || open.getAttribute("data-my-open"));
      return true;
    }
    if (target.closest("[data-sheet-close]")) {
      closeDialog();
      paintHome();
      return true;
    }
    const dup = target.closest("[data-list-dup]");
    if (dup) {
      book = persist(duplicateThemed(book, dup.getAttribute("data-list-dup")));
      const created = book.lists[book.lists.length - 1];
      deps.toast("Saved a copy in My lists.");
      paintHome();
      if (created) openList(created.id);
      return true;
    }
    const inc = target.closest("[data-slot-inc]");
    if (inc) {
      changeQty(inc.getAttribute("data-slot-inc"), 1);
      return true;
    }
    const dec = target.closest("[data-slot-dec]");
    if (dec) {
      changeQty(dec.getAttribute("data-slot-dec"), -1);
      return true;
    }
    const change = target.closest("[data-slot-change]");
    if (change) {
      void openPicker(change.getAttribute("data-slot-change"));
      return true;
    }
    const move = target.closest("[data-slot-move]");
    if (move && view?.kind === "list") {
      book = persist(moveListSlot(book, view.listId, move.getAttribute("data-slot-move"), Number(move.getAttribute("data-slot-dir")), Date.now()));
      paintSheet();
      return true;
    }
    const remove = target.closest("[data-slot-remove]");
    if (remove && view?.kind === "list") {
      book = persist(removeListSlot(book, view.listId, remove.getAttribute("data-slot-remove"), Date.now()));
      paintSheet();
      paintHome();
      return true;
    }
    const known = target.closest("[data-add-known]");
    if (known && view?.kind === "list") {
      book = persist(addListSlot(book, view.listId, { slotId: known.getAttribute("data-add-known") }, Date.now()));
      view.finder = "";
      paintSheet();
      paintHome();
      return true;
    }
    const custom = target.closest("[data-add-custom]");
    if (custom && view?.kind === "list") {
      const label = custom.getAttribute("data-add-custom") || "Item";
      book = persist(
        addListSlot(
          book,
          view.listId,
          { slotId: newSlotId(), label, search: label, suggestedName: label },
          Date.now()
        )
      );
      view.finder = "";
      paintSheet();
      paintHome();
      return true;
    }
    const listMove = target.closest("[data-my-move-list]");
    if (listMove && view?.kind === "list") {
      book = persist(moveList(book, view.listId, Number(listMove.getAttribute("data-my-move-list")), Date.now()));
      paintSheet();
      paintHome();
      return true;
    }
    const deleteAsk = target.closest("[data-my-delete]");
    if (deleteAsk && view) {
      view.confirmDelete = true;
      paintSheet();
      return true;
    }
    const deleteYes = target.closest("[data-my-delete-yes]");
    if (deleteYes) {
      book = persist(deleteList(book, deleteYes.getAttribute("data-my-delete-yes"), Date.now()));
      closeDialog();
      paintHome();
      deps.toast("Deleted that list.");
      return true;
    }
    if (target.closest("[data-pick-back]") && view?.kind === "picker") {
      const listId = view.listId;
      const quantities = view.quantities;
      const touched = view.touched;
      view = { kind: "list", listId, quantities, touched, confirmDelete: false, finder: "" };
      paintSheet();
      return true;
    }
    const size = target.closest("[data-pick-size]");
    if (size && view?.kind === "picker") {
      const family = size.getAttribute("data-pick-family") || "";
      view.selected = { ...(view.selected || {}), [family]: size.getAttribute("data-pick-size") };
      const host = document.getElementById("pick-results");
      if (host) host.innerHTML = pickerResultsHtml(view.tiles || [], view.selected, deps.escapeHtml, deps.mediaUrl);
      return true;
    }
    const scope = target.closest("[data-pick-scope]");
    if (scope && view?.kind === "picker") {
      choose(scope.getAttribute("data-pick-scope"), scope.getAttribute("data-pick-family") || "");
      return true;
    }
    return false;
  }

  return {
    paint: paintHome,
    onClick,
    onInput,
    payload() {
      return book;
    },
    applyServer(serverBook) {
      applying = true;
      book = persist(mergeBooks(book, serverBook));
      applying = false;
      paintHome();
      if (view?.kind === "list") paintSheet();
    },
    annotate(item) {
      return annotateFavoriteSwap(item, swaps);
    },
  };
}
