import {
  ONBOARDING_KEY,
  accountStepCopy,
  krogerStepCopy,
  onboardingDone,
  primaryLabel,
  progressLabel,
  shouldShowOnboarding,
  welcomeSteps,
  zipAdvanceError,
} from "./onboarding.js";

/**
 * Welcome dialog and Settings. Location is offered only when `isNative()` is true.
 * @param {{
 *   isNative: () => boolean,
 *   apiUrl: (path: string) => string,
 *   fetch: typeof fetch,
 *   getZip: () => string,
 *   setZip: (zip: string) => void,
 *   focusZip: () => void,
 *   readCoords: () => Promise<{ lat: number, lng: number }>,
 *   openAuthorize: (url: string) => Promise<void> | void,
 *   toast: (message: string) => void,
 *   themeLabel: () => string,
 *   cycleTheme: () => void,
 *   accountsEnabled?: () => boolean,
 *   signedIn?: () => boolean,
 *   getBilling?: () => { enforced?: boolean, pro?: boolean, limits?: { multiStore?: boolean, cartHandoffs?: boolean, priceAlerts?: boolean } } | null,
 * }} deps
 */
export function mountWelcome(deps) {
  const dialog = document.getElementById("onboarding");
  const settings = document.getElementById("settings-dialog");
  if (!dialog || !settings) {
    return { openWelcome() {}, maybeAutoOpen() {}, openSettings() {} };
  }

  const $ = (id) => document.getElementById(id);
  let index = 0;
  /** @type {{ oauthConfigured?: boolean, connected?: boolean } | null} */
  let kroger = null;

  function steps() {
    return welcomeSteps({
      accountsEnabled: Boolean(deps.accountsEnabled?.()),
      signedIn: Boolean(deps.signedIn?.()),
      billing: deps.getBilling?.() ?? null,
    });
  }

  function readFlag() {
    try {
      return localStorage.getItem(ONBOARDING_KEY);
    } catch {
      return "1";
    }
  }

  function writeFlag() {
    try {
      localStorage.setItem(ONBOARDING_KEY, "1");
    } catch {
      /* private browsing */
    }
  }

  function focusTitle() {
    const title = $("onboard-title");
    if (!title) return;
    title.tabIndex = -1;
    title.focus();
  }

  function renderDots() {
    const dots = $("onboard-dots");
    if (!dots) return;
    dots.innerHTML = steps().map((_, stepIndex) => {
      const current = stepIndex === index ? "true" : "false";
      return `<span data-current="${current}"></span>`;
    }).join("");
  }

  function renderStep() {
    const list = steps();
    if (index >= list.length) index = list.length - 1;
    const step = list[index];
    const progress = $("onboard-progress");
    const title = $("onboard-title");
    const body = $("onboard-body");
    const accountFields = $("onboard-account-fields");
    const zipFields = $("onboard-zip-fields");
    const krogerFields = $("onboard-kroger-fields");
    const back = $("onboard-back");
    const next = $("onboard-next");
    const connect = $("onboard-kroger");
    const signIn = $("onboard-sign-in");
    const loc = $("onboard-location");
    const zipError = $("onboard-zip-error");
    const zipInput = $("onboard-zip");
    const last = index >= list.length - 1;
    if (progress) progress.textContent = progressLabel(index, list);
    if (title) title.textContent = step.title;
    if (body) body.textContent = step.body;
    if (accountFields) accountFields.hidden = step.kind !== "account";
    if (zipFields) zipFields.hidden = step.kind !== "zip";
    if (krogerFields) krogerFields.hidden = step.kind !== "kroger";
    if (back) back.hidden = index === 0;
    if (loc) loc.hidden = !(step.kind === "zip" && deps.isNative());
    if (zipError) {
      zipError.hidden = true;
      zipError.textContent = "";
    }
    zipInput?.setAttribute("aria-invalid", "false");
    if (connect && step.kind !== "kroger") connect.hidden = true;
    if (signIn && step.kind !== "account") signIn.hidden = true;
    if (step.kind === "kroger") {
      const copy = krogerStepCopy(kroger);
      if (title) title.textContent = copy.title;
      if (body) body.textContent = copy.body;
      if (connect) connect.hidden = !copy.connect;
      if (next) next.textContent = last ? copy.action : "Next";
    } else if (step.kind === "account") {
      const copy = accountStepCopy(Boolean(deps.signedIn?.()));
      if (title) title.textContent = copy.title;
      if (body) body.textContent = copy.body;
      if (signIn) signIn.hidden = !copy.signIn;
      if (next) next.textContent = last ? copy.action : "Next";
    } else if (next) {
      next.textContent = primaryLabel(step);
    }
    renderDots();
  }

  async function loadKroger() {
    try {
      const response = await deps.fetch(deps.apiUrl("/api/kroger/auth-status"), {
        headers: { Accept: "application/json" },
      });
      kroger = response.ok ? await response.json() : { oauthConfigured: false, connected: false };
    } catch {
      kroger = { oauthConfigured: false, connected: false };
    }
    if (steps()[index]?.kind === "kroger") renderStep();
    syncSettings();
  }

  function finish() {
    writeFlag();
    if (dialog.open) dialog.close();
  }

  function openWelcome() {
    index = 0;
    kroger = null;
    const zipInput = $("onboard-zip");
    if (zipInput) zipInput.value = deps.getZip();
    const note = $("onboard-loc-note");
    if (note) note.textContent = "";
    renderStep();
    if (settings.open) settings.close();
    if (!dialog.open) dialog.showModal();
    focusTitle();
    void loadKroger();
  }

  function maybeAutoOpen() {
    if (shouldShowOnboarding(readFlag())) openWelcome();
  }

  function goNext() {
    const step = steps()[index];
    if (step.kind === "zip") {
      const zipInput = $("onboard-zip");
      const error = zipAdvanceError(zipInput?.value ?? "");
      const zipError = $("onboard-zip-error");
      if (error) {
        if (zipError) {
          zipError.hidden = false;
          zipError.textContent = error;
        }
        zipInput?.setAttribute("aria-invalid", "true");
        zipInput?.focus();
        return;
      }
      const raw = String(zipInput?.value ?? "").trim();
      if (raw) deps.setZip(raw);
    }
    if (index >= steps().length - 1) {
      finish();
      return;
    }
    index += 1;
    renderStep();
    focusTitle();
  }

  function goBack() {
    if (index === 0) return;
    index -= 1;
    renderStep();
    focusTitle();
  }

  async function useLocation() {
    const note = $("onboard-loc-note");
    const button = $("onboard-location");
    if (!deps.isNative()) return;
    if (button) button.disabled = true;
    if (note) note.textContent = "Looking up your ZIP…";
    try {
      const coords = await deps.readCoords();
      const response = await deps.fetch(
        deps.apiUrl(`/api/geo/zip?lat=${encodeURIComponent(coords.lat)}&lng=${encodeURIComponent(coords.lng)}`)
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !/^\d{5}/.test(String(body.zip || ""))) {
        if (note) note.textContent = "Couldn’t read a ZIP from this location. Type it instead.";
        return;
      }
      const zipInput = $("onboard-zip");
      if (zipInput) zipInput.value = body.zip;
      deps.setZip(body.zip);
      if (note) note.textContent = `ZIP set to ${body.zip}.`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const denied = Number(error?.code) === 1 || /denied|permission/i.test(message);
      if (note) {
        note.textContent = denied
          ? "Location stayed off. Type a ZIP instead."
          : "Couldn’t use location. Type a ZIP instead.";
      }
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function connectKroger() {
    const button = $("onboard-kroger");
    const settingsButton = $("settings-kroger-connect");
    if (button) button.disabled = true;
    if (settingsButton) settingsButton.disabled = true;
    try {
      const response = await deps.fetch(deps.apiUrl("/api/kroger/connect"), {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        deps.toast(body.error || "Kroger connect isn’t available.");
        return;
      }
      if (body.status === "connected") {
        kroger = { oauthConfigured: true, connected: true };
        deps.toast("Kroger is connected.");
        if (dialog.open) finish();
        syncSettings();
        return;
      }
      if (body.authorizeUrl) {
        if (dialog.open) finish();
        if (settings.open) settings.close();
        await deps.openAuthorize(body.authorizeUrl);
        return;
      }
      deps.toast("Kroger did not return a sign-in link.");
    } catch {
      deps.toast("Couldn’t reach Kroger connect. Try again from Settings.");
    } finally {
      if (button) button.disabled = false;
      if (settingsButton) settingsButton.disabled = false;
    }
  }

  function syncSettings() {
    const themeBtn = $("settings-theme");
    if (themeBtn) themeBtn.textContent = deps.themeLabel();
    const zipLine = $("settings-zip");
    const zip = deps.getZip();
    if (zipLine) zipLine.textContent = zip ? `ZIP ${zip}` : "No ZIP saved yet.";
    const krogerLine = $("settings-kroger");
    const connectBtn = $("settings-kroger-connect");
    if (!kroger?.oauthConfigured) {
      if (krogerLine) krogerLine.textContent = "Kroger sign-in isn’t set up on this server.";
      if (connectBtn) connectBtn.hidden = true;
    } else if (kroger.connected) {
      if (krogerLine) krogerLine.textContent = "Kroger is connected.";
      if (connectBtn) connectBtn.hidden = true;
    } else {
      if (krogerLine) krogerLine.textContent = "Optional. Connect Kroger to add items to your cart.";
      if (connectBtn) {
        connectBtn.hidden = false;
        connectBtn.textContent = "Connect Kroger";
      }
    }
  }

  function openSettings() {
    const opener = $("settings-open");
    opener?.setAttribute("aria-expanded", "true");
    syncSettings();
    void loadKroger();
    if (!settings.open) settings.showModal();
    const title = $("settings-title");
    if (title) {
      title.tabIndex = -1;
      title.focus();
    }
  }

  $("onboard-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    goNext();
  });
  $("onboard-back")?.addEventListener("click", goBack);
  $("onboard-skip")?.addEventListener("click", finish);
  $("onboard-location")?.addEventListener("click", () => void useLocation());
  $("onboard-kroger")?.addEventListener("click", () => void connectKroger());
  $("onboard-sign-in")?.addEventListener("click", () => {
    finish();
    openSettings();
  });
  dialog.addEventListener("close", () => {
    if (!onboardingDone(readFlag())) writeFlag();
  });

  const opener = $("settings-open");
  opener?.addEventListener("click", openSettings);
  $("settings-close")?.addEventListener("click", () => settings.close());
  settings.addEventListener("close", () => opener?.setAttribute("aria-expanded", "false"));
  $("settings-theme")?.addEventListener("click", () => {
    deps.cycleTheme();
    syncSettings();
  });
  $("settings-zip-edit")?.addEventListener("click", () => {
    settings.close();
    deps.focusZip();
  });
  $("settings-kroger-connect")?.addEventListener("click", () => void connectKroger());
  $("settings-welcome")?.addEventListener("click", openWelcome);

  return { openWelcome, maybeAutoOpen, openSettings, syncSettings };
}
