/**
 * Beta tester tools: invite gate, feedback sheet, client error toast, and
 * privacy-friendly product counters. The shopper page loads this module.
 * With no document (unit tests) it only exports helpers.
 */

import { SESSION_KEY } from "./account.js";
import {
  INVITE_KEY,
  clearInvite,
  clip,
  feedbackBody,
  feedbackContext,
  readInvite,
  rememberInvite,
} from "./betaContext.js";

const CLIENT_EVENTS = [
  "onboarding_completed",
  "receipt_imported",
  "plan_built",
  "kroger_cart_sent",
  "walmart_opened",
  "trip_completed",
];

const ERROR_LIMIT = 5;
const ERROR_WINDOW_MS = 60_000;

export function errorToastModel() {
  return {
    text: "Something went wrong",
    actions: ["Retry", "Send feedback"],
  };
}

export function errorMessage(reason) {
  if (reason instanceof Error) return clip(reason.message, 500);
  return clip(reason, 500);
}

export function shouldReportError(message) {
  if (!message) return false;
  if (/ResizeObserver loop/i.test(message)) return false;
  return true;
}

/**
 * window.onerror and unhandledrejection both call this.
 * Sentry capture runs only when the loader installed a client.
 */
export function reportClientFailure(reason, deps) {
  const message = errorMessage(reason);
  if (!shouldReportError(message)) return { reported: false, toast: false };
  const state = deps.state;
  const now = typeof deps.now === "function" ? deps.now() : Date.now();
  state.hits = (state.hits || []).filter((stamp) => now - stamp < ERROR_WINDOW_MS);
  const seenAt = state.seen?.has(message) ? state.seen.get(message) : null;
  const throttled = state.hits.length >= ERROR_LIMIT || (seenAt != null && now - seenAt < 10_000);
  if (!throttled) {
    state.hits.push(now);
    state.seen.set(message, now);
    const error = reason instanceof Error ? reason : new Error(message);
    if (typeof deps.capture === "function") {
      try {
        deps.capture(error);
      } catch {
        /* reporting must not create a second error */
      }
    }
    if (typeof deps.fetch === "function") {
      const payload = {
        message,
        stack: clip(error.stack || "", 4000),
        screen: clip(deps.screen || "", 80),
        tab: clip(deps.tab || "", 40),
        deviceId: deps.deviceId || "",
      };
      void Promise.resolve(deps.fetch(deps.url || "/api/beta/client-errors", payload)).catch(() => {});
    }
  }
  const toast = !state.toastOpen;
  if (toast) {
    state.toastOpen = true;
    deps.showToast?.(errorToastModel());
  }
  return { reported: !throttled, toast, throttled };
}

export function installClientErrors(root, deps) {
  if (!root) return;
  const previous = root.onerror;
  root.onerror = function onBetaError(message, source, lineno, colno, error) {
    if (source && typeof source !== "string" && source !== root) return false;
    reportClientFailure(error || message, deps);
    if (typeof previous === "function") return previous.call(root, message, source, lineno, colno, error);
    return false;
  };
  root.addEventListener?.("unhandledrejection", (event) => {
    reportClientFailure(event?.reason, deps);
  });
}

export function inviteScreenHtml() {
  return `<dialog id="beta-gate" class="beta-gate">
    <form id="beta-gate-form" class="beta-gate-card" method="post" action="#">
      <h1>Enter your invite code</h1>
      <p>Grocery Gitter is in a private beta. The code is how Brandon knows which group you joined.</p>
      <label>Invite code <input id="beta-code" name="code" autocomplete="off" autocapitalize="off" spellcheck="false" required /></label>
      <div class="beta-actions"><button type="submit" class="primary">Continue</button></div>
      <p id="beta-gate-error" class="status" role="alert" hidden></p>
      <p class="beta-legal"><a href="/privacy">Privacy</a><a href="/terms">Terms</a></p>
    </form>
  </dialog>`;
}

