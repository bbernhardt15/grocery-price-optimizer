import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  firstTwoWordQuery,
  nameContainsAllTokens,
  productSearchAttempts,
  tokenizeProductName,
} from "./productSearchQuery";

describe("productSearchQuery", () => {
  it("splits Honey Nut Cheerios Cereal into word tokens", () => {
    assert.deepEqual(tokenizeProductName("Honey Nut Cheerios Cereal"), [
      "Honey",
      "Nut",
      "Cheerios",
      "Cereal",
    ]);
  });

  it("falls back to the first two words after the full name", () => {
    assert.deepEqual(productSearchAttempts("Honey Nut Cheerios Cereal"), [
      "Honey Nut Cheerios Cereal",
      "Honey Nut",
    ]);
    assert.equal(firstTwoWordQuery("Honey Nut Cheerios Cereal"), "Honey Nut");
    assert.equal(firstTwoWordQuery("milk"), null);
  });

  it("matches store names that contain every keyword, ignoring case", () => {
    assert.equal(
      nameContainsAllTokens("Honey Nut Cheerios", ["Honey", "Nut", "Cheerios", "Cereal"]),
      false
    );
    assert.equal(
      nameContainsAllTokens("Honey Nut Cheerios", ["Honey", "Nut"]),
      true
    );
  });
});
