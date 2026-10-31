/**
 * Fridge and pantry photos become grocery rows on the shopping list.
 * The picture is resized, read, and dropped. It is not a meal planner.
 */

import { parseNeedItems, resolveNeedList } from "./categoryPreference.js";
import { imageBlobs } from "./receiptImages.js";
import { mapPool } from "./receiptImport.js";
import { familyLabel } from "./stapleFamilies.js";

export const SHELF_LANES = 4;
export const SHELF_EMPTY = "We couldn't spot groceries in that photo, try a closer shot of one shelf";
export const SHELF_OFF = "Fridge and pantry scan needs photo reading, which isn't switched on.";
export const SHELF_PRIVACY = "Photos are read for groceries, then discarded. We don't save the picture.";
export const SHELF_TOO_LARGE = "That photo is too large to read. Try a closer shot of one shelf.";
export const SHELF_FORMAT = "That photo format didn't open. Take a new photo of one shelf.";

const RANK = { empty: 0, low: 1, half: 2, full: 3, unknown: 4 };
const FATAL = new Set(["unauthorized", "unconfigured"]);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function emptier(left, right) {
  if (!left || left === "unknown") return right || "unknown";
  if (!right || right === "unknown") return left;
  return (RANK[left] ?? 4) <= (RANK[right] ?? 4) ? left : right;
}

export function shelfProgressLabel(job) {
  const photo = Number(job?.photo) || 1;
  const photos = Number(job?.photos) || 1;
  const part = Number(job?.part) || 1;
  const parts = Number(job?.parts) || 1;
  if (parts > 1 && photos > 1) return `Reading photo ${photo} of ${photos}, part ${part} of ${parts}…`;
  if (parts > 1) return `Reading part ${part} of ${parts}…`;
  if (photos > 1) return `Reading photo ${photo} of ${photos}…`;
  return "Reading the shelf…";
}

export function defaultChoice(item) {
  if (item?.fullness === "low") return "low";
  if (item?.fullness === "empty") return "out";
  if (item?.fullness === "full" || item?.fullness === "half") return "enough";
  return "";
}

export function presentShelfItem(item) {
  const family = String(item?.family || "");
  const label = item?.label || familyLabel(family) || item?.name || "";
  const confidence = item?.confidence === "high" ? "high" : "low";
  const fullness = ["full", "half", "low", "empty", "unknown"].includes(item?.fullness) ? item.fullness : "unknown";
  const choice = item?.choice === undefined || item?.choice === null ? defaultChoice({ fullness }) : item.choice;
  return {
    name: label,
    family,
    label,
    confidence,
    fullness,
    unsure: confidence !== "high",
    choice,
    source: item?.source || "photo",
  };
}

export function mergeShelfItems(groups) {
  const seen = new Map();
  const list = Array.isArray(groups) ? groups.flat() : [];
  for (const raw of list) {
    if (!raw?.family) continue;
    const item = presentShelfItem({ ...raw, choice: undefined });
    const prev = seen.get(item.family);
    if (!prev) {
      seen.set(item.family, presentShelfItem(raw));
      continue;
    }
    const confidence = prev.confidence === "low" || item.confidence === "low" ? "low" : "high";
    const fullness = emptier(prev.fullness, item.fullness);
    seen.set(
      item.family,
      presentShelfItem({
        family: item.family,
        name: item.label,
        label: item.label,
        confidence,
        fullness,
        source: prev.source,
      })
    );
  }
  return [...seen.values()];
}

export function withChoice(rows, family, choice) {
  return (rows || []).map((row) => (row.family === family ? { ...row, choice } : row));
}

export function removeShelfItem(rows, family) {
  return (rows || []).filter((row) => row.family !== family);
}

export function addMissed(rows, text) {
  const parsed = parseNeedItems(text);
  const next = (rows || []).slice();
  const added = [];
  for (const item of parsed) {
    if (!item.family || next.some((row) => row.family === item.family)) continue;
    const row = presentShelfItem({
      name: familyLabel(item.family) || item.raw,
      family: item.family,
      label: familyLabel(item.family) || item.raw,
      confidence: "high",
      fullness: "unknown",
      choice: "out",
      source: "typed",
    });
    next.push(row);
    added.push(row);
  }
  return { rows: next, added, missed: parsed.filter((item) => !item.family).map((item) => item.raw) };
}

