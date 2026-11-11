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

  function persist(next) {
    settings = next;
    writeGuideSettings(storage, settings);
    const box = doc.getElementById("settings-guide");
    if (box) box.checked = settings.enabled !== false;
  }

  function hidePrompt() {
    host.hidden = true;
    host.removeAttribute("data-moment");
    host.removeAttribute("data-chips");
    if (chipsEl) chipsEl.replaceChildren();
    if (lineEl) lineEl.textContent = "";
    if (liveEl) liveEl.textContent = "";
  }

  function paint(prompt) {
    if (!prompt) {
      host.hidden = true;
      host.removeAttribute("data-moment");
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
        if (!current) hidePrompt();
        return;
      }
      if (result.hidden || !result.current) {
        hidePrompt();
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

  host.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (!button || !host.contains(button)) return;
    event.stopPropagation();
    if (button.hasAttribute("data-guide-dismiss")) {
      persist(dismissGuide(settings));
      current = null;
      host.hidden = true;
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
      const names = [...host.querySelectorAll("[data-guide-action='toggle-pick'][aria-pressed='true']")]
        .map((chip) => chip.getAttribute("data-guide-name") || "")
        .map((name) => name.trim())
        .filter(Boolean);
      if (!names.length) return;
      const moment = current?.moment || host.dataset.moment || "";
      if (moment) session = noteShown(session, moment);
      current = null;
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
  });

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
  };
  doc.__gitterGuide = api;
  sync();
  return api;
}

export { GUIDE_KEY, namesMatch };
