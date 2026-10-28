/** Shopper-facing cap. A hung store lookup must not hold the plan screen. */
export const PLAN_TIMEOUT_MS = 8000;

/**
 * Fetch that aborts when `ms` elapses or the parent signal aborts.
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @param {RequestInit & { signal?: AbortSignal }} [options]
 * @param {number} [ms]
 */
export function fetchWithTimeout(fetchImpl, url, options = {}, ms = PLAN_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const parent = options.signal;
  if (parent) {
    if (parent.aborted) controller.abort();
    else parent.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return Promise.resolve(fetchImpl(url, { ...options, signal: controller.signal })).finally(() => clearTimeout(timer));
}

/** @param {unknown} error */
export function planTimedOut(error) {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  return name === "AbortError" || name === "TimeoutError";
}
