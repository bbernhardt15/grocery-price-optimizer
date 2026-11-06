/**
 * Review-tab plans. Best price is the cheapest way to buy every priced
 * item. Fewer stores is the cheapest way that uses strictly fewer stops.
 * A store that cannot sell the whole list is named, never quoted as a
 * cheaper plan for a shorter list.
 */

import { applyTripEdits, normalizeStoreKey, roundMoney } from "./tripPlan.js";
import { formatMoney } from "./savingsMeter.js";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function upcDigits(value) {
  const digits = String(value || "").replace(/\D/g, "").replace(/^0+/, "");
  return digits.length >= 8 ? digits : "";
}

/** One requested line. Copies of the same line collapse; they do not add quantity. */
export function assignmentKey(item) {
  const lineId = clean(item?.lineId);
  if (lineId) return `line:${lineId}`;
  const upc = upcDigits(item?.upc);
  if (upc) return `upc:${upc}`;
  const productId = clean(item?.productId).toLowerCase();
  if (productId) return `id:${productId}`;
  const name = clean(item?.query || item?.name).toLowerCase();
  return name ? `name:${name}` : "";
}

/**
 * Unit price. A line total that was stored in `price` is not multiplied again.
 * @param {{ price?: number, itemTotal?: number, quantity?: number }} item
 */
export function unitPrice(item) {
  const qty = Math.max(1, Math.floor(Number(item?.quantity) || 1));
  const price = Number(item?.price);
  const total = Number(item?.itemTotal);
  if (Number.isFinite(price) && price >= 0) {
    if (qty > 1 && Number.isFinite(total) && total >= 0 && Math.abs(price - total) < 0.02 && total > 0) {
      return roundMoney(total / qty);
    }
    return price;
  }
  if (Number.isFinite(total) && total >= 0) return roundMoney(total / qty);
  return NaN;
}

export function lineMoney(item) {
  const price = unitPrice(item);
  if (!Number.isFinite(price)) return 0;
  const qty = Math.max(1, Math.floor(Number(item?.quantity) || 1));
  return roundMoney(price * qty);
}

function rememberOffer(map, storeName, price, source) {
  const name = clean(storeName);
  const key = normalizeStoreKey(name);
  const amount = Number(price);
  if (!key || !Number.isFinite(amount) || amount < 0) return;
  const prev = map.get(key);
  if (!prev || amount < prev.price) map.set(key, { storeName: name, price: amount, source: source || null });
}

function offersOf(line) {
  const map = new Map();
  rememberOffer(map, line?.storeName, unitPrice(line), null);
  for (const offer of line?.offers || []) rememberOffer(map, offer?.storeName, offer?.price, offer);
  return [...map.values()];
}

function mergeOffers(left, right) {
  const map = new Map();
  for (const offer of [...(left || []), ...(right || [])]) {
    rememberOffer(map, offer?.storeName, offer?.price, offer);
  }
  return [...map.values()].map((row) => row.source || { storeName: row.storeName, price: row.price });
}

/**
 * Collapse a price set that was merged twice (the same line on Kroger and
 * Walmart). Distinct requests that share a UPC but not a line id add quantity.
 * @param {Array<{ storeName?: string, items?: object[] }>} stores
 */
function collectKey(item) {
  const upc = upcDigits(item?.upc);
  if (upc) return `upc:${upc}`;
  return assignmentKey(item);
}

export function collectPlanLines(stores) {
  /** @type {Map<string, any>} */
  const groups = new Map();
  for (const store of stores || []) {
    for (const item of store?.items || []) {
      const key = collectKey(item) || `row:${groups.size}`;
      const qty = Math.max(1, Math.floor(Number(item?.quantity) || 1));
      const existing = groups.get(key);
      if (!existing) {
        const lineIds = new Set(clean(item?.lineId) ? [clean(item.lineId)] : []);
        const price = unitPrice(item);
        groups.set(key, {
          ...item,
          quantity: qty,
          ...(Number.isFinite(price) ? { price } : {}),
          offers: mergeOffers(item?.offers, []),
          lineIds,
        });
        continue;
      }
      const lineId = clean(item?.lineId);
      if (!lineId || existing.lineIds.has(lineId)) existing.quantity = Math.max(existing.quantity, qty);
      else {
        existing.lineIds.add(lineId);
        existing.quantity += qty;
      }
      existing.offers = mergeOffers(existing.offers, item?.offers);
      const price = unitPrice(item);
      if (Number.isFinite(price)) rememberOfferOnLine(existing, item.storeName, price);
    }
  }
  return [...groups.values()].map((line) => {
    const quantity = Math.max(1, Math.floor(Number(line.quantity) || 1));
    const price = Number(line.price);
    const { lineIds: _lineIds, ...rest } = line;
    return {
      ...rest,
      quantity,
      ...(Number.isFinite(price) ? { price, itemTotal: roundMoney(price * quantity) } : {}),
    };
  });
}