export function neededText(rows) {
  return (rows || [])
    .filter((row) => row.choice === "low" || row.choice === "out")
    .map((row) => row.label || row.name)
    .filter(Boolean)
    .join(", ");
}

/** Same preference, allergy, and diet rules as the ask box. */
export function applyShelfPreferences(input) {
  const text = neededText(input?.rows);
  if (!text) return { text: "", added: [], skipped: [], ask: [] };
  const result = resolveNeedList({
    profile: input?.profile,
    text,
    products: input?.products || [],
    storeName: input?.storeName,
  });
  return {
    text,
    added: result.added,
    skipped: result.skipped,
    ask: result.ask,
  };
}

function fullnessNote(fullness) {
  if (fullness === "full") return "Looks full";
  if (fullness === "half") return "Looks half";
  if (fullness === "low") return "Looks low";
  if (fullness === "empty") return "Looks empty";
  return "Fill not visible";
}

export function shelfHomeHtml() {
  return `<div class="shelf-home">
    <p>Take a photo of one shelf, or choose a few. This adds groceries to your list.</p>
    <p class="shelf-privacy">${escapeHtml(SHELF_PRIVACY)}</p>
    <button type="button" class="primary" id="shelf-camera-go">Take a photo</button>
    <button type="button" class="ghost" id="shelf-library-go">Choose photos</button>
  </div>`;
}

function choiceButton(row, value, label) {
  const pressed = row.choice === value ? "true" : "false";
  return `<button type="button" data-shelf-choice="${value}" aria-pressed="${pressed}">${label}</button>`;
}

export function shelfResultsHtml(rows) {
  const list = rows || [];
  const cards = list
    .map((row) => {
      const unsure = row.unsure ? `<span class="shelf-unsure">Not sure</span>` : "";
      return `<li class="shelf-row" data-shelf-family="${escapeHtml(row.family)}">
        <div class="shelf-row-name">
          <strong>${escapeHtml(row.label || row.name)}</strong>
          ${unsure}
          <span class="muted">${escapeHtml(fullnessNote(row.fullness))}</span>
        </div>
        <div class="shelf-choices" role="group" aria-label="${escapeHtml(row.label || row.name)}">
          ${choiceButton(row, "enough", "Have enough")}
          ${choiceButton(row, "low", "Running low")}
          ${choiceButton(row, "out", "Out")}
        </div>
        <button type="button" class="text-btn" data-shelf-remove="${escapeHtml(row.family)}">Remove</button>
      </li>`;
    })
    .join("");
  const ready = list.some((row) => row.choice === "low" || row.choice === "out");
  const empty = list.length ? "" : `<p>Nothing left from that photo. Add a staple below.</p>`;
  return `<div class="shelf-results">
    <p>Mark what you need to buy. Have enough stays off the list.</p>
    ${empty}
    <ul class="shelf-rows">${cards}</ul>
    <form id="shelf-add-form" class="shelf-add">
      <label>Add something the photo missed
        <input id="shelf-add" maxlength="80" placeholder="Yogurt, bread" autocomplete="off" enterkeyhint="done" />
      </label>
      <button type="submit" class="ghost" id="shelf-add-go">Add</button>
    </form>
    <p class="shelf-privacy">${escapeHtml(SHELF_PRIVACY)}</p>
    <button type="button" class="primary" id="shelf-accept" ${ready ? "" : "disabled"}>Add to my list</button>
  </div>`;
}

function deviceId() {
  const key = "gg-device";
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `gg-${Date.now()}`;
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return "gg-device";
  }
}

