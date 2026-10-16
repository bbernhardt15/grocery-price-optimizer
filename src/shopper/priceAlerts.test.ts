import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { itemWatched, nextItemWatch, parseTargetPrice } from "../../public/shopper/priceAlerts.js";

describe("saved list price alerts", () => {
  it("watches every item when the list is on, unless that item opts out", () => {
    assert.equal(itemWatched(true, "inherit"), true);
    assert.equal(itemWatched(true, "off"), false);
    assert.equal(itemWatched(true, "on"), true);
    assert.equal(itemWatched(false, "inherit"), false);
    assert.equal(itemWatched(false, "on"), true);
  });

  it("stores a per-item choice that still follows the list switch", () => {
    assert.equal(nextItemWatch(true, true), "inherit");
    assert.equal(nextItemWatch(true, false), "off");
    assert.equal(nextItemWatch(false, true), "on");
    assert.equal(nextItemWatch(false, false), "inherit");
  });

  it("keeps a target only when it is a positive price", () => {
    assert.equal(parseTargetPrice(""), null);
    assert.equal(parseTargetPrice("nope"), null);
    assert.equal(parseTargetPrice("0"), null);
    assert.equal(parseTargetPrice("2.5"), 2.5);
    assert.equal(parseTargetPrice("2.499"), 2.5);
  });
});