function rememberOfferOnLine(line, storeName, price) {
  line.offers = mergeOffers(line.offers, [{ storeName, price }]);
}

/**
 * One copy of each line, grouped by the store it is already on.
 * Safe to run before another total.
 * @param {Array<{ storeName?: string, items?: object[] }>} stores
 */
export function dedupeStores(stores) {
  const lines = collectPlanLines(stores);
  /** @type {Map<string, { storeName: string, items: object[], prior?: object }>} */
  const grouped = new Map();
  for (const line of lines) {
    const storeName = clean(line.storeName) || "Store";
    const key = normalizeStoreKey(storeName);
    if (!grouped.has(key)) grouped.set(key, { storeName, items: [] });
    const price = unitPrice(line);
    const quantity = Math.max(1, Math.floor(Number(line.quantity) || 1));
    grouped.get(key).items.push({
      ...line,
      storeName,
      quantity,
      ...(Number.isFinite(price) ? { price, itemTotal: roundMoney(price * quantity) } : {}),
    });
  }
  return [...grouped.values()]
    .map((group) => {
      const prior = (stores || []).find((store) => normalizeStoreKey(store.storeName) === normalizeStoreKey(group.storeName));
      const items = group.items;
      return {
        ...(prior || {}),
        storeName: group.storeName,
        items,
        subtotal: roundMoney(items.reduce((sum, item) => sum + lineMoney(item), 0)),
        itemCount: items.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0),
      };
    })
    .filter((store) => store.items.length);
}

function placeLine(line, choice) {
  const quantity = Math.max(1, Math.floor(Number(line.quantity) || 1));
  const price = choice.price;
  return {
    ...line,
    storeName: choice.storeName,
    price,
    quantity,
    itemTotal: roundMoney(price * quantity),
    offers: line.offers,
  };
}

function pack(buckets, missing, lines) {
  const stores = [...buckets.values()]
    .filter((store) => store.items.length)
    .map((store) => ({
      storeName: store.storeName,
      items: store.items,
      subtotal: roundMoney(store.items.reduce((sum, item) => sum + lineMoney(item), 0)),
      itemCount: store.items.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0),
    }))
    .sort((a, b) => a.storeName.localeCompare(b.storeName));
  return {
    stores,
    total: roundMoney(stores.reduce((sum, store) => sum + store.subtotal, 0)),
    stops: stores.length,
    missing,
    complete: missing.length === 0 && lines.length > 0,
    itemCount: lines.length - missing.length,
  };
}

function assign(lines, allowedNames) {
  const allowed = allowedNames ? new Set(allowedNames.map((name) => normalizeStoreKey(name))) : null;
  /** @type {Map<string, { storeName: string, items: object[] }>} */
  const buckets = new Map();
  if (allowedNames) {
    for (const name of allowedNames) buckets.set(normalizeStoreKey(name), { storeName: name, items: [] });
  }
  const missing = [];
  for (const line of lines) {
    const options = offersOf(line)
      .filter((offer) => !allowed || allowed.has(normalizeStoreKey(offer.storeName)))
      .sort((a, b) => a.price - b.price || a.storeName.localeCompare(b.storeName));
    if (!options.length) {
      missing.push(line);
      continue;
    }
    const choice = options[0];
    const key = normalizeStoreKey(choice.storeName);
    if (!buckets.has(key)) buckets.set(key, { storeName: choice.storeName, items: [] });
    buckets.get(key).items.push(placeLine(line, choice));
  }
  return pack(buckets, missing, lines);
}

function combinations(names, size) {
  const out = [];
  const pick = (start, chosen) => {
    if (chosen.length === size) {
      out.push(chosen.slice());
      return;
    }
    for (let index = start; index < names.length; index += 1) {
      chosen.push(names[index]);
      pick(index + 1, chosen);
      chosen.pop();
    }
  };
  pick(0, []);
  return out;
}

function storeNamesOf(lines) {
  const names = [];
  const seen = new Set();
  for (const line of lines) {
    for (const offer of offersOf(line)) {
      const key = normalizeStoreKey(offer.storeName);
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(offer.storeName);
    }
  }
  return names.sort((a, b) => a.localeCompare(b));
}

function sameStopSet(left, right) {
  const names = (plan) =>
    (plan?.stores || [])
      .map((store) => normalizeStoreKey(store.storeName))
      .filter(Boolean)
      .sort();
  const a = names(left);
  const b = names(right);
  return a.length === b.length && a.every((name, index) => name === b[index]);
}

