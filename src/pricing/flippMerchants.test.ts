import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sampleZips from "./flipp/sample-zips.json";
import {
  allowsDemoFallback,
  canonicalGroceryStoreName,
  FLIPP_MERCHANT_MAPPINGS,
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
    assert.equal(mappingForStore("Costco")?.club, true);
    assert.equal(mappingForStore("Costco")?.dealsOnly, true);
    assert.equal(groceryStoreNameForFlippMerchant("H-E-B", 2467), "H-E-B");
    assert.equal(groceryStoreNameForFlippMerchant("Jewel-Osco", 2364), "Jewel-Osco");
    assert.equal(groceryStoreNameForFlippMerchant("Acme Markets", 2365), "Acme");
    assert.equal(groceryStoreNameForFlippMerchant("Sprouts Farmers Market", 2419), "Sprouts");
    assert.equal(groceryStoreNameForFlippMerchant("Stop & Shop", 2393), "Stop & Shop");
    assert.equal(groceryStoreNameForFlippMerchant("Winn-Dixie", 2415), "Winn-Dixie");
    assert.equal(groceryStoreNameForFlippMerchant("Vons", 2375), "Vons");
    assert.equal(groceryStoreNameForFlippMerchant("Tom Thumb", 2381), "Tom Thumb");
    assert.equal(groceryStoreNameForFlippMerchant("Randalls", 2378), "Randalls");
    assert.equal(groceryStoreNameForFlippMerchant("Pavilions", 2377), "Pavilions");
    assert.equal(groceryStoreNameForFlippMerchant("Albertsons", 5661), "Albertsons");
    assert.equal(groceryStoreNameForFlippMerchant("Food Lion", 2100), undefined);
    assert.equal(groceryStoreNameForFlippMerchant("Safeway", 5667), undefined);
    assert.equal(groceryStoreNameForFlippMerchant("Giant Eagle", 2130), undefined);
    assert.equal(groceryStoreNameForFlippMerchant("Safeway Liquor", 4623), undefined);
    assert.equal(flippItemMatchesStore("Safeway", "Safeway Liquor", 4623), false);
    assert.equal(mappingForStore("Kroger")?.merchantIds.includes(3883), true);
    assert.equal(mappingForStore("Kroger")?.merchantIds.includes(2550), true);
    assert.equal(allowsDemoFallback("Publix"), false);
    assert.equal(allowsDemoFallback("Sprouts"), false);
    assert.equal(allowsDemoFallback("Aldi"), true);
    assert.equal(allowsDemoFallback("Kroger"), true);
    assert.match(mappingForStore("Jewel-Osco")?.searchUrl ?? "", /\{q\}/);
  });

  it("only keeps banners Flipp returned for the sample ZIPs", () => {
    const seen = new Set<number>();
    assert.deepEqual(sampleZips.postalCodes, [
      "45103",
      "10001",
      "60601",
      "75201",
      "90012",
      "30303",
      "33101",
      "77002",
    ]);
    for (const zip of sampleZips.postalCodes) {
      const rows = sampleZips.byZip[zip as keyof typeof sampleZips.byZip];
      assert.ok(rows.length > 0, zip);
      for (const row of rows) {
        seen.add(row.merchantId);
      }
    }
    for (const mapping of FLIPP_MERCHANT_MAPPINGS) {
      assert.ok(
        mapping.merchantIds.some((id) => seen.has(id)),
        `${mapping.storeName} was not in the Flipp flyer index`
      );
    }
    for (const name of sampleZips.notFound) {
      assert.equal(
        FLIPP_MERCHANT_MAPPINGS.some(
          (mapping) => mapping.storeName.toLowerCase() === name.toLowerCase()
        ),
        false,
        name
      );
    }
  });
});
