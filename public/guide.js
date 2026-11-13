/**
 * Gitter guide card. Rules live in guide-rules.js (from src/guide/rules.ts).
 * Receipt text is read only from a response the app already requested.
 * The ask endpoint is never called from here.
 */

import {
  DISMISS_LABEL,
  GUIDE_DWELL_MS,
  GUIDE_KEY,
  GUIDE_LABEL,
  GUIDE_QUIET_MS,
  holdVisiblePrompt,
  REPLIES_LABEL,
  TURN_OFF_LABEL,
  clearTripNote,
  createGuideSession,
  dismissGuide,
  importReceiptUrl,
  receiptLinesFromImportBody,
  namesMatch,
  noteDeclined,
  noteReceipt as rememberReceipt,
  noteShown,
  noteTrip as rememberTrip,
  presentGuide,
  revealReceiptPicks,
  readGuideSettings,
  setGuideEnabled,
  typeFrames,
  writeGuideSettings,
} from "./guide-rules.js";

const QUIET_MOMENTS = new Set(["welcome", "keep-building", "before-review", "running-low"]);

function promptIdentity(prompt) {
  return `${prompt?.moment || ""}\n${prompt?.line || ""}`;
}

/**
 * One card is on screen. A quiet prompt replaces another quiet prompt.
 * A second task prompt waits until the card that is up is dismissed.
 * Welcome and the other quiet prompts are dropped while a task dialog is open.
 */
export function resolveQueuedPrompt(queue, visible, incoming, options = {}) {
  const pending = Array.isArray(queue) ? queue.slice() : [];
  if (!incoming?.moment) return { queue: pending, show: null };
  if (options.midTask && QUIET_MOMENTS.has(incoming.moment)) return { queue: pending, show: null };
  const dropIncoming = (rows) => rows.filter((row) => promptIdentity(row) !== promptIdentity(incoming));
  if (!visible?.moment || visible.moment === incoming.moment || QUIET_MOMENTS.has(visible.moment)) {
    return { queue: dropIncoming(pending), show: incoming };
  }
  if (!pending.some((row) => promptIdentity(row) === promptIdentity(incoming))) pending.push(incoming);
  return { queue: pending, show: null };
}

export function dequeuePrompt(queue) {
  const pending = Array.isArray(queue) ? queue.slice() : [];
  const show = pending.shift() || null;
  return { queue: pending, show };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function guideSettingsHtml(on) {
  return `<label class="guide-setting"><input type="checkbox" id="settings-guide"${on ? " checked" : ""} /> <span>Gitter guide</span></label><p id="settings-guide-note" class="muted">Short prompts while you shop. You can turn this off.</p>`;
}

export function guideChipHtml(chip) {
  const name = chip?.name ? ` data-guide-name="${escapeHtml(chip.name)}"` : "";
  const names = Array.isArray(chip?.names) && chip.names.length ? ` data-guide-names="${escapeHtml(chip.names.join("\n"))}"` : "";
  const url = chip?.url ? ` data-guide-url="${escapeHtml(chip.url)}"` : "";
  return `<button type="button" class="gitter-guide-chip" data-guide-action="${escapeHtml(chip?.action || "")}" data-guide-id="${escapeHtml(chip?.id || "")}"${name}${names}${url}>${escapeHtml(chip?.label || "")}</button>`;
}

export function guideCardHtml(prompt) {
  const chips = (prompt?.chips || []).map((chip) => guideChipHtml(chip)).join("");
  return `<aside class="gitter-guide" role="region" aria-label="${escapeHtml(GUIDE_LABEL)}">
    <div class="gitter-guide-avatar" aria-hidden="true">G</div>
    <div class="gitter-guide-copy">
      <p class="gitter-guide-kicker" aria-hidden="true">Gitter</p>
      <p class="gitter-guide-line" aria-hidden="true">${escapeHtml(prompt?.line || "")}</p>
      <p class="gitter-guide-live sr-only" aria-live="polite">${escapeHtml(prompt?.line || "")}</p>
      <div class="gitter-guide-chips" role="group" aria-label="${escapeHtml(REPLIES_LABEL)}">${chips}</div>
      <button type="button" class="gitter-guide-off" data-guide-off="1" aria-label="${escapeHtml(TURN_OFF_LABEL)}">Turn off</button>
    </div>
    <button type="button" class="gitter-guide-dismiss" data-guide-dismiss="1" aria-label="${escapeHtml(DISMISS_LABEL)}">×</button>
  </aside>`;
}

function reducedMotion(win) {
  try {
    return win?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  } catch {
    return false;
  }
}

function installReceiptWatch(win, note) {
  if (!win || win.__gitterGuideFetch || typeof win.fetch !== "function") return;
  const original = win.fetch.bind(win);
  win.__gitterGuideFetch = true;
  win.fetch = async function gitterGuideFetch(input, init) {
    const response = await original(input, init);
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url || "";
      if (!importReceiptUrl(String(url)) || !response?.ok || typeof response.clone !== "function") return response;
      const copy = response.clone();
      const type = copy.headers?.get?.("content-type") || "";
      const body = await copy.text();
      const lines = receiptLinesFromImportBody(type, body);
      const teaching = Boolean(win.document?.getElementById("profile-onboard")?.open);
      if (lines.length) note(teaching ? { lines, prompt: false } : { lines });
    } catch {
      /* the original response is unchanged */
    }
    return response;
  };
}

