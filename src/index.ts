import "dotenv/config";
import app from "./app";
import { connectDatabase } from "./db";

const PORT =3000;

async function start(): Promise<void> {
  await connectDatabase();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Grocery List Optimizer API listening on http://0.0.0.0:${PORT}`);
  });
}

void start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to start: ${message}`);
  process.exit(1);
});
