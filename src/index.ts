import "dotenv/config";
import "./observability/instrument";
import app from "./app";
import { connectDatabase } from "./db";
import { startIngestScheduler } from "./ingest/scheduler";
import { scrubString } from "./observability/scrub";
import { captureServerException, flushSentry } from "./observability/sentry";

const PORT = Number(process.env.PORT) || 3000;

async function start(): Promise<void> {
  await connectDatabase();
  startIngestScheduler();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Grocery Gitter API listening on http://0.0.0.0:${PORT}`);
  });
}

void start().catch((error: unknown) => {
  captureServerException(error);
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to start: ${scrubString(message)}`);
  void flushSentry().finally(() => {
    process.exit(1);
  });
});
