import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapPool } from "./pool";

describe("mapPool", () => {
  it("keeps order and never runs more than the limit at once", async () => {
    let active = 0;
    let peak = 0;
    const values = await mapPool([1, 2, 3, 4, 5], 2, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return item * 10;
    });
    assert.equal(peak, 2);
    assert.deepEqual(values, [10, 20, 30, 40, 50]);
    assert.deepEqual(await mapPool([], 4, async (item: number) => item), []);
  });
});
