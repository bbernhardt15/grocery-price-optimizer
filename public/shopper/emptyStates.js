/** Friendly empty copy. Each state has one next action. */
export const EMPTY_STATES = {
  list: {
    title: "Your list is empty",
    body: "Check items while you browse. They stay on this device until you share.",
    action: "Browse the aisle",
    actionId: "browse",
  },
  search: {
    title: "No matches",
    body: "Nothing matched that search. Try a shorter name, or clear it.",
    action: "Clear search",
    actionId: "clear-search",
  },
  filters: {
    title: "Nothing in this aisle",
    body: "Those filters didn’t match. Clear them to see the shelf again.",
    action: "Clear filters",
    actionId: "clear-filters",
  },
  shelf: {
    title: "This shelf is empty",
    body: "Nothing is on this aisle right now.",
    action: "Try again",
    actionId: "retry",
  },
  stores: {
    title: "No stores near this ZIP",
    body: "No store could fill this list for that ZIP. Check the digits, or try another one.",
    action: "Change ZIP",
    actionId: "edit-zip",
  },
  alerts: {
    title: "No price alerts",
    body: "No drops yet. Turn on alerts for My list and we’ll watch the saved prices.",
    action: "Turn on list alerts",
    actionId: "enable-alerts",
  },
  alertsOn: {
    title: "No price alerts",
    body: "Alerts are on. We’ll show a drop here when a saved price falls.",
    action: "Browse the aisle",
    actionId: "browse",
  },
  shared: {
    title: "No shared lists",
    body: "Share a link so someone else can shop this list with you.",
    action: "Share list",
    actionId: "share",
  },
  offline: {
    title: "You’re offline",
    body: "Grocery Gitter needs a connection to load shelves and prices.",
    action: "Try again",
    actionId: "retry",
  },
  network: {
    title: "Couldn’t reach Grocery Gitter",
    body: "The request didn’t go through. Check your connection and try again.",
    action: "Try again",
    actionId: "retry",
  },
};

/**
 * Alerts stay a normal empty state until billing is enforced and this plan
 * cannot turn them on. A missing status fails open, matching the server.
 * @param {{ billing?: { enforced?: boolean, pro?: boolean, limits?: { priceAlerts?: boolean } } | null, alertsOn?: boolean }} [options]
 */
export function alertsEmptyChoice(options = {}) {
  if (options.alertsOn) return emptyState("alertsOn");
  const billing = options.billing;
  const enforced = Boolean(billing?.enforced);
  const allowed = !enforced || Boolean(billing?.pro) || Boolean(billing?.limits?.priceAlerts);
  if (!allowed) {
    return {
      title: "No price alerts",
      body: "Price alerts are part of Grocery Gitter Pro.",
      action: "See Pro",
      actionId: "see-pro",
    };
  }
  return emptyState("alerts");
}

/** @param {string} kind */
export function emptyState(kind) {
  const state = EMPTY_STATES[kind] || EMPTY_STATES.network;
  return { ...state };
}

/** @param {string} query */
export function searchEmpty(query) {
  const state = emptyState("search");
  const typed = String(query ?? "").trim();
  if (typed) {
    state.body = `Nothing matched "${typed}". Try a shorter name, or clear the search.`;
  }
  return state;
}

/**
 * @param {{ query?: string, filtered?: boolean }} input
 * @returns {"search" | "filters" | "shelf"}
 */
export function catalogEmptyKind(input) {
  if (String(input?.query ?? "").trim()) return "search";
  if (input?.filtered) return "filters";
  return "shelf";
}

/** A planned trip with a ZIP and no store groups. */
export function tripStoreEmpty(payload) {
  if (!payload || typeof payload !== "object") return false;
  const zip = String(payload.zipCode ?? "");
  if (!/^\d{5}/.test(zip)) return false;
  return Array.isArray(payload.stores) && payload.stores.length === 0;
}

/**
 * Transport failures only. Server messages such as "Browse failed (500)" stay as-is.
 * @param {unknown} error
 * @param {boolean | undefined} online
 * @returns {"offline" | "network" | ""}
 */
export function networkKind(error, online) {
  if (online === false) return "offline";
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  if (name === "AbortError") return "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/failed to fetch|networkerror|network request failed|load failed|offline|internet connection/i.test(message)) {
    return "network";
  }
  return "";
}

/**
 * Inner markup for an existing empty-state element.
 * @param {{ title: string, body: string, action?: string, actionId?: string, bodyId?: string }} state
 * @param {(value: string) => string} escapeHtml
 */
export function emptyStateInner(state, escapeHtml) {
  const bodyId = state.bodyId ? ` id="${escapeHtml(state.bodyId)}"` : "";
  const action = state.action
    ? `<button type="button" class="primary" data-empty-action="${escapeHtml(state.actionId || "")}">${escapeHtml(state.action)}</button>`
    : "";
  return `<h3>${escapeHtml(state.title)}</h3><p${bodyId}>${escapeHtml(state.body)}</p>${action}`;
}

/**
 * @param {{ title: string, body: string, action?: string, actionId?: string }} state
 * @param {(value: string) => string} escapeHtml
 * @param {"status" | "alert" | ""} [role]
 */
export function emptyStateMarkup(state, escapeHtml, role = "") {
  const live = role === "alert" || role === "status" ? ` role="${role}"` : "";
  return `<div class="empty-state"${live}>${emptyStateInner(state, escapeHtml)}</div>`;
}
