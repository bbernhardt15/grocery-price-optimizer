/** How a saved line follows its list. `inherit` uses the list switch. */
export type ItemWatch = "inherit" | "on" | "off";

export type DropReason = "saved" | "target" | "both";

export type PriceQuote = {
  storeName: string;
  price: number;
  zip?: string;
  availability?: string;
  status?: string;
};

export type DropDecision = {
  oldPrice: number;
  newPrice: number;
  savings: number;
  reason: DropReason;
  /** True when the new price is also under the shopper's target. */
  hitTarget: boolean;
};

export function cents(value: number): number {
  if (!Number.isFinite(value)) {
    return Number.NaN;
  }
  return Math.round(value * 100);
}

export function fromCents(value: number): number {
  return value / 100;
}

/**
 * A list switch watches every line. A line can opt in on its own, or opt out
 * while the list is on.
 */
export function itemIsWatched(listEnabled: boolean, watch: ItemWatch): boolean {
  if (watch === "on") {
    return true;
  }
  if (watch === "off") {
    return false;
  }
  return listEnabled;
}

/**
 * Best in-stock price for this shopper.
 * A blank offer ZIP is a catalog-wide price (Walmart). A ZIP on the offer
 * has to match the list. Out-of-stock and inactive rows are ignored.
 */
export function bestQuote(offers: PriceQuote[], zip: string): PriceQuote | null {
  const wanted = zip.trim().slice(0, 5);
  const usable = offers.filter((offer) => {
    if ((offer.status ?? "active") !== "active") {
      return false;
    }
    if (offer.availability === "out_of_stock") {
      return false;
    }
    if (!Number.isFinite(offer.price) || offer.price <= 0) {
      return false;
    }
    const offerZip = (offer.zip ?? "").trim().slice(0, 5);
    if (!wanted) {
      return true;
    }
    return offerZip === "" || offerZip === wanted;
  });
  if (usable.length === 0) {
    return null;
  }
  return usable.slice().sort((a, b) => a.price - b.price || a.storeName.localeCompare(b.storeName))[0] ?? null;
}

/**
 * Alert when the best price is at least one cent under the price saved with
 * the item. A target under that saved price is the same kind of drop: crossing
 * it is included, and a target above the saved price does not fire on its own
 * (the item was already cheaper than that target).
 * A later alert only happens when the price is lower than the last one we
 * recorded for this saved price.
 */
export function evaluateDrop(input: {
  baselinePrice: number;
  targetPrice?: number | null;
  bestPrice: number;
  lastNotifiedPrice?: number | null;
}): DropDecision | null {
  const next = cents(input.bestPrice);
  const baseline = cents(input.baselinePrice);
  const target =
    typeof input.targetPrice === "number" && Number.isFinite(input.targetPrice) && input.targetPrice > 0
      ? cents(input.targetPrice)
      : null;
  if (!Number.isFinite(next) || next <= 0 || !Number.isFinite(baseline) || baseline <= 0) {
    return null;
  }
  const belowSaved = next < baseline;
  const targetCounts = target != null && target < baseline && next < target;
  if (!belowSaved && !targetCounts) {
    return null;
  }
  const previous =
    typeof input.lastNotifiedPrice === "number" && Number.isFinite(input.lastNotifiedPrice)
      ? cents(input.lastNotifiedPrice)
      : null;
  if (previous != null && next >= previous) {
    return null;
  }
  const oldCents = previous ?? baseline;
  if (next >= oldCents) {
    return null;
  }
  const savings = oldCents - next;
  if (savings < 1) {
    return null;
  }
  const reason: DropReason = belowSaved && targetCounts ? "both" : belowSaved ? "saved" : "target";
  return {
    oldPrice: fromCents(oldCents),
    newPrice: fromCents(next),
    savings: fromCents(savings),
    reason,
    hitTarget: targetCounts,
  };
}

/** One drop is the saved price plus the new price, in cents. */
export function dropKey(
  deviceId: string,
  listId: string,
  productKey: string,
  baselinePrice: number,
  newPrice: number
): string {
  return `${deviceId}:${listId}:${productKey}:${cents(baselinePrice)}:${cents(newPrice)}`;
}

/** Browse ids look like `upc:{catalog key}`. The catalog stores the key alone. */
export function catalogProductKey(productId: string): string {
  const id = productId.trim();
  if (id.startsWith("upc:")) {
    return id.slice(4);
  }
  return id;
}
