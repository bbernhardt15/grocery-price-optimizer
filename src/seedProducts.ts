import { Product } from "./models/Product";
import type { CatalogProduct } from "./optimizeGroceryList";

export const seedCatalog: CatalogProduct[] = [
  // Aldi
  { name: "Whole Milk", brand: "Friendly Farms", storeName: "Aldi", price: 2.19, unit: "gal", normalizedUnit: "gal" },
  { name: "Large Eggs", brand: "Goldhen", storeName: "Aldi", price: 1.89, unit: "count", normalizedUnit: "count" },
  { name: "White Bread", brand: "L'oven Fresh", storeName: "Aldi", price: 1.79, unit: "oz", normalizedUnit: "oz" },
  { name: "Bananas", brand: "Fresh", storeName: "Aldi", price: 0.49, unit: "lbs", normalizedUnit: "lbs" },
  { name: "Boneless Chicken Breast", brand: "Kirkwood", storeName: "Aldi", price: 4.99, unit: "lbs", normalizedUnit: "lbs" },
  { name: "Long Grain Rice", brand: "Earthly Grains", storeName: "Aldi", price: 3.49, unit: "lbs", normalizedUnit: "lbs" },
  { name: "Gala Apples", brand: "Fresh", storeName: "Aldi", price: 1.99, unit: "lbs", normalizedUnit: "lbs" },
  { name: "Salted Butter", brand: "Countryside Creamery", storeName: "Aldi", price: 3.29, unit: "oz", normalizedUnit: "oz" },
  { name: "Spaghetti Pasta", brand: "Reggano", storeName: "Aldi", price: 0.89, unit: "oz", normalizedUnit: "oz" },
  { name: "Ground Beef 80/20", brand: "Kirkwood", storeName: "Aldi", price: 4.29, unit: "lbs", normalizedUnit: "lbs" },

  // Walmart
  { name: "Whole Milk", brand: "Great Value", storeName: "Walmart", price: 2.48, unit: "gal", normalizedUnit: "gal" },
  { name: "Large Eggs", brand: "Great Value", storeName: "Walmart", price: 2.14, unit: "count", normalizedUnit: "count" },
  { name: "White Bread", brand: "Great Value", storeName: "Walmart", price: 1.28, unit: "oz", normalizedUnit: "oz" },
  { name: "Bananas", brand: "Fresh", storeName: "Walmart", price: 0.58, unit: "lbs", normalizedUnit: "lbs" },
  { name: "Boneless Chicken Breast", brand: "Marketside", storeName: "Walmart", price: 4.47, unit: "lbs", normalizedUnit: "lbs" },
  { name: "Long Grain Rice", brand: "Great Value", storeName: "Walmart", price: 2.84, unit: "lbs", normalizedUnit: "lbs" },
  { name: "Gala Apples", brand: "Fresh", storeName: "Walmart", price: 2.48, unit: "lbs", normalizedUnit: "lbs" },
  { name: "Salted Butter", brand: "Great Value", storeName: "Walmart", price: 3.98, unit: "oz", normalizedUnit: "oz" },
  { name: "Spaghetti Pasta", brand: "Great Value", storeName: "Walmart", price: 0.98, unit: "oz", normalizedUnit: "oz" },
  { name: "Ground Beef 80/20", brand: "Great Value", storeName: "Walmart", price: 4.74, unit: "lbs", normalizedUnit: "lbs" },

  // Kroger
  { name: "Whole Milk", brand: "Kroger", storeName: "Kroger", price: 2.99, unit: "gal", normalizedUnit: "gal" },
  { name: "Large Eggs", brand: "Kroger", storeName: "Kroger", price: 2.49, unit: "count", normalizedUnit: "count" },
  { name: "White Bread", brand: "Kroger", storeName: "Kroger", price: 2.19, unit: "oz", normalizedUnit: "oz" },
  { name: "Bananas", brand: "Fresh", storeName: "Kroger", price: 0.69, unit: "lbs", normalizedUnit: "lbs" },
  { name: "Boneless Chicken Breast", brand: "Simple Truth", storeName: "Kroger", price: 3.99, unit: "lbs", normalizedUnit: "lbs" },
  { name: "Long Grain Rice", brand: "Kroger", storeName: "Kroger", price: 3.19, unit: "lbs", normalizedUnit: "lbs" },
  { name: "Gala Apples", brand: "Fresh", storeName: "Kroger", price: 1.79, unit: "lbs", normalizedUnit: "lbs" },
  { name: "Salted Butter", brand: "Kroger", storeName: "Kroger", price: 3.49, unit: "oz", normalizedUnit: "oz" },
  { name: "Spaghetti Pasta", brand: "Kroger", storeName: "Kroger", price: 1.19, unit: "oz", normalizedUnit: "oz" },
  { name: "Ground Beef 80/20", brand: "Kroger", storeName: "Kroger", price: 4.99, unit: "lbs", normalizedUnit: "lbs" },

  // Target
  { name: "Whole Milk", brand: "Good & Gather", storeName: "Target", price: 3.29, unit: "gal", normalizedUnit: "gal" },
  { name: "Large Eggs", brand: "Good & Gather", storeName: "Target", price: 2.99, unit: "count", normalizedUnit: "count" },
  { name: "White Bread", brand: "Good & Gather", storeName: "Target", price: 2.49, unit: "oz", normalizedUnit: "oz" },
  { name: "Bananas", brand: "Fresh", storeName: "Target", price: 0.79, unit: "lbs", normalizedUnit: "lbs" },
  { name: "Boneless Chicken Breast", brand: "Good & Gather", storeName: "Target", price: 5.49, unit: "lbs", normalizedUnit: "lbs" },
  { name: "Long Grain Rice", brand: "Good & Gather", storeName: "Target", price: 4.19, unit: "lbs", normalizedUnit: "lbs" },
  { name: "Gala Apples", brand: "Fresh", storeName: "Target", price: 2.99, unit: "lbs", normalizedUnit: "lbs" },
  { name: "Salted Butter", brand: "Good & Gather", storeName: "Target", price: 2.79, unit: "oz", normalizedUnit: "oz" },
  { name: "Spaghetti Pasta", brand: "Good & Gather", storeName: "Target", price: 1.29, unit: "oz", normalizedUnit: "oz" },
  { name: "Ground Beef 80/20", brand: "Good & Gather", storeName: "Target", price: 5.29, unit: "lbs", normalizedUnit: "lbs" },
];

export async function seedProductsIfEmpty(): Promise<void> {
  const count = await Product.estimatedDocumentCount();
  if (count > 0) {
    return;
  }

  await Product.insertMany(
    seedCatalog.map((product) => ({
      ...product,
      lastUpdated: new Date(),
    }))
  );

  console.log(`Seeded ${seedCatalog.length} products across Aldi, Walmart, Kroger, and Target`);
}
