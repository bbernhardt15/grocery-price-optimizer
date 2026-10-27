/**
 * Savings versus the most expensive store that can fill every priced line,
 * plus the cheapest single-store baseline. Callers pass shelf quotes
 * (and substitutes, when those are allowed). Out-of-stock offers stay out.
 */

export function roundMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  // Nudge off binary prices like 1.005 so half-cents round the way a receipt does.
  const nudged = amount * 100 + (amount >= 0 ? 1e-8 : -1e-8);
  return Math.round(nudged) / 100;
}

export function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(roundMoney(value));
}

/**
 * @param {Array<{ storeName?: string, price?: number }>} quotes
 * @returns {Array<{ storeName: string, price: number }>}
 */
function cheapestByStore(quotes) {
  const best = new Map();
  for (const quote of quotes || []) {
    const storeName = String(quote?.storeName ?? "").trim();
    const price = Number(quote?.price);
    if (!storeName || !Number.isFinite(price) || price < 0) continue;
    const previous = best.get(storeName);
    if (previous === undefined || price < previous) best.set(storeName, price);
  }
  return [...best.entries()].map(([storeName, price]) => ({ storeName, price }));
}

function emptyMeter() {
  return {
    status: "empty",
    lineCount: 0,
    unpricedCount: 0,
    storeCount: 0,
    splitTotal: 0,
    expensive: null,
    baseline: null,
    saved: 0,
    savedVsBaseline: 0,
    ratio: 0,
  };
}

/**
 * @param {Array<{ quantity?: number, quotes?: Array<{ storeName?: string, price?: number }> }>} lines
 * @param {{ splitTotal?: number }} [options] Use splitTotal to compare a planned trip total.
 */
