import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { askIntent } from "../../public/shopper/askIntent.js";

describe("what do you need", () => {
  it("treats a short product name as a shelf search", () => {
    assert.equal(askIntent(""), "empty");
    assert.equal(askIntent("   "), "empty");
    assert.equal(askIntent("milk"), "search");
    assert.equal(askIntent("whole milk"), "search");
    assert.equal(askIntent("greek yogurt"), "search");
    assert.equal(askIntent("2% milk"), "search");
    assert.equal(askIntent("bread and butter"), "search");
  });

  it("sends a sentence or a list to import matching", () => {
    assert.equal(askIntent("taco night for 6, milk, eggs, bread"), "list");
    assert.equal(askIntent("milk, eggs, bread"), "list");
    assert.equal(askIntent("milk\neggs\nbread"), "list");
    assert.equal(askIntent("taco night for 6"), "list");
    assert.equal(askIntent("milk and eggs"), "list");
    assert.equal(askIntent("I need milk eggs bread and juice"), "list");
  });
});
