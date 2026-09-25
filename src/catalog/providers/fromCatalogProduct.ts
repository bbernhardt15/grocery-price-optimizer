import type { CatalogProduct } from "../../optimizeGroceryList";
import type { OfferPriceSource, RawCatalogRecord } from "../types";

export function rawFromCatalogProduct(
  product: CatalogProduct,
  priceSource: OfferPriceSource
): RawCatalogRecord | null {
  if (!product.name?.trim() || !Number.isFinite(product.price)) {
    return null;
  }
  return {
    name: product.name,
    brand: product.brand,
    storeName: product.storeName,
    price: product.price,
    priceSource,
    ...(product.upc ? { upc: product.upc } : {}),
    ...(product.productId ? { productId: product.productId, retailerItemId: product.productId } : {}),
    ...(product.locationId ? { locationId: product.locationId } : {}),
    ...(product.size ? { size: product.size } : {}),
    ...(product.imageUrls && product.imageUrls.length > 0 ? { imageUrls: product.imageUrls } : {}),
    ...(product.categories && product.categories.length > 0 ? { categories: product.categories } : {}),
    ...(product.onSale ? { onSale: true } : {}),
    availability: product.availability ?? "unknown",
  };
}