export function estimateSavings(lines, options = {}) {
  const priced = [];
  let unpricedCount = 0;
  for (const line of lines || []) {
    const quantity = Number(line?.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    const quotes = cheapestByStore(line.quotes);
    if (quotes.length === 0) {
      unpricedCount += 1;
      continue;
    }
    priced.push({ quantity, quotes });
  }

  if (priced.length === 0 && unpricedCount === 0) return emptyMeter();

  const storeNames = [...new Set(priced.flatMap((line) => line.quotes.map((quote) => quote.storeName)))];
  const totals = Object.fromEntries(storeNames.map((store) => [store, 0]));
  const missing = Object.fromEntries(storeNames.map((store) => [store, false]));
  let split = 0;
  let highEach = 0;

  for (const line of priced) {
    const prices = line.quotes.map((quote) => quote.price);
    split += roundMoney(Math.min(...prices) * line.quantity);
    highEach += roundMoney(Math.max(...prices) * line.quantity);
    for (const store of storeNames) {
      const hit = line.quotes.find((quote) => quote.storeName === store);
      if (!hit) missing[store] = true;
      else totals[store] += roundMoney(hit.price * line.quantity);
    }
  }

  const complete = storeNames
    .filter((store) => !missing[store])
    .map((storeName) => ({ storeName, total: roundMoney(totals[storeName]) }))
    .sort((a, b) => a.total - b.total || a.storeName.localeCompare(b.storeName));

  split = roundMoney(split);
  highEach = roundMoney(highEach);
  const override = Number(options.splitTotal);
  if (Number.isFinite(override) && override >= 0) split = roundMoney(override);

  if (complete.length === 0 || unpricedCount > 0) {
    const comparable = unpricedCount === 0 && highEach > 0;
    const saved = comparable ? roundMoney(Math.max(0, highEach - split)) : 0;
    const ratio = comparable && highEach > 0 ? Math.min(100, Math.round((saved / highEach) * 100)) : 0;
    return {
      status: "partial",
      lineCount: priced.length,
      unpricedCount,
      storeCount: 0,
      splitTotal: split,
      expensive: null,
      baseline: null,
      highEachTotal: comparable ? highEach : null,
      saved,
      savedVsBaseline: 0,
      ratio,
    };
  }

  const baseline = complete[0];
  const expensive = [...complete].sort(
    (a, b) => b.total - a.total || a.storeName.localeCompare(b.storeName)
  )[0];
  const saved = roundMoney(Math.max(0, expensive.total - split));
  const savedVsBaseline = roundMoney(Math.max(0, baseline.total - split));
  const ratio = expensive.total > 0 ? Math.min(100, Math.round((saved / expensive.total) * 100)) : 0;

  return {
    status: "ready",
    lineCount: priced.length,
    unpricedCount: 0,
    storeCount: complete.length,
    splitTotal: split,
    expensive,
    baseline,
    saved,
    savedVsBaseline,
    ratio,
  };
}

function tripCostsMore(meter) {
  return Boolean(meter.baseline) && meter.splitTotal > meter.baseline.total + 0.001 && meter.saved === 0;
}

/**
 * @param {ReturnType<typeof estimateSavings>} meter
 * @param {{ subject?: "list" | "item" }} [options]
 */
export function describeSavings(meter, options = {}) {
  const subject = options.subject === "item" ? "item" : "list";
  if (!meter || meter.status === "empty") {
    return {
      badge: null,
      note: "Add items to compare a split trip with the priciest store that carries all of them.",
      caption: "Waiting for your list",
      meterText: "Add items to see savings versus the priciest store.",
    };
  }

  if (meter.status === "partial") {
    if (meter.unpricedCount > 0) {
      const note = `Some picks don’t have a price yet. The priced ones come to ${formatMoney(meter.splitTotal)}.`;
      return {
        badge: null,
        note,
        caption: "Waiting on a price for every item",
        meterText: note,
      };
    }
    const extra =
      options.allowSubstitutes === false
        ? " Allow substitutes if a close item would fill a gap."
        : "";
    if (meter.saved > 0 && meter.highEachTotal > 0) {
      const badge = `Save ${formatMoney(meter.saved)}`;
      const note = `No single store carries every item. You still save ${formatMoney(meter.saved)} versus ${formatMoney(meter.highEachTotal)} if each item is bought at its highest price.${extra}`;
      const caption = `${formatMoney(meter.saved)} saved · ${meter.ratio}% under the highest price on each item`;
      return { badge, note, caption, meterText: note };
    }
    const note = `No single store carries every item. The split so far is ${formatMoney(meter.splitTotal)}.${extra}`;
    return {
      badge: null,
      note,
      caption: "Need one store to stock the whole list",
      meterText: note,
    };
  }

  const expensive = meter.expensive;
  const baseline = meter.baseline;
  if (!expensive || !baseline) {
    return describeSavings({ ...meter, status: "partial", unpricedCount: 0 });
  }

  if (subject === "item") {
    if (meter.saved > 0) {
      const badge = `Save ${formatMoney(meter.saved)}`;
      const note = `${baseline.storeName} is lowest at ${formatMoney(meter.splitTotal)}. ${expensive.storeName} is ${formatMoney(expensive.total)} — you save ${formatMoney(meter.saved)} on this item.`;
      const caption = `${formatMoney(meter.saved)} less than ${expensive.storeName}`;
      return { badge, note, caption, meterText: note };
    }
    if (meter.storeCount <= 1) {
      const note = `${baseline.storeName} is the only listed price (${formatMoney(meter.splitTotal)}).`;
      return { badge: null, note, caption: "One store", meterText: note };
    }
    const note = `Same price at every store that stocks it (${formatMoney(meter.splitTotal)}).`;
    return { badge: null, note, caption: "No price gap", meterText: note };
  }

  if (meter.saved > 0) {
    const badge = `Save ${formatMoney(meter.saved)}`;
    let note = `You saved ${formatMoney(meter.saved)} with Grocery Gitter, versus ${formatMoney(expensive.total)} at ${expensive.storeName}.`;
    if (meter.savedVsBaseline >= 0.05 && baseline.storeName !== expensive.storeName) {
      note += ` That is also ${formatMoney(meter.savedVsBaseline)} under ${baseline.storeName}.`;
    }
    const caption = `${formatMoney(meter.saved)} saved · ${meter.ratio}% less than ${expensive.storeName}`;
    return {
      badge,
      note,
      caption,
      meterText: `Save ${formatMoney(meter.saved)} versus ${expensive.storeName}, ${meter.ratio}% of that store's total.`,
    };
  }

  if (tripCostsMore(meter)) {
    const note = `This trip (${formatMoney(meter.splitTotal)}) costs more than ${baseline.storeName} alone (${formatMoney(baseline.total)}).`;
    return { badge: null, note, caption: "No savings versus one store", meterText: note };
  }

  if (meter.storeCount <= 1) {
    const note = `${baseline.storeName} is the only store that stocks this whole list (${formatMoney(baseline.total)}).`;
    return { badge: null, note, caption: "No second store to compare", meterText: note };
  }

  const note = `${baseline.storeName} already matches this split (${formatMoney(baseline.total)}).`;
  return { badge: null, note, caption: "No extra savings versus one store", meterText: note };
}
