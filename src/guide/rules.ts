/**
 * Deterministic Gitter guide.
 *
 * The phone runs the same functions from public/guide-rules.js (built from
 * this file). Prompts come from the list, usuals, and trip state. Nothing
 * here calls the ask endpoint, so showing a card does not spend a model call.
 *
 * Rebuild the browser copy after editing:
 *   npx esbuild src/guide/rules.ts --bundle --format=esm --platform=browser --outfile=public/guide-rules.js
 */

export const GUIDE_KEY = "gg-guide";
export const DISMISS_LIMIT = 3;
export const GUIDE_QUIET_MS = 280;
/** A visible prompt stays up this long before a different one can replace it. */
export const GUIDE_DWELL_MS = 4000;

export const GUIDE_LABEL = "Gitter guide";
export const DISMISS_LABEL = "Dismiss guide";
export const TURN_OFF_LABEL = "Turn off guide";
export const REPLIES_LABEL = "Replies";

export const MOMENTS = ["welcome", "receipt", "running-low", "before-review", "keep-building", "review-next", "trip-saved"] as const;

export type Moment = (typeof MOMENTS)[number];

/** Higher wins when a new moment arrives while another card is up. */
export const MOMENT_RANK: Record<Moment, number> = {
  "trip-saved": 6,
  receipt: 5,
  "review-next": 4,
  "running-low": 3,
  "before-review": 2,
  "keep-building": 2,
  welcome: 1,
};

export const RUNNING_LOW_STAPLES = ["Milk", "Eggs", "Bread"];

export type Usual = { name: string; times?: number };

export type ReceiptLine = { name: string; quantity: number };

export type StoreSearch = { label?: string; url?: string };

export type GuideChip = {
  id: string;
  label: string;
  action: string;
  name?: string;
  names?: string[];
  url?: string;
};

export type Prompt = {
  moment: Moment;
  line: string;
  chips: GuideChip[];
};

export type GuideSettings = {
  enabled: boolean;
  dismissals: number;
};

export type GuideSession = {
  shown: Partial<Record<Moment, boolean>>;
  declined?: Partial<Record<Moment, boolean>>;
  receipt: { count: number; lines: ReceiptLine[]; taught?: boolean; showAll?: boolean } | null;
  trip: { saved: number; total?: number; savedToPastTrips?: boolean; items?: ReceiptLine[] } | null;
};

export type GuideView = {
  step?: string;
  itemCount?: number;
  listNames?: string[];
  usuals?: Usual[];
  /** True while Review is showing the single-store savings card. */
  savingsCard?: boolean;
  /** From the Review price cache. Empty until a complete pass has a time. */
  pricesLabel?: string;
  unfound?: string[];
  search?: { name?: string; kroger?: StoreSearch; walmart?: StoreSearch } | null;
};

export type GuideInput = GuideView & {
  settings?: GuideSettings | null;
  session?: GuideSession | null;
};

export type GuideFrame = {
  prompt: Prompt | null;
  defer: boolean;
  hidden: boolean;
};

const WELCOME_LINE = "Hey. What are we picking up this week?";
const BEFORE_REVIEW_LINE = "Want me to check which stores are cheaper?";
const KEEP_BUILDING_LINE = "Add anything else you need. Review checks which stores are cheaper when you're ready.";
const SIMILAR_LINE = "Want me to look for a similar brand?";

export function emptyGuideSettings(): GuideSettings {
  return { enabled: true, dismissals: 0 };
}

export function createGuideSession(): GuideSession {
  return { shown: {}, declined: {}, receipt: null, trip: null };
}

export function guideIsOff(settings: GuideSettings | null | undefined): boolean {
  if (!settings) return false;
  return settings.enabled === false || settings.dismissals >= DISMISS_LIMIT;
}

export function parseGuideSettings(raw: unknown): GuideSettings {
  let value = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return emptyGuideSettings();
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      return emptyGuideSettings();
    }
  }
  const row = asRecord(value);
  if (!row) return emptyGuideSettings();
  const dismissals = clampCount(row.dismissals, 99);
  const enabled = row.enabled === false || dismissals >= DISMISS_LIMIT ? false : true;
  return { enabled, dismissals };
}

