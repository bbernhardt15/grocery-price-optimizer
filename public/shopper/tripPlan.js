/**
 * Trip edits the shopper can make on the device: move a line, lock a store,
 * copy a list, and remember in-store checks. The server still builds the
 * first handoff. This module rebuilds totals and actions after an edit so
 * the checklist works offline.
 */

const KROGER_CART_START = "/api/kroger/cart/start";

const STORES = [
  { name: "Kroger", tier: "cart", aliases: ["kroger"] },
  { name: "Walmart", tier: "cart", aliases: ["walmart"] },
  { name: "Target", tier: "link", aliases: ["target"] },
  { name: "Aldi", tier: "link", aliases: ["aldi"] },
  { name: "Publix", tier: "link", dealsOnly: true, aliases: ["publix"] },
  { name: "H-E-B", tier: "link", dealsOnly: true, aliases: ["h e b", "heb"] },
  { name: "Meijer", tier: "link", dealsOnly: true, aliases: ["meijer"] },
  { name: "Safeway", tier: "link", aliases: ["safeway"] },
  { name: "Albertsons", tier: "link", dealsOnly: true, aliases: ["albertsons"] },
  { name: "Vons", tier: "link", dealsOnly: true, aliases: ["vons"] },
  { name: "Jewel-Osco", tier: "link", dealsOnly: true, aliases: ["jewel osco"] },
  { name: "Acme", tier: "link", dealsOnly: true, aliases: ["acme", "acme markets"] },
  { name: "Tom Thumb", tier: "link", dealsOnly: true, aliases: ["tom thumb"] },
  { name: "Randalls", tier: "link", dealsOnly: true, aliases: ["randalls"] },
  { name: "Pavilions", tier: "link", dealsOnly: true, aliases: ["pavilions"] },
  { name: "Food Lion", tier: "link", aliases: ["food lion"] },
  { name: "Giant", tier: "link", aliases: ["giant", "giant food"] },
  { name: "Stop & Shop", tier: "link", dealsOnly: true, aliases: ["stop and shop"] },
  { name: "Sprouts", tier: "link", dealsOnly: true, aliases: ["sprouts", "sprouts farmers market"] },
  { name: "Winn-Dixie", tier: "link", dealsOnly: true, aliases: ["winn dixie"] },
  { name: "Costco", tier: "link", dealsOnly: true, aliases: ["costco"] },
  { name: "Sam's Club", tier: "link", aliases: ["sams club"] },
  { name: "Whole Foods", tier: "link", aliases: ["whole foods", "whole foods market"] },
  { name: "Amazon Fresh", tier: "link", aliases: ["amazon fresh"] },
  { name: "Giant Eagle", tier: "list", aliases: ["giant eagle"] },
];

const TIER_BY_ALIAS = new Map();
for (const store of STORES) {
  for (const alias of store.aliases) TIER_BY_ALIAS.set(alias, store.tier);
}

const DEPARTMENT_ORDER = [
  "Produce",
  "Dairy & Eggs",
  "Meat & Seafood",
  "Bakery",
  "Deli",
  "Pantry",
  "Frozen",
  "Snacks",
  "Beverages",
  "Breakfast",
  "Baby",
  "Household",
  "Personal Care",
  "Pet",
  "Other",
];

export const CHECKS_KEY = "gg-trip-checks";
export const TRIP_SNAPSHOT_KEY = "gg-last-trip";

export function normalizeStoreKey(storeName) {
  return String(storeName || "")
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tierForStore(storeName) {
  return TIER_BY_ALIAS.get(normalizeStoreKey(storeName)) || "list";
}

/** Canonical store name → tier. Kept in step with src/storeHandoffConfig.ts. */
export function storeTiers() {
  return Object.fromEntries(STORES.map((store) => [store.name, store.tier]));
}

export function roundMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

export function priceSourceLabel(source) {
  switch (source) {
    case "live":
    case "cached_live":
      return "Live shelf price";
    case "weekly_ad":
    case "cached_weekly_ad":
      return "Weekly ad";
    case "partner_feed":
      return "Partner feed";
    case "seed":
      return "Demo catalog";
    case "mixed":
      return "Mixed prices";
    case "unavailable":
      return "Price unavailable";
    default:
      return "Price";
  }
}

export function storePriceLabel(items) {
  const sources = [...new Set((items || []).map((item) => item?.priceSource).filter(Boolean))];
  if (sources.length === 1) return priceSourceLabel(sources[0]);
  if (sources.length > 1) return "Mixed prices";
  return "Price";
}

function dealsOnlyStore(storeName) {
  const key = normalizeStoreKey(storeName);
  return STORES.some((store) => store.dealsOnly && store.aliases.includes(key));
}

/** Store-card label. Weekly-ad-only banners stay distinct from a shelf price. */
export function segmentPriceLabel(storeName, items, prior) {
  const source = prior?.pricing?.source;
  if (
    source === "live" ||
    source === "cached_live" ||
    source === "partner_feed" ||
    source === "mixed" ||
    source === "seed" ||
    source === "unavailable"
  ) {
    return priceSourceLabel(source);
  }
  if (source === "weekly_ad" || source === "cached_weekly_ad" || dealsOnlyStore(storeName)) {
    return "Weekly ad, not shelf price";
  }
  const fromItems = storePriceLabel(items);
  if (fromItems === "Weekly ad") return "Weekly ad, not shelf price";
  if (prior?.handoff?.priceLabel && fromItems === "Price") return prior.handoff.priceLabel;
  return fromItems;
}

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(roundMoney(value));
}

