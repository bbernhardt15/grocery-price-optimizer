import "dotenv/config";
import mongoose from "mongoose";
import { DEMO_KROGER_LOCATION_ID } from "./krogerService";
import { Product } from "./models/Product";

const MONGODB_URI =
  process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/grocery-list-optimizer";

type SeedProduct = {
  name: string;
  brand: string;
  storeName: "Walmart" | "Target" | "Kroger";
  locationId?: string;
  price: number;
  unit: "gal" | "count" | "lbs";
  normalizedUnit: "gal" | "count" | "lbs";
};

/**
 * 10 mock catalog rows for POST /api/optimize-list.
 * Milk, bread, and eggs are duplicated across Walmart, Target, and Kroger
 * with slightly different shelf prices so the optimizer has a cheapest store
 * to pick per item. Bananas is a single-store extra to reach 10 documents.
 */
export const mockProducts: SeedProduct[] = [
  { name: "Gallon of Milk", brand: "Great Value", storeName: "Walmart", price: 3.27, unit: "gal", normalizedUnit: "gal" },
  { name: "Gallon of Milk", brand: "Good & Gather", storeName: "Target", price: 3.49, unit: "gal", normalizedUnit: "gal" },
  { name: "Gallon of Milk", brand: "Kroger", storeName: "Kroger", locationId: DEMO_KROGER_LOCATION_ID, price: 2.89, unit: "gal", normalizedUnit: "gal" },

  { name: "Loaf of Bread", brand: "Great Value", storeName: "Walmart", price: 1.28, unit: "count", normalizedUnit: "count" },
  { name: "Loaf of Bread", brand: "Good & Gather", storeName: "Target", price: 1.89, unit: "count", normalizedUnit: "count" },
  { name: "Loaf of Bread", brand: "Kroger", storeName: "Kroger", locationId: DEMO_KROGER_LOCATION_ID, price: 1.59, unit: "count", normalizedUnit: "count" },

  { name: "Dozen Eggs", brand: "Great Value", storeName: "Walmart", price: 2.48, unit: "count", normalizedUnit: "count" },
  { name: "Dozen Eggs", brand: "Good & Gather", storeName: "Target", price: 1.99, unit: "count", normalizedUnit: "count" },
  { name: "Dozen Eggs", brand: "Kroger", storeName: "Kroger", locationId: DEMO_KROGER_LOCATION_ID, price: 2.29, unit: "count", normalizedUnit: "count" },

  { name: "Bananas", brand: "Fresh", storeName: "Walmart", price: 0.54, unit: "lbs", normalizedUnit: "lbs" },
];

async function seed(): Promise<void> {
  mongoose.set("strictQuery", true);

  await mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
  });
  console.log(`Connected to ${MONGODB_URI}`);

  const names = [...new Set(mockProducts.map((product) => product.name))];
  const stores = [...new Set(mockProducts.map((product) => product.storeName))];

  const deleted = await Product.deleteMany({
    name: { $in: names },
    storeName: { $in: stores },
  });
  if (deleted.deletedCount > 0) {
    console.log(`Removed ${deleted.deletedCount} existing mock product(s)`);
  }

  const inserted = await Product.insertMany(
    mockProducts.map((product) => ({
      ...product,
      lastUpdated: new Date(),
    }))
  );

  console.log(`Inserted ${inserted.length} mock products:\n`);
  for (const product of inserted) {
    console.log(
      `  ${product.storeName.padEnd(8)}  $${product.price.toFixed(2).padStart(5)}  ${product.name} (${product.brand})`
    );
  }

  console.log(`
Try the optimizer:

  curl -s -X POST http://localhost:3000/api/optimize-list \\
    -H "Content-Type: application/json" \\
    -d '{"groceryList":["Gallon of Milk","Loaf of Bread","Dozen Eggs"],"zipCode":"45202"}'
`);
}

if (require.main === module) {
  void seed()
    .then(async () => {
      await mongoose.disconnect();
    })
    .catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      const hint = message.includes("ECONNREFUSED")
        ? ` Is MongoDB running at ${MONGODB_URI}?`
        : "";
      console.error(`Seed failed: ${message}.${hint}`);
      await mongoose.disconnect().catch(() => undefined);
      process.exit(1);
    });
}
