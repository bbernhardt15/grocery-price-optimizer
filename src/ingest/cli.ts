import "dotenv/config";
import { connectDatabase } from "../db";
import { ingestConfig } from "./config";
import { runDemoIngest, runIngestTick } from "./runner";
import { catalogStatus } from "./status";

const demo = process.argv.includes("--demo");

async function main(): Promise<void> {
  await connectDatabase();
  if (demo) {
    const result = await runDemoIngest();
    const status = await catalogStatus();
    console.log(JSON.stringify({ result, counts: status.counts, storage: status.storage }, null, 2));
    process.exit(0);
  }

  const config = ingestConfig();
  if (!config.enabled) {
    console.error("Set CATALOG_INGEST_ENABLED=true to run the worker. Use --demo to load the local demo catalog.");
    process.exit(1);
  }

  console.log("Catalog ingest worker started. Checkpoints resume after a restart.");
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  while (!stopped) {
    try {
      const tick = await runIngestTick();
      if (tick.slices.length > 0) {
        console.log(JSON.stringify({ at: new Date().toISOString(), locked: tick.locked, slices: tick.slices }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Catalog ingest tick failed: ${message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, config.intervalSeconds * 1000));
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
