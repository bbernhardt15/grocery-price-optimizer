import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { browseDepartment, isCoffeeHardwareName, isFarmEquipmentName, isMobilityGearName, isOralSupplementName, mapToDepartment } from "./departments";
import { krogerLookupCodes, krogerRequestId } from "./normalize";
import { krogerTickForQueue } from "../ingest/crossLookup";
import { PRICE_BUDGET_MS, WALMART_PRICE_GRACE_MS } from "../priceCache";
import { PLAN_TIMEOUT_MS } from "../../public/shopper/planLoad.js";

describe("v95 aisle strays", () => {
  it("sends supplement tablets and capsules to personal care ahead of a food aisle", () => {
    assert.equal(isOralSupplementName("Apple Cider Vinegar Capsules 120 ct"), true);
    assert.equal(browseDepartment(["Produce"], "Nature's Way Alive Women's Ultra Potency Tablets", "produce"), "personal-care");
    assert.equal(mapToDepartment(["Produce/Fruit"], "Spring Valley Vitamin D3 Softgels").departmentId, "personal-care");
    assert.equal(isOralSupplementName("Nespresso Vertuo Coffee Capsules"), false);
    assert.equal(browseDepartment(["Beverages"], "Nespresso Vertuo Coffee Capsules", "beverages"), "beverages");
  });

  it("sends mobility gear, coop hardware, and coffee machines out of the food aisles", () => {
    assert.equal(isMobilityGearName("COEQINE Crutch Pouch"), true);
    assert.equal(browseDepartment(["Dairy"], "COEQINE Crutch Pouch", "dairy-eggs"), "other");
    assert.equal(isFarmEquipmentName("Solar Chicken Coop Fan"), true);
    assert.equal(browseDepartment(["Meat"], "Solar Chicken Coop Fan", "meat-seafood"), "other");
    assert.equal(browseDepartment(["Meat"], "Boneless Chicken Breast", "meat-seafood"), "meat-seafood");
    assert.equal(isCoffeeHardwareName("Nespresso VertuoPlus Coffee and Espresso Machine"), true);
    assert.equal(isCoffeeHardwareName("Keurig Water Filter 2 pack"), true);
    assert.equal(browseDepartment(["Beverages"], "Nespresso VertuoPlus Coffee and Espresso Machine", "beverages"), "other");
    assert.equal(isCoffeeHardwareName("Nespresso Espresso Capsules"), false);
  });
});

describe("v95 Kroger id shapes", () => {
  it("asks with the 13-digit body first and the check-digit form second", () => {
    const codes = krogerLookupCodes("049000042566");
    assert.equal(codes[0], "0004900004256");
    assert.equal(codes[1], "0049000042566");
    assert.equal(codes.every((code) => code.length === 13), true);
    assert.deepEqual(krogerLookupCodes("4011"), ["0000000004011"]);
    assert.equal(krogerRequestId("201234567890")?.length, 13);
  });

  it("gives a long lookup queue the majority of a Kroger tick", () => {
    const quiet = krogerTickForQueue({ lookup: 1, refresh: 2, discovery: 1, refreshFirst: true }, 40, 4);
    assert.equal(quiet.discovery, 1);
    const backedUp = krogerTickForQueue({ lookup: 1, refresh: 2, discovery: 1, refreshFirst: true }, 72_500, 4);
    assert.equal(backedUp.refreshFirst, false);
    assert.ok(backedUp.lookup >= 2);
    assert.ok(backedUp.discovery <= 1);
    assert.equal(backedUp.lookup + backedUp.refresh + backedUp.discovery, 4);
  });
});

describe("v95 price check budget", () => {
  it("is under half of the old 9 second server budget plus 6 second Walmart grace", () => {
    const before = 9_000 + 6_000;
    const after = PRICE_BUDGET_MS + WALMART_PRICE_GRACE_MS;
    assert.equal(PRICE_BUDGET_MS, 4_000);
    assert.equal(WALMART_PRICE_GRACE_MS, 2_000);
    assert.equal(PLAN_TIMEOUT_MS, 12_000);
    assert.ok(after * 2 < before);
  });
});
