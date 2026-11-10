import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catalogJoinKey, groupOffersByUpc, hasStandardCheckDigit } from "./normalize";
import { canonicalGtin14, gtinCheckDigit, gtinJoinKey, parseGtin } from "./gtin";
import type { RawCatalogRecord } from "./types";

const cheeriosWalmart = "016000124790";
const cheeriosKroger = "0001600012479";
const cokeWalmart = "049000042566";
const cokeKroger = "0004900004256";
const chobaniWalmart = "894700010144";
const chobaniKroger = "0089470001014";

function record(overrides: Partial<RawCatalogRecord> & Pick<RawCatalogRecord, "name" | "storeName" | "price">): RawCatalogRecord {
  return { brand: "Test", priceSource: "live", ...overrides };
}

function upcAFromBody(body11: string): string {
  return `${body11}${gtinCheckDigit(body11)}`;
}

function caseGtin(indicator: number, upcA: string): string {
  const data = `${indicator}0${upcA.slice(0, 11)}`;
  return `${data}${gtinCheckDigit(data)}`;
}

/**
 * The previous reader treated a 13-digit id as a no-check Kroger id only when
 * it had three or more leading zeros. Fewer zeros plus a GS1-valid last 12
 * dropped a real digit. Kept here so the sample can report that before/after.
 */
function legacyKrogerKey(kroger13: string): string {
  const leadingZeros = kroger13.match(/^0*/)?.[0].length ?? 0;
  const wrapped = kroger13.slice(1);
  const body = leadingZeros < 3 && wrapped.length === 12 && hasStandardCheckDigit(wrapped)
    ? wrapped.slice(0, 11)
    : kroger13.slice(-11);
  return body.replace(/^0+/, "");
}

