import type { CatalogProduct, PriceSource } from "../optimizeGroceryList";
import { parseGroceryUnit } from "../pricing/parseGroceryUnit";
import { upcKey } from "./normalize";
import { gapsForProduct } from "./substitutes";
import type { BrowseProduct, CatalogOffer, OfferPriceSource } from "./types";

export type BrowseSelection = {
  name: string;
  quantity: number;
  brand?: string;
  catalogId?: string;
  upc?: string;
};

const TRIP_STORES = ["Aldi", "Kroger", "Target", "Walmart"];

function optimizerSource(source: OfferPriceSource): PriceSource {
  if (source === "weekly_ad") {
    return "weekly_ad";
  }
  if (source === "seed") {
    return "seed";
  }
  return "live";
}

function toOptimizerProduct(
  product: BrowseProduct,
  offer: CatalogOffer,
  meta: {
    sourceQuery: string;
    pinned?: boolean;
    offerRole?: "exact" | "substitute";
    substitutedFor?: string;
  }
): CatalogProduct {
  const size = offer.sizeLabel || product.sizeLabel;
  const unit = parseGroceryUnit(size);
  return {
    name: product.name,
    brand: product.brand,
    storeName: offer.storeName,
    price: offer.price,
    unit,
    normalizedUnit: unit,
    ...(size ? { size } : {}),
    ...(offer.locationId ? { locationId: offer.locationId } : {}),
    ...(offer.productId ? { productId: offer.productId } : {}),
    ...(offer.upc || product.upc ? { upc: offer.upc || product.upc } : {}),
    priceSource: optimizerSource(offer.priceSource),
    sourceQuery: meta.sourceQuery,
    ...(meta.pinned ? { pinned: true } : {}),
    ...(meta.offerRole ? { offerRole: meta.offerRole } : {}),
    ...(meta.substitutedFor ? { substitutedFor: meta.substitutedFor } : {}),
  };
}

export function findBrowseProduct(
  selection: BrowseSelection,
  products: BrowseProduct[]
): BrowseProduct | undefined {
  if (selection.catalogId) {
    const byId = products.find((product) => product.id === selection.catalogId);
    if (byId) {
      return byId;
    }
  }
  const key = upcKey(selection.upc);
  if (key) {
    const byUpc = products.find((product) => upcKey(product.upc) === key);
    if (byUpc) {
      return byUpc;
    }
  }
  const name = selection.name.trim().toLowerCase();
  const brand = selection.brand?.trim().toLowerCase();
  return products.find((product) => {
    if (product.name.trim().toLowerCase() !== name) {
      return false;
    }
    return !brand || product.brand.trim().toLowerCase() === brand;
  });
}

/**
 * Turns browse selections into optimizer rows. Exact offers are pinned so the
 * seed catalog cannot swap in a different food that merely shares a keyword.
 * Substitutes are added only for stores that do not carry the UPC, and only
 * when the shopper allowed them. They stay labeled `offerRole: "substitute"`.
 */
export function pinnedRowsForSelections(
  selections: BrowseSelection[],
  products: BrowseProduct[],
  options: { allowSubstitutes: boolean }
): CatalogProduct[] {
  const rows: CatalogProduct[] = [];
  for (const selection of selections) {
    const product = findBrowseProduct(selection, products);
    if (!product) {
      continue;
    }
    const sourceQuery = selection.name.trim();
    for (const offer of product.offers) {
      rows.push(
        toOptimizerProduct(product, offer, {
          sourceQuery,
          pinned: true,
          offerRole: "exact",
        })
      );
    }
    if (!options.allowSubstitutes) {
      continue;
    }
    for (const gap of gapsForProduct(product, products, TRIP_STORES)) {
      if (!gap.substitute) {
        continue;
      }
      const substitute = products.find((entry) => entry.id === gap.substitute?.productId);
      const offer = substitute?.offers.find((entry) => entry.storeName === gap.storeName);
      if (!substitute || !offer) {
        continue;
      }
      rows.push(
        toOptimizerProduct(substitute, offer, {
          sourceQuery,
          offerRole: "substitute",
          substitutedFor: product.name,
        })
      );
    }
  }
  return rows;
}
