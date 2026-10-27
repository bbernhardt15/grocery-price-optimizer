import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseModelJson, validateAiItems } from "./aiSchema";

describe("validateAiItems", () => {
  it("accepts a strict grocery list and coerces a couple", () => {
    const result = validateAiItems({
      items: [
        { name: "whole milk", quantity: 2, brand: "Dairy Pure", size: "gallon" },
        { name: "bananas", quantity: "a couple" },
      ],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.items[0]?.brand, "Dairy Pure");
    assert.equal(result.items[0]?.size, "gallon");
    assert.equal(result.items[1]?.quantity, 2);
    assert.equal("price" in (result.items[0] ?? {}), false);
  });

  it("rejects prices, stores, and broken rows", () => {
    assert.equal(validateAiItems({ items: [{ name: "milk", quantity: 1, price: 3.29 }] }).ok, false);
    assert.equal(validateAiItems({ items: [{ name: "milk", quantity: 1 }], store: "Kroger" }).ok, false);
    assert.equal(validateAiItems({ items: [{ name: "", quantity: 1 }] }).ok, false);
    assert.equal(validateAiItems({ items: [{ name: "milk", quantity: 0 }] }).ok, false);
    assert.equal(validateAiItems({ items: "milk" }).ok, false);
    assert.equal(validateAiItems(null).ok, false);
    assert.equal(validateAiItems({ items: [] }).ok, false);
  });

  it("reads fenced JSON", () => {
    const parsed = parseModelJson('```json\n{"items":[{"name":"eggs","quantity":1}]}\n```');
    const result = validateAiItems(parsed);
    assert.equal(result.ok, true);
  });
});
