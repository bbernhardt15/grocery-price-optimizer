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
    assert.equal(groceryStoreNameForFlippMerchant("Food Lion", 2100), "Food Lion");
    assert.equal(groceryStoreNameForFlippMerchant("H-E-B", 2467), "H-E-B");
    assert.equal(groceryStoreNameForFlippMerchant("Safeway", 5667), "Safeway");
    assert.equal(groceryStoreNameForFlippMerchant("Giant Eagle", 2130), "Giant Eagle");
    assert.equal(groceryStoreNameForFlippMerchant("Safeway Liquor", 4623), undefined);
    assert.equal(flippItemMatchesStore("Safeway", "Safeway Liquor", 4623), false);
    assert.equal(mappingForStore("Kroger")?.merchantIds.includes(3883), true);
  });
});
