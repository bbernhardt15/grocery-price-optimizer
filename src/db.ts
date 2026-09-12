import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { seedProductsIfEmpty } from "./seedProducts";

const DEFAULT_URI = "mongodb://127.0.0.1:27017/grocery-list-optimizer";

let memoryServer: MongoMemoryServer | null = null;

export async function connectDatabase(): Promise<void> {
  const explicitUri = process.env.MONGODB_URI;
  mongoose.set("strictQuery", true);

  if (explicitUri) {
    await mongoose.connect(explicitUri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log(`Connected to MongoDB at ${sanitizeUri(explicitUri)}`);
    await seedProductsIfEmpty();
    return;
  }

  try {
    await mongoose.connect(DEFAULT_URI, {
      serverSelectionTimeoutMS: 3000,
    });
    console.log(`Connected to MongoDB at ${sanitizeUri(DEFAULT_URI)}`);
  } catch {
    console.warn(
      "No local MongoDB on 27017; starting an in-memory MongoDB for product queries."
    );
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri());
    console.log("Connected to in-memory MongoDB");
  }

  await seedProductsIfEmpty();
}

function sanitizeUri(uri: string): string {
  return uri.replace(/\/\/.*@/, "//***@");
}
