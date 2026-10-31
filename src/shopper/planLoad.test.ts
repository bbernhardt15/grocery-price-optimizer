import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PLAN_TIMEOUT_MS, fetchWithTimeout, planTimedOut } from "../../public/shopper/planLoad.js";

describe("plan request timeout", () => {
  it("caps a plan request long enough for a few stores", () => {
    assert.equal(PLAN_TIMEOUT_MS, 22000);
  });

  it("aborts a fetch that never returns", async () => {
    const started = Date.now();
    const fetchImpl = (_url: string, options: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    await assert.rejects(fetchWithTimeout(fetchImpl as typeof fetch, "/api/optimize-list", {}, 40), (error: unknown) => {
      assert.equal(planTimedOut(error), true);
      return true;
    });
    assert.ok(Date.now() - started < 500);
  });
});