function sameStore(left, right) {
  return normalizeStoreKey(left) === normalizeStoreKey(right);
}

function syntheticOffer(item) {
  return {
    storeName: item.storeName,
    name: item.name,
    brand: item.brand,
    price: item.price,
    unit: item.unit,
    normalizedUnit: item.normalizedUnit,
    size: item.size,
    productId: item.productId,
    upc: item.upc,
    locationId: item.locationId,
    priceSource: item.priceSource,
    department: item.department,
    aisle: item.aisle,
    url: item.url,
  };
}

function offersOf(item) {
  return item?.offers?.length ? item.offers : [syntheticOffer(item)];
}

export function assignedOffer(item, edits = {}) {
  const offers = offersOf(item);
  const moved = item?.lineId ? edits.moves?.[item.lineId] : undefined;
  if (moved) {
    const found = offers.find((offer) => sameStore(offer.storeName, moved));
    if (found) return found;
  }
  if (edits.lockedStore) {
    const found = offers.find((offer) => sameStore(offer.storeName, edits.lockedStore));
    if (found) return found;
  }
  return offers.find((offer) => sameStore(offer.storeName, item.storeName)) || offers[0];
}

function cleanText(value) {
  const text = String(value || "").trim();
  return text || undefined;
}

function lineFromOffer(item, offer) {
  const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
  const price = Number(offer.price);
  const same = sameStore(offer.storeName, item.storeName);
  const size = cleanText(offer.size) || (same ? cleanText(item.size) : undefined);
  const aisle = cleanText(offer.aisle) || (same ? cleanText(item.aisle) : undefined);
  return {
    query: item.query,
    lineId: item.lineId,
    quantity,
    name: offer.name || item.name,
    brand: offer.brand || item.brand || "",
    storeName: offer.storeName,
    price,
    itemTotal: roundMoney(price * quantity),
    unit: offer.unit || item.unit,
    normalizedUnit: offer.normalizedUnit || item.normalizedUnit,
    ...(size ? { size } : {}),
    ...(cleanText(offer.productId) ? { productId: cleanText(offer.productId) } : {}),
    ...(cleanText(offer.upc) ? { upc: cleanText(offer.upc) } : {}),
    ...(cleanText(offer.locationId) ? { locationId: cleanText(offer.locationId) } : {}),
    ...(offer.priceSource ? { priceSource: offer.priceSource } : {}),
    department: offer.department || item.department,
    ...(aisle ? { aisle } : {}),
    ...(offer.url ? { url: offer.url } : {}),
    ...(same && item.matchKind ? { matchKind: item.matchKind } : {}),
    offers: item.offers,
  };
}

function numericWalmartId(item) {
  if (item?.priceSource === "weekly_ad" || item?.priceSource === "seed") return "";
  const id = String(item?.productId || "").trim();
  return /^\d+$/.test(id) ? id : "";
}

function formatIdQty(id, quantity) {
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  return qty === 1 ? id : `${id}|${qty}`;
}

/** Same shape as walmartAddToCartUrl for numeric item ids. */
export function walmartCartUrl(lines, publisherId, options = {}) {
  const pairs = [];
  for (const line of lines || []) {
    const id = String(line?.itemId || "").trim();
    if (!/^\d+$/.test(id)) continue;
    pairs.push(formatIdQty(id, line.quantity));
  }
  if (!pairs.length) return "";
  const params = new URLSearchParams();
  params.set("items", pairs.join(","));
  const storeId = String(options.storeId || "").trim();
  if (/^\d+$/.test(storeId)) params.set("storeId", storeId);
  const accessPointId = String(options.accessPointId || "").trim();
  if (/^[A-Za-z0-9-]+$/.test(accessPointId)) params.set("ap", accessPointId);
  const destination = `https://www.walmart.com/sc/cart/addToCart?${params.toString()}`;
  const publisher = String(publisherId || "").trim();
  if (!publisher) return destination;
  const wrap = new URLSearchParams({
    veh: "aff",
    sourceid: "imp_000011112222333344",
    u: destination,
  });
  return `https://goto.walmart.com/c/${encodeURIComponent(publisher)}/568844/9383?${wrap.toString()}`;
}

