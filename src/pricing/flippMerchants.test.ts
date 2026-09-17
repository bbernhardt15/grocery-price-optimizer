import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalGroceryStoreName,
  flippItemMatchesStore,
  groceryStoreNameForFlippMerchant,
  mappingForStore,
} from "./flipp/merchants";

describe("Flipp merchant mapping", () => {
  it("maps Flipp merchant ids and names onto Grocery Gitter storeNames", () => {
    assert.equal(groceryStoreNameForFlippMerchant("ALDI", 2353), "Aldi");
    assert.equal(groceryStoreNameForFlippMerchant("Target", 2040), "Target");
    assert.equal(groceryStoreNameForFlippMerchant("Walmart", 2175), "Walmart");
    assert.equal(groceryStoreNameForFlippMerchant("Kroger", 2707), "Kroger");
    assert.equal(groceryStoreNameForFlippMerchant("King Soopers"), "Kroger");
    assert.equal(groceryStoreNameForFlippMerchant("Publix", 2361), "Publix");
    assert.equal(groceryStoreNameForFlippMerchant("Meijer", 2281), "Meijer");
  });

  it("does not treat Publix Liquors as the Publix grocery circular", () => {
    assert.equal(groceryStoreNameForFlippMerchant("Publix Liquors", 5489), undefined);
    assert.equal(flippItemMatchesStore("Publix", "Publix Liquors", 5489), false);
    assert.equal(flippItemMatchesStore("Publix", "Publix", 2361), true);
  });

  it("canonicalizes aliases to Grocery Gitter store names", () => {
    assert.equal(canonicalGroceryStoreName("ALDI"), "Aldi");
    assert.equal(canonicalGroceryStoreName("ralphs"), "Kroger");
    assert.equal(canonicalGroceryStoreName("Harris Teeter"), "Kroger");
    assert.equal(mappingForStore("Target")?.flyerKitSlug, "target");
    assert.equal(mappingForStore("Costco")?.merchantIds.includes(2519), true);
  });
});