export function readGuideSettings(storage: { getItem?: (key: string) => string | null } | null | undefined): GuideSettings {
  if (!storage || typeof storage.getItem !== "function") return emptyGuideSettings();
  try {
    return parseGuideSettings(storage.getItem(GUIDE_KEY));
  } catch {
    return emptyGuideSettings();
  }
}

export function writeGuideSettings(
  storage: { setItem?: (key: string, value: string) => void } | null | undefined,
  settings: GuideSettings
): void {
  if (!storage || typeof storage.setItem !== "function") return;
  try {
    storage.setItem(GUIDE_KEY, JSON.stringify(parseGuideSettings(settings)));
  } catch {
    /* private browsing */
  }
}

export function dismissGuide(settings: GuideSettings | null | undefined): GuideSettings {
  const current = settings || emptyGuideSettings();
  const dismissals = Math.min(99, current.dismissals + 1);
  return {
    enabled: dismissals >= DISMISS_LIMIT ? false : current.enabled !== false,
    dismissals,
  };
}

/** Turning the guide back on clears the power-user dismissals. */
export function setGuideEnabled(settings: GuideSettings | null | undefined, on: boolean): GuideSettings {
  if (on) return { enabled: true, dismissals: 0 };
  return { enabled: false, dismissals: settings?.dismissals || 0 };
}

export function noteShown(session: GuideSession, moment: Moment): GuideSession {
  if (session.shown[moment]) return session;
  return { ...session, shown: { ...session.shown, [moment]: true } };
}

/** A terminal chip ("Not yet", "Not this time") spends that moment and asks for a follow-up. */
export function noteDeclined(session: GuideSession, moment: unknown): GuideSession {
  const id = String(moment || "");
  if (!MOMENTS.includes(id as Moment)) return session;
  const key = id as Moment;
  return {
    ...session,
    shown: { ...session.shown, [key]: true },
    declined: { ...(session.declined || {}), [key]: true },
  };
}

export function revealReceiptPicks(session: GuideSession): GuideSession {
  if (!session.receipt) return session;
  const shown = { ...session.shown };
  delete shown.receipt;
  return { ...session, shown, receipt: { ...session.receipt, showAll: true } };
}

export function noteReceipt(session: GuideSession, payload: unknown): GuideSession {
  const lines = linesFromReceipt(payload);
  if (!lines.length) return session;
  const record = asRecord(payload);
  // Teaching a first receipt (onboarding) must not ask "start with what you buy most".
  // A later order, with prompt left on, can ask. After teaching, that next order starts clean.
  const prompt = record?.prompt !== false;
  const taught = session.receipt?.taught === true;
  const prior = prompt && taught ? [] : session.receipt?.lines || [];
  const next = [...prior, ...lines].slice(0, 80);
  const shown = { ...session.shown };
  if (prompt) delete shown.receipt;
  else shown.receipt = true;
  return {
    ...session,
    shown,
    receipt: { count: next.length, lines: next, taught: prompt ? false : true },
  };
}

export function noteTrip(session: GuideSession, saved: unknown): GuideSession {
  const row = asRecord(saved);
  const value = Number(row ? row.saved : saved);
  const total = Number(row ? row.total : NaN);
  const items = row ? readLines(row.items).slice(0, 40) : [];
  // A finished trip must not immediately ask about the receipt, usuals, or a new list.
  const shown = {
    ...session.shown,
    receipt: true,
    welcome: true,
    "before-review": true,
    "running-low": true,
    "keep-building": true,
  };
  return {
    ...session,
    shown,
    trip: {
      saved: Number.isFinite(value) ? roundDollars(Math.max(0, value)) : 0,
      total: Number.isFinite(total) && total > 0 ? roundDollars(total) : 0,
      savedToPastTrips: row?.savedToPastTrips === true,
      items,
    },
  };
}

/** Undo of a finished trip. The moment can show again if they finish another one. */
export function clearTripNote(session: GuideSession): GuideSession {
  const shown = { ...session.shown };
  delete shown["trip-saved"];
  delete shown.welcome;
  delete shown.receipt;
  delete shown["before-review"];
  delete shown["running-low"];
  delete shown["keep-building"];
  return { ...session, trip: null, shown };
}