/** A stored code is not valid until this load's check says so. Network failure stays on the screen. */
export async function resolveInviteGate({ remembered, postInvite, fetchGate, clearCode }) {
  if (remembered) {
    try {
      const { response, body } = await postInvite(remembered);
      const payload = body || {};
      if (response?.ok && payload.ok && payload.required === false) {
        clearCode?.();
        return { show: false, reason: "open" };
      }
      if (response?.ok && payload.ok) return { show: false, reason: "valid" };
      if (response?.status === 401) {
        clearCode?.();
        return { show: true, reason: "invalid" };
      }
      if (response?.status === 429) return { show: true, reason: "limited" };
      // A saved code is not known to be revoked when the recheck cannot connect.
      return { show: false, reason: "unchecked" };
    } catch {
      return { show: false, reason: "offline" };
    }
  }
  try {
    const { response, body } = await fetchGate();
    if (response?.ok && body?.required === false) return { show: false, reason: "open" };
    return { show: true, reason: "required" };
  } catch {
    return { show: true, reason: "offline" };
  }
}

export function isShopperApi(url, root) {
  let parsed;
  try {
    parsed = new URL(url, root?.location?.href || "http://localhost/");
  } catch {
    return false;
  }
  if (!parsed.pathname.startsWith("/api/")) return false;
  const pageOrigin = root?.location?.origin || "";
  if (pageOrigin && parsed.origin === pageOrigin) return true;
  const native = root?.GroceryGitterNative;
  const nativePlatform = root?.Capacitor?.isNativePlatform?.() === true;
  const resolved =
    native?.resolveApiOrigin?.({
      native: nativePlatform,
      location: root?.location,
      configured: root?.GROCERY_GITTER_API_ORIGIN,
    }) || "";
  if (!resolved) return false;
  try {
    return parsed.origin === new URL(resolved, pageOrigin || undefined).origin;
  } catch {
    return false;
  }
}

export function fetchInitWithDevice(input, init = {}, deviceId) {
  const headers = new Headers();
  if (typeof Request !== "undefined" && input instanceof Request) {
    input.headers.forEach((value, key) => headers.set(key, value));
  }
  new Headers(init.headers || {}).forEach((value, key) => headers.set(key, value));
  if (deviceId) headers.set("x-device-id", deviceId);
  return { ...init, headers };
}

export function dialogAllowedDuringGate(id, gated) {
  return !gated || id === "beta-gate";
}

export const FEEDBACK_SHOT_MAX = 1_200_000;
export const FEEDBACK_SHOT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export function feedbackShotError(file) {
  if (!file) return "";
  const type = String(file.type || "").toLowerCase();
  if (!FEEDBACK_SHOT_TYPES.includes(type)) return "Use a JPEG, PNG, WebP, or GIF.";
  if (Number(file.size) > FEEDBACK_SHOT_MAX) return "That screenshot is over 1.2 MB. Use a smaller image.";
  return "";
}

export function feedbackScreenshotNote(files) {
  const list = [...(files || [])];
  if (!list.length) return "";
  const problem = list.map(feedbackShotError).find(Boolean);
  if (problem) return problem;
  const names = list.map((file) => String(file?.name || "").trim()).filter(Boolean).slice(0, 3);
  return `${names.length === 1 ? "1 screenshot" : `${names.length} screenshots`} will be sent with this note: ${names.join(", ")}.`;
}

export async function readFeedbackShots(files) {
  const list = [...(files || [])].slice(0, 3);
  const shots = [];
  for (const file of list) {
    const error = feedbackShotError(file);
    if (error) return { ok: false, error };
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    shots.push({
      name: String(file.name || "screenshot").slice(0, 80),
      mimeType: String(file.type || "").toLowerCase(),
      data: btoa(binary),
    });
  }
  return { ok: true, shots };
}

