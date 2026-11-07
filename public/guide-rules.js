// src/guide/rules.ts
var GUIDE_KEY = "gg-guide";
var DISMISS_LIMIT = 3;
var GUIDE_QUIET_MS = 280;
var GUIDE_LABEL = "Gitter guide";
var DISMISS_LABEL = "Dismiss guide";
var TURN_OFF_LABEL = "Turn off guide";
var REPLIES_LABEL = "Replies";
var MOMENTS = ["welcome", "receipt", "running-low", "before-review", "keep-building", "review-next", "trip-saved"];
var MOMENT_RANK = {
  "trip-saved": 6,
  receipt: 5,
  "review-next": 4,
  "running-low": 3,
  "before-review": 2,
  "keep-building": 2,
  welcome: 1
};
var RUNNING_LOW_STAPLES = ["Milk", "Eggs", "Bread"];
var WELCOME_LINE = "Hey. What are we picking up this week?";
var BEFORE_REVIEW_LINE = "Want me to check which stores are cheaper?";
var KEEP_BUILDING_LINE = "Add anything else you need. Review checks which stores are cheaper when you're ready.";
var SIMILAR_LINE = "Want me to look for a similar brand?";
function emptyGuideSettings() {
  return { enabled: true, dismissals: 0 };
}
function createGuideSession() {
  return { shown: {}, declined: {}, receipt: null, trip: null };
}
function guideIsOff(settings) {
  if (!settings) return false;
  return settings.enabled === false || settings.dismissals >= DISMISS_LIMIT;
}
function parseGuideSettings(raw) {
  let value = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return emptyGuideSettings();
    try {
      value = JSON.parse(text);
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
function readGuideSettings(storage) {
  if (!storage || typeof storage.getItem !== "function") return emptyGuideSettings();
  try {
    return parseGuideSettings(storage.getItem(GUIDE_KEY));
  } catch {
    return emptyGuideSettings();
  }
}
function writeGuideSettings(storage, settings) {
  if (!storage || typeof storage.setItem !== "function") return;
  try {
    storage.setItem(GUIDE_KEY, JSON.stringify(parseGuideSettings(settings)));
  } catch {
  }
}
function dismissGuide(settings) {
  const current = settings || emptyGuideSettings();
  const dismissals = Math.min(99, current.dismissals + 1);
  return {
    enabled: dismissals >= DISMISS_LIMIT ? false : current.enabled !== false,
    dismissals
  };
}
function setGuideEnabled(settings, on) {
  if (on) return { enabled: true, dismissals: 0 };
  return { enabled: false, dismissals: settings?.dismissals || 0 };
}
function noteShown(session, moment) {
  if (session.shown[moment]) return session;
  return { ...session, shown: { ...session.shown, [moment]: true } };
}
function noteDeclined(session, moment) {
  const id = String(moment || "");
  if (!MOMENTS.includes(id)) return session;
  const key = id;
  return {
    ...session,
    shown: { ...session.shown, [key]: true },
    declined: { ...session.declined || {}, [key]: true }
  };
}
function noteReceipt(session, payload) {
  const lines = linesFromReceipt(payload);
  if (!lines.length) return session;
  const record = asRecord(payload);
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
    receipt: { count: next.length, lines: next, taught: prompt ? false : true }
  };
}
function noteTrip(session, saved) {
  const row = asRecord(saved);
  const value = Number(row ? row.saved : saved);
  const items = row ? readLines(row.items).slice(0, 40) : [];
  return {
    ...session,
    trip: {
      saved: Number.isFinite(value) ? roundDollars(Math.max(0, value)) : 0,
      savedToPastTrips: row?.savedToPastTrips === true,
      items
    }
  };
}
function clearTripNote(session) {
  const shown = { ...session.shown };
  delete shown["trip-saved"];
  return { ...session, trip: null, shown };
}
function normalizeName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function namesMatch(left, right) {
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
function onList(name, listNames) {
  return (listNames || []).some((row) => namesMatch(name, row));
}
function formatDollars(amount) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(roundDollars(Number(amount)));
}
function receiptLine(count) {
  const n = Math.max(0, Math.floor(count));
  const noun = n === 1 ? "item that is" : "items that are";
  return `I found ${n} ${noun} not on your list yet. Choose any, then add them.`;
}
function runningLowLine(names) {
  const list = (names || []).map((name) => String(name || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (list.length === 1) return `Looks like you might be low on ${list[0]}. Want me to add ${list[0]}?`;
  return `Looks like you might be low on ${list.join(", ")}. Want me to add them?`;
}
function reviewLine(unfound) {
  const name = unfound.find(Boolean);
  if (name) return `I couldn't find ${name}. ${SIMILAR_LINE}`;
  return SIMILAR_LINE;
}
function tripLine(saved) {
  return `Nice, you saved ${formatDollars(saved)}. Save this Shopping list for next time?`;
}
function linesFromReceipt(payload) {
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
function importReceiptUrl(url) {
  try {
    const path = new URL(url, "https://grocery.gitter").pathname.replace(/\/+$/, "");
    return path === "/api/import/receipt" || path === "/api/import/photo" || path === "/api/import/pdf" || path === "/api/import/text" || path === "/api/import/file";
  } catch {
    return false;
  }
}
function receiptLinesFromPayload(payload) {
  if (Array.isArray(payload)) return linesFromReceipt(payload);
  const root = asRecord(payload);
  if (!root) return [];
  if (root.receipt) return linesFromReceipt(root.receipt);
  if (root.analysis) return linesFromReceipt(root.analysis);
  if (Array.isArray(root.lines) && !Array.isArray(root.items)) return linesFromReceipt(root);
  return [];
}
function receiptLinesFromImportBody(contentType, body) {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("ndjson")) {
    let found = [];
    for (const line of String(body || "").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed);
        const record = asRecord(event);
        const payload = record?.type === "result" ? record.analysis ?? record : event;
        const lines = receiptLinesFromPayload(payload);
        if (lines.length) found = lines;
      } catch {
      }
    }
    return found;
  }
  try {
    return receiptLinesFromPayload(JSON.parse(body));
  } catch {
    return [];
  }
}
function linesFromImportBody(contentType, body) {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("ndjson")) {
    let found = [];
    for (const line of String(body || "").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed);
        const record = asRecord(event);
        const payload = record?.type === "result" ? record.analysis ?? record : event;
        const lines = linesFromReceipt(payload);
        if (lines.length) found = lines;
      } catch {
      }
    }
    return found;
  }
  try {
    return linesFromReceipt(JSON.parse(body));
  } catch {
    return [];
  }
}
function receiptPicks(lines, usuals, limit = 8) {
  const ranked = (lines || []).map((line) => {
    const usual = (usuals || []).find((row) => namesMatch(row.name, line.name));
    return { name: line.name, quantity: line.quantity || 1, times: Math.max(0, Math.floor(Number(usual?.times) || 0)) };
  });
  const frequent = ranked.filter((row) => row.times > 0);
  const pool = (frequent.length ? frequent : ranked).slice();
  pool.sort((a, b) => b.times - a.times || b.quantity - a.quantity || a.name.localeCompare(b.name));
  const names = [];
  const cap = Math.max(1, Math.min(12, Math.floor(limit) || 8));
  for (const row of pool) {
    if (!row.name || names.some((name) => namesMatch(name, row.name))) continue;
    names.push(row.name);
    if (names.length >= cap) break;
  }
  return names;
}
function runningLowSuggestions(usuals, listNames, limit = 3) {
  const cap = Math.max(1, Math.min(3, Math.floor(limit) || 3));
  return runningLowUsuals(usuals, listNames, cap);
}
function runningLowUsuals(usuals, listNames, limit = 3) {
  const ranked = (usuals || []).filter((row) => String(row?.name || "").trim() && !onList(row.name, listNames)).slice().sort((a, b) => (Number(b.times) || 0) - (Number(a.times) || 0) || a.name.localeCompare(b.name));
  const names = [];
  const cap = Math.max(1, Math.min(3, Math.floor(limit) || 3));
  for (const row of ranked) {
    const name = String(row.name).replace(/\s+/g, " ").trim();
    if (names.some((have) => namesMatch(have, name))) continue;
    names.push(name);
    if (names.length >= cap) break;
  }
  return names;
}
function typeFrames(line, reduced) {
  const text = String(line || "");
  if (reduced || text.length < 2) return [text];
  const frames = [];
  for (let i = 1; i <= text.length; i += 1) frames.push(text.slice(0, i));
  return frames;
}
function decideGuide(input = {}) {
  const settings = input.settings ? parseGuideSettings(input.settings) : emptyGuideSettings();
  if (guideIsOff(settings)) return null;
  const session = input.session || createGuideSession();
  const step = surface(input.step);
  const itemCount = Math.max(0, Math.floor(Number(input.itemCount) || 0));
  const listNames = (input.listNames || []).map((name) => String(name || "")).filter(Boolean);
  const usuals = input.usuals || [];
  const unfound = (input.unfound || []).map((name) => String(name || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (input.savingsCard) return null;
  if (!session.shown["trip-saved"] && session.trip) {
    const names = (session.trip.items || []).map((item) => item.name).filter(Boolean);
    return {
      moment: "trip-saved",
      line: tripLine(session.trip.saved),
      chips: [
        { id: "save", label: "Save Shopping list", action: "save-list", names },
        { id: "skip", label: "Not this time", action: "later" }
      ]
    };
  }
  if (!session.shown.receipt && session.receipt && session.receipt.count > 0) {
    const offList = session.receipt.lines.filter((line) => line?.name && !onList(line.name, listNames));
    const picks = receiptPicks(offList, usuals, 6);
    if (picks.length) {
      return {
        moment: "receipt",
        line: receiptLine(offList.length),
        chips: [
          ...picks.map((name) => ({ id: `pick:${normalizeName(name)}`, label: name, action: "toggle-pick", name })),
          { id: "add", label: "Add selected", action: "commit-picks" }
        ]
      };
    }
  }
  if (step === "review" && !session.shown["review-next"] && String(input.pricesLabel || "").trim() && unfound.length) {
    const search = input.search;
    const chips = [];
    if (search?.kroger?.url) {
      chips.push({
        id: "kroger",
        label: search.kroger.label || "Search at Kroger",
        action: "open-search",
        url: search.kroger.url,
        name: unfound[0]
      });
    }
    if (search?.walmart?.url) {
      chips.push({
        id: "walmart",
        label: search.walmart.label || "Search at Walmart",
        action: "open-search",
        url: search.walmart.url,
        name: unfound[0]
      });
    }
    if (chips.length < 3) chips.push({ id: "keep", label: "Keep these", action: "later" });
    return {
      moment: "review-next",
      line: reviewLine(unfound),
      chips: chips.slice(0, 3)
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
          { id: "add", label: "Add selected", action: "commit-picks" }
        ]
      };
    }
  }
  if (step === "build" && itemCount > 0 && !session.shown["before-review"]) {
    return {
      moment: "before-review",
      line: BEFORE_REVIEW_LINE,
      chips: [
        { id: "review", label: "Review", action: "review" },
        { id: "later", label: "Not yet", action: "later" }
      ]
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
        { id: "enough", label: "Hide tips", action: "close-guide" }
      ]
    };
  }
  if (step === "build" && itemCount === 0 && !session.shown.welcome) {
    return {
      moment: "welcome",
      line: WELCOME_LINE,
      chips: [
        { id: "say", label: "Say or type my list", action: "focus-ask" },
        { id: "usuals", label: "Use my usuals", action: "use-usuals" },
        { id: "receipt", label: "Upload a receipt", action: "upload-receipt" }
      ]
    };
  }
  return null;
}
function applyGuideFrame(current, next, options = {}) {
  if (options.holding) return { prompt: current, defer: true, hidden: false };
  if (options.dialogOpen || options.fieldFocused) return { prompt: null, defer: true, hidden: true };
  return { prompt: next, defer: false, hidden: !next };
}
function momentStillFits(input, moment) {
  const session = input.session || createGuideSession();
  const shown = {};
  for (const id of MOMENTS) {
    if (id !== moment) shown[id] = true;
  }
  return decideGuide({ ...input, session: { ...session, shown } })?.moment === moment;
}
function presentGuide(input = {}) {
  const session = input.session || createGuideSession();
  const settings = input.settings ? parseGuideSettings(input.settings) : emptyGuideSettings();
  const view = input.view || {};
  const current = input.current || null;
  const packed = { ...view, settings, session };
  const decision = decideGuide(packed);
  const frame = applyGuideFrame(current, decision, input);
  if (frame.defer) {
    return { session, current, defer: true, hidden: frame.hidden };
  }
  if (current?.moment === "review-next" && !session.declined?.["review-next"]) {
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
function surface(step) {
  const id = String(step || "").toLowerCase();
  if (id === "add" || id === "home" || id === "build") return "build";
  if (id === "plan" || id === "review") return "review";
  if (id === "shop" || id === "store" || id === "in-store") return "shop";
  return "other";
}
function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}
function clampCount(value, max) {
  const number = Math.floor(Number(value) || 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(max, number);
}
function roundDollars(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}
function readLines(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      const name = entry.replace(/\s+/g, " ").trim();
      if (name) out.push({ name: name.slice(0, 120), quantity: 1 });
    } else {
      const row = asRecord(entry);
      if (!row) continue;
      const name = String(row.name || row.label || row.raw || row.productName || "").replace(/\s+/g, " ").trim();
      if (!name) continue;
      out.push({ name: name.slice(0, 120), quantity: Math.max(1, Math.floor(Number(row.quantity) || 1)) });
    }
    if (out.length >= 80) break;
  }
  return out;
}
export {
  DISMISS_LABEL,
  DISMISS_LIMIT,
  GUIDE_KEY,
  GUIDE_LABEL,
  GUIDE_QUIET_MS,
  MOMENTS,
  MOMENT_RANK,
  REPLIES_LABEL,
  RUNNING_LOW_STAPLES,
  TURN_OFF_LABEL,
  applyGuideFrame,
  clearTripNote,
  createGuideSession,
  decideGuide,
  dismissGuide,
  emptyGuideSettings,
  formatDollars,
  guideIsOff,
  importReceiptUrl,
  linesFromImportBody,
  linesFromReceipt,
  momentStillFits,
  namesMatch,
  normalizeName,
  noteDeclined,
  noteReceipt,
  noteShown,
  noteTrip,
  onList,
  parseGuideSettings,
  presentGuide,
  readGuideSettings,
  receiptLine,
  receiptLinesFromImportBody,
  receiptLinesFromPayload,
  receiptPicks,
  reviewLine,
  runningLowLine,
  runningLowSuggestions,
  runningLowUsuals,
  setGuideEnabled,
  tripLine,
  typeFrames,
  writeGuideSettings
};
