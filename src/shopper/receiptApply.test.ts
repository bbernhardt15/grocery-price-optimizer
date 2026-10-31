import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { analyzeReceipt } from "../import/receiptLearn";
import { applyLearnedReceipts } from "../../public/shopper/receiptApply.js";
import { DIGITAL_ASK, PAPER_WARNING, PRIVACY_NOTE, STORE_HINTS, receiptUploadHtml } from "../../public/shopper/receiptCopy.js";
import { readReceiptBatch } from "../../public/shopper/receiptImport.js";
import { emptyProfile, parseProfile, saveUserProfile } from "../../public/shopper/profile.js";
import { setCategoryPreference } from "../../public/shopper/categoryPreference.js";
import { learnPreference } from "../../public/shopper/productPreference.js";

function memory() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
  };
}

describe("receipt preferences", () => {
  it("tells shoppers to use a digital order and where to find it", () => {
    assert.match(PAPER_WARNING, /paper receipts/i);
    assert.match(PAPER_WARNING, /barcode/i);
    assert.match(DIGITAL_ASK, /Kroger/);
    assert.match(DIGITAL_ASK, /Walmart/);
    assert.match(DIGITAL_ASK, /Target/);
    assert.match(DIGITAL_ASK, /Instacart/);
    assert.match(DIGITAL_ASK, /Amazon Fresh/);
    assert.match(DIGITAL_ASK, /emailed/i);
    assert.match(PRIVACY_NOTE, /don't keep the pictures/i);
    assert.match(PRIVACY_NOTE, /loyalty card/i);
    assert.match(PRIVACY_NOTE, /order number/i);
    const kroger = STORE_HINTS.find((row) => row.store === "Kroger");
    assert.match(kroger?.hint || "", /Account/);
    assert.match(kroger?.hint || "", /Order History/);
    assert.match(kroger?.hint || "", /PDF/);
    const html = receiptUploadHtml();
    assert.match(html, /Upload receipts/);
    assert.match(html, /multiple/);
    assert.match(html, /Where to find it/);
    const app = fs.readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
    const ui = fs.readFileSync(new URL("../../public/shopper/profileOnboardingUi.js", import.meta.url), "utf8");
    assert.match(app, /\/api\/import\/photo/);
    assert.match(app, /\/api\/import\/pdf/);
    assert.match(app, /\/api\/import\/receipt/);
    assert.match(app, /askCategory\?\.\(/);
    assert.match(ui, /Here's what we learned/);
    assert.match(ui, /Confirm/);
    assert.equal(app.includes("localStorage.setItem(\"gg-receipt"), false);
  });

  it("saves learned brands and lets an allergy, a lock, and a hand-picked choice win", () => {
    const analysis = analyzeReceipt(`Kroger Large Eggs Grade A, 12 Count
Qty: 1
$2.99
UPC: 0001111040101
Tide Liquid Laundry Detergent, 92 oz
Qty: 1
$11.99
Dave's Killer Bread, 21 oz
Qty: 1
$5.99`);
    const eggAllergy = applyLearnedReceipts({ ...emptyProfile(), allergies: ["egg"] }, analysis.learned, 5);
    assert.equal(eggAllergy.profile.categoryPreferences.eggs, undefined);
    assert.equal(eggAllergy.profile.categoryPreferences["laundry-detergent"].mode, "brand");
    assert.equal(eggAllergy.profile.categoryPreferences["laundry-detergent"].brand, "Tide");
    assert.equal(eggAllergy.profile.categoryPreferences["laundry-detergent"].source, "receipt");
    assert.equal(eggAllergy.profile.productPreferences["laundry-detergent"].brand, "Tide");
    assert.equal("price" in eggAllergy.profile.productPreferences["laundry-detergent"], false);
    const saved = parseProfile(JSON.stringify(saveUserProfile(memory(), eggAllergy.profile, 5)));
    assert.equal(saved.categoryPreferences["laundry-detergent"].source, "receipt");
    assert.equal(JSON.stringify(saved).includes("2.99"), false);

    const locked = learnPreference(emptyProfile(), { id: "tide-1", brand: "All", name: "Laundry Detergent", familyName: "Laundry Detergent" }, {
      family: "laundry-detergent",
      locked: true,
      source: "manual",
      at: 3,
    });
    const keptLock = applyLearnedReceipts(locked, analysis.learned, 9);
    assert.equal(keptLock.profile.productPreferences["laundry-detergent"].brand, "All");
    assert.equal(keptLock.profile.productPreferences["laundry-detergent"].locked, true);

    const chosen = setCategoryPreference(emptyProfile(), { family: "bread", mode: "cheapest", brand: "", source: "manual" }, 4);
    const keptChoice = applyLearnedReceipts(chosen, analysis.learned, 9);
    assert.equal(keptChoice.profile.categoryPreferences.bread.mode, "cheapest");
    assert.equal(keptChoice.profile.categoryPreferences.bread.source, "manual");

    const gluten = applyLearnedReceipts({ ...emptyProfile(), diets: ["gluten-free"] }, analysis.learned, 5);
    assert.equal(gluten.profile.categoryPreferences.bread, undefined);
    assert.equal(gluten.profile.categoryPreferences["laundry-detergent"].brand, "Tide");
  });

  it("explains a missing photo reader and still accepts pasted text", async () => {
    const images = await readReceiptBatch(
      { photo: false },
      { files: [{ type: "image/jpeg", name: "receipt.jpg", text: async () => "" }] }
    );
    assert.match(images.error, /Photo reading isn't switched on/);
    assert.equal(images.lines.length, 0);

    const pasted = await readReceiptBatch(
      {
        photo: false,
        postText: async () => ({ lines: [{ name: "Large Eggs", brand: "Kroger", family: "eggs", label: "Eggs", quantity: 1, receipt: 1 }], learned: [] }),
        postLines: async (lines) => ({
          lines,
          learned: [{ family: "eggs", label: "Eggs", mode: "storeBrand", brand: "Kroger", confidence: "low", count: 1 }],
          paper: false,
          paperNote: "",
        }),
      },
      { text: "Kroger Large Eggs" }
    );
    assert.equal(pasted.error, "");
    assert.equal(pasted.learned[0].mode, "storeBrand");
  });
});
