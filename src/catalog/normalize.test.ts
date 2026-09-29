import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gtinCheckDigit, groupOffersByUpc, isStoreBrand, krogerProductIdForLookup, upcKey, walmartUpcForLookup } from "./normalize";
import type { RawCatalogRecord } from "./types";

function record(overrides: Partial<RawCatalogRecord> & Pick<RawCatalogRecord, "name" | "storeName" | "price">): RawCatalogRecord {
  return {
    brand: "Test",
    priceSource: "seed",
    ...overrides,
  };
}

describe("upcKey", () => {
  it("strips punctuation and leading zeros so UPC-A and EAN-13 match", () => {
    assert.equal(upcKey("0-078742-00001-2"), upcKey("00078742000012"));
    assert.equal(upcKey("1234567"), null);
    assert.equal(upcKey(""), null);
    assert.equal(upcKey("not-a-code"), null);
  });

  it("drops Walmart's UPC-A check digit and keeps Kroger's 13-digit code that has none", () => {
    const walmartUpcA = "049000042566";
    const walmartEan = "0049000042566";
    const walmartGtin = "00049000042566";
    const krogerWithoutCheck = "0004900004256";
    const key = upcKey(walmartUpcA);
    assert.equal(key, upcKey(walmartEan));
    assert.equal(key, upcKey(walmartGtin));
    assert.equal(key, upcKey(krogerWithoutCheck));
    assert.equal(key, "4900004256");
  });

  it("matches real Walmart and Kroger forms, including a numeric UPC that lost its leading zero", () => {
    const cokeWalmart = "049000042566";
    const cokeKroger = "0004900004256";
    const cokeNumeric = String(Number(cokeWalmart));
    assert.equal(cokeNumeric, "49000042566");
    assert.equal(upcKey(cokeWalmart), upcKey(cokeKroger));
    assert.equal(upcKey(cokeNumeric), upcKey(cokeKroger));
    assert.equal(krogerProductIdForLookup(cokeWalmart), cokeKroger);
    assert.equal(krogerProductIdForLookup(cokeNumeric), cokeKroger);
    assert.equal(walmartUpcForLookup(cokeKroger), cokeWalmart);
    assert.equal(walmartUpcForLookup(upcKey(cokeKroger)), cokeWalmart);

    const generalMillsBody = "01600027528";
    const generalMillsCheck = String(gtinCheckDigit(generalMillsBody));
    const generalMillsWalmart = `${generalMillsBody}${generalMillsCheck}`;
    const generalMillsKroger = generalMillsBody.padStart(13, "0");
    assert.equal(generalMillsWalmart, "016000275287");
    assert.equal(upcKey(generalMillsWalmart), upcKey(generalMillsKroger));
    assert.equal(upcKey(String(Number(generalMillsWalmart))), upcKey(generalMillsKroger));
    assert.equal(walmartUpcForLookup(generalMillsKroger), generalMillsWalmart);
    assert.equal(krogerProductIdForLookup(generalMillsWalmart), generalMillsKroger);

    const pgBody = "03700031802";
    const pgWalmart = `${pgBody}${gtinCheckDigit(pgBody)}`;
    const pgKroger = pgBody.padStart(13, "0");
    assert.equal(upcKey(pgWalmart), upcKey(pgKroger));
    assert.equal(upcKey(pgWalmart.padStart(14, "0")), upcKey(pgKroger));
    assert.equal(walmartUpcForLookup(pgKroger), pgWalmart);
  });
});

describe("groupOffersByUpc", () => {
  it("groups offers from different stores when the UPC matches", () => {
    const products = groupOffersByUpc([
      record({
        name: "Whole Milk",
        brand: "Dairy Pure",
        storeName: "Kroger",
        price: 3.29,
        upc: "00078742000012",
        size: "1 gal",
        imageUrls: ["https://img.example/milk-a.jpg"],
        departmentId: "dairy-eggs",
      }),
      record({
        name: "Dairy Pure Whole Milk",
        brand: "Dairy Pure",
        storeName: "Walmart",
        price: 3.08,
        upc: "078742000012",
        size: "1 gal",
        imageUrls: ["https://img.example/milk-b.jpg"],
        priceSource: "live",
        onSale: true,
      }),
    ]);

    assert.equal(products.length, 1);
    assert.equal(products[0].id, `upc:${upcKey("078742000012")}`);
    assert.equal(products[0].offers.length, 2);
    assert.equal(products[0].bestOffer.storeName, "Walmart");
    assert.equal(products[0].bestOffer.price, 3.08);
    assert.equal(products[0].bestOffer.onSale, true);
    assert.equal(products[0].bestOffer.unitPriceText, "$3.08/gal");
    assert.equal(products[0].departmentId, "dairy-eggs");
    assert.deepEqual(products[0].imageUrls, [
      "https://img.example/milk-a.jpg",
      "https://img.example/milk-b.jpg",
    ]);
    assert.equal(products[0].name, "Dairy Pure Whole Milk");
  });

  it("keeps different UPCs as separate products and prefers a live price over a demo row at the same store", () => {
    const products = groupOffersByUpc([
      record({
        name: "Whole Milk",
        brand: "Great Value",
        storeName: "Walmart",
        price: 2.48,
        upc: "0099991000011",
        size: "1 gal",
        priceSource: "seed",
      }),
      record({
        name: "Whole Milk",
        brand: "Great Value",
        storeName: "Walmart",
        price: 2.44,
        upc: "0099991000011",
        size: "1 gal",
        priceSource: "live",
      }),
      record({
        name: "Whole Milk",
        brand: "Friendly Farms",
        storeName: "Aldi",
        price: 2.19,
        upc: "0099991000028",
        size: "1 gal",
      }),
    ]);

    assert.equal(products.length, 2);
    const walmart = products.find((product) => product.brand === "Great Value");
    assert.ok(walmart);
    assert.equal(walmart.offers.length, 1);
    assert.equal(walmart.offers[0].price, 2.44);
    assert.equal(walmart.offers[0].priceSource, "live");
    assert.equal(walmart.storeBrand, true);
    assert.equal(isStoreBrand("Friendly Farms"), true);
    assert.equal(isStoreBrand("Dairy Pure"), false);
  });

  it("does not merge offers that have no UPC", () => {
    const products = groupOffersByUpc([
      record({ name: "Bananas", brand: "Fresh", storeName: "Aldi", price: 0.49, size: "1 lb" }),
      record({ name: "Bananas", brand: "Fresh", storeName: "Walmart", price: 0.54, size: "1 lb" }),
    ]);
    assert.equal(products.length, 2);
    assert.ok(products.every((product) => product.id.startsWith("local:")));
  });
});