function toHandoffItem(storeName, item) {
  return {
    name: item.name,
    brand: item.brand || "",
    quantity: item.quantity,
    price: item.price,
    ...(item.productId ? { productId: item.productId } : {}),
    ...(item.upc ? { upc: item.upc } : {}),
    ...(item.locationId ? { locationId: item.locationId } : {}),
    ...(item.size ? { size: item.size } : {}),
    ...(item.lineId ? { lineId: item.lineId } : {}),
    ...(item.department ? { department: item.department } : {}),
    ...(item.aisle ? { aisle: item.aisle } : {}),
    ...(item.url ? { url: item.url, openLabel: `Open in ${storeName}` } : {}),
    ...(item.priceSource ? { priceSource: item.priceSource } : {}),
  };
}

export function buildHandoff(storeName, items, capabilities = {}, prior) {
  const tier = tierForStore(storeName);
  const handoffItems = (items || []).map((item) => toHandoffItem(storeName, item));
  const subtotal = roundMoney(handoffItems.reduce((sum, item) => sum + roundMoney(Number(item.price) * Number(item.quantity || 1)), 0));
  const firstUrl = handoffItems.find((item) => item.url)?.url;
  let action = null;

  if (tier === "cart" && normalizeStoreKey(storeName) === "kroger" && capabilities.krogerCart) {
    const ready = handoffItems.some((item) => item.upc || item.productId);
    if (ready) {
      action = {
        type: "kroger_cart",
        label: `Send to ${storeName} cart`,
        url: KROGER_CART_START,
        status: "needs_shopper_login",
        ...(firstUrl ? { fallbackUrl: firstUrl } : {}),
        detail: "Signs in to Kroger, then adds the items.",
      };
    }
  }

  if (!action && tier === "cart" && normalizeStoreKey(storeName) === "walmart") {
    const lines = [];
    for (const item of handoffItems) {
      const itemId = numericWalmartId(item);
      if (itemId) lines.push({ itemId, quantity: item.quantity });
    }
    const url = walmartCartUrl(lines, capabilities.walmartPublisherId, {
      storeId: capabilities.walmartStoreId,
      accessPointId: capabilities.walmartAccessPointId,
    });
    if (url) {
      action = {
        type: "walmart_cart",
        label: `Send to ${storeName} cart`,
        url,
        status: "ready",
        ...(firstUrl ? { fallbackUrl: firstUrl } : {}),
        detail: "Opens walmart.com with the items in the cart link. Grocery Gitter does not report the cart as filled.",
      };
    }
  }

  if (!action) {
    action = {
      type: "shop_list",
      label: `Open ${storeName} list`,
      status: handoffItems.length ? "ready" : "unavailable",
      ...(firstUrl ? { url: firstUrl } : {}),
      detail: firstUrl
        ? `Checklist with item links. Each line has an Open in ${storeName} link. Not a cart fill.`
        : `Checklist only. ${storeName} has no verified item link.`,
    };
  }

  const priceLabel = segmentPriceLabel(storeName, items, prior);

  return {
    storeName,
    tier,
    priceLabel,
    itemCount: handoffItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
    subtotal,
    items: handoffItems,
    action,
  };
}

export function applyTripEdits(stores, edits = {}, capabilities = {}) {
  const grouped = new Map();
  for (const store of stores || []) {
    for (const item of store.items || []) {
      const offer = assignedOffer(item, edits);
      const next = lineFromOffer(item, offer);
      const bucket = grouped.get(next.storeName) || [];
      bucket.push(next);
      grouped.set(next.storeName, bucket);
    }
  }

  const nextStores = [...grouped.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([storeName, items]) => {
      const subtotal = roundMoney(items.reduce((sum, item) => sum + item.itemTotal, 0));
      const prior = (stores || []).find((store) => sameStore(store.storeName, storeName));
      return {
        storeName,
        items,
        subtotal,
        itemCount: items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
        ...(prior?.pricing ? { pricing: prior.pricing } : {}),
        ...(prior?.nearbyStore ? { nearbyStore: prior.nearbyStore } : {}),
        handoff: buildHandoff(storeName, items, capabilities, prior),
      };
    });

  return {
    stores: nextStores,
    total: roundMoney(nextStores.reduce((sum, store) => sum + store.subtotal, 0)),
  };
}