export function normalizeName(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function namesMatch(left: unknown, right: unknown): boolean {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length < 3) return false;
  const escaped = shorter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^| )${escaped}(?: |$)`).test(longer);
}

export function onList(name: string, listNames: string[] | undefined): boolean {
  return (listNames || []).some((row) => namesMatch(name, row));
}

export function formatDollars(amount: unknown): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(roundDollars(Number(amount)));
}

export function receiptLine(count: number, total?: number): string {
  const n = Math.max(0, Math.floor(count));
  const all = Math.max(n, Math.floor(Number(total) || n));
  const noun = all === 1 ? "item that is" : "items that are";
  if (all > n) return `Showing ${n} of ${all} ${noun} not on your list yet. Choose any, then add them.`;
  return `I found ${n} ${noun} not on your list yet. Choose any, then add them.`;
}

export function runningLowLine(names: string[]): string {
  const list = (names || []).map((name) => String(name || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (list.length === 1) return `Looks like you might be low on ${list[0]}. Want me to add ${list[0]}?`;
  return `Looks like you might be low on ${list.join(", ")}. Want me to add them?`;
}

export function reviewLine(unfound: string[]): string {
  const name = unfound.find(Boolean);
  if (name) return `I couldn't find ${name}. ${SIMILAR_LINE}`;
  return SIMILAR_LINE;
}

export function tripLine(saved: number, total?: number): string {
  const amount = Number(saved);
  const estimate = Number(total);
  const estimateText = Number.isFinite(estimate) && estimate > 0.009 ? ` Estimated ${formatDollars(estimate)}.` : "";
  if (!(amount > 0.009)) {
    return estimateText ? `Trip saved.${estimateText}` : "Trip saved.";
  }
  return `Nice, you saved ${formatDollars(amount)}.${estimateText} Save this Shopping list for next time?`;
}

export function linesFromReceipt(payload: unknown): ReceiptLine[] {
  if (Array.isArray(payload)) return readLines(payload);
  const root = asRecord(payload);
  if (!root) return [];
  const receipt = asRecord(root.receipt);
  const analysis = asRecord(root.analysis);
  const buckets = [receipt?.lines, root.lines, analysis?.lines, root.items];
  for (const bucket of buckets) {
    const lines = readLines(bucket);
    if (lines.length) return lines;
  }
  return [];
}

export function importReceiptUrl(url: string): boolean {
  try {
    const path = new URL(url, "https://grocery.gitter").pathname.replace(/\/+$/, "");
    return (
      path === "/api/import/receipt" ||
      path === "/api/import/photo" ||
      path === "/api/import/pdf" ||
      path === "/api/import/text" ||
      path === "/api/import/file"
    );
  } catch {
    return false;
  }
}

/** Lines from a receipt read. A catalog match with no receipt is not this moment. */
export function receiptLinesFromPayload(payload: unknown): ReceiptLine[] {
  if (Array.isArray(payload)) return linesFromReceipt(payload);
  const root = asRecord(payload);
  if (!root) return [];
  if (root.receipt) return linesFromReceipt(root.receipt);
  if (root.analysis) return linesFromReceipt(root.analysis);
  if (Array.isArray(root.lines) && !Array.isArray(root.items)) return linesFromReceipt(root);
  return [];
}

export function receiptLinesFromImportBody(contentType: string, body: string): ReceiptLine[] {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("ndjson")) {
    let found: ReceiptLine[] = [];
    for (const line of String(body || "").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed) as unknown;
        const record = asRecord(event);
        const payload = record?.type === "result" ? (record.analysis ?? record) : event;
        const lines = receiptLinesFromPayload(payload);
        if (lines.length) found = lines;
      } catch {
        /* a partial chunk is ignored */
      }
    }
    return found;
  }
  try {
    return receiptLinesFromPayload(JSON.parse(body) as unknown);
  } catch {
    return [];
  }
}

