import "dotenv/config";
import app from "./app";
import { connectDatabase } from "./db";
import { startIngestScheduler } from "./ingest/scheduler";

const PORT = Number(process.env.PORT) || 3000;

async function start(): Promise<void> {
  await connectDatabase();
  startIngestScheduler();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Grocery Gitter API listening on http://0.0.0.0:${PORT}`);
  });
}

void start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to start: ${message}`);
  process.exit(1);
});
