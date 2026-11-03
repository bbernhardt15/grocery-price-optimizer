/**
 * What the trip saved, and the running total kept on the account profile.
 */

function money(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function round(amount) {
  return Math.round(Number(amount) * 100) / 100;
}

/**
 * @param {{ savings?: { lifetimeCents?: number, usualStore?: string } } | null | undefined} profile
 * @param {number} dollars
 */
export function addLifetimeSavings(profile, dollars) {
  const current = Math.max(0, Math.floor(Number(profile?.savings?.lifetimeCents) || 0));
  const add = Math.max(0, Math.round(Number(dollars) * 100));
  return {
    lifetimeCents: current + add,
    usualStore: String(profile?.savings?.usualStore || ""),
  };
}

/** @param {number} cents */
export function lifetimeLabel(cents) {
  const dollars = Math.max(0, Math.floor(Number(cents) || 0)) / 100;
  return money(dollars);
}

/**
 * @param {{
 *   stores?: Array<{ storeName?: string, subtotal?: number, items?: object[] }>,
 *   planTotal?: number,
 *   singleStore?: { storeName?: string, total?: number } | null,
 *   usualStore?: string,
 *   usualTotal?: number | null,
 *   lifetimeCents?: number,
 *   marks?: Record<string, string>,
 * }} input
 */
export function tripValueSummary(input = {}) {
  const stores = (input.stores || [])
    .filter((store) => (store.items || []).length)
    .map((store) => ({
      storeName: store.storeName || "Store",
      subtotal: round(store.subtotal),
      items: (store.items || []).map((item) => {
        const id = String(item?.lineId || "");
        const mark = input.marks?.[id] || "sent";
        return {
          lineId: id,
          name: String(item?.name || "Item"),
          quantity: Math.max(1, Math.floor(Number(item?.quantity) || 1)),
          storeName: store.storeName || "Store",
          status: mark === "confirmed" ? "Confirmed" : mark === "bought" ? "Bought" : "Sent to cart",
        };
      }),
    }));
  const paid = round(input.planTotal ?? stores.reduce((sum, store) => sum + Number(store.subtotal || 0), 0));
  const single = input.singleStore && Number(input.singleStore.total) > 0 ? input.singleStore : null;
  const savedVsSingle = single ? round(Math.max(0, Number(single.total) - paid)) : 0;
  const usualTotal = Number(input.usualTotal);
  const usualStore = String(input.usualStore || "");
  const savedVsUsual = usualStore && Number.isFinite(usualTotal) && usualTotal > 0 ? round(Math.max(0, usualTotal - paid)) : 0;
  return {
    stores,
    paid,
    paidLabel: money(paid),
    singleStore: single?.storeName || "",
    singleTotalLabel: single ? money(single.total) : "",
    savedVsSingle,
    savedVsSingleLabel: savedVsSingle > 0 ? money(savedVsSingle) : "",
    usualStore,
    savedVsUsual,
    savedVsUsualLabel: savedVsUsual > 0 ? money(savedVsUsual) : "",
    lifetimeLabel: lifetimeLabel(input.lifetimeCents),
  };
}

/**
 * Total if every line were bought at one named store. Null when that store
 * does not carry the whole list.
 * @param {object[]} lines
 * @param {string} storeName
 */
export function totalAtStore(lines, storeName) {
  const wanted = String(storeName || "").trim().toLowerCase();
  if (!wanted) return null;
  let total = 0;
  for (const line of lines || []) {
    const quantity = Math.max(1, Math.floor(Number(line?.quantity) || 1));
    const offers = line?.offers || [];
    const hit = offers.find((offer) => String(offer?.storeName || "").trim().toLowerCase() === wanted && Number(offer?.price) > 0);
    const own = String(line?.storeName || "").trim().toLowerCase() === wanted ? Number(line?.price) : NaN;
    const price = hit ? Number(hit.price) : own;
    if (!Number.isFinite(price) || price <= 0) return null;
    total += price * quantity;
  }
  return lines?.length ? round(total) : null;
}
