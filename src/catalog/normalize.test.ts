import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expandUpcE, gtinCheckDigit, groupOffersByUpc, hasStandardCheckDigit, isStoreBrand, krogerLookupCodes, krogerProductIdForLookup, krogerRequestId, storeLookupFormats, upcForStorage, upcKey, walmartLookupCodes, walmartUpcForLookup } from "./normalize";
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
    assert.equal(upcKey("0-49000-04256-6"), upcKey("049000042566"));
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
    assert.equal(key, upcKey(krogerWithoutCheck, { source: "kroger-product-id" }));
    assert.equal(key, "4900004256");
  });

  it("matches real Walmart and Kroger forms, including a numeric UPC that lost its leading zero", () => {
    const cokeWalmart = "049000042566";
    const cokeKroger = "0004900004256";
    const cokeNumeric = String(Number(cokeWalmart));
    assert.equal(cokeNumeric, "49000042566");
    assert.equal(upcKey(cokeWalmart), upcKey(cokeKroger, { source: "kroger-product-id" }));
    assert.equal(upcKey(cokeNumeric), upcKey(cokeKroger, { source: "kroger-product-id" }));
    assert.equal(krogerProductIdForLookup(cokeWalmart), cokeKroger);
    assert.equal(krogerProductIdForLookup(cokeNumeric), cokeKroger);
    assert.equal(walmartUpcForLookup(cokeKroger), cokeWalmart);
    assert.equal(walmartUpcForLookup(upcKey(cokeKroger)), cokeWalmart);

    const generalMillsBody = "01600027528";
    const generalMillsCheck = String(gtinCheckDigit(generalMillsBody));
    const generalMillsWalmart = `${generalMillsBody}${generalMillsCheck}`;
    const generalMillsKroger = generalMillsBody.padStart(13, "0");
    assert.equal(generalMillsWalmart, "016000275287");
    assert.equal(upcKey(generalMillsWalmart), upcKey(generalMillsKroger, { source: "kroger-product-id" }));
    assert.equal(upcKey(String(Number(generalMillsWalmart))), upcKey(generalMillsKroger, { source: "kroger-product-id" }));
    assert.equal(walmartUpcForLookup(generalMillsKroger), generalMillsWalmart);
    assert.equal(krogerProductIdForLookup(generalMillsWalmart), generalMillsKroger);

    const pgBody = "03700031802";
    const pgWalmart = `${pgBody}${gtinCheckDigit(pgBody)}`;
    const pgKroger = pgBody.padStart(13, "0");
    assert.equal(upcKey(pgWalmart), upcKey(pgKroger, { source: "kroger-product-id" }));
    assert.equal(upcKey(pgWalmart.padStart(14, "0")), upcKey(pgKroger, { source: "kroger-product-id" }));
    assert.equal(walmartUpcForLookup(pgKroger), pgWalmart);
  });

  it("expands UPC-E to the same key as UPC-A and lists leading-zero pads", () => {
    const middle = "123456";
    const expanded = expandUpcE(`0${middle}5`);
    assert.equal(expanded, "012345000065");
    assert.equal(upcKey(expanded), upcKey("012345000065"));
    assert.equal(upcKey(`0${middle}5`), upcKey("012345000065"));
    assert.equal(upcKey("1234567"), null);
    const codes = walmartLookupCodes("012345000065");
    assert.deepEqual(codes, ["012345000065"]);
    assert.deepEqual(walmartLookupCodes(`0${middle}5`), codes);
    const kroger = krogerLookupCodes("012345000065");
    assert.deepEqual(kroger, ["0001234500006"]);
    assert.equal(krogerProductIdForLookup("070708200500"), "0007070820050");
    assert.equal(krogerProductIdForLookup("70708200500"), "0007070820050");
    assert.equal(krogerProductIdForLookup("003063880160"), "0000306388016");
    assert.equal(krogerProductIdForLookup("073214835404"), "0007321483540");
    assert.deepEqual(krogerLookupCodes("070708200500"), ["0007070820050"]);
    assert.equal(upcForStorage("049000042566"), "0004900004256");
    assert.equal(upcForStorage("49000042566"), "0004900004256");
    assert.equal(upcForStorage("0004900004256"), "0004900004256");
    // A non-GS1 check digit cannot be rebuilt from the 13-digit body, so the
    // stored Walmart code stays put. Lookup still zero-pads it to 13.
    assert.equal(krogerProductIdForLookup(upcForStorage("070708200500")), "0007070820050");
    assert.equal(krogerProductIdForLookup(upcForStorage("70708200500")), "0007070820050");
    assert.equal(walmartUpcForLookup(upcForStorage("070708200500")), walmartUpcForLookup("070708200500"));
    assert.equal(walmartUpcForLookup(upcForStorage("049000042566")), "049000042566");
    // 000001000078's Kroger id 0000000100007 also passes the GTIN check.
    // The request id stays 13 digits so a second normalize cannot shorten it.
    const accidentalUpc = "000001000078";
    const accidentalId = "0000000100007";
    assert.equal(gtinCheckDigit(accidentalUpc.slice(0, -1)), Number(accidentalUpc.at(-1)));
    assert.equal(hasStandardCheckDigit(accidentalId), true);
    assert.equal(krogerProductIdForLookup(accidentalUpc), accidentalId);
    assert.equal(upcKey(accidentalId, { source: "kroger-product-id" }), upcKey(accidentalUpc));
    assert.deepEqual(krogerLookupCodes(accidentalId), [accidentalId]);
    assert.deepEqual(krogerLookupCodes(accidentalUpc), [accidentalId]);
    assert.equal(krogerProductIdForLookup("0049000042566"), "0004900004256");
    const zeroBody = "01200000345";
    const zeroCheck = String(gtinCheckDigit(zeroBody));
    const formats = storeLookupFormats("016000124790");
    assert.deepEqual(formats, {
      krogerProductId: "0001600012479",
      gtin14: "00016000124790",
      stored: "016000124790",
      upcA: "016000124790",
    });
    assert.deepEqual(storeLookupFormats("0001600012479"), {
      krogerProductId: "0001600012479",
      gtin14: "00016000124790",
      stored: "0001600012479",
      upcA: "016000124790",
    });
    assert.deepEqual(storeLookupFormats("049000042566"), {
      krogerProductId: "0004900004256",
      gtin14: "00049000042566",
      stored: "049000042566",
      upcA: "049000042566",
    });
    assert.equal(storeLookupFormats("894700010144").krogerProductId, "0089470001014");
    assert.equal(storeLookupFormats("0089470001014").upcA, "894700010144");
    assert.equal(storeLookupFormats("070708200500").krogerProductId, "0007070820050");
    // Production dairy misses and personal-care hits, ZIP 45103 catalog, Nov 12.
    assert.equal(krogerRequestId("0004138761190"), "0004138761190");
    assert.equal(krogerRequestId("0003320018626"), "0003320018626");
    assert.equal(krogerRequestId("041570054130"), "0004157005413");
    assert.deepEqual(krogerLookupCodes("041570054130"), ["0004157005413"]);
    assert.equal(storeLookupFormats("070708200500").upcA, "070708200507");
    assert.equal(expandUpcE(`0123450${zeroCheck}`), `${zeroBody}${zeroCheck}`);
    assert.equal(upcKey(`0123450${zeroCheck}`), upcKey(`${zeroBody}${zeroCheck}`));
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
