export type GroceryLine = {
  raw: string;
  name: string;
  quantity: number;
};

function toQuantity(value: string): number {
  const quantity = Number.parseInt(value, 10);
  if (!Number.isFinite(quantity) || quantity < 1) {
    return 1;
  }

  return quantity;
}

/**
 * Pulls a count off the start or end of a grocery line.
 * Supports "2 Milk", "2x Milk", "2 x Milk", "Milk x2", and "Milk x 2".
 * Bare names default to quantity 1.
 */
export function parseGroceryLine(raw: string): GroceryLine | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const leadingAttached = trimmed.match(/^(\d+)\s*[x×]\s+(.+)$/i);
  if (leadingAttached?.[2]?.trim()) {
    return {
      raw: trimmed,
      quantity: toQuantity(leadingAttached[1]),
      name: leadingAttached[2].trim(),
    };
  }

  const leadingCount = trimmed.match(/^(\d+)\s+(.+)$/);
  if (leadingCount?.[2]?.trim() && !leadingCount[2].startsWith("%")) {
    return {
      raw: trimmed,
      quantity: toQuantity(leadingCount[1]),
      name: leadingCount[2].trim(),
    };
  }

  const trailingCount = trimmed.match(/^(.+?)\s*[x×]\s*(\d+)$/i);
  if (trailingCount?.[1]?.trim()) {
    return {
      raw: trimmed,
      quantity: toQuantity(trailingCount[2]),
      name: trailingCount[1].trim(),
    };
  }

  return { raw: trimmed, quantity: 1, name: trimmed };
}

export function parseGroceryList(lines: string[]): GroceryLine[] {
  const merged = new Map<string, GroceryLine>();

  for (const raw of lines) {
    const parsed = parseGroceryLine(raw);
    if (!parsed) {
      continue;
    }

    const key = parsed.name.toLowerCase();
    const existing = merged.get(key);
    if (existing) {
      existing.quantity += parsed.quantity;
    } else {
      merged.set(key, { ...parsed });
    }
  }

  return [...merged.values()];
}