export async function readShelfPhotos(deps, files) {
  const list = [...(files || [])].filter(Boolean);
  const report = (message, ratio) => {
    if (message) deps.onProgress?.({ message, ratio });
  };
  if (!list.length) return { items: [], error: "Choose a photo first." };
  if (deps.photo === false) return { items: [], error: SHELF_OFF };
  report("Preparing…", 0.08);
  const prepare = deps.prepare || imageBlobs;
  const jobs = [];
  for (let index = 0; index < list.length; index += 1) {
    if (list.length > 1) report(`Preparing photo ${index + 1} of ${list.length}…`, 0.08 + (0.1 * index) / list.length);
    let blobs;
    try {
      blobs = await prepare(list[index]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/format|didn't open|heic|heif/i.test(message)) return { items: [], error: SHELF_FORMAT };
      return { items: [], error: message || SHELF_EMPTY };
    }
    const parts = blobs?.length ? blobs : [list[index]];
    parts.forEach((blob, part) => {
      jobs.push({ blob, photo: index + 1, photos: list.length, part: part + 1, parts: parts.length });
    });
  }
  let finished = 0;
  let fatal = null;
  let soft = null;
  const found = [];
  await mapPool(jobs, deps.lanes || SHELF_LANES, async (job) => {
    if (fatal) return;
    report(shelfProgressLabel(job), 0.2 + (0.7 * finished) / Math.max(1, jobs.length));
    try {
      if (job.blob?.size > 4_000_000) {
        const error = new Error(SHELF_TOO_LARGE);
        error.code = "too_large";
        throw error;
      }
      const payload = await deps.postPhoto(job.blob);
      if (Array.isArray(payload?.items)) found.push(...payload.items);
    } catch (error) {
      const code = String(error?.code || "");
      if (FATAL.has(code)) fatal = error;
      else if (!soft) soft = error;
    } finally {
      finished += 1;
      report(shelfProgressLabel(job), 0.2 + (0.7 * Math.min(finished, jobs.length)) / Math.max(1, jobs.length));
    }
  });
  if (fatal) return { items: [], error: fatal instanceof Error ? fatal.message : SHELF_OFF, note: "" };
  const items = mergeShelfItems(found);
  if (!items.length) {
    const message = soft instanceof Error ? soft.message : SHELF_EMPTY;
    return { items: [], error: message || SHELF_EMPTY, note: "" };
  }
  const note = soft instanceof Error && soft.message && soft.message !== SHELF_EMPTY ? soft.message : "";
  return { items, error: "", note };
}

/**
 * @param {{ apiUrl: Function, addNeeds: Function, toast?: Function }} deps
 */
export function mountShelfScan(deps) {
  const openButton = document.getElementById("shelf-scan");
  const offNote = document.getElementById("shelf-scan-off");
  if (!openButton || !deps || document.getElementById("shelf-dialog")) return;
  const apiUrl = deps.apiUrl || ((path) => path);
  const toast = deps.toast || (() => {});
  let photo = false;
  let rows = [];
  let busy = false;

  const dialog = document.createElement("dialog");
  dialog.id = "shelf-dialog";
  dialog.className = "sheet shelf-sheet";
  dialog.setAttribute("aria-labelledby", "shelf-title");
  dialog.innerHTML = `<div class="sheet-body">
      <div class="list-head">
        <h2 id="shelf-title" tabindex="-1">Scan fridge or pantry</h2>
        <button type="button" class="text-btn" id="shelf-close">Close</button>
      </div>
      <div id="shelf-home"></div>
      <div id="shelf-progress" class="read-progress" hidden>
        <div class="read-progress-row">
          <span class="spinner" aria-hidden="true"></span>
          <p id="shelf-status" class="status" role="status"></p>
        </div>
        <progress id="shelf-meter" max="1" value="0"></progress>
      </div>
      <div id="shelf-results" hidden></div>
      <input id="shelf-camera" type="file" accept="image/*" capture="environment" hidden />
      <input id="shelf-library" type="file" accept="image/*" multiple hidden />
    </div>`;
  document.body.appendChild(dialog);
  const home = dialog.querySelector("#shelf-home");
  const results = dialog.querySelector("#shelf-results");
  const progress = dialog.querySelector("#shelf-progress");
  const title = dialog.querySelector("#shelf-title");
  home.innerHTML = shelfHomeHtml();

  function paintEntry() {
    openButton.hidden = !photo;
    if (offNote) offNote.hidden = photo;
  }

  function show(which) {
    home.hidden = which !== "home";
    results.hidden = which !== "results";
    if (title) title.textContent = which === "results" ? "Here's what we found" : "Scan fridge or pantry";
  }

  function showProgress(message, ratio, isError) {
    progress.hidden = !message;
    progress.dataset.state = isError ? "error" : "reading";
    const status = dialog.querySelector("#shelf-status");
    const meter = dialog.querySelector("#shelf-meter");
    if (status) {
      status.textContent = message || "";
      status.setAttribute("role", isError ? "alert" : "status");
    }
    if (meter) meter.value = Math.max(0, Math.min(1, Number(ratio) || 0));
  }

  function paintResults(focusTitle) {
    results.innerHTML = shelfResultsHtml(rows);
    show("results");
    showProgress("", 1, false);
    if (focusTitle) title?.focus();
  }

  function syncChoice(family, choice) {
    rows = withChoice(rows, family, choice);
    const row = dialog.querySelector(`[data-shelf-family="${CSS.escape(family)}"]`);
    row?.querySelectorAll("[data-shelf-choice]").forEach((button) => {
      button.setAttribute("aria-pressed", button.getAttribute("data-shelf-choice") === choice ? "true" : "false");
    });
    const accept = dialog.querySelector("#shelf-accept");
    if (accept) accept.disabled = !neededText(rows);
  }

  async function postPhoto(blob) {
    const { fileToBase64 } = await import("./receiptImport.js");
    const response = await fetch(apiUrl("/api/import/shelf"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-device-id": deviceId() },
      body: JSON.stringify({ imageBase64: await fileToBase64(blob), mimeType: blob.type || "image/jpeg" }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || SHELF_EMPTY);
      error.code = payload.code || "";
      throw error;
    }
    return payload;
  }

  async function scan(fileList) {
    if (busy) return;
    const files = [...(fileList || [])].filter(Boolean);
    if (!files.length) return;
    busy = true;
    show("home");
    home.hidden = true;
    results.hidden = true;
    showProgress("Preparing…", 0.08, false);
    try {
      const result = await readShelfPhotos(
        {
          photo,
          postPhoto,
          onProgress: (event) => showProgress(event.message, event.ratio, false),
        },
        files
      );
      if (!result.items.length) {
        show("home");
        showProgress(result.error || SHELF_EMPTY, 0, true);
        return;
      }
      rows = result.items;
      paintResults(true);
      if (result.note) showProgress(result.note, 1, true);
    } catch (error) {
      show("home");
      showProgress(error instanceof Error ? error.message : SHELF_EMPTY, 0, true);
    } finally {
      busy = false;
    }
  }

  function open() {
    if (!photo) return;
    rows = [];
    show("home");
    showProgress("", 0, false);
    if (!dialog.open) dialog.showModal();
    title?.focus();
  }

  openButton.addEventListener("click", () => open());
  dialog.querySelector("#shelf-close")?.addEventListener("click", () => dialog.close());
  dialog.querySelector("#shelf-camera-go")?.addEventListener("click", () => dialog.querySelector("#shelf-camera")?.click());
  dialog.querySelector("#shelf-library-go")?.addEventListener("click", () => dialog.querySelector("#shelf-library")?.click());
  dialog.querySelector("#shelf-camera")?.addEventListener("change", (event) => {
    const input = event.target;
    const files = input.files ? [...input.files] : [];
    input.value = "";
    void scan(files);
  });
  dialog.querySelector("#shelf-library")?.addEventListener("change", (event) => {
    const input = event.target;
    const files = input.files ? [...input.files] : [];
    input.value = "";
    void scan(files);
  });

  dialog.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const choice = target.closest("[data-shelf-choice]");
    if (choice) {
      const row = choice.closest("[data-shelf-family]");
      const family = row?.getAttribute("data-shelf-family") || "";
      syncChoice(family, choice.getAttribute("data-shelf-choice"));
      return;
    }
    const remove = target.closest("[data-shelf-remove]");
    if (remove) {
      rows = removeShelfItem(rows, remove.getAttribute("data-shelf-remove"));
      paintResults(false);
      return;
    }
    if (target.closest("#shelf-accept")) {
      const text = neededText(rows);
      if (!text) {
        toast("Mark what is running low or out.");
        return;
      }
      dialog.close();
      void deps.addNeeds?.(text);
    }
  });

  dialog.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== "shelf-add-form") return;
    event.preventDefault();
    const input = dialog.querySelector("#shelf-add");
    const typed = input?.value || "";
    const next = addMissed(rows, typed);
    if (!next.added.length) {
      toast(next.missed.length ? "Try a staple, like yogurt or bread." : "That's already on this scan.");
      return;
    }
    rows = next.rows;
    paintResults(false);
    dialog.querySelector("#shelf-add")?.focus();
  });

  async function loadStatus() {
    try {
      const response = await fetch(apiUrl("/api/import/status"));
      if (response.ok) {
        const body = await response.json();
        photo = Boolean(body.shelf ?? body.photo);
      }
    } catch {
      photo = false;
    }
    paintEntry();
  }

  void loadStatus();
  return { open, reload: loadStatus };
}
