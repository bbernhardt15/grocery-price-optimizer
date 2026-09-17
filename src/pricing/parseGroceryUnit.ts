const groceryUnits = ["oz", "lbs", "count", "g", "kg", "ml", "l", "gal"] as const;
export type GroceryUnit = (typeof groceryUnits)[number];

export function parseGroceryUnit(size?: string): GroceryUnit {
  const value = (size ?? "").toLowerCase();
  if (/\bgal/.test(value)) return "gal";
  if (/\bfl\s*oz|\boz\b/.test(value)) return "oz";
  if (/\blbs?\b|\bpounds?\b/.test(value)) return "lbs";
  if (/\bkg\b/.test(value)) return "kg";
  if (/\bml\b/.test(value)) return "ml";
  if (/\bl\b/.test(value)) return "l";
  if (/\bg\b/.test(value)) return "g";
  return "count";
}

export function isGroceryUnit(value: unknown): value is GroceryUnit {
  return typeof value === "string" && groceryUnits.includes(value as GroceryUnit);
}
