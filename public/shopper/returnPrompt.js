/**
 * "Did you finish at the store?" opens once, only after the shopper
 * actually left for a store site and the page comes back to visible.
 * Scroll, touch, focus, and pageshow do not open it. It stays closed
 * while the cart-ready or return screen is being read.
 */

export const MIN_AWAY_MS = 400;

export function createReturnWatch() {
  return {
    armedAt: 0,
    store: "",
    kind: "store",
    hiddenAt: 0,
    promptedAt: 0,
  };
}

function kindOf(kind) {
  if (kind === "coupons" || kind === "cart") return kind;
  return "store";
}

/**
 * The shopper tapped a control that leaves for the store. Nothing is shown yet.
 * @param {ReturnType<typeof createReturnWatch>} state
 */
export function armHandoff(state, { store, kind, at } = {}) {
  const when = Number(at) || Date.now();
  return {
    ...(state || createReturnWatch()),
    armedAt: when,
    store: String(store || "the store").trim() || "the store",
    kind: kindOf(kind),
    hiddenAt: 0,
    promptedAt: 0,
  };
}

function consume(state) {
  return { ...state, hiddenAt: 0, promptedAt: state.armedAt };
}

/**
 * @param {ReturnType<typeof createReturnWatch>} state
 * @param {{ source?: string, visibility?: string, now?: number, cartReadyOpen?: boolean, returnScreenOpen?: boolean }} event
 */
export function returnPromptDecision(state, event = {}) {
  const current = state || createReturnWatch();
  const source = event.source || "";
  const now = Number(event.now) || 0;
  if (source !== "visibility" && source !== "browser-finished") {
    return { state: current, show: false, store: current.store, kind: current.kind };
  }
  if (source === "visibility" && event.visibility === "hidden") {
    if (!current.armedAt || current.promptedAt === current.armedAt) {
      return { state: current, show: false, store: current.store, kind: current.kind };
    }
    return {
      state: { ...current, hiddenAt: now || Date.now() },
      show: false,
      store: current.store,
      kind: current.kind,
    };
  }
  if (!current.armedAt || current.promptedAt === current.armedAt) {
    return { state: current, show: false, store: current.store, kind: current.kind };
  }
  if (source === "visibility") {
    if (!current.hiddenAt) {
      return { state: current, show: false, store: current.store, kind: current.kind };
    }
    const away = (now || Date.now()) - current.hiddenAt;
    if (away < MIN_AWAY_MS) {
      return {
        state: { ...current, hiddenAt: 0 },
        show: false,
        store: current.store,
        kind: current.kind,
      };
    }
  }
  const reading = Boolean(event.cartReadyOpen || event.returnScreenOpen);
  if (reading) {
    return { state: consume(current), show: false, store: current.store, kind: current.kind };
  }
  return { state: consume(current), show: true, store: current.store, kind: current.kind };
}

/** Not yet closes the sheet and does not pick a tab. */
export function dismissReturnChoice() {
  return { close: true, step: null };
}