describe("canonical GTIN", () => {
  it("maps real Walmart UPC-A and Kroger no-check ids onto one GTIN-14", () => {
    const pairs = [
      [cheeriosWalmart, cheeriosKroger],
      [cokeWalmart, cokeKroger],
      ["078742351896", "0007874235189"],
      ["100144318730", "0010014431873"],
      [upcAFromBody("71514150349"), "0071514150349"],
    ];
    for (const [walmart, kroger] of pairs) {
      assert.equal(canonicalGtin14(walmart), canonicalGtin14(kroger, { source: "kroger-product-id" }), walmart);
      assert.equal(gtinJoinKey(walmart), gtinJoinKey(kroger, { source: "kroger-product-id" }), walmart);
      assert.equal(parseGtin(kroger, { source: "kroger-product-id" })?.upcA, walmart.length === 12 ? walmart : parseGtin(walmart)?.upcA);
    }
    assert.equal(canonicalGtin14(cheeriosWalmart), "00016000124790");
    assert.equal(canonicalGtin14(cokeWalmart), "00049000042566");
  });

  it("computes the check digit for every Kroger productId, including two leading zeros", () => {
    assert.equal(gtinCheckDigit(chobaniWalmart.slice(0, 11)), Number(chobaniWalmart.at(-1)));
    assert.equal(hasStandardCheckDigit(chobaniKroger), true);
    assert.equal(gtinJoinKey(chobaniWalmart), "89470001014");
    assert.equal(gtinJoinKey(chobaniKroger, { source: "kroger-product-id" }), "89470001014");
    assert.equal(canonicalGtin14(chobaniKroger, { source: "kroger-product-id" }), canonicalGtin14(chobaniWalmart));
    assert.notEqual(legacyKrogerKey(chobaniKroger), gtinJoinKey(chobaniWalmart));
    assert.equal(gtinJoinKey(cheeriosKroger, { source: "kroger-product-id" }), "1600012479");
    assert.equal(gtinJoinKey(cheeriosWalmart), "1600012479");
  });

  it("matches a real Open Food Facts sample, including the two-zero ids the old rule split", () => {
    const pairs: Array<[string, string]> = [
    ["Organic Bread 21 Whole Grains and Seeds", "013764027053"],
    ["THIN-SLICED", "013764027138"],
    ["100% Whole Wheat Bread", "072250037129"],
    ["EZEKIEL 4:9 FLOURLESS SPROUTED GRAIN BREAD", "073472001202"],
    ["ORGANIC BREAD GOOD SEED THIN-SLICED", "013764027121"],
    ["English Muffins", "048121102081"],
    ["Honey Wheat Bread", "072250037068"],
    ["Organic Bread", "013764027220"],
    ["Organic Bread Good Seed", "013764027039"],
    ["Butterbread", "072250049191"],
    ["Thin-Sliced Organic Bread Sprouted Whole Grains", "013764028074"],
    ["21 Whole Grains And Seeds", "013764027756"],
    ["Organic Bagels Plain Awesome", "013764028012"],
    ["Organic Bagels Epic Everything", "013764028036"],
    ["Plain Bagels", "048121277079"],
    ["Powerseed Organic Bread", "013764027282"],
    ["Artesano bakery bread", "072945612419"],
    ["Honey Wheat Bread", "072945601369"],
    ["Bread -english Muffins 100 Calories Light Multig", "048121276201"],
    ["Whole Grain 15 Grain Bread", "014100085980"],
    ["Organic Creamy Peanut Butter", "096619555505"],
    ["Creamy Peanut Butter", "051500255162"],
    ["Creamy Peanut Butter", "037600110754"],
    ["CREAMY PEANUT BUTTER", "051500240946"],
    ["Reeses Creamy Peanut Butter", "034000400126"],
    ["CREAMY PEANUT BUTTER", "051500720011"],
    ["Peanut Butter Spread", "051500243213"],
    ["Peanut Butter Pretzels", "096619336753"],
    ["PEANUT BUTTER SPREAD", "051500255650"],
    ["NuttZo Organic 7 Nut & Seed Butter POWER FUEL Cr", "894697002184"],
    ["Creamy Peanut Butter", "037600223324"],
    ["Peanut Butter Dark Chocolate", "016000507661"],
    ["Extra Crunchy Peanut Butter", "051500255377"],
    ["ClifBar Crunchy Peanut Butter", "722252101204"],
    ["PEANUT BUTTER SPREAD", "855188003004"],
    ["Natural Creamy Peanut Butter", "051500017005"],
    ["Super Extra Large Peanuts", "096619222490"],
    ["Natural Creamy Peanut Butter Spread", "037600106740"],
    ["100% Peanuts! Creamy", "074822610631"],
    ["Peanut butter", "051500245408"],
    ["Dry Roasted Lightly Salted Peanuts", "029000076501"],
    ["Creamy Peanut Butter", "037600106252"],
    ["Sweet & Salty Nut Peanut Chewy Granola Bar", "016000442825"],
    ["Peanut Butter", "037600223348"],
    ["Peanut Butter", "051500241776"],
    ["Organic Chewy Granola Bars Mixed Berry", "687456213064"],
    ["Dark Chocolate Peanut Butter Cups", "850034219356"],
    ["Ramen Noodle Soup Chicken Flavor", "041789002113"],
    ["Tomato Soup", "051000000118"],
    ["Chicken Noodle", "051000012517"],
    ["Chicken Ramen Noodle Soup", "070662010037"],
    ["Chicken Ramen", "041789001215"],
    ["SHIN RAMYUN", "031146150601"],
    ["Cream Of Mushroom Soup", "051000012616"],
    ["Lentil Vegetable Soup", "042272005826"],
    ["Ramen Noodle Soup", "041789002120"],
    ["Mediterranean-Style Lentil", "041196133066"],
    ["MINESTRONE", "041196010121"],
    ["Organic Bone Broth Chicken Unsalted", "052603056076"],
    ["Chicken Broth", "051000121141"],
    ["Organic Creamy Tomato Soup", "052603041201"],
    ["Organic Roasted Red Pepper & Tomato Soup", "052603041843"],
    ["CHICKEN BROTH", "051000132796"],
    ["Instant Bone Broth", "850005324225"],
    ["Cup Noodles Chicken Flavor", "070662030035"],
    ["Classic Chicken Noodle with White Meat Chicken", "051000038852"],
    ["Organic Butternut Squash Soup", "052603041805"],
    ["Split Pea Soup", "042272005840"],
    ["Organic Chicken Sipping Bone Broth", "096619095032"],
    ["Organic Chicken Noodle Soup", "052603283663"],
    ["Progresso Chicken Noodle", "041196010886"],
    ["Organic low sodium vegetable broth", "052603054508"],
    ["CHICKEN & HOMESTYLE NOODLES", "041196914016"],
    ["organic GREEK YOGURT plain", "096619483556"],
    ["Greek Yogurt Nonfat Plain", "894700010137"],
    ["Total 0% Milkfat", "689544083016"],
    ["Kefir", "017077102322"],
    ["Total 2% Milkfat", "689544083023"],
    ["Oikos Triple Zero Blended Greek Yogurt Vanilla", "036632019448"],
    ["Total 5% Milkfat Greek Yogurt", "689544083009"],
    ["Greek Yogurt Vanilla", "894700010144"],
    ["Greek Yogurt Whole Milk Plain", "894700010434"],
    ["Hipro", "034361588136"],
    ["HiPro Mangue", "034361729218"],
    ["Plain Whole Milk Probiotic Yogurt", "052159000011"],
    ["Greek Yogurt Vanilla Flavored", "818290018571"],
    ["OIKOS TRIPLE ZERO Strawberry Flavored", "036632020192"],
    ["Blended Vanilla", "036632039200"],
    ["simple ingredient skyr", "898248001411"],
    ["Mixed Berry Vanilla Protein Shake", "818290017734"],
    ["Vanilla", "898248001077"],
    ["Total 0% Milkfat", "689544080008"],
    ["Greek Plain", "078742016856"],
    ["Yogurt blends snack", "015000047757"],
    ["Strawberries & Cream", "818290017710"],
    ["Greek Yogurt Blueberry on the Bottom", "894700010052"],
    ["Honey Nut Cheerios", "016000124790"],
    ["Coca-Cola", "049000042566"],
    ["Diet Coke", "049000028904"],
    ];
    assert.ok(pairs.length >= 50);
    let legacySplits = 0;
    const zeroCounts = new Set<number>();
    for (const [name, upcA] of pairs) {
      assert.equal(upcA.length, 12, name);
      assert.equal(Number(upcA.at(-1)), gtinCheckDigit(upcA.slice(0, 11)), name);
      const body = upcA.slice(0, 11);
      const kroger = body.padStart(13, "0");
      zeroCounts.add(kroger.match(/^0*/)?.[0].length ?? 0);
      const joined = gtinJoinKey(upcA);
      assert.equal(gtinJoinKey(kroger, { source: "kroger-product-id" }), joined, name);
      assert.equal(canonicalGtin14(kroger, { source: "kroger-product-id" }), canonicalGtin14(upcA), name);
      if (legacyKrogerKey(kroger) !== joined) legacySplits += 1;
    }
    assert.equal(legacySplits, 3);
    assert.equal(zeroCounts.has(2), true);
    assert.equal(zeroCounts.has(3), true);
    assert.equal(legacyKrogerKey(chobaniKroger) === gtinJoinKey(chobaniWalmart), false);
    assert.equal(gtinJoinKey(chobaniKroger, { source: "kroger-product-id" }), gtinJoinKey(chobaniWalmart));
  });

  it("keeps a case GTIN-14 distinct from the consumer unit", () => {
    const bottle = cokeWalmart;
    const caseOfCoke = caseGtin(1, bottle);
    assert.equal(caseOfCoke, "10049000042563");
    assert.notEqual(gtinJoinKey(caseOfCoke), gtinJoinKey(bottle));
    assert.equal(gtinJoinKey(`00${bottle}`), gtinJoinKey(bottle));
    assert.equal(canonicalGtin14(`00${bottle}`), "00049000042566");
    for (const indicator of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const packed = caseGtin(indicator, bottle);
      assert.equal(parseGtin(packed)?.indicator, indicator);
      assert.notEqual(gtinJoinKey(packed), gtinJoinKey(bottle));
      assert.notEqual(gtinJoinKey(packed), gtinJoinKey(caseGtin(indicator === 8 ? 1 : indicator + 1, bottle)));
    }
    const variable = `9${caseOfCoke.slice(1, 13)}`;
    const indicator9 = `${variable}${gtinCheckDigit(variable)}`;
    assert.equal(gtinJoinKey(indicator9), null);
    assert.equal(parseGtin(indicator9), null);
  });

  it("leaves non-zero EAN-13 and plain GTIN-8 unparsed, and gives PLU and random-weight no key", () => {
    const eanBody = "400638133393";
    const ean = `${eanBody}${gtinCheckDigit(eanBody)}`;
    assert.equal(ean.startsWith("0"), false);
    assert.equal(hasStandardCheckDigit(ean), true);
    assert.equal(parseGtin(ean), null);
    assert.equal(gtinJoinKey(ean), null);
    const gtin8Body = "9638507";
    const gtin8 = `${gtin8Body}${gtinCheckDigit(gtin8Body)}`;
    assert.equal(parseGtin(gtin8), null);
    assert.equal(gtinJoinKey(gtin8), null);
    assert.equal(gtinJoinKey("4011"), null);
    assert.equal(gtinJoinKey("4065"), null);
    const randomBody = "20123400000";
    const randomUpc = upcAFromBody(randomBody);
    assert.equal(gtinJoinKey(randomUpc), null);
    assert.equal(gtinJoinKey(randomBody.padStart(13, "0"), { source: "kroger-product-id" }), null);
    assert.equal(gtinJoinKey("1234567"), null);
  });

  it("accepts UPC-E, a dropped leading zero, and a GTIN-14 pad", () => {
    const upcA = "012345000065";
    assert.equal(canonicalGtin14(`0${"123456"}5`), canonicalGtin14(upcA));
    assert.equal(gtinJoinKey("49000042566"), gtinJoinKey(cokeWalmart));
    assert.equal(canonicalGtin14(`00${cokeWalmart}`), canonicalGtin14(cokeWalmart));
    assert.equal(gtinJoinKey("1234567"), null);
  });

  it("groups a Walmart offer with the Kroger offer for the same item", () => {
    const products = groupOffersByUpc([
      record({
        name: "Chobani Vanilla",
        brand: "Chobani",
        storeName: "Walmart",
        price: 1.29,
        upc: chobaniWalmart,
        productId: "104501",
        departmentId: "dairy-eggs",
      }),
      record({
        name: "Chobani Greek Vanilla",
        brand: "Chobani",
        storeName: "Kroger",
        price: 1.19,
        upc: chobaniKroger,
        productId: chobaniKroger,
        departmentId: "dairy-eggs",
      }),
      record({
        name: "Honey Nut Cheerios",
        brand: "General Mills",
        storeName: "Walmart",
        price: 4.98,
        upc: cheeriosWalmart,
        productId: "944068996",
        departmentId: "breakfast",
      }),
      record({
        name: "Honey Nut Cheerios Cereal",
        brand: "General Mills",
        storeName: "Kroger",
        price: 3.99,
        upc: cheeriosKroger,
        productId: cheeriosKroger,
        departmentId: "breakfast",
      }),
    ]);
    assert.equal(products.length, 2);
    const chobani = products.find((product) => product.name.toLowerCase().includes("chobani"));
    const cheerios = products.find((product) => product.name.toLowerCase().includes("cheerios"));
    assert.equal(chobani?.offers.length, 2);
    assert.equal(cheerios?.offers.length, 2);
    assert.equal(catalogJoinKey({ storeName: "Kroger", productId: chobaniKroger, upc: chobaniKroger }), gtinJoinKey(chobaniWalmart));
  });
});