export function feedbackSheetHtml() {
  return `<dialog id="beta-feedback" class="sheet beta-feedback" aria-labelledby="beta-feedback-title">
    <form id="beta-feedback-form" class="sheet-body">
      <div class="list-head">
        <h2 id="beta-feedback-title" tabindex="-1">Send feedback</h2>
        <button type="button" class="text-btn" id="beta-feedback-close">Close</button>
      </div>
      <fieldset class="beta-ratings">
        <legend class="sr-only">Rating from 1 to 5</legend>
        ${[1, 2, 3, 4, 5].map((score) => `<label class="beta-rating">${score}<input type="radio" name="rating" value="${score}" required /></label>`).join("")}
      </fieldset>
      <label>What should we know?
        <textarea id="beta-feedback-text" name="message" maxlength="2000" placeholder="A short note is enough."></textarea>
      </label>
      <p class="beta-note">Don't include receipts, passwords, or card numbers.</p>
      <label>What screen were you on? <span class="muted">(optional)</span>
        <input id="beta-feedback-screen" name="screen" type="text" maxlength="80" placeholder="Review, Add, In-store…" />
      </label>
      <label>Video link <span class="muted">(optional)</span>
        <input id="beta-feedback-video" name="video" type="url" inputmode="url" maxlength="300" placeholder="https://" />
      </label>
      <label>Screenshots <span class="muted">(optional)</span>
        <input id="beta-feedback-shots" name="shots" type="file" accept="image/*" multiple />
      </label>
      <p id="beta-feedback-shots-note" class="beta-note" hidden></p>
      <div id="beta-feedback-shots-preview" class="beta-shot-preview"></div>
      <p class="beta-note">Up to 3 images, 1.2 MB each. They are stored with this note so they can be reviewed. Don't include receipts, passwords, or card numbers.</p>
      <div class="beta-actions">
        <button type="submit" class="primary">Send</button>
      </div>
      <p id="beta-feedback-status" class="status" role="status" hidden></p>
    </form>
  </dialog>`;
}

function memoryStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function deviceId(storage) {
  const key = "gg-device";
  let id = "";
  try {
    id = storage?.getItem(key) || "";
  } catch {
    id = "";
  }
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) {
    id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `gg-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    try {
      storage?.setItem(key, id);
    } catch {
      /* the request still sends the id for this page */
    }
  }
  return id;
}

function apiTarget(path) {
  const native = window.GroceryGitterNative;
  const nativePlatform = window.Capacitor?.isNativePlatform?.() === true;
  const origin =
    native?.resolveApiOrigin?.({
      native: nativePlatform,
      location: window.location,
      configured: window.GROCERY_GITTER_API_ORIGIN,
    }) || "";
  return {
    url: origin ? `${String(origin).replace(/\/$/, "")}${path}` : path,
    credentials: origin ? "omit" : "include",
  };
}

function sessionHeader() {
  const storage = memoryStorage();
  let token = "";
  try {
    token = storage?.getItem(SESSION_KEY) || "";
  } catch {
    token = "";
  }
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function postJson(path, payload) {
  const target = apiTarget(path);
  const response = await fetch(target.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-device-id": deviceId(memoryStorage()),
      ...sessionHeader(),
    },
    credentials: target.credentials,
    cache: "no-store",
    body: JSON.stringify({ ...payload, deviceId: deviceId(memoryStorage()) }),
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function currentScreen() {
  const tab = document.body?.dataset?.step || "";
  const path = window.location?.pathname || "/";
  return { pathname: path, tab };
}

function closeDrawer() {
  document.getElementById("drawer-close")?.click();
}

function openFeedback() {
  closeDrawer();
  const dialog = document.getElementById("beta-feedback");
  if (!(dialog instanceof HTMLDialogElement)) return;
  if (!dialog.open) dialog.showModal();
  document.getElementById("beta-feedback-title")?.focus();
}

function showGate(on) {
  if (typeof document === "undefined") return;
  const gate = document.getElementById("beta-gate");
  document.body.classList.toggle("beta-gated", on);
  document.documentElement.classList.remove("beta-gate-hold");
  if (!(gate instanceof HTMLDialogElement)) return;
  if (on) {
    document.querySelectorAll("dialog").forEach((dialog) => {
      if (dialog.id !== "beta-gate" && dialog.open) dialog.close();
    });
    if (!gate.open) gate.showModal();
    document.getElementById("beta-code")?.focus();
    return;
  }
  if (gate.open) gate.close();
}

let appAllowed = false;
let gateCheck = null;

export function whenInviteAllowsApp() {
  if (typeof window !== "undefined" && window.__ggInviteGate) return window.__ggInviteGate;
  const promise = (async () => {
    if (appAllowed) return true;
    if (!gateCheck) gateCheck = checkInviteGate();
    const ok = await gateCheck;
    if (ok || appAllowed) return true;
    return new Promise((resolve) => {
      if (appAllowed) {
        resolve(true);
        return;
      }
      document.addEventListener("gg-beta-unlocked", () => resolve(true), { once: true });
    });
  })();
  if (typeof window !== "undefined") window.__ggInviteGate = promise;
  return promise;
}

function allowApp() {
  appAllowed = true;
  showGate(false);
  if (typeof window !== "undefined") window.__ggInviteGate = Promise.resolve(true);
  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("gg-beta-unlocked"));
  }
}

async function checkInviteGate() {
  const storage = memoryStorage();
  const decision = await resolveInviteGate({
    remembered: readInvite(storage),
    clearCode() {
      clearInvite(storage);
    },
    async postInvite(code) {
      const { response, body } = await postJson("/api/beta/invite", { code });
      return { response, body };
    },
    async fetchGate() {
      const target = apiTarget("/api/beta/gate");
      const response = await fetch(target.url, {
        headers: { accept: "application/json" },
        credentials: target.credentials,
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      return { response, body };
    },
  });
  if (decision.show) showGate(true);
  else allowApp();
  return !decision.show;
}

function installApiDeviceHeader() {
  if (typeof window === "undefined" || window.__ggDeviceFetch || typeof window.fetch !== "function") return;
  const original = window.fetch.bind(window);
  window.__ggDeviceFetch = true;
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? String(input) : input?.url || "";
    if (!isShopperApi(url, window)) return original(input, init);
    const response = await original(input, fetchInitWithDevice(input, init, deviceId(memoryStorage())));
    if (response.status === 401) {
      const body = await response.clone().json().catch(() => ({}));
      const message = String(body?.error || "");
      if (message === "Enter your invite code." || message === "Send this device's id.") {
        clearInvite(memoryStorage());
        appAllowed = false;
        gateCheck = null;
        if (typeof window !== "undefined") {
          window.__ggInviteGate = new Promise((resolve) => {
            document.addEventListener("gg-beta-unlocked", () => resolve(true), { once: true });
          });
        }
        showGate(true);
      }
    }
    return response;
  };
}

function keepGateOnTop() {
  const proto = typeof HTMLDialogElement === "undefined" ? null : HTMLDialogElement.prototype;
  if (!proto || proto.__ggGate) return;
  const original = proto.showModal;
  proto.showModal = function showModalDuringGate(...args) {
    if (!dialogAllowedDuringGate(this.id, document.body?.classList.contains("beta-gated"))) return;
    return original.apply(this, args);
  };
  proto.__ggGate = true;
}

function mountFeedback() {
  document.body.insertAdjacentHTML("beforeend", feedbackSheetHtml());
  document.getElementById("beta-feedback-close")?.addEventListener("click", () => {
    document.getElementById("beta-feedback")?.close();
  });
  document.getElementById("beta-feedback-shots")?.addEventListener("change", (event) => {
    const note = document.getElementById("beta-feedback-shots-note");
    const preview = document.getElementById("beta-feedback-shots-preview");
    const files = event.target?.files;
    const text = feedbackScreenshotNote(files);
    if (note) {
      note.hidden = !text;
      note.textContent = text;
    }
    if (preview) {
      preview.replaceChildren();
      for (const file of [...(files || [])].slice(0, 3)) {
        if (feedbackShotError(file)) continue;
        const img = document.createElement("img");
        img.alt = file.name || "Screenshot";
        img.src = URL.createObjectURL(file);
        preview.appendChild(img);
      }
    }
  });
  document.getElementById("beta-feedback-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = document.getElementById("beta-feedback-status");
    const data = new FormData(form);
    const rating = Number(data.get("rating"));
    const screenNote = String(data.get("screen") || "");
    const where = currentScreen();
    const context = feedbackContext({
      storage: memoryStorage(),
      userAgent: navigator.userAgent,
      pathname: where.pathname,
      tab: where.tab,
    });
    const video = String(data.get("video") || "").trim();
    const note = String(data.get("message") || "");
    const files = document.getElementById("beta-feedback-shots")?.files;
    const read = await readFeedbackShots(files);
    if (!read.ok) {
      if (status) {
        status.hidden = false;
        status.textContent = read.error;
      }
      return;
    }
    const message = [note, video ? `Video: ${video}` : ""].filter(Boolean).join("\n");
    const payload = feedbackBody({
      rating,
      message,
      screen: screenNote,
      context,
      deviceId: deviceId(memoryStorage()),
      shots: read.shots,
    });
    if (status) {
      status.hidden = true;
      status.textContent = "";
    }
    try {
      const { response, body } = await postJson("/api/beta/feedback", payload);
      if (!response.ok) throw new Error(body.error || "Could not send feedback.");
      if (status) {
        status.hidden = false;
        status.textContent = "Sent. Thank you.";
      }
      form.reset();
      window.setTimeout(() => document.getElementById("beta-feedback")?.close(), 600);
    } catch (error) {
      if (status) {
        status.hidden = false;
        status.textContent = error instanceof Error ? error.message : "Could not send feedback.";
      }
    }
  });
  document.getElementById("menu-feedback")?.addEventListener("click", openFeedback);
  document.getElementById("help-feedback")?.addEventListener("click", openFeedback);
}

function mountGate() {
  document.body.insertAdjacentHTML("beforeend", inviteScreenHtml());
  const gate = document.getElementById("beta-gate");
  gate?.addEventListener("cancel", (event) => {
    event.preventDefault();
  });
  document.getElementById("beta-gate-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.getElementById("beta-code");
    const errorEl = document.getElementById("beta-gate-error");
    const code = input instanceof HTMLInputElement ? input.value : "";
    if (errorEl) errorEl.hidden = true;
    try {
      const { response, body } = await postJson("/api/beta/invite", { code });
      if (!response.ok || !body.ok) throw new Error(body.error || "That invite code is not recognized.");
      if (body.required === false) clearInvite(memoryStorage());
      else rememberInvite(memoryStorage(), code);
      allowApp();
    } catch (error) {
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent = error instanceof Error ? error.message : "That invite code is not recognized.";
      }
    }
  });
  const pending = whenInviteAllowsApp();
  if (typeof window !== "undefined") window.__ggInviteGate = pending;
}

function mountErrorToast() {
  const model = errorToastModel();
  const toast = document.createElement("div");
  toast.id = "beta-error-toast";
  toast.className = "beta-error-toast";
  toast.hidden = true;
  toast.setAttribute("role", "status");
  toast.innerHTML = `<p>${model.text}</p><button type="button" id="beta-error-retry">${model.actions[0]}</button><button type="button" id="beta-error-feedback">${model.actions[1]}</button>`;
  document.body.appendChild(toast);
  toast.querySelector("#beta-error-retry")?.addEventListener("click", () => {
    window.location.reload();
  });
  toast.querySelector("#beta-error-feedback")?.addEventListener("click", () => {
    toast.hidden = true;
    openFeedback();
  });
  return toast;
}

function mountDeleteAccount() {
  const button = document.getElementById("delete-account-btn");
  const confirmEl = document.getElementById("delete-confirm");
  if (!button || !confirmEl) return;
  const sync = () => {
    button.disabled = confirmEl.value !== "DELETE";
  };
  confirmEl.addEventListener("input", sync);
  button.addEventListener("click", () => {
    document.getElementById("delete-data-btn")?.click();
  });
}

function mountEvents() {
  let lastTrip = 0;
  document.addEventListener("gg-beta-event", (event) => {
    const name = String(event.detail || "");
    if (!CLIENT_EVENTS.includes(name)) return;
    if (name === "trip_completed") {
      const now = Date.now();
      if (now - lastTrip < 60_000) return;
      lastTrip = now;
    }
    void postJson("/api/beta/events", { name }).catch(() => {});
  });
}

export function mountBeta() {
  if (typeof document !== "undefined" && document.getElementById("beta-gate")) return;
  installApiDeviceHeader();
  keepGateOnTop();
  mountErrorToast();
  mountFeedback();
  mountGate();
  mountDeleteAccount();
  mountEvents();
  const state = { hits: [], seen: new Map(), toastOpen: false };
  const toast = document.getElementById("beta-error-toast");
  installClientErrors(window, {
    state,
    capture(error) {
      const client = window.GroceryGitterSentry;
      if (client && typeof client.capture === "function") client.capture(error);
    },
    showToast() {
      if (toast) toast.hidden = false;
    },
    fetch(url, payload) {
      return postJson(url, payload);
    },
    screen: window.location?.pathname || "/",
    tab: document.body?.dataset?.step || "",
    deviceId: deviceId(memoryStorage()),
    url: "/api/beta/client-errors",
  });
}

if (typeof document !== "undefined") {
  mountBeta();
}

export { INVITE_KEY };
