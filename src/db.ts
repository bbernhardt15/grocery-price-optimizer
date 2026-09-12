import mongoose from "mongoose";

const DEFAULT_URI = "mongodb://127.0.0.1:27017/grocery-list-optimizer";

export async function connectDatabase(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;

  mongoose.set("strictQuery", true);

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 3000,
  });
  console.log(`Connected to MongoDB at ${sanitizeUri(uri)}`);
}

function sanitizeUri(uri: string): string {
  return uri.replace(/\/\/.*@/, "//***@");
}
