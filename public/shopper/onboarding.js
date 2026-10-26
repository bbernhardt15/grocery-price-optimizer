/** First-run welcome. The stored flag is "1" after Skip, Done, or Escape. */
export const ONBOARDING_KEY = "gg-onboarding-done";

const PICK_STEP = {
  id: "pick",
  title: "Pick items",
  body: "Check groceries as you browse. Your list stays on this device.",
};

const SPLIT_OPEN = {
  id: "split",
  title: "Split by the cheapest store",
  body: "Plan the trip. Each item goes to the store with the lowest price.",
};

const SPLIT_FREE = {
  id: "split",
  title: "One store on the free plan",
  body: "The free plan prices the whole list at one store. Pro splits it across stores when that costs less.",
};

const CARTS_OPEN = {
  id: "carts",
  title: "Send to store carts",
  body: "Send each store’s items to its cart or a search page. You finish checkout there.",
};

const CARTS_FREE = {
  id: "carts",
  title: "Cart handoffs are in Pro",
  body: "The free plan shows the trip. Pro sends each store’s items to its cart or a search page. You finish checkout there.",
};

const ZIP_STEP = {
  id: "zip",
  kind: "zip",
  title: "Your ZIP",
  body: "A 5-digit ZIP finds nearby stores and this week’s ads. You can skip it.",
};

const KROGER_STEP = {
  id: "kroger",
  kind: "kroger",
  title: "Connect Kroger",
  body: "Optional. Sign in on Kroger so we can add items to your cart. We never see your password.",
};

/**
 * Split and cart copy follow the plan. Missing billing, or enforced false, fails open:
 * the multi-store split and cart handoffs stay available, which is what the server does
 * until RevenueCat is configured.
 * @param {{ enforced?: boolean, pro?: boolean, limits?: { multiStore?: boolean, cartHandoffs?: boolean } } | null | undefined} billing
 */
export function tripStepCopy(billing) {
  const enforced = Boolean(billing?.enforced);
  const pro = Boolean(billing?.pro);
  const multi = !enforced || pro || Boolean(billing?.limits?.multiStore);
  const carts = !enforced || pro || Boolean(billing?.limits?.cartHandoffs);
  return {
    split: multi ? SPLIT_OPEN : SPLIT_FREE,
    carts: carts ? CARTS_OPEN : CARTS_FREE,
  };
}

/** @param {boolean} signedIn */
export function accountStepCopy(signedIn) {
  if (signedIn) {
    return {
      id: "account",
      kind: "account",
      title: "You’re signed in",
      body: "This list can follow you to your other devices.",
      action: "Done",
      signIn: false,
    };
  }
  return {
    id: "account",
    kind: "account",
    title: "Sign in",
    body: "Optional. Sign in to keep this list and your alerts on your other devices. You can shop without an account.",
    action: "Not now",
    signIn: true,
  };
}

/**
 * Welcome screens. The sign-in step is included only when accounts are configured.
 * @param {{ accountsEnabled?: boolean, signedIn?: boolean, billing?: { enforced?: boolean, pro?: boolean, limits?: { multiStore?: boolean, cartHandoffs?: boolean } } | null }} [options]
 */
export function welcomeSteps(options = {}) {
  const trip = tripStepCopy(options.billing);
  const steps = [PICK_STEP, trip.split, trip.carts];
  if (options.accountsEnabled) steps.push(accountStepCopy(Boolean(options.signedIn)));
  steps.push(ZIP_STEP, KROGER_STEP);
  return steps;
}

/** Default tour: billing not enforced, accounts off. */
export const ONBOARDING_STEPS = welcomeSteps();

const ZIP_PATTERN = /^\d{5}(?:-\d{4})?$/;

/** @param {string | null | undefined} stored */
export function onboardingDone(stored) {
  return stored === "1";
}

/** @param {string | null | undefined} stored */
export function shouldShowOnboarding(stored) {
  return !onboardingDone(stored);
}

/**
 * @param {number} index
 * @param {readonly { id: string }[]} [steps]
 */
export function clampStep(index, steps = ONBOARDING_STEPS) {
  const value = Number(index);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= steps.length) return Math.max(0, steps.length - 1);
  return Math.floor(value);
}

/**
 * @param {number} index
 * @param {readonly { id: string }[]} [steps]
 */
export function progressLabel(index, steps = ONBOARDING_STEPS) {
  const list = steps.length ? steps : ONBOARDING_STEPS;
  const step = clampStep(index, list);
  return `${step + 1} of ${list.length}`;
}

/** @param {{ kind?: string } | null | undefined} step */
export function primaryLabel(step) {
  if (step?.kind === "zip") return "Continue";
  if (step?.kind === "kroger" || step?.kind === "account") return "Done";
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
