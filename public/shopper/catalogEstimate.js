/**
 * A trip total from prices already on the catalog tiles.
 * Used before the store plan comes back, so a priced list never reads $0.00.
 */

function linePrice(product) {
  const best = Number(product?.bestOffer?.price);
  if (Number.isFinite(best) && best > 0) return best;
  const offers = Array.isArray(product?.offers) ? product.offers : [];
  const prices = offers.map((offer) => Number(offer?.price)).filter((price) => Number.isFinite(price) && price > 0);
  if (prices.length) return Math.min(...prices);
  const direct = Number(product?.price);
  return Number.isFinite(direct) && direct > 0 ? direct : 0;
}

/**
 * @param {Array<{ quantity?: number, product?: object }> | null | undefined} entries
 */
export function catalogTripEstimate(entries) {
  let total = 0;
  let priced = 0;
  let unpriced = 0;
  for (const entry of entries || []) {
    const quantity = Math.max(1, Math.floor(Number(entry?.quantity) || 1));
    const price = linePrice(entry?.product);
    if (price > 0) {
      total += price * quantity;
      priced += 1;
    } else {
      unpriced += 1;
    }
  }
  return {
    total: Math.round(total * 100) / 100,
    priced,
    unpriced,
  };
}
