import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSavedListWrite } from "./savedList";
import { mergeTasteProfiles, parseTasteProfile } from "./tasteProfile";

const list = {
  listId: "list-1234",
  items: [{ id: "milk", name: "Milk", quantity: 1, writtenAt: 1 }],
};

describe("account taste profile", () => {
  it("stores a profile with the list and refuses a price", () => {
    const saved = parseSavedListWrite({
      ...list,
      tasteProfile: {
        updatedAt: 40,
        allergies: ["peanut"],
        productPreferences: {
          butter: { family: "butter", name: "Salted Butter", brand: "Challenge", catalogId: "b1", locked: true, updatedAt: 40, source: "onboarding" },
        },
      },
    });
    assert.equal("error" in saved, false);
    if ("error" in saved) return;
    assert.equal(saved.tasteProfile?.productPreferences.butter.catalogId, "b1");
    assert.equal(saved.tasteProfile?.allergies?.[0], "peanut");

    const priced = parseTasteProfile({ updatedAt: 1, price: 2 });
    assert.equal(priced && "error" in priced && priced.error.includes("price"), true);
    const huge = parseTasteProfile({ updatedAt: 1, why: "x".repeat(90_000) });
    assert.equal(huge && "error" in huge, true);
    assert.equal(parseTasteProfile(undefined), undefined);
  });

  it("keeps the newer preference when the account already has one", () => {
    const merged = mergeTasteProfiles(
      {
        updatedAt: 10,
        productPreferences: {
          butter: { family: "butter", name: "Store Butter", brand: "Great Value", catalogId: "old", locked: false, updatedAt: 10, source: "add" },
        },
      },
      {
        updatedAt: 30,
        allergies: ["peanut"],
        productPreferences: {
          butter: { family: "butter", name: "Salted Butter", brand: "Challenge", catalogId: "new", locked: true, updatedAt: 30, source: "onboarding" },
        },
      }
    );
    assert.equal(merged?.productPreferences.butter.catalogId, "new");
    assert.equal(merged?.productPreferences.butter.locked, true);
    assert.equal(merged?.allergies?.[0], "peanut");
  });
});
