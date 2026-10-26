import type { SizeDimension } from "../packageSize";

/**
 * Unit prices for a family tile.
 *
 * Volume is always per fluid ounce (liters and multipacks included), weight
 * per ounce, and counts per item. A can's fluid ounces are never ranked
 * against a count of eggs. The price is the variant's cheapest shelf price.
 * The shopper never sees which store that was.
 */

export type ValueSort = "unit" | "item";

export type PricedSize = {
  id: string;
  price: number;
  totalAmount: number | null;
  totalDimension: SizeDimension | null;
};

export type UnitQuote = {
  per: number;
  text: string;
  basis: SizeDimension;
};

export type ValueVerdict = {
  winnerId: string | null;
  basis: SizeDimension | "item" | null;
  comparable: boolean;
  reason: string;
  largePack: boolean;
  /** Shown with the badge when the winner is a much bigger pack. Never hides the smaller sizes. */
  largePackNote: string;
  comparedIds: string[];
  orderedIds: string[];
};

const LARGE_PACK_RATIO = 2.5;

function roundPer(per: number): number {
  return Math.round(per * 10000) / 10000;
}

function formatPer(per: number): string {
  const digits = per > 0 && per < 0.01 ? 3 : 2;
  return `$${per.toFixed(digits)}`;
}

export function basisPhrase(basis: SizeDimension): string {
  if (basis === "volume") return "fl oz";
  if (basis === "weight") return "oz";
  return "each";
}

export function unitSortLabel(basis: SizeDimension | null): string {
  if (basis === "volume") return "Per fl oz";
  if (basis === "weight") return "Per oz";
  if (basis === "count") return "Per each";
  return "Per ounce";
}

/** Price divided by the base amount. 2 L and 12 fl oz cans both come out per fl oz. */
export function normalizeUnitPrice(
  price: number,
  amount: number | null,
  dimension: SizeDimension | null
): UnitQuote | null {
  if (amount == null || !dimension || !(amount > 0) || !(price >= 0)) return null;
  const per = price / amount;
  return { per, text: `${formatPer(per)}/${basisPhrase(dimension)}`, basis: dimension };
}

function money(price: number): string {
  return `$${price.toFixed(2)}`;
}

function empty(orderedIds: string[]): ValueVerdict {
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

function byId(rows: PricedSize[], ids: string[]): string[] {
  const known = new Set(ids);
  const rest = rows.map((row) => row.id).filter((id) => !known.has(id));
  return [...ids, ...rest];
}

/**
 * Pick the best size in one flavor.
 * "unit" is the lowest comparable unit price. "item" is the lowest pack price.
 * A larger pack can win and is only flagged, never required.
 */
export function selectBestValue(rows: PricedSize[], sort: ValueSort): ValueVerdict {
  const priced = rows.filter((row) => Number.isFinite(row.price) && row.price >= 0);
  const priceOrder = [...priced].sort((a, b) => a.price - b.price || a.id.localeCompare(b.id)).map((row) => row.id);

  if (sort === "item") {
    if (priced.length < 2) return empty(priceOrder);
    const lowest = Math.min(...priced.map((row) => row.price));
    const tied = priced.filter((row) => row.price === lowest);
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
    const winner = tied[0]!;
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
    .map((row) => ({ row, quote: normalizeUnitPrice(row.price, row.totalAmount, row.totalDimension) }))
    .filter((entry): entry is { row: PricedSize; quote: UnitQuote } => entry.quote != null);
  if (valued.length < 2) return empty(priceOrder);

  const byBasis = new Map<SizeDimension, Array<{ row: PricedSize; quote: UnitQuote }>>();
  for (const entry of valued) {
    const list = byBasis.get(entry.quote.basis) ?? [];
    list.push(entry);
    byBasis.set(entry.quote.basis, list);
  }
  const groups = [...byBasis.values()].sort((a, b) => b.length - a.length || a[0]!.quote.basis.localeCompare(b[0]!.quote.basis));
  if (groups.length > 1 && groups[0]!.length === groups[1]!.length) {
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

  const group = groups[0]!;
  group.sort(
    (a, b) => roundPer(a.quote.per) - roundPer(b.quote.per) || a.row.price - b.row.price || a.row.id.localeCompare(b.row.id)
  );
  const bestPer = roundPer(group[0]!.quote.per);
  const tied = group.filter((entry) => roundPer(entry.quote.per) === bestPer);
  const comparedIds = group.map((entry) => entry.row.id);
  const orderedIds = byId(priced, comparedIds);
  if (tied.length > 1) {
    return {
      winnerId: null,
      basis: group[0]!.quote.basis,
      comparable: true,
      reason: `These sizes cost the same per ${basisPhrase(group[0]!.quote.basis)}.`,
      largePack: false,
      largePackNote: "",
      comparedIds,
      orderedIds,
    };
  }

  const winner = group[0]!;
  const amounts = group
    .map((entry) => entry.row.totalAmount)
    .filter((amount): amount is number => amount != null && amount > 0)
    .sort((a, b) => a - b);
  const median = amounts.length > 0 ? amounts[Math.floor((amounts.length - 1) / 2)]! : 0;
  const largePack =
    winner.row.totalAmount != null && median > 0 && winner.row.totalAmount >= median * LARGE_PACK_RATIO && group.length >= 2;
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
