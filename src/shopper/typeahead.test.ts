import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  highlightMatch,
  nextSuggestIndex,
  SUGGEST_DEBOUNCE_MS,
  suggestPanelKind,
  suggestionFacts,
  suggestionPriceLabel,
} from "../../public/shopper/typeahead.js";

describe("highlightMatch", () => {
  it("marks the typed word without caring about case", () => {
    assert.deepEqual(highlightMatch("Whole Milk", "milk"), [
      { text: "Whole ", match: false },
      { text: "Milk", match: true },
    ]);
  });

  it("marks each word and treats regex characters as literal text", () => {
    assert.deepEqual(highlightMatch("Milk (2%)", "2% milk"), [
      { text: "Milk", match: true },
      { text: " (", match: false },
      { text: "2%", match: true },
      { text: ")", match: false },
    ]);
    assert.deepEqual(highlightMatch("a.b cereal", "a.b"), [
      { text: "a.b", match: true },
      { text: " cereal", match: false },
    ]);
  });

  it("returns the original text when nothing was typed or nothing matched", () => {
    assert.deepEqual(highlightMatch("Bananas", ""), [{ text: "Bananas", match: false }]);
    assert.deepEqual(highlightMatch("Bananas", "   "), [{ text: "Bananas", match: false }]);
    assert.deepEqual(highlightMatch("Bananas", "kale"), [{ text: "Bananas", match: false }]);
  });
});

describe("suggest keyboard and panel", () => {
  it("moves with the arrows and clamps at the ends", () => {
    assert.equal(nextSuggestIndex(-1, 3, "ArrowDown"), 0);
    assert.equal(nextSuggestIndex(-1, 3, "ArrowUp"), 2);
    assert.equal(nextSuggestIndex(0, 3, "ArrowUp"), 0);
    assert.equal(nextSuggestIndex(2, 3, "ArrowDown"), 2);
    assert.equal(nextSuggestIndex(1, 0, "ArrowDown"), -1);
  });

  it("debounces and distinguishes hint, loading, empty, and results", () => {
    assert.equal(SUGGEST_DEBOUNCE_MS >= 100 && SUGGEST_DEBOUNCE_MS <= 250, true);
    assert.equal(suggestPanelKind("", "idle", 0), "hint");
    assert.equal(suggestPanelKind("  ", "ready", 0), "hint");
    assert.equal(suggestPanelKind("mil", "loading", 0), "loading");
    assert.equal(suggestPanelKind("mil", "ready", 0), "empty");
    assert.equal(suggestPanelKind("mil", "ready", 2), "results");
    assert.equal(suggestPanelKind("mil", "loading", 2), "results");
  });

  it("shows brand, department, size, and price only when they exist", () => {
    assert.deepEqual(
      suggestionFacts({ brand: "Dairy Pure", departmentName: "Dairy & Eggs", sizeLabel: "1 gal" }),
      ["Dairy Pure", "Dairy & Eggs", "1 gal"]
    );
    assert.deepEqual(suggestionFacts({ brand: "  ", departmentName: null, sizeLabel: "" }), []);
    assert.equal(suggestionPriceLabel(3.18, "Walmart", (value) => `$${value.toFixed(2)}`), "$3.18 at Walmart");
    assert.equal(suggestionPriceLabel(3.18, "", (value) => `$${value.toFixed(2)}`), "$3.18");
    assert.equal(suggestionPriceLabel(undefined, "Walmart", () => "$0"), null);
  });
});