/** Item names from a receipt response the app already fetched. Not an ask call. */
export function linesFromImportBody(contentType: string, body: string): ReceiptLine[] {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("ndjson")) {
    let found: ReceiptLine[] = [];
    for (const line of String(body || "").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed) as unknown;
        const record = asRecord(event);
        const payload = record?.type === "result" ? (record.analysis ?? record) : event;
        const lines = linesFromReceipt(payload);
        if (lines.length) found = lines;
      } catch {
        /* a partial chunk is ignored */
      }
    }
    return found;
  }
  try {
    return linesFromReceipt(JSON.parse(body) as unknown);
  } catch {
    return [];
  }
}

export function receiptPicks(lines: ReceiptLine[], usuals: Usual[] | undefined, limit = 8): string[] {
  const ranked = (lines || []).map((line) => {
    const usual = (usuals || []).find((row) => namesMatch(row.name, line.name));
    return { name: line.name, quantity: line.quantity || 1, times: Math.max(0, Math.floor(Number(usual?.times) || 0)) };
  });
  const pool = ranked.slice();
  pool.sort((a, b) => b.times - a.times || b.quantity - a.quantity || a.name.localeCompare(b.name));
  const names: string[] = [];
  const seen = new Set<string>();
  const cap = Math.max(1, Math.min(80, Math.floor(limit) || 8));
  for (const row of pool) {
    const key = normalizeName(row.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(row.name);
    if (names.length >= cap) break;
  }
  return names;
}

/** Usuals the shopper has actually bought that are still off the list. No invented staples. */
export function runningLowSuggestions(usuals: Usual[] | undefined, listNames: string[] | undefined, limit = 3): string[] {
  const cap = Math.max(1, Math.min(3, Math.floor(limit) || 3));
  return runningLowUsuals(usuals, listNames, cap);
}

export function runningLowUsuals(usuals: Usual[] | undefined, listNames: string[] | undefined, limit = 3): string[] {
  const ranked = (usuals || [])
    .filter((row) => String(row?.name || "").trim() && !onList(row.name, listNames))
    .slice()
    .sort((a, b) => (Number(b.times) || 0) - (Number(a.times) || 0) || a.name.localeCompare(b.name));
  const names: string[] = [];
  const cap = Math.max(1, Math.min(3, Math.floor(limit) || 3));
  for (const row of ranked) {
    const name = String(row.name).replace(/\s+/g, " ").trim();
    if (names.some((have) => namesMatch(have, name))) continue;
    names.push(name);
    if (names.length >= cap) break;
  }
  return names;
}

export function typeFrames(line: string, _reduced?: boolean): string[] {
  return [String(line || "")];
}

/**
 * One card, or nothing. A moment already shown this session is skipped.
 * Trip completion and a fresh receipt win over the standing prompts.
 */
export function decideGuide(input: GuideInput = {}): Prompt | null {
  const settings = input.settings ? parseGuideSettings(input.settings) : emptyGuideSettings();
  if (guideIsOff(settings)) return null;
  const session = input.session || createGuideSession();
  const step = surface(input.step);
  const itemCount = Math.max(0, Math.floor(Number(input.itemCount) || 0));
  const listNames = (input.listNames || []).map((name) => String(name || "")).filter(Boolean);
  const usuals = input.usuals || [];
  const unfound = (input.unfound || []).map((name) => String(name || "").replace(/\s+/g, " ").trim()).filter(Boolean);

  // The single-store savings card already asks the next question.
  if (input.savingsCard) return null;

  if (!session.shown["trip-saved"] && session.trip) {
    const names = (session.trip.items || []).map((item) => item.name).filter(Boolean);
    const remember = !(Number(session.trip.saved) > 0.009);
    return {
      moment: "trip-saved",
      line: tripLine(session.trip.saved, session.trip.total),
      chips: [
        { id: "save", label: remember ? "Remember these items" : "Save Shopping list", action: "save-list", names },
        { id: "skip", label: "Not this time", action: "later" },
      ],
    };
  }

  if (!session.shown.receipt && session.receipt && session.receipt.count > 0) {
    const offList = session.receipt.lines.filter((line) => line?.name && !onList(line.name, listNames));
    const available = receiptPicks(offList, usuals, Math.max(offList.length, 1));
    const picks = session.receipt.showAll ? available : available.slice(0, 6);
    const hidden = available.length - picks.length;
    if (picks.length) {
      return {
        moment: "receipt",
        line: receiptLine(picks.length, available.length),
        chips: [
          ...picks.map((name) => ({ id: `pick:${normalizeName(name)}`, label: name, action: "toggle-pick", name })),
          ...(hidden > 0 ? [{ id: "more-picks", label: `Show ${hidden} more`, action: "show-rest" }] : []),
          { id: "add", label: "Add selected", action: "commit-picks" },
          { id: "no", label: "No thanks", action: "later" },
        ],
      };
    }
  }

  if (step === "review" && !session.shown["review-next"] && String(input.pricesLabel || "").trim() && unfound.length) {
    const search = input.search;
    const chips: GuideChip[] = [];
    if (search?.kroger?.url) {
      chips.push({
        id: "kroger",
        label: search.kroger.label || "Search at Kroger",
        action: "open-search",
        url: search.kroger.url,
        name: unfound[0],
      });
    }
    if (search?.walmart?.url) {
      chips.push({
        id: "walmart",
        label: search.walmart.label || "Search at Walmart",
        action: "open-search",
        url: search.walmart.url,
        name: unfound[0],
      });
    }
    chips.push({ id: "no", label: "No thanks", action: "later" });
    return {
      moment: "review-next",
      line: reviewLine(unfound),
      chips: chips.slice(0, 3),
    };
  }

  if (step === "build" && itemCount > 0 && !session.shown["running-low"]) {
    const names = runningLowSuggestions(usuals, listNames, 3);
    if (names.length) {
      return {
        moment: "running-low",
        line: runningLowLine(names),
        chips: [
          ...names.map((name) => ({ id: `usual:${normalizeName(name)}`, label: name, action: "toggle-pick", name })),
          { id: "add", label: "Add selected", action: "commit-picks" },
          { id: "no", label: "No thanks", action: "later" },
        ],
      };
    }
  }

  if (step === "build" && itemCount > 0 && !session.shown["before-review"]) {
    return {
      moment: "before-review",
      line: BEFORE_REVIEW_LINE,
      chips: [
        { id: "review", label: "Check prices", action: "review" },
        { id: "later", label: "Keep building", action: "later" },
      ],
    };
  }

  const declined = session.declined || {};
  const passed = MOMENTS.some((id) => declined[id]);
  if (step === "build" && itemCount > 0 && passed && !session.shown["keep-building"]) {
    return {
      moment: "keep-building",
      line: KEEP_BUILDING_LINE,
      chips: [
        { id: "add", label: "Add an item", action: "focus-ask" },
        { id: "review", label: "Check store prices", action: "review" },
        { id: "enough", label: "Hide tips", action: "close-guide" },
      ],
    };
  }

  if (step === "build" && itemCount === 0 && !session.shown.welcome && !session.declined?.["trip-saved"]) {
    return {
      moment: "welcome",
      line: WELCOME_LINE,
      chips: [
        { id: "say", label: "Say or type my list", action: "focus-ask" },
        { id: "usuals", label: "Use my usuals", action: "use-usuals" },
        { id: "receipt", label: "Upload a receipt", action: "upload-receipt" },
      ],
    };
  }

  return null;
}

/**
 * Keep the card still while a finger is down, and don't treat a covered
 * moment as spent. Dialogs and a focused field only hide the card.
 */
export function applyGuideFrame(
  current: Prompt | null,
  next: Prompt | null,
  options: { holding?: boolean; dialogOpen?: boolean; fieldFocused?: boolean } = {}
): GuideFrame {
  if (options.holding) return { prompt: current, defer: true, hidden: false };
  if (options.dialogOpen || options.fieldFocused) return { prompt: null, defer: true, hidden: true };
  return { prompt: next, defer: false, hidden: !next };
}

export type PresentInput = {
  settings?: GuideSettings | null;
  session?: GuideSession | null;
  view?: GuideView;
  current?: Prompt | null;
  holding?: boolean;
  dialogOpen?: boolean;
  fieldFocused?: boolean;
};

export type PresentResult = {
  session: GuideSession;
  current: Prompt | null;
  defer: boolean;
  hidden: boolean;
};

/** True when this moment's own conditions still hold, ignoring what else is waiting. */
export function momentStillFits(input: GuideInput, moment: Moment): boolean {
  const session = input.session || createGuideSession();
  const shown: Partial<Record<Moment, boolean>> = {};
  for (const id of MOMENTS) {
    if (id !== moment) shown[id] = true;
  }
  return decideGuide({ ...input, session: { ...session, shown } })?.moment === moment;
}

/**
 * Two prompts were landing back to back, each with its own Turn off.
 * Keep the one already on screen until the dwell passes. A saved-trip
 * prompt still replaces it, because that is the completion of the shop.
 */
export function holdVisiblePrompt(
  current: Prompt | null,
  next: Prompt | null,
  shownAt: number,
  now: number,
  dwellMs = GUIDE_DWELL_MS
): boolean {
  if (!current || !next) return false;
  if (current.moment === next.moment) return false;
  if (next.moment === "trip-saved") return false;
  const started = Number(shownAt) || 0;
  const clock = Number(now) || 0;
  if (started <= 0 || clock <= 0) return false;
  return clock - started < dwellMs;
}

/** Show a moment once, keep it on screen until it no longer fits, and don't swap mid-tap. */
export function presentGuide(input: PresentInput = {}): PresentResult {
  const session = input.session || createGuideSession();
  const settings = input.settings ? parseGuideSettings(input.settings) : emptyGuideSettings();
  const view = input.view || {};
  const current = input.current || null;
  const packed = { ...view, settings, session };
  const decision = decideGuide(packed);
  const frame = applyGuideFrame(current, decision, input);
  const onReview = surface(view.step) === "review";
  // The unmatched-item card belongs on Review. Leaving that tab takes it down.
  if (current?.moment === "review-next" && !onReview) {
    return { session, current: null, defer: false, hidden: true };
  }
  if (frame.defer) {
    return { session, current, defer: true, hidden: frame.hidden };
  }
  // An unmatched-item question stays until the shopper answers or dismisses it.
  // A later savings card or a cleared unfound list must not take it down.
  if (current?.moment === "review-next" && !session.declined?.["review-next"] && onReview) {
    const nextRank = decision ? MOMENT_RANK[decision.moment] : 0;
    if (!decision || decision.moment === "review-next" || nextRank <= MOMENT_RANK["review-next"]) {
      const nextSession = session.shown["review-next"] ? session : noteShown(session, "review-next");
      return { session: nextSession, current, defer: false, hidden: false };
    }
  }
  if (current && momentStillFits(packed, current.moment)) {
    const nextRank = decision ? MOMENT_RANK[decision.moment] : 0;
    if (!decision || decision.moment === current.moment || nextRank <= MOMENT_RANK[current.moment]) {
      const nextSession = session.shown[current.moment] ? session : noteShown(session, current.moment);
      return { session: nextSession, current, defer: false, hidden: false };
    }
  }
  if (frame.prompt) {
    const nextSession = session.shown[frame.prompt.moment] ? session : noteShown(session, frame.prompt.moment);
    return { session: nextSession, current: frame.prompt, defer: false, hidden: false };
  }
  return { session, current: null, defer: false, hidden: true };
}

function surface(step: unknown): "build" | "review" | "shop" | "other" {
  const id = String(step || "").toLowerCase();
  if (id === "add" || id === "home" || id === "build") return "build";
  if (id === "plan" || id === "review") return "review";
  if (id === "shop" || id === "store" || id === "in-store") return "shop";
  return "other";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function clampCount(value: unknown, max: number): number {
  const number = Math.floor(Number(value) || 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(max, number);
}

function roundDollars(amount: number): number {
  const value = Number(amount);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function readLines(value: unknown): ReceiptLine[] {
  if (!Array.isArray(value)) return [];
  const out: ReceiptLine[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      const name = entry.replace(/\s+/g, " ").trim();
      if (name) out.push({ name: name.slice(0, 120), quantity: 1 });
    } else {
      const row = asRecord(entry);
      if (!row) continue;
      const name = String(row.name || row.label || row.raw || row.productName || "")
        .replace(/\s+/g, " ")
        .trim();
      if (!name) continue;
      out.push({ name: name.slice(0, 120), quantity: Math.max(1, Math.floor(Number(row.quantity) || 1)) });
    }
    if (out.length >= 80) break;
  }
  return out;
}
