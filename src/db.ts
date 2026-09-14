import mongoose from "mongoose";
import { seedProductsIfEmpty } from "./seedProducts";

const DEFAULT_URI = "mongodb://127.0.0.1:27017/grocery-list-optimizer";

export async function connectDatabase(): Promise<void> {
  mongoose.set("strictQuery", true);

  const mongoUrl = process.env.MONGO_URL?.trim();
  if (mongoUrl) {
    await mongoose.connect(mongoUrl, {
      serverSelectionTimeoutMS: 10_000,
    });
    console.log(`Connected to MongoDB at ${sanitizeUri(mongoUrl)}`);
    await seedProductsIfEmpty();
    return;
  }

  const uri = process.env.MONGODB_URI?.trim() || DEFAULT_URI;
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 3000,
    });
    console.log(`Connected to MongoDB at ${sanitizeUri(uri)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `MongoDB at ${sanitizeUri(uri)} is unavailable (${message}). Starting in-memory MongoDB so product queries still hit a database.`
    );

    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }

    // Loaded only when MONGO_URL is unset so cloud builds never pull in
    // mongodb-memory-server's native Linux binaries.
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    const memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri());
    console.log("Connected to in-memory MongoDB");
  }

  await seedProductsIfEmpty();
}

function sanitizeUri(uri: string): string {
  return uri.replace(/\/\/.*@/, "//***@");
}
