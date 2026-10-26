import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PULL_THRESHOLD, keepAwake, lightTap, pullDistance, pullShouldRefresh } from "../../public/shopper/phone.js";

describe("phone feel", () => {
  it("uses a haptic plugin when the shell already has one", async () => {
    let style = "";
    const how = await lightTap({
      haptics: {
        async impact(options) {
          style = options.style;
        },
      },
      vibrate() {
        throw new Error("should not vibrate");
      },
    });
    assert.equal(how, "haptics");
    assert.equal(style, "LIGHT");
  });

  it("falls back to a short vibration, then to nothing", async () => {
    let ms = 0;
    const vibrated = await lightTap({
      haptics: {
        async impact() {
          throw new Error("missing");
        },
      },
      vibrate(value) {
        ms = value;
      },
    });
    assert.equal(vibrated, "vibrate");
    assert.equal(ms, 12);
    assert.equal(await lightTap({}), "none");
    assert.equal(
      await lightTap({
        vibrate() {
          throw new Error("blocked");
        },
      }),
      "none"
    );
  });

  it("holds the screen only when the wake lock is allowed", async () => {
    let released = false;
    const held = await keepAwake({
      async requestWakeLock(type) {
        assert.equal(type, "screen");
        return {
          async release() {
            released = true;
          },
        };
      },
    });
    assert.equal(held.active, true);
    await held.release();
    assert.equal(released, true);

    const missing = await keepAwake({});
    assert.equal(missing.active, false);
    await missing.release();

    const denied = await keepAwake({
      async requestWakeLock() {
        throw new Error("not allowed");
      },
    });
    assert.equal(denied.active, false);
  });

  it("refreshes only after a downward pull from the top", () => {
    assert.equal(pullDistance(100, 140, false), 0);
    assert.equal(pullDistance(100, 90, true), 0);
    assert.equal(pullDistance(100, 100 + PULL_THRESHOLD, true), PULL_THRESHOLD);
    assert.equal(pullShouldRefresh(PULL_THRESHOLD - 1), false);
    assert.equal(pullShouldRefresh(PULL_THRESHOLD), true);
    assert.equal(pullDistance(0, 500, true), 120);
  });
});
