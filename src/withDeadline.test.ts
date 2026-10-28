import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withDeadline } from "./withDeadline.js";

describe("withDeadline", () => {
  it("returns the value when the work finishes in time", async () => {
    assert.equal(await withDeadline(Promise.resolve("store"), 50, "fallback"), "store");
  });

  it("returns the fallback when the work hangs", async () => {
    const hung = new Promise<string>(() => {});
    const started = Date.now();
    assert.equal(await withDeadline(hung, 40, "fallback"), "fallback");
    assert.ok(Date.now() - started < 500);
  });

  it("still rejects a fast error", async () => {
    await assert.rejects(withDeadline(Promise.reject(new Error("Invalid ZIP code: x")), 50, "fallback"), /Invalid ZIP code/);
  });
});
