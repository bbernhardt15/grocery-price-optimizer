/**
 * Write receipt lessons into the same preferences the ask box uses.
 * An allergy, a diet, a "never" answer, a locked product, or any choice
 * the shopper made by hand wins over a receipt.
 */

import { setCategoryPreference } from "./categoryPreference.js";
import { learnPreference } from "./productPreference.js";
import { parseProfile } from "./profile.js";
import { productExcluded } from "./profileConstraints.js";

function explicit(row) {
  return Boolean(row?.mode && row.mode !== "skip" && row.source !== "receipt");
}

export function applyLearnedReceipts(profile, learned, at = Date.now()) {
  let next = parseProfile(profile);
  const kept = [];
  const skipped = [];
  for (const row of learned || []) {
    if (!row?.family || !row.mode) {
      skipped.push(row);
      continue;
    }
    const hay = [row.brand, row.productName, row.label].filter(Boolean).join(" ");
    if (productExcluded(next, { name: hay, brand: row.brand || "" }).excluded) {
      skipped.push(row);
      continue;
    }
    const existing = next.categoryPreferences?.[row.family];
    if (existing?.mode === "never" || explicit(existing)) {
      skipped.push(row);
      continue;
    }
    if (next.productPreferences?.[row.family]?.locked) {
      skipped.push(row);
      continue;
    }
    next = setCategoryPreference(
      next,
      {
        family: row.family,
        mode: row.mode,
        brand: row.mode === "brand" || row.mode === "cheapestPicks" ? row.brand || "" : "",
        brands: row.mode === "cheapestPicks" ? row.brands || (row.brand ? [row.brand] : []) : [],
        productId: "",
        size: row.size || "",
        attributes: [],
        source: "receipt",
        confidence: row.confidence === "high" ? "high" : "low",
        count: row.count || 1,
        label: row.label || "",
      },
      at
    );
    if (row.mode === "brand" && row.brand) {
      next = learnPreference(
        next,
        {
          brand: row.brand,
          name: row.productName || row.label || row.brand,
          familyName: row.productName || row.label || row.brand,
          sizeLabel: row.size || "",
          upc: String(row.upc || "").replace(/\D/g, ""),
        },
        { family: row.family, locked: false, source: "import", replace: true, at }
      );
    }
    kept.push(row);
  }
  return { profile: next, kept, skipped };
}
