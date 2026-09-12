import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { seedProductsIfEmpty } from "./seedProducts";

const DEFAULT_URI = "mongodb://127.0.0.1:27017/grocery-list-optimizer";

let memoryServer: MongoMemoryServer | null = null;

export async function connectDatabase(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  mongoose.set("strictQuery", true);

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

    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri());
    console.log("Connected to in-memory MongoDB");
  }

  await seedProductsIfEmpty();
}

function sanitizeUri(uri: string): string {
  return uri.replace(/\/\/.*@/, "//***@");
}
