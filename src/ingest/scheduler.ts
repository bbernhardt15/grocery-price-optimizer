import { ingestConfig } from "./config";
import { runIngestTick } from "./runner";
import { ingestShouldWait, loopSnapshot } from "../runtime/loopGuard";

let timer: ReturnType<typeof setInterval> | null = null;

/** In-process scheduler. A Mongo lock keeps a second replica from double-crawling. */
export function startIngestScheduler(): void {
  const config = ingestConfig();
  if (!config.enabled || timer) {
    return;
  }
  const tick = () => {
    if (ingestShouldWait()) {
      const snap = loopSnapshot();
      console.info(`Catalog ingest deferred (lag ${snap.lagP99Ms}ms, in flight ${snap.inFlight}).`);
      return;
    }
    void runIngestTick().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Catalog ingest tick failed: ${message}`);
    });
  };
  timer = setInterval(tick, config.intervalSeconds * 1000);
  timer.unref?.();
  console.log(
    `Catalog ingest scheduler every ${config.intervalSeconds}s (batch ${config.batchCalls} calls, Mongo lock).`
  );
  tick();
}

export function stopIngestScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
