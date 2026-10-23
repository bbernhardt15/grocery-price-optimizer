/** First-run welcome. The stored flag is "1" after Skip, Done, or Escape. */
export const ONBOARDING_KEY = "gg-onboarding-done";

export const ONBOARDING_STEPS = [
  {
    id: "pick",
    title: "Pick items",
    body: "Check groceries as you browse. Your list stays on this device.",
  },
  {
    id: "split",
    title: "Split by the cheapest store",
    body: "Plan the trip. Each item goes to the store with the lowest price.",
  },
  {
    id: "carts",
    title: "Send to store carts",
    body: "Send each store’s items to its cart or a search page. You finish checkout there.",
  },
  {
    id: "zip",
    kind: "zip",
    title: "Your ZIP",
    body: "A 5-digit ZIP finds nearby stores and this week’s ads. You can skip it.",
  },
  {
    id: "kroger",
    kind: "kroger",
    title: "Connect Kroger",
    body: "Optional. Sign in on Kroger so we can add items to your cart. We never see your password.",
  },
];

const ZIP_PATTERN = /^\d{5}(?:-\d{4})?$/;

/** @param {string | null | undefined} stored */
export function onboardingDone(stored) {
  return stored === "1";
}

/** @param {string | null | undefined} stored */
export function shouldShowOnboarding(stored) {
  return !onboardingDone(stored);
}

/** @param {number} index */
export function clampStep(index) {
  const value = Number(index);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= ONBOARDING_STEPS.length) return ONBOARDING_STEPS.length - 1;
  return Math.floor(value);
}

/** @param {number} index */
export function progressLabel(index) {
  const step = clampStep(index);
  return `${step + 1} of ${ONBOARDING_STEPS.length}`;
}

/** @param {{ kind?: string } | null | undefined} step */
export function primaryLabel(step) {
  if (step?.kind === "zip") return "Continue";
  if (step?.kind === "kroger") return "Done";
  return "Next";
}

/**
 * @param {string | null | undefined} value
 * Same digit rules as the header ZIP field.
 */
export function normalizeZipInput(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length >= 9) return `${digits.slice(0, 5)}-${digits.slice(5, 9)}`;
  if (digits.length >= 5) return digits.slice(0, 5);
  return digits;
}

/** Blank is allowed. Letters or a partial ZIP are not. */
export function zipAdvanceError(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const zip = normalizeZipInput(raw);
  if (ZIP_PATTERN.test(zip)) return "";
  return "Enter a 5-digit ZIP, or leave it blank.";
}

/**
 * Copy for the optional Kroger step.
 * @param {{ oauthConfigured?: boolean, connected?: boolean } | null | undefined} status
 */
export function krogerStepCopy(status) {
  if (!status) {
    return {
      title: "Connect Kroger",
      body: "Optional. Checking whether Kroger sign-in is available.",
      action: "Not now",
      connect: false,
    };
  }
  if (!status.oauthConfigured) {
    return {
      title: "Connect Kroger",
      body: "Kroger sign-in isn’t available on this server. You can still open Kroger from a trip plan.",
      action: "Done",
      connect: false,
    };
  }
  if (status.connected) {
    return {
      title: "Kroger is connected",
      body: "You’re signed in. A trip can add Kroger items to your cart.",
      action: "Done",
      connect: false,
    };
  }
  return {
    title: "Connect Kroger",
    body: "Optional. Sign in on Kroger so we can add items to your cart. We never see your password.",
    action: "Not now",
    connect: true,
  };
}
