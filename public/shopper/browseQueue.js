/**
 * One shelf lookup at a time per key, and only a few at once.
 * A timeout aborts the fetch. A later retry waits longer instead of stacking.
 */

export function createBrowseQueue(limit = 2) {
  let active = 0;
  const waiting = [];
  const inflight = new Map();

  function pump() {
    while (active < limit && waiting.length) {
      const job = waiting.shift();
      active += 1;
      Promise.resolve()
        .then(() => job.run())
        .then(job.resolve, job.reject)
        .finally(() => {
          active -= 1;
          if (job.key) inflight.delete(job.key);
          pump();
        });
    }
  }

  function enqueue(key, run) {
    const id = String(key || "");
    if (id && inflight.has(id)) return inflight.get(id);
    const promise = new Promise((resolve, reject) => {
      waiting.push({ key: id, run, resolve, reject });
      pump();
    });
    if (id) inflight.set(id, promise);
    return promise;
  }

  return {
    enqueue,
    get active() {
      return active;
    },
    get waiting() {
      return waiting.length;
    },
  };
}

export const browseQueue = createBrowseQueue(2);

/** 400ms, 800ms, 1600ms. Stops after three tries. */
export function browseRetryDelay(attempt) {
  const n = Math.max(0, Math.floor(Number(attempt) || 0));
  if (n >= 3) return 0;
  return 400 * 2 ** n;
}
