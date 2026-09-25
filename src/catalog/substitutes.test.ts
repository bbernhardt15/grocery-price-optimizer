import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scoreSubstitute, type SubstituteProfile } from "./substitutes";

function profile(overrides: Partial<SubstituteProfile> & Pick<SubstituteProfile, "name" | "departmentId">): SubstituteProfile {
  return {
    brand: "National",
    packageSize: { dimension: "volume", amount: 128 },
    ...overrides,
  };
}

describe("scoreSubstitute", () => {
  const milk = profile({
    name: "Whole Milk",
    brand: "Dairy Pure",
    departmentId: "dairy-eggs",
    upc: "00078742000012",
  });

  it("rejects a different department, the same UPC, and a weak name overlap", () => {
    assert.equal(
      scoreSubstitute(milk, profile({ name: "Bananas", departmentId: "produce" })),
      null
    );
    assert.equal(
      scoreSubstitute(
        milk,
        profile({ name: "Whole Milk", departmentId: "dairy-eggs", upc: "078742000012", brand: "Other" })
      ),
      null
    );
    assert.equal(
      scoreSubstitute(milk, profile({ name: "Greek Yogurt", departmentId: "dairy-eggs" })),
      null
    );
    assert.equal(
      scoreSubstitute(
        profile({ name: "Boneless Chicken Breast", departmentId: "meat-seafood", packageSize: { dimension: "weight", amount: 16 } }),
        profile({ name: "Chicken Thighs", departmentId: "meat-seafood", packageSize: { dimension: "weight", amount: 16 } })
      ),
      null
    );
  });

  it("scores a close package and similar name above a far size, and uses brand only as a tiebreaker", () => {
    const close = scoreSubstitute(
      milk,
      profile({ name: "Vitamin D Whole Milk", brand: "Friendly Farms", departmentId: "dairy-eggs", storeBrand: true, upc: "0099991" })
    );
    const far = scoreSubstitute(
      milk,
      profile({
        name: "Vitamin D Whole Milk",
        brand: "Friendly Farms",
        departmentId: "dairy-eggs",
        storeBrand: true,
        upc: "0099992",
        packageSize: { dimension: "volume", amount: 16 },
      })
    );
    assert.ok(close !== null && far !== null);
    assert.ok(close > far);

    const sameSize = {
      name: "Vitamin D Whole Milk",
      departmentId: "dairy-eggs",
      packageSize: { dimension: "volume" as const, amount: 128 },
    };
    const matchingBrand = scoreSubstitute(milk, profile({ ...sameSize, brand: "Dairy Pure", upc: "111" }));
    const otherBrand = scoreSubstitute(milk, profile({ ...sameSize, brand: "Horizon", upc: "222" }));
    const storeBrand = scoreSubstitute(
      milk,
      profile({ ...sameSize, brand: "Great Value", storeBrand: true, upc: "333" })
    );
    assert.ok(matchingBrand !== null && otherBrand !== null && storeBrand !== null);
    assert.ok(matchingBrand > otherBrand);
    assert.ok(storeBrand > otherBrand);
    assert.ok(matchingBrand > storeBrand);
  });

  it("still suggests a store brand when the name and size are close", () => {
    const score = scoreSubstitute(
      milk,
      profile({
        name: "Friendly Farms Whole Milk",
        brand: "Friendly Farms",
        departmentId: "dairy-eggs",
        storeBrand: true,
        upc: "0099991000028",
      })
    );
    assert.ok(score !== null && score >= 0.5);
  });
});
