import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  firstTwoWordQuery,
  matchTokenSets,
  nameContainsAllTokens,
  productSearchAttempts,
  stripServingAnnotations,
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

  it("strips FatSecret serving annotations such as (28g)", () => {
    assert.equal(stripServingAnnotations("White Sandwich Bread (28g)"), "White Sandwich Bread");
    assert.deepEqual(tokenizeProductName("White Sandwich Bread (28g)"), [
      "White",
      "Sandwich",
      "Bread",
    ]);
    assert.deepEqual(tokenizeProductName("Honey Nut Cheerios (37g)"), [
      "Honey",
      "Nut",
      "Cheerios",
    ]);
    assert.deepEqual(productSearchAttempts("White Sandwich Bread (28g)"), [
      "White Sandwich Bread",
      "White Sandwich",
    ]);
  });

  it("falls back to dropping Cereal, then the first two words", () => {
    assert.deepEqual(productSearchAttempts("Honey Nut Cheerios Cereal"), [
      "Honey Nut Cheerios Cereal",
      "Honey Nut Cheerios",
      "Honey Nut",
    ]);
    assert.equal(firstTwoWordQuery("Honey Nut Cheerios Cereal"), "Honey Nut");
    assert.equal(firstTwoWordQuery("milk"), null);
    assert.deepEqual(matchTokenSets("Honey Nut Cheerios Cereal"), [
      ["Honey", "Nut", "Cheerios", "Cereal"],
      ["Honey", "Nut", "Cheerios"],
      ["Honey", "Nut"],
    ]);
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
    assert.equal(
      nameContainsAllTokens("Great Value White Sandwich Bread", ["White", "Sandwich", "Bread"]),
      true
    );
  });
});