export function joinStoreNames(stores) {
  const names = (stores || []).map((store) => clean(store.storeName || store)).filter(Boolean);
  if (names.length === 0) return "No store";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function stopPhrase(count) {
  const stops = Math.max(0, Math.floor(Number(count) || 0));
  return `${stops} ${stops === 1 ? "store" : "stores"}`;
}

/**
 * @param {Array<{ storeName?: string, items?: object[] }>} stores
 */
export function buildReviewPlans(stores) {
  const lines = collectPlanLines(stores).filter((line) => offersOf(line).length);
  const best = assign(lines, null);
  const names = storeNamesOf(lines);
  const coverage = names
    .map((storeName) => {
      const plan = assign(lines, [storeName]);
      return {
        storeName,
        missing: plan.missing.length,
        complete: plan.complete,
        total: plan.complete ? plan.total : null,
      };
    })
    .sort((a, b) => a.missing - b.missing || (a.total ?? Infinity) - (b.total ?? Infinity) || a.storeName.localeCompare(b.storeName));

  let fewer = null;
  const pool = names.slice(0, 8);
  const maxStops = Math.max(0, best.stops - 1);
  for (let size = 1; size <= maxStops; size += 1) {
    let winner = null;
    for (const subset of combinations(pool, size)) {
      const plan = assign(lines, subset);
      if (!plan.complete) continue;
      if (!winner || plan.total < winner.total - 0.009) winner = plan;
    }
    if (winner) {
      fewer = winner;
      break;
    }
  }

  if (fewer && (fewer.stops >= best.stops || sameStopSet(fewer, best))) fewer = null;
  if (fewer && fewer.total + 0.009 < best.total) {
    best.stores = fewer.stores;
    best.total = fewer.total;
    best.stops = fewer.stops;
    best.missing = fewer.missing;
    best.complete = fewer.complete;
    fewer = null;
  }

  const baseline = coverage.find((row) => row.complete) || null;
  const single = baseline?.complete ? assign(lines, [baseline.storeName]) : null;
  const saved = baseline && Number.isFinite(baseline.total) ? roundMoney(baseline.total - best.total) : null;
  const coverageNotes = coverage
    .filter((row) => row.missing > 0)
    .map((row) => ({
      storeName: row.storeName,
      missing: row.missing,
      text: `${row.storeName} is missing ${row.missing} ${row.missing === 1 ? "item" : "items"}`,
    }));

  return {
    lines,
    best,
    fewer,
    baseline,
    single,
    saved,
    coverageNotes,
    signature: lines.map((line) => assignmentKey(line)).sort().join("|"),
  };
}

export function formatPlanDetail(plan) {
  if (!plan) return "";
  const figure = Number.isFinite(plan.total) && plan.total > 0 ? formatMoney(plan.total) : "";
  return [joinStoreNames(plan.stores), stopPhrase(plan.stops), figure].filter(Boolean).join(" · ");
}

export function fewerDeltaText(fewer, best) {
  if (!fewer || !best) return "";
  const delta = roundMoney(Number(fewer.total) - Number(best.total));
  const gap = Math.max(1, best.stops - fewer.stops);
  const stops = `${gap} fewer stop${gap === 1 ? "" : "s"}`;
  if (delta > 0.009) return `+${formatMoney(delta)} for ${stops} · more than the best price`;
  if (delta < -0.009) return `${formatMoney(Math.abs(delta))} less than the best price`;
  return "Same price as the best price";
}

export function savingsVersusBaseline(plans) {
  if (!plans?.baseline || !Number.isFinite(plans.baseline.total)) {
    return plans?.coverageNotes?.[0]?.text || "No single store has this whole list.";
  }
  const saved = Number(plans.saved) || 0;
  const storeName = plans.baseline.storeName;
  if (saved > 0.009) return `Gitter saved you ${formatMoney(saved)} versus shopping only at ${storeName}.`;
  if (saved < -0.009) return `This plan costs ${formatMoney(Math.abs(saved))} more than shopping only at ${storeName}.`;
  return `Same total as shopping only at ${storeName}.`;
}

/**
 * The selected plan, rebuilt once so a second pass cannot add the price again.
 * @param {Array<{ storeName?: string, items?: object[] }>} stores
 * @param {"spread" | "fewer" | "custom" | string} mode
 * @param {object} [capabilities]
 */
export function selectPlan(stores, mode, capabilities = {}) {
  const deduped = dedupeStores(stores);
  const plans = buildReviewPlans(deduped);
  const picked = mode === "fewer" && plans.fewer ? plans.fewer : plans.best;
  const rebuilt = applyTripEdits(picked.stores, {}, capabilities);
  return {
    plans,
    stores: rebuilt.stores,
    total: rebuilt.total,
    mode: mode === "fewer" && plans.fewer ? "fewer" : "spread",
  };
}

/** @param {Array<{ storeName?: string, items?: object[] }>} stores @param {string[]} modes */
export function selectRepeatedly(stores, modes, capabilities = {}) {
  let current = stores;
  /** @type {number[]} */
  const totals = [];
  for (const mode of modes || []) {
    const next = selectPlan(current, mode, capabilities);
    totals.push(next.total);
    current = next.stores;
  }
  return totals;
}
