/**
 * Same rules as src/catalog/bestValue.ts. The shelf ranks sizes the browser
 * already has: cheapest shelf price, compared only when the unit matches.
 */

function roundPer(per) {
  return Math.round(per * 10000) / 10000;
}

function formatPer(per) {
  const digits = per > 0 && per < 0.01 ? 3 : 2;
  return `$${per.toFixed(digits)}`;
}

export function basisPhrase(basis) {
  if (basis === "volume") return "fl oz";
  if (basis === "weight") return "oz";
  return "each";
}

export function unitSortLabel(basis) {
  if (basis === "volume") return "Per fl oz";
  if (basis === "weight") return "Per oz";
  if (basis === "count") return "Per each";
  return "Per ounce";
}

export function normalizeUnitPrice(price, amount, dimension) {
  if (amount == null || !dimension || !(amount > 0) || !(price >= 0)) return null;
  const per = price / amount;
  return { per, text: `${formatPer(per)}/${basisPhrase(dimension)}`, basis: dimension };
}

function money(price) {
  return `$${Number(price).toFixed(2)}`;
}

function empty(orderedIds) {
  return {
    winnerId: null,
    basis: null,
    comparable: true,
    reason: "",
    largePack: false,
    largePackNote: "",
    comparedIds: [],
    orderedIds,
  };
}

function byId(rows, ids) {
  const known = new Set(ids);
  const rest = rows.map((row) => row.id).filter((id) => !known.has(id));
  return [...ids, ...rest];
}

export function selectBestValue(rows, sort) {
  const priced = (rows || []).filter((row) => Number.isFinite(Number(row.price)) && Number(row.price) >= 0);
  const priceOrder = [...priced]
    .sort((a, b) => Number(a.price) - Number(b.price) || String(a.id).localeCompare(String(b.id)))
    .map((row) => row.id);

  if (sort === "item") {
    if (priced.length < 2) return empty(priceOrder);
    const lowest = Math.min(...priced.map((row) => Number(row.price)));
    const tied = priced.filter((row) => Number(row.price) === lowest);
    if (tied.length > 1) {
      return {
        winnerId: null,
        basis: "item",
        comparable: true,
        reason: "Same price for these sizes.",
        largePack: false,
        largePackNote: "",
        comparedIds: priced.map((row) => row.id),
        orderedIds: priceOrder,
      };
    }
    const winner = tied[0];
    return {
      winnerId: winner.id,
      basis: "item",
      comparable: true,
      reason: `${money(winner.price)}, lowest price of ${priced.length} sizes`,
      largePack: false,
      largePackNote: "",
      comparedIds: priced.map((row) => row.id),
      orderedIds: priceOrder,
    };
  }

  const valued = priced
    .map((row) => ({ row, quote: normalizeUnitPrice(Number(row.price), row.totalAmount, row.totalDimension) }))
    .filter((entry) => entry.quote);
  if (valued.length < 2) return empty(priceOrder);

  const byBasis = new Map();
  for (const entry of valued) {
    const list = byBasis.get(entry.quote.basis) || [];
    list.push(entry);
    byBasis.set(entry.quote.basis, list);
  }
  const groups = [...byBasis.values()].sort(
    (a, b) => b.length - a.length || String(a[0].quote.basis).localeCompare(String(b[0].quote.basis))
  );
  if (groups.length > 1 && groups[0].length === groups[1].length) {
    return {
      winnerId: null,
      basis: null,
      comparable: false,
      reason: "These sizes use different measures, so there isn't one best value.",
      largePack: false,
      largePackNote: "",
      comparedIds: [],
      orderedIds: priceOrder,
    };
  }

  const group = groups[0];
  group.sort(
    (a, b) =>
      roundPer(a.quote.per) - roundPer(b.quote.per) ||
      Number(a.row.price) - Number(b.row.price) ||
      String(a.row.id).localeCompare(String(b.row.id))
  );
  const bestPer = roundPer(group[0].quote.per);
  const tied = group.filter((entry) => roundPer(entry.quote.per) === bestPer);
  const comparedIds = group.map((entry) => entry.row.id);
  const orderedIds = byId(priced, comparedIds);
  if (tied.length > 1) {
    return {
      winnerId: null,
      basis: group[0].quote.basis,
      comparable: true,
      reason: `These sizes cost the same per ${basisPhrase(group[0].quote.basis)}.`,
      largePack: false,
      largePackNote: "",
      comparedIds,
      orderedIds,
    };
  }

  const winner = group[0];
  const amounts = group
    .map((entry) => entry.row.totalAmount)
    .filter((amount) => typeof amount === "number" && amount > 0)
    .sort((a, b) => a - b);
  const median = amounts.length > 0 ? amounts[Math.floor((amounts.length - 1) / 2)] : 0;
  const largePack = winner.row.totalAmount != null && median > 0 && winner.row.totalAmount >= median * 2.5 && group.length >= 2;
  const skipped = valued.length - group.length;
  let reason = `${winner.quote.text}, cheapest of ${group.length} sizes`;
  if (skipped === 1) reason += ". One size uses a different measure and isn't compared.";
  else if (skipped > 1) reason += `. ${skipped} sizes use a different measure and aren't compared.`;
  return {
    winnerId: winner.row.id,
    basis: winner.quote.basis,
    comparable: true,
    reason,
    largePack,
    largePackNote: largePack ? "Larger pack. A smaller size is here if you don't need that much." : "",
    comparedIds,
    orderedIds,
  };
}

export function valueRow(variant) {
  const amount = variant?.totalSize?.amount ?? variant?.totalAmount ?? null;
  const dimension = variant?.totalSize?.dimension ?? variant?.totalDimension ?? null;
  return {
    id: variant?.id,
    price: Number(variant?.price),
    totalAmount: amount,
    totalDimension: dimension,
  };
}
