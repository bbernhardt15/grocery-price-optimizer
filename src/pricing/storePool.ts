/**
 * Kroger (and any other store) runs in its own pool.
 * Walmart runs beside it, and the plan returns after a short grace
 * so a stalled Walmart lookup cannot hold the phone's wait.
 */

export type PooledJob = { storeName: string };

export async function runStorePools<T extends PooledJob>(
  jobs: T[],
  run: (job: T) => Promise<void>,
  options: {
    leadPool?: number;
    walmartPool?: number;
    walmartGraceMs?: number;
    onSkip?: (job: T) => void;
  } = {}
): Promise<void> {
  const leadPool = Math.max(1, options.leadPool ?? 8);
  const walmartPool = Math.max(1, options.walmartPool ?? 4);
  const graceMs = Math.max(0, options.walmartGraceMs ?? 6_000);
  const lead: T[] = [];
  const walmart: T[] = [];
  for (const job of jobs) {
    if (String(job.storeName || "").trim().toLowerCase() === "walmart") walmart.push(job);
    else lead.push(job);
  }

  function start(list: T[], size: number) {
    let cursor = 0;
    let stopped = false;
    const workers = Array.from({ length: Math.min(size, Math.max(list.length, 1)) }, async () => {
      while (!stopped) {
        const index = cursor;
        cursor += 1;
        if (index >= list.length) return;
        const job = list[index];
        if (!job) return;
        await run(job);
      }
    });
    return {
      done: Promise.all(workers),
      stop() {
        if (stopped) return;
        stopped = true;
        for (let index = cursor; index < list.length; index += 1) {
          const job = list[index];
          if (job) options.onSkip?.(job);
        }
        cursor = list.length;
      },
    };
  }

  const leadRun = start(lead, leadPool);
  const walmartRun = start(walmart, walmartPool);
  await leadRun.done;
  await Promise.race([
    walmartRun.done,
    new Promise<void>((resolve) => {
      setTimeout(resolve, graceMs);
    }),
  ]);
  walmartRun.stop();
}