export function singleStoreSavings(lines) {
  const priced = (lines || []).filter((line) => Number(line?.quantity) > 0);
  const splitTotal = roundMoney(
    priced.reduce((sum, line) => sum + Number(line.itemTotal ?? Number(line.price) * Number(line.quantity)), 0)
  );
  const names = new Set();
  for (const line of priced) {
    for (const offer of line.offers || []) {
      if (offer?.storeName) names.add(offer.storeName);
    }
  }

  let best = null;
  for (const storeName of names) {
    let total = 0;
    let complete = true;
    for (const line of priced) {
      const offer = (line.offers || []).find((row) => sameStore(row.storeName, storeName));
      if (!offer || !Number.isFinite(Number(offer.price))) {
        complete = false;
        break;
      }
      total += Number(line.quantity) * Number(offer.price);
    }
    if (!complete) continue;
    total = roundMoney(total);
    if (!best || total < best.total || (total === best.total && storeName.localeCompare(best.storeName) < 0)) {
      best = { storeName, total };
    }
  }

  if (!best) {
    return {
      splitTotal,
      singleStore: null,
      savings: 0,
      note: "No single store carries every item on this trip.",
    };
  }

  const savings = roundMoney(best.total - splitTotal);
  let note;
  if (savings > 0) {
    note = `Save ${money(savings)} versus a one-store trip at ${best.storeName} (${money(best.total)}).`;
  } else if (savings < 0) {
    note = `This trip costs ${money(Math.abs(savings))} more than shopping only at ${best.storeName} (${money(best.total)}).`;
  } else {
    note = `Same total as shopping only at ${best.storeName}.`;
  }
  return { splitTotal, singleStore: best, savings, note };
}

export function formatItemLine(item) {
  const quantity = Math.max(1, Math.floor(Number(item?.quantity) || 1));
  const name = String(item?.name || "Item").replace(/\s+/g, " ").trim();
  const size = String(item?.size || "").replace(/\s+/g, " ").trim();
  return size ? `${quantity} ${name}, ${size}` : `${quantity} ${name}`;
}

/**
 * One item per line, with quantity and size. Per-store text is only the
 * lines, so it can paste into a store app's list. A whole trip puts the
 * store name above each group.
 */
export function formatTripText(stores, options = {}) {
  const blocks = [];
  for (const store of stores || []) {
    const lines = (store.items || []).map(formatItemLine).filter(Boolean);
    if (!lines.length) continue;
    const heading = `${store.storeName} list`;
    blocks.push(options.headed ? [heading, ...lines].join("\n") : lines.join("\n"));
  }
  return blocks.join("\n\n");
}

function departmentRank(name) {
  const index = DEPARTMENT_ORDER.indexOf(name || "Other");
  return index === -1 ? DEPARTMENT_ORDER.length : index;
}

export function groupForAisle(items) {
  const sorted = [...(items || [])].sort((left, right) => {
    const byDepartment = departmentRank(left.department || "Other") - departmentRank(right.department || "Other");
    if (byDepartment !== 0) return byDepartment;
    const byAisle = String(left.aisle || "").localeCompare(String(right.aisle || ""));
    if (byAisle !== 0) return byAisle;
    return String(left.name || "").localeCompare(String(right.name || ""));
  });
  const groups = [];
  for (const item of sorted) {
    const department = item.department || "Other";
    const aisle = item.aisle || "";
    const last = groups[groups.length - 1];
    if (last && last.department === department && last.aisle === aisle) {
      last.items.push(item);
    } else {
      groups.push({ department, aisle, items: [item] });
    }
  }
  return groups;
}

export function tripFingerprint(stores) {
  const ids = [];
  for (const store of stores || []) {
    for (const item of store.items || []) ids.push(String(item.lineId || item.query || item.name || ""));
  }
  return ids.join("|");
}

function readCheckMap(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(CHECKS_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function readChecks(storage, tripId) {
  if (!storage || !tripId) return {};
  const row = readCheckMap(storage)[tripId];
  return row && typeof row === "object" ? { ...row } : {};
}

export function writeCheck(storage, tripId, lineId, checked) {
  if (!storage || !tripId || !lineId) return {};
  const all = readCheckMap(storage);
  const row = { ...(all[tripId] && typeof all[tripId] === "object" ? all[tripId] : {}) };
  if (checked) row[lineId] = true;
  else delete row[lineId];
  all[tripId] = row;
  storage.setItem(CHECKS_KEY, JSON.stringify(all));
  return row;
}

export function saveTripSnapshot(storage, payload, edits) {
  if (!storage || !payload) return;
  storage.setItem(
    TRIP_SNAPSHOT_KEY,
    JSON.stringify({
      payload,
      edits: {
        lockedStore: edits?.lockedStore || null,
        moves: { ...(edits?.moves || {}) },
      },
      savedAt: Date.now(),
    })
  );
}

export function readTripSnapshot(storage) {
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(TRIP_SNAPSHOT_KEY) || "null");
    if (!parsed?.payload?.stores) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function shareItemId(item, index) {
  const raw = String(item?.lineId || item?.name || index)
    .toLowerCase()
    .replace(/[^a-z0-9:._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return raw || `item-${index}`;
}
