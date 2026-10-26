/**
 * Coupons the shopper handles themselves.
 *
 * Store coupon pages are links. Grocery Gitter does not clip them and does
 * not read them. A coupon the shopper types in is kept on this device (and
 * on the signed-in saved list) and is estimated separately from the
 * store-to-store price comparison in `singleStoreSavings`.
 *
 * Integration point: call `couponSavingsSummary(stores, coupons)` with the
 * same store groups you pass to `singleStoreSavings`. Do not add the coupon
 * dollars to that comparison.
 */

export const COUPONS_KEY = "gg-own-coupons";
export const CLIPPED_KEY = "gg-coupon-clipped";

/**
 * Real store pages, checked October 2026. A home page is used only when a
 * coupon page could not be confirmed. Kept in step with src/coupons/pages.json.
 */
export const COUPON_PAGES = [
  { storeName: "Kroger", url: "https://www.kroger.com/savings/cl/coupons/", label: "Kroger digital coupons", note: "Opens Kroger’s coupon page. You clip them there, on your shopper card. Grocery Gitter cannot clip them for you.", kind: "coupons", aliases: ["kroger"] },
  { storeName: "Walmart", url: "https://www.walmart.com/walmartcash", label: "Walmart Cash", note: "Opens Walmart Cash. Those offers come from Ibotta and are clipped on Walmart, not here.", kind: "coupons", aliases: ["walmart"] },
  { storeName: "Target", url: "https://www.target.com/circle", label: "Target Circle", note: "Opens Target Circle. You save the deals in Target’s app or on Target’s site.", kind: "coupons", aliases: ["target"] },
  { storeName: "Aldi", url: "https://www.aldi.us/store/aldi/pages/weekly-specials", label: "This week’s ALDI Finds", note: "Aldi does not offer digital coupons to clip. This opens this week’s ad.", kind: "weekly", aliases: ["aldi"] },
  { storeName: "Publix", url: "https://www.publix.com/savings/digital-coupons", label: "Publix digital coupons", note: "Opens Publix digital coupons. Clip them on your Publix account, then use your phone number at checkout.", kind: "coupons", aliases: ["publix"] },
  { storeName: "Meijer", url: "https://www.meijer.com/shopping/coupons.html", label: "Meijer mPerks coupons", note: "Opens Meijer coupons. Clip them to your mPerks account. Grocery Gitter cannot clip them for you.", kind: "coupons", aliases: ["meijer"] },
  { storeName: "H-E-B", url: "https://www.heb.com/digital-coupon/coupon-selection/all-coupons", label: "H-E-B digital coupons", note: "Opens H-E-B digital coupons. Clip them in the H-E-B app or on heb.com.", kind: "coupons", aliases: ["h e b", "heb"] },
  { storeName: "Albertsons", url: "https://www.albertsons.com/rewards/all-coupons", label: "Albertsons for U coupons", note: "Opens Albertsons for U coupons. Clip them on your for U account.", kind: "coupons", aliases: ["albertsons"] },
  { storeName: "Safeway", url: "https://www.safeway.com/rewards/all-coupons", label: "Safeway for U coupons", note: "Opens Safeway for U coupons. Clip them on your for U account.", kind: "coupons", aliases: ["safeway"] },
  { storeName: "Vons", url: "https://www.vons.com/rewards/all-coupons", label: "Vons for U coupons", note: "Opens Vons for U coupons. Clip them on your for U account.", kind: "coupons", aliases: ["vons"] },
  { storeName: "Jewel-Osco", url: "https://www.jewelosco.com/rewards/all-coupons", label: "Jewel-Osco for U coupons", note: "Opens Jewel-Osco for U coupons. Clip them on your for U account.", kind: "coupons", aliases: ["jewel osco"] },
  { storeName: "Acme", url: "https://www.acmemarkets.com/rewards/all-coupons", label: "Acme for U coupons", note: "Opens Acme for U coupons. Clip them on your for U account.", kind: "coupons", aliases: ["acme", "acme markets"] },
  { storeName: "Tom Thumb", url: "https://www.tomthumb.com/rewards/all-coupons", label: "Tom Thumb for U coupons", note: "Opens Tom Thumb for U coupons. Clip them on your for U account.", kind: "coupons", aliases: ["tom thumb"] },
  { storeName: "Randalls", url: "https://www.randalls.com/rewards/all-coupons", label: "Randalls for U coupons", note: "Opens Randalls for U coupons. Clip them on your for U account.", kind: "coupons", aliases: ["randalls"] },
  { storeName: "Pavilions", url: "https://www.pavilions.com/rewards/all-coupons", label: "Pavilions for U coupons", note: "Opens Pavilions for U coupons. Clip them on your for U account.", kind: "coupons", aliases: ["pavilions"] },
  { storeName: "Food Lion", url: "https://shop.foodlion.com/", label: "Food Lion", note: "We could not confirm a public Food Lion coupon page, so this opens Food Lion’s home page. Clip coupons in the Food Lion app.", kind: "home", aliases: ["food lion"] },
  { storeName: "Giant", url: "https://giantfood.com/savings/coupons/browse", label: "Giant Food coupons", note: "Opens Giant Food coupons. This is Giant Food, not Giant Eagle. Clip them on your Giant account.", kind: "coupons", aliases: ["giant", "giant food"] },
  { storeName: "Stop & Shop", url: "https://stopandshop.com/savings/coupons/browse", label: "Stop & Shop coupons", note: "Opens Stop & Shop coupons. Clip them on your Stop & Shop account.", kind: "coupons", aliases: ["stop and shop"] },
  { storeName: "Sprouts", url: "https://shop.sprouts.com/store/sprouts/pages/in-store-deals", label: "Sprouts digital coupons", note: "Opens Sprouts deals. Clip coupons in the Sprouts app or on this page, then scan your barcode at checkout.", kind: "coupons", aliases: ["sprouts", "sprouts farmers market"] },
  { storeName: "Winn-Dixie", url: "https://www.winndixie.com/coupons", label: "Winn-Dixie digital coupons", note: "Opens Winn-Dixie digital coupons. Clip them on your Winn-Dixie account.", kind: "coupons", aliases: ["winn dixie"] },
  { storeName: "Costco", url: "https://www.costco.com/whse-savings.html", label: "Costco Warehouse Savings", note: "Costco does not offer a public coupon clip page. This opens warehouse savings. A membership may be required.", kind: "deals", aliases: ["costco"] },
  { storeName: "Sam's Club", url: "https://www.samsclub.com/shop/savings", label: "Sam's Club savings", note: "Sam’s Club does not share a coupon clip page we can link. This opens Sam’s Club savings. A membership may be required.", kind: "deals", aliases: ["sams club"] },
  { storeName: "Whole Foods", url: "https://www.wholefoodsmarket.com/sales-flyer", label: "Whole Foods weekly sales", note: "Whole Foods does not share a coupon clip page we can link. This opens the weekly sales flyer.", kind: "weekly", aliases: ["whole foods", "whole foods market"] },
  { storeName: "Amazon Fresh", url: "https://www.amazon.com/", label: "Amazon", note: "Amazon Fresh does not share a coupon page we can link, so this opens Amazon’s home page.", kind: "home", aliases: ["amazon fresh"] },
  { storeName: "Giant Eagle", url: "https://www.gianteagle.com/coupons", label: "Giant Eagle coupons", note: "Opens Giant Eagle coupons. Clip them in the Giant Eagle app or on this page. This is not Giant Food.", kind: "coupons", aliases: ["giant eagle"] },
];

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function normalizeStoreKey(storeName) {
  return String(storeName || "")
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function roundMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

export function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(roundMoney(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function couponPageFor(storeName) {
  const key = normalizeStoreKey(storeName);
  if (!key) return undefined;
  const page = COUPON_PAGES.find((row) => row.aliases.includes(key) || normalizeStoreKey(row.storeName) === key);
  if (!page) return undefined;
  return {
    storeName: page.storeName,
    url: page.url,
    label: page.label,
    note: page.note,
    kind: page.kind,
  };
}

export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function friendlyDay(day) {
  const match = String(day || "").match(DAY);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

/** Badge only when the line is already marked on sale. Was-price and end date only when present. */
export function saleBadge(item) {
  if (!item?.onSale) return null;
  const price = Number(item.price);
  const regular = Number(item.regularPrice);
  const was = Number.isFinite(regular) && Number.isFinite(price) && regular > price ? `was ${money(regular)}` : "";
  const ends = friendlyDay(item.saleEndsOn);
  return { label: "On sale", was, ends: ends ? `ends ${ends}` : "" };
}

export function saleBadgeMarkup(item) {
  const badge = saleBadge(item);
  if (!badge) return "";
  const was = badge.was ? `<span class="sale-was">${escapeHtml(badge.was)}</span>` : "";
  const ends = badge.ends ? `<span class="sale-ends">${escapeHtml(badge.ends)}</span>` : "";
  return `<span class="sale-badge">${escapeHtml(badge.label)}</span>${was}${ends}`;
}

export function couponChecklist(items) {
  const names = [];
  const seen = new Set();
  for (const item of items || []) {
    const name = String(item?.name || "").replace(/\s+/g, " ").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

export function checklistSentence(names, limit = 8) {
  const list = (names || []).filter(Boolean);
  if (!list.length) return "Nothing on this store’s list yet.";
  const shown = list.slice(0, limit);
  const extra = list.length - shown.length;
  const body = extra > 0 ? `${shown.join(", ")}, and ${extra} more` : joinNames(shown);
  return `Look for coupons on: ${body}.`;
}

function joinNames(names) {
  if (names.length <= 1) return names[0] || "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function cleanId(value) {
  const id = String(value || "").trim().slice(0, 80);
  return /^[A-Za-z0-9:_-]{1,80}$/.test(id) ? id : "";
}

/** Trip line ids look like "0:large eggs". Keep the words; drop only control characters. */
function cleanLineId(value) {
  const id = String(value || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!id || /[\u0000-\u001f<>]/.test(id)) return "";
  return id;
}

export function normalizeCoupon(value) {
  if (!value || typeof value !== "object") return null;
  const id = cleanId(value.id);
  const storeName = String(value.storeName || "").trim().slice(0, 80);
  const itemName = String(value.itemName || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const lineId = cleanLineId(value.lineId);
  const kind = value.kind === "percent" ? "percent" : value.kind === "dollars" ? "dollars" : "";
  const amount = roundMoney(value.amount);
  const expiresOn = DAY.test(String(value.expiresOn || "")) ? String(value.expiresOn) : "";
  if (!id || !storeName || !itemName || !lineId || !kind || !(amount > 0)) return null;
  if (kind === "percent" && amount > 100) return null;
  if (kind === "dollars" && amount > 500) return null;
  return {
    id,
    storeName,
    lineId,
    itemName,
    kind,
    amount,
    ...(expiresOn ? { expiresOn } : {}),
  };
}

export function parseCouponForm(input) {
  const storeName = String(input?.storeName || "").trim();
  const lineId = String(input?.lineId || "").trim();
  const itemName = String(input?.itemName || "").trim();
  const kind = input?.kind === "percent" ? "percent" : "dollars";
  const rawAmount = String(input?.amount ?? "").trim().replace(/^\$/, "");
  const amount = Number(rawAmount);
  const expiresRaw = String(input?.expiresOn || "").trim();
  if (!storeName || !lineId || !itemName) {
    return { ok: false, error: "Choose an item on this store’s list." };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: kind === "percent" ? "Enter a percent greater than 0." : "Enter a dollar amount greater than 0." };
  }
  if (kind === "percent" && amount > 100) {
    return { ok: false, error: "A percent coupon can’t be more than 100%." };
  }
  if (kind === "dollars" && amount > 500) {
    return { ok: false, error: "Enter an amount of $500 or less." };
  }
  if (expiresRaw && !DAY.test(expiresRaw)) {
    return { ok: false, error: "Use a real expiration date, or leave it blank." };
  }
  const coupon = normalizeCoupon({
    id: input?.id || `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    storeName,
    lineId,
    itemName,
    kind,
    amount,
    expiresOn: expiresRaw,
  });
  if (!coupon) return { ok: false, error: "That coupon could not be saved." };
  return { ok: true, coupon };
}

export function couponExpired(coupon, today = todayKey()) {
  return Boolean(coupon?.expiresOn && coupon.expiresOn < today);
}

export function sameCouponLine(left, right) {
  if (!left || !right) return false;
  if (normalizeStoreKey(left.storeName) !== normalizeStoreKey(right.storeName)) return false;
  if (left.lineId && right.lineId) return left.lineId === right.lineId;
  return String(left.itemName || "").trim().toLowerCase() === String(right.itemName || "").trim().toLowerCase();
}

function matchesLine(coupon, item) {
  if (coupon.lineId && item?.lineId && coupon.lineId === item.lineId) return true;
  return String(coupon.itemName || "").trim().toLowerCase() === String(item?.name || "").trim().toLowerCase();
}

export function lineDiscount(coupon, itemTotal, today = todayKey()) {
  if (!coupon || couponExpired(coupon, today)) return 0;
  const total = roundMoney(Math.max(0, Number(itemTotal) || 0));
  if (coupon.kind === "percent") {
    const pct = Math.min(100, Math.max(0, Number(coupon.amount) || 0));
    return roundMoney((total * pct) / 100);
  }
  return roundMoney(Math.min(total, Math.max(0, Number(coupon.amount) || 0)));
}

export function couponsForStore(store, coupons, today = todayKey()) {
  const used = new Set();
  const rows = [];
  for (const coupon of coupons || []) {
    if (normalizeStoreKey(coupon?.storeName) !== normalizeStoreKey(store?.storeName)) continue;
    const item = (store?.items || []).find((line) => {
      const key = line?.lineId || line?.name;
      return key && !used.has(key) && matchesLine(coupon, line);
    });
    if (!item) continue;
    used.add(item.lineId || item.name);
    const itemTotal = roundMoney(item.itemTotal ?? Number(item.price) * Number(item.quantity || 1));
    rows.push({
      coupon,
      item,
      amount: lineDiscount(coupon, itemTotal, today),
      expired: couponExpired(coupon, today),
    });
  }
  let left = roundMoney(Math.max(0, Number(store?.subtotal) || 0));
  for (const row of rows) {
    if (row.expired) {
      row.amount = 0;
      continue;
    }
    const applied = roundMoney(Math.min(row.amount, left));
    row.amount = applied;
    left = roundMoney(left - applied);
  }
  return rows;
}

/**
 * Estimated coupon savings for the trip. Shelf totals are unchanged.
 * `singleStoreSavings` must keep using those shelf totals.
 */
export function couponSavingsSummary(stores, coupons, today = todayKey()) {
  const byStore = (stores || []).map((store) => {
    const rows = couponsForStore(store, coupons, today);
    const savings = roundMoney(rows.reduce((sum, row) => sum + row.amount, 0));
    const shelf = roundMoney(store?.subtotal ?? 0);
    return {
      storeName: store?.storeName || "",
      shelf,
      savings,
      estimated: roundMoney(Math.max(0, shelf - savings)),
      rows,
    };
  });
  const savings = roundMoney(byStore.reduce((sum, store) => sum + store.savings, 0));
  const shelf = roundMoney(byStore.reduce((sum, store) => sum + store.shelf, 0));
  return {
    savings,
    shelf,
    estimatedTotal: roundMoney(Math.max(0, shelf - savings)),
    byStore,
  };
}

export function couponLineLabel(row) {
  const name = row?.coupon?.itemName || row?.item?.name || "Item";
  if (row?.expired) {
    const when = friendlyDay(row.coupon?.expiresOn);
    return `Your coupon · ${name} · expired${when ? ` ${when}` : ""}`;
  }
  if (row?.coupon?.kind === "percent") {
    return `Your coupon · ${name} · ${row.coupon.amount}% off (${money(row.amount)})`;
  }
  return `Your coupon · ${name} · ${money(row.amount)} off`;
}

export function readCoupons(storage) {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(COUPONS_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeCoupon).filter(Boolean).slice(0, 40);
  } catch {
    return [];
  }
}

export function writeCoupons(storage, coupons) {
  const next = (coupons || []).map(normalizeCoupon).filter(Boolean).slice(0, 40);
  storage?.setItem(COUPONS_KEY, JSON.stringify(next));
  return next;
}

/** One coupon per line. A new one for the same line replaces the old one. */
export function upsertCoupon(storage, coupon) {
  const saved = normalizeCoupon(coupon);
  if (!saved) return readCoupons(storage);
  const rest = readCoupons(storage).filter((row) => !sameCouponLine(row, saved));
  return writeCoupons(storage, [...rest, saved]);
}

export function removeCoupon(storage, id) {
  return writeCoupons(storage, readCoupons(storage).filter((row) => row.id !== id));
}

function clippedMap(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(CLIPPED_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function readClipped(storage, tripId) {
  if (!storage || !tripId) return {};
  const row = clippedMap(storage)[tripId];
  return row && typeof row === "object" ? { ...row } : {};
}

export function isClipped(storage, tripId, storeName) {
  return Boolean(readClipped(storage, tripId)[normalizeStoreKey(storeName)]);
}

export function writeClipped(storage, tripId, storeName, checked) {
  if (!storage || !tripId || !storeName) return {};
  const all = clippedMap(storage);
  const row = { ...(all[tripId] && typeof all[tripId] === "object" ? all[tripId] : {}) };
  const key = normalizeStoreKey(storeName);
  if (checked) row[key] = true;
  else delete row[key];
  all[tripId] = row;
  storage.setItem(CLIPPED_KEY, JSON.stringify(all));
  return row;
}

export function couponSummaryMarkup(summary) {
  return `<p class="trip-coupon-savings">Estimated coupon savings (if clipped): ${escapeHtml(money(summary?.savings || 0))}</p>
    <p class="trip-coupon-total">Trip total including estimated coupons: <strong>${escapeHtml(money(summary?.estimatedTotal || 0))}</strong> <span class="estimate-tag">estimated</span></p>
    <p class="muted coupon-estimate-note">This is only the coupons you typed in. It is separate from the price comparison above. We can’t see coupons you clip on a store’s site.</p>`;
}

export function storeCouponMarkup(store, options) {
  const page = options.page || couponPageFor(store?.storeName);
  const rows = options.rows || [];
  const names = couponChecklist(store?.items);
  const sentence = checklistSentence(names);
  const open = options.open ? " open" : "";
  const link = page
    ? `<a class="coupon-link" href="${escapeHtml(page.url)}" data-coupon-link="${escapeHtml(page.url)}">${escapeHtml(`Open ${page.label}`)}</a>
       <p class="muted coupon-note">${escapeHtml(page.note)}</p>`
    : `<p class="muted coupon-note">We don’t have a coupon page for ${escapeHtml(store?.storeName || "this store")} yet.</p>`;
  const clipped = options.clipped ? " checked" : "";
  const storeName = escapeHtml(store?.storeName || "");
  const lines = rows
    .map((row) => {
      return `<li class="your-coupon">
        <span>${escapeHtml(couponLineLabel(row))}</span>
        <button type="button" class="text-btn" data-coupon-remove="${escapeHtml(row.coupon.id)}">Remove</button>
      </li>`;
    })
    .join("");
  const applied = rows.some((row) => row.amount > 0);
  const storeSummary = options.storeSummary;
  const estimated = applied && storeSummary
    ? `<p class="store-coupon-total"><span>With your coupons</span><strong>${escapeHtml(money(storeSummary.estimated))}</strong><span class="estimate-tag">estimated</span></p>`
    : "";
  const form = options.canEnter
    ? couponFormMarkup(store)
    : `<p class="muted">Coupon links stay free. <button type="button" class="linkish" data-open-paywall="1">Grocery Gitter Pro</button> lets you type in a coupon you already have.</p>`;
  return `<details class="coupon-panel"${open}>
    <summary>Check ${storeName} coupons before you shop</summary>
    <div class="coupon-body">
      ${link}
      <p class="coupon-list">${escapeHtml(sentence)}</p>
      <label class="check-line coupon-clipped">
        <input type="checkbox" data-coupon-clipped="${storeName}"${clipped} />
        <span>I clipped my coupons</span>
      </label>
      ${lines ? `<ul class="your-coupon-list">${lines}</ul>` : ""}
      ${estimated}
      ${form}
    </div>
  </details>`;
}

function couponFormMarkup(store) {
  const options = (store?.items || [])
    .map((item) => {
      const lineId = item?.lineId || "";
      if (!lineId) return "";
      return `<option value="${escapeHtml(lineId)}">${escapeHtml(item.name)}</option>`;
    })
    .join("");
  if (!options) return `<p class="muted">Add items to this store before you enter a coupon.</p>`;
  const storeName = escapeHtml(store.storeName || "");
  return `<form class="coupon-form" data-coupon-store="${storeName}">
    <p class="coupon-form-title">Add a coupon you already have</p>
    <label>Item
      <select data-coupon-line required>${options}</select>
    </label>
    <div class="coupon-amount">
      <label>Amount off
        <input data-coupon-amount type="number" inputmode="decimal" min="0.01" step="0.01" required />
      </label>
      <label>Dollars or percent
        <select data-coupon-kind>
          <option value="dollars">Dollars</option>
          <option value="percent">Percent</option>
        </select>
      </label>
    </div>
    <label>Expires, if it has a date
      <input data-coupon-expires type="date" />
    </label>
    <button type="button" class="ghost" data-add-coupon>Add coupon</button>
    <p class="coupon-form-error" data-coupon-error role="alert" hidden></p>
  </form>`;
}