/**
 * @param {{
 *   storage?: Storage,
 *   document?: Document,
 *   getState?: () => object,
 *   onAction?: (action: string, detail: object) => void,
 * }} [deps]
 */
export function mountGuide(deps = {}) {
  const doc = deps.document || (typeof document !== "undefined" ? document : null);
  if (!doc?.body) return null;
  if (doc.getElementById("gitter-guide")) return doc.__gitterGuide || null;
  const storage = deps.storage || (typeof localStorage !== "undefined" ? localStorage : null);
  const win = doc.defaultView || (typeof window !== "undefined" ? window : null);
  let settings = readGuideSettings(storage);
  let session = createGuideSession();
  let current = null;
  let holding = 0;
  let quietUntil = 0;
  let typeTimer = 0;
  let promptShownAt = 0;

  const host = doc.createElement("aside");
  host.id = "gitter-guide";
  host.className = "gitter-guide";
  host.hidden = true;
  host.setAttribute("role", "region");
  host.setAttribute("aria-label", GUIDE_LABEL);
  host.innerHTML = `<div class="gitter-guide-avatar" aria-hidden="true">G</div>
    <div class="gitter-guide-copy">
      <p class="gitter-guide-kicker" aria-hidden="true">Gitter</p>
      <p class="gitter-guide-line" aria-hidden="true"></p>
      <p class="gitter-guide-live sr-only" aria-live="polite"></p>
      <div class="gitter-guide-chips" role="group" aria-label="${escapeHtml(REPLIES_LABEL)}"></div>
      <button type="button" class="gitter-guide-off" data-guide-off="1" aria-label="${escapeHtml(TURN_OFF_LABEL)}">Turn off</button>
    </div>
    <button type="button" class="gitter-guide-dismiss" data-guide-dismiss="1" aria-label="${escapeHtml(DISMISS_LABEL)}">×</button>`;
  doc.body.appendChild(host);
  const receiptDialog = doc.createElement("dialog");
  receiptDialog.id = "gitter-receipt-sheet";
  receiptDialog.className = "gitter-receipt-sheet";
  receiptDialog.setAttribute("aria-label", "Items from past receipts");
  doc.body.appendChild(receiptDialog);

  const lineEl = host.querySelector(".gitter-guide-line");
  const liveEl = host.querySelector(".gitter-guide-live");
  const chipsEl = host.querySelector(".gitter-guide-chips");

  const settingsHost = doc.querySelector("#settings-dialog .settings-list");
  if (settingsHost && !doc.getElementById("settings-guide")) {
    const block = doc.createElement("div");
    block.className = "guide-setting-block";
    block.innerHTML = guideSettingsHtml(settings.enabled !== false);
    settingsHost.insertBefore(block, settingsHost.firstChild);
  }

  function closeReceiptSheet() {
    if (receiptDialog.open) receiptDialog.close();
    const importDialog = doc.getElementById("import-dialog");
    if (importDialog instanceof HTMLElement) importDialog.inert = false;
  }

  function guideRoot(node) {
    return node?.closest?.("#gitter-guide, #gitter-receipt-sheet") || null;
  }

  function persist(next) {
    settings = next;
    writeGuideSettings(storage, settings);
    const box = doc.getElementById("settings-guide");
    if (box) box.checked = settings.enabled !== false;
  }

  function lockPage(on) {
    const shell = doc.querySelector(".shell");
    if (shell instanceof HTMLElement) {
      if (on) shell.setAttribute("inert", "");
      else shell.removeAttribute("inert");
    }
  }

  const promptQueue = [];
  const quietMoments = QUIET_MOMENTS;

  function taskDialogOpen() {
    const profile = doc.getElementById("profile-onboard");
    const importer = doc.getElementById("import-dialog");
    return Boolean(profile?.open || importer?.open);
  }

  function hidePrompt(showNext) {
    host.hidden = true;
    host.removeAttribute("data-moment");
    host.removeAttribute("data-guide-line");
    host.removeAttribute("data-chips");
    host.setAttribute("role", "region");
    host.removeAttribute("aria-modal");
    if (chipsEl) chipsEl.replaceChildren();
    if (lineEl) lineEl.textContent = "";
    if (liveEl) liveEl.textContent = "";
    const dismiss = host.querySelector("[data-guide-dismiss]");
    if (dismiss) {
      dismiss.textContent = "×";
      dismiss.setAttribute("aria-label", DISMISS_LABEL);
    }
    lockPage(false);
    if (!showNext) {
      promptQueue.length = 0;
      return;
    }
    const decision = dequeuePrompt(promptQueue);
    promptQueue.length = 0;
    promptQueue.push(...decision.queue);
    if (decision.show) paint(decision.show);
  }

  function paint(prompt) {
    if (!prompt) {
      host.hidden = true;
      host.removeAttribute("data-moment");
      return;
    }
    const receiptOpen = receiptDialog?.open;
    const midTask = taskDialogOpen() || receiptOpen || Boolean(doc.querySelector("dialog[open]:not(#gitter-receipt-sheet)"));
    const visible = host.hidden ? null : { moment: host.dataset.moment || "", line: host.dataset.guideLine || "" };
    const decision = resolveQueuedPrompt(promptQueue, visible, prompt, { midTask: midTask || receiptOpen });
    promptQueue.length = 0;
    promptQueue.push(...decision.queue);
    if (!decision.show) {
      if ((midTask || receiptOpen) && !host.hidden && quietMoments.has(host.dataset.moment || "")) host.hidden = true;
      return;
    }
    prompt = decision.show;
    if (receiptOpen && prompt.moment !== "receipt") {
      host.hidden = true;
      return;
    }
    const chipKey = (prompt.chips || []).map((chip) => `${chip.id}:${chip.label}`).join("|");
    const same = host.dataset.moment === prompt.moment && host.dataset.chips === chipKey && !host.hidden;
    const pressed = same
      ? null
      : new Set(
          [...host.querySelectorAll("[aria-pressed='true']")].map((button) => button.getAttribute("data-guide-name") || "").filter(Boolean)
        );
    host.hidden = false;
    host.dataset.moment = prompt.moment;
    host.dataset.guideLine = prompt.line || "";
    host.dataset.singleDismiss = prompt.moment === "review-next" ? "" : (prompt.chips || []).some((chip) => chip?.id === "no") ? "1" : "";
    const kicker = host.querySelector(".gitter-guide-kicker");
    if (kicker) kicker.textContent = prompt.moment === "review-next" ? "Needs a look" : "Gitter";
    host.dataset.chips = chipKey;
    if (chipsEl && !same) {
      chipsEl.innerHTML = (prompt.chips || []).map((chip) => guideChipHtml(chip)).join("");
      if (pressed?.size) {
        for (const button of chipsEl.querySelectorAll("[data-guide-name]")) {
          if (pressed.has(button.getAttribute("data-guide-name") || "")) button.setAttribute("aria-pressed", "true");
        }
      }
    }
    if (liveEl && !same) liveEl.textContent = prompt.line || "";
    if (!same) typeLine(prompt.line || "");
    const dismiss = host.querySelector("[data-guide-dismiss]");
    const receipt = prompt.moment === "receipt";
    lockPage(false);
    if (receipt) {
      host.setAttribute("role", "dialog");
      host.setAttribute("aria-modal", "true");
      if (dismiss) {
        dismiss.textContent = "Skip";
        dismiss.setAttribute("aria-label", "Skip");
      }
      const first = host.querySelector("button");
      if (first instanceof HTMLElement) first.focus();
    } else {
      host.setAttribute("role", "region");
      host.removeAttribute("aria-modal");
      if (dismiss) {
        dismiss.textContent = "×";
        dismiss.setAttribute("aria-label", DISMISS_LABEL);
      }
    }
  }

  function typeLine(line) {
    if (win) win.clearInterval(typeTimer);
    if (!lineEl) return;
    const frames = typeFrames(line, reducedMotion(win));
    if (frames.length < 2) {
      lineEl.textContent = line;
      return;
    }
    let index = 0;
    lineEl.textContent = frames[0];
    if (!win) {
      lineEl.textContent = line;
      return;
    }
    typeTimer = win.setInterval(() => {
      index += 1;
      if (!lineEl || index >= frames.length) {
        win.clearInterval(typeTimer);
        if (lineEl) lineEl.textContent = line;
        return;
      }
      lineEl.textContent = frames[index];
    }, 18);
  }

  function fieldFocused() {
    const active = doc.activeElement;
    if (!active || active === doc.body) return false;
    const tag = active.tagName;
    if (tag === "TEXTAREA") return true;
    if (tag === "INPUT") {
      const type = String(active.getAttribute("type") || "text").toLowerCase();
      return type !== "checkbox" && type !== "radio" && type !== "button";
    }
    return Boolean(active.isContentEditable);
  }

  function dialogOpen() {
    return Boolean(doc.querySelector("dialog[open]"));
  }

  function sync() {
    try {
      const now = Date.now();
      const result = presentGuide({
        settings,
        session,
        view: deps.getState?.() || {},
        current,
        holding: holding > 0 || now < quietUntil,
        dialogOpen: dialogOpen(),
        fieldFocused: fieldFocused(),
      });
      if (!result.defer && holdVisiblePrompt(current, result.current, promptShownAt, now)) {
        if (win) win.setTimeout(() => sync(), Math.max(50, GUIDE_DWELL_MS - (now - promptShownAt)));
        return;
      }
      const previousMoment = current?.moment || "";
      session = result.session;
      current = result.current;
      if (result.current && result.current.moment !== previousMoment) promptShownAt = now;
      if (result.defer && !result.hidden) {
        if (!current) hidePrompt(false);
        return;
      }
      if (result.hidden || !result.current) {
        hidePrompt(false);
        return;
      }
      paint(result.current);
    } catch {
      /* a guide miss must not block the list */
    }
  }

  function finishQuiet() {
    quietUntil = Date.now() + GUIDE_QUIET_MS;
    if (!win) return;
    win.setTimeout(() => {
      if (holding === 0 && Date.now() >= quietUntil) sync();
    }, GUIDE_QUIET_MS + 20);
  }

  host.addEventListener("keydown", (event) => {
    if (host.hidden || host.dataset.moment !== "receipt" || event.key !== "Tab") return;
    const items = [...host.querySelectorAll("button")].filter((button) => button instanceof HTMLButtonElement && !button.disabled);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && doc.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && doc.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  function dismissOpenPrompt(event) {
    const raw = event?.target;
    const element = raw instanceof Element ? raw : raw instanceof Node ? raw.parentElement : null;
    if (element && !element.closest("[data-guide-dismiss]")) return;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const moment = current?.moment || host.dataset.moment || "";
    if (moment) session = noteDeclined(session, moment);
    current = null;
    closeReceiptSheet();
    if (moment !== "receipt") persist(dismissGuide(settings));
    hidePrompt(true);
  }
  host.addEventListener("pointerup", (event) => {
    const raw = event.target;
    const element = raw instanceof Element ? raw : raw instanceof Node ? raw.parentElement : null;
    if (element?.closest("[data-guide-dismiss]")) dismissOpenPrompt(event);
  });
  host.addEventListener("click", onGuideClick);
  receiptDialog.addEventListener("click", onGuideClick);
  receiptDialog.addEventListener("pointerup", (event) => {
    const raw = event.target;
    const element = raw instanceof Element ? raw : raw instanceof Node ? raw.parentElement : null;
    if (element?.closest("[data-guide-dismiss]")) dismissOpenPrompt(event);
  });

  function onGuideClick(event) {
    const raw = event.target;
    const element = raw instanceof Element ? raw : raw instanceof Node ? raw.parentElement : null;
    const button = element?.closest("button") || null;
    const root = guideRoot(button);
    if (!button || !root) return;
    event.guideHandled = true;
    event.stopPropagation();
    if (button.hasAttribute("data-guide-dismiss")) {
      dismissOpenPrompt(event);
      return;
    }
    if (button.hasAttribute("data-guide-off")) {
      persist(setGuideEnabled(settings, false));
      current = null;
      host.hidden = true;
      deps.onQuiet?.();
      return;
    }
    const action = button.getAttribute("data-guide-action");
    if (!action) return;
    if (action === "show-rest") {
      session = revealReceiptPicks(session);
      current = null;
      sync();
      return;
    }
    if (action === "toggle-pick") {
      const on = button.getAttribute("aria-pressed") === "true";
      button.setAttribute("aria-pressed", on ? "false" : "true");
      return;
    }
    if (action === "commit-picks") {
      const names = [...root.querySelectorAll("[data-guide-action='toggle-pick'][aria-pressed='true']")]
        .map((chip) => chip.getAttribute("data-guide-name") || "")
        .map((name) => name.trim())
        .filter(Boolean);
    if (!names.length) return;
      const moment = current?.moment || host.dataset.moment || "";
      if (moment) session = noteShown(session, moment);
      current = null;
      closeReceiptSheet();
      host.hidden = true;
      deps.onAction?.("commit-picks", { names, moment });
      return;
    }
    const names = String(button.getAttribute("data-guide-names") || "")
      .split("\n")
      .map((name) => name.trim())
      .filter(Boolean);
    const detail = {
      id: button.getAttribute("data-guide-id") || "",
      name: button.getAttribute("data-guide-name") || "",
      names,
      url: button.getAttribute("data-guide-url") || "",
      label: button.textContent || "",
      moment: current?.moment || host.dataset.moment || "",
    };
    if (action === "later") {
      session = noteDeclined(session, detail.moment);
      current = null;
      closeReceiptSheet();
      host.hidden = true;
      deps.onAction?.(action, detail);
      return;
    }
    if (action === "save-list") {
      session = noteDeclined(session, detail.moment || "trip-saved");
      current = null;
      host.hidden = true;
      deps.onAction?.(action, detail);
      return;
    }
    if (action === "close-guide") {
      session = noteShown(session, detail.moment || "keep-building");
      current = null;
      host.hidden = true;
      return;
    }
    current = null;
    host.hidden = true;
    deps.onAction?.(action, detail);
  }

  doc.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || target.id !== "settings-guide") return;
    persist(setGuideEnabled(settings, target.checked));
    if (!target.checked) {
      current = null;
      host.hidden = true;
      return;
    }
    sync();
  });

  doc.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target;
      if (target instanceof Node && host.contains(target)) return;
      holding += 1;
    },
    true
  );
  doc.addEventListener(
    "pointerup",
    () => {
      holding = Math.max(0, holding - 1);
      finishQuiet();
    },
    true
  );
  doc.addEventListener(
    "pointercancel",
    () => {
      holding = Math.max(0, holding - 1);
      finishQuiet();
    },
    true
  );
  doc.addEventListener(
    "close",
    (event) => {
      if (event.target && event.target.tagName === "DIALOG") sync();
    },
    true
  );
  doc.addEventListener("focusout", () => {
    if (!win) return;
    win.setTimeout(() => sync(), 0);
  });
  if (typeof MutationObserver === "function") {
    const dialogs = new MutationObserver(() => sync());
    dialogs.observe(doc.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
  }

  function openOverImport() {
    const importDialog = doc.getElementById("import-dialog");
    if (!(importDialog instanceof HTMLDialogElement) || !importDialog.open) return false;
    const result = presentGuide({
      settings,
      session,
      view: deps.getState?.() || {},
      current: null,
      holding: false,
      dialogOpen: false,
      fieldFocused: false,
    });
    if (result.current?.moment !== "receipt") return false;
    session = result.session;
    current = result.current;
    paint(result.current);
    receiptDialog.replaceChildren();
    for (const node of [...host.childNodes]) receiptDialog.appendChild(node.cloneNode(true));
    receiptDialog.querySelector("[data-guide-dismiss]")?.addEventListener("click", dismissOpenPrompt);
    if (!receiptDialog.open) receiptDialog.showModal();
    host.hidden = true;
    importDialog.inert = true;
    const first = receiptDialog.querySelector("[data-guide-name], button");
    if (first instanceof HTMLElement) first.focus();
    return true;
  }
  receiptDialog.addEventListener("close", () => {
    const importDialog = doc.getElementById("import-dialog");
    if (importDialog instanceof HTMLElement) importDialog.inert = false;
    if (current?.moment === "receipt") {
      session = noteDeclined(session, "receipt");
      current = null;
      hidePrompt(true);
    }
  });

  installReceiptWatch(win, (payload) => {
    const pressed = host.querySelector("[data-guide-action='toggle-pick'][aria-pressed='true']");
    if (pressed && host.dataset.moment === "receipt") return;
    session = rememberReceipt(session, payload);
    sync();
  });

  const api = {
    sync,
    noteReceipt(payload) {
      session = rememberReceipt(session, payload);
      sync();
    },
    holdAfterReturn() {
      for (const moment of ["receipt", "running-low", "before-review", "keep-building"]) {
        session = noteShown(session, moment);
      }
      current = null;
      host.hidden = true;
    },
    holdAfterImport() {
      for (const moment of ["before-review", "running-low"]) {
        session = noteShown(session, moment);
      }
      if (current?.moment === "before-review" || current?.moment === "running-low") {
        current = null;
        host.hidden = true;
      }
    },
    noteTrip(saved) {
      session = rememberTrip(session, saved);
      sync();
    },
    clearTrip() {
      session = clearTripNote(session);
      if (current?.moment === "trip-saved") {
        current = null;
        host.hidden = true;
      }
    },
    readSettings() {
      return settings;
    },
    openOverImport,
  };
  doc.__gitterGuide = api;
  sync();
  return api;
}

export { GUIDE_KEY, namesMatch };
