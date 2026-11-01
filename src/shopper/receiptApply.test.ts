import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { analyzeReceipt, learnReceiptLines } from "../import/receiptLearn";
import { applyLearnedReceipts } from "../../public/shopper/receiptApply.js";
import { applyLearnedChoice, learnedSummaryHtml, PAPER_WARNING, PRIVACY_NOTE, RECEIPT_HINT, STORE_HINTS, receiptUploadHtml } from "../../public/shopper/receiptCopy.js";
import { readNdjsonResponse, readReceiptBatch, resetReceiptReads } from "../../public/shopper/receiptImport.js";
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
    assert.equal(PAPER_WARNING.split(/[.!?]/).filter((part) => part.trim()).length, 1);
    assert.match(RECEIPT_HINT, /brands you already buy/i);
    assert.match(PRIVACY_NOTE, /don't keep the pictures/i);
    assert.match(PRIVACY_NOTE, /loyalty card/i);
    assert.match(PRIVACY_NOTE, /order number/i);
    for (const store of ["Kroger", "Walmart", "Target", "Instacart", "Amazon"]) {
      assert.ok(STORE_HINTS.some((row) => row.store === store || row.hint.includes(store)));
    }
    assert.match(STORE_HINTS.find((row) => row.store === "Email")?.hint || "", /emailed|Email|receipt/i);
    const kroger = STORE_HINTS.find((row) => row.store === "Kroger");
    assert.match(kroger?.hint || "", /Account/);
    assert.match(kroger?.hint || "", /Order History/);
    assert.match(kroger?.hint || "", /PDF/);
    const html = receiptUploadHtml();
    assert.match(html, /Drop PDFs or screenshots/);
    assert.match(html, /class="drop-zone"/);
    assert.match(html, /paper receipts/i);
    assert.match(html, /multiple/);
    assert.match(html, /<summary>Where do I find it\?<\/summary>/);
    assert.match(html, /<details class="store-find"><summary>Kroger<\/summary>/);
    assert.equal((html.match(/<details/g) || []).length, STORE_HINTS.length + 1);
    const app = fs.readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
    const ui = fs.readFileSync(new URL("../../public/shopper/profileOnboardingUi.js", import.meta.url), "utf8");
    assert.match(app, /\/api\/import\/photo/);
    assert.match(app, /\/api\/import\/pdf/);
    assert.match(app, /\/api\/import\/receipt/);
    assert.match(app, /askCategory\?\.\(/);
    assert.match(ui, /Here's what we learned/);
    assert.match(ui, /Confirm/);
    assert.match(ui, /Read my receipts/);
    assert.match(ui, /file-chip/);
    assert.equal(app.includes("localStorage.setItem(\"gg-receipt"), false);
  });

  it("keeps Change choices inside the row and refuses a click that would clear the list", () => {
    const rows = [
      { family: "laundry-detergent", label: "Laundry detergent", mode: "brand", brand: "Tide" },
      { family: "dish-soap", label: "Dish soap", mode: "brand", brand: "Dawn" },
    ];
    const closed = learnedSummaryHtml(rows, {});
    assert.equal(closed.includes("data-learned-mode"), false);
    assert.equal(closed.includes(">Store brand<"), false);
    assert.equal(closed.includes(">Cheapest<"), false);
    const open = learnedSummaryHtml(rows, {
      editingFamily: "laundry-detergent",
      brandsByFamily: { "laundry-detergent": ["Tide", "Gain", "All"] },
    });
    const row = open.slice(open.indexOf('data-learned-row="laundry-detergent"'), open.indexOf('data-learned-row="dish-soap"'));
    assert.match(row, /data-learned-mode="storeBrand"/);
    assert.match(row, /data-learned-mode="cheapest"/);
    assert.match(row, /data-learned-mode="never"/);
    assert.match(row, /data-learned-brand="Tide"/);
    assert.match(row, /aria-pressed="true"/);
    const after = open.split("</section>").pop() || "";
    assert.equal(after.includes("data-learned-mode"), false);
    assert.equal(applyLearnedChoice(rows, { family: "", mode: "storeBrand" }), rows);
    assert.equal(applyLearnedChoice(rows, { family: "missing", mode: "cheapest" }), rows);
    assert.equal(applyLearnedChoice(rows, { mode: "brand", family: "laundry-detergent", brand: "" }), rows);
    const changed = applyLearnedChoice(rows, { family: "laundry-detergent", mode: "storeBrand" });
    assert.equal(changed.length, rows.length);
    assert.equal(changed[0].mode, "storeBrand");
    assert.equal(changed[0].brand, "");
    assert.equal(changed[1].brand, "Dawn");
    assert.equal(changed[1], rows[1]);
    const named = applyLearnedChoice(rows, { family: "dish-soap", mode: "brand", brand: "Palmolive" });
    assert.equal(named.length, 2);
    assert.equal(named[1].brand, "Palmolive");
    assert.equal(named[0].brand, "Tide");
    const declined = applyLearnedChoice(rows, { family: "laundry-detergent", mode: "never" });
    assert.equal(declined.length, 2);
    assert.equal(declined[0].mode, "never");
    assert.equal(declined[1].mode, "brand");
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

  it("merges several files and keeps the brand that shows up on the most orders", async () => {
    const messages: string[] = [];
    const tide = { name: "Tide Laundry Detergent", brand: "Tide", quantity: 1, upc: "0003077201234" };
    const gain = { name: "Gain Laundry Detergent", brand: "Gain", quantity: 1, upc: "0003077209999" };
    const result = await readReceiptBatch(
      {
        photo: true,
        onProgress: (event) => messages.push(String(event?.message || "")),
        postPdf: async (file) => ({
          lines: String(file.name).includes("gain") ? [gain, gain, gain] : [tide],
        }),
        postLines: async (lines) => learnReceiptLines(lines),
      },
      {
        files: [
          { type: "application/pdf", name: "kroger.pdf" },
          { type: "application/pdf", name: "walmart.pdf" },
          { type: "application/pdf", name: "gain.pdf" },
        ],
      }
    );
    assert.equal(result.error, "");
    const detergent = result.learned.find((row) => row.family === "laundry-detergent");
    assert.equal(detergent?.brand, "Tide");
    assert.equal(detergent?.mode, "brand");
    assert.ok(messages.includes("Preparing…"));
    assert.ok(messages.some((message) => message.startsWith("Reading file ")));
    assert.ok(messages.includes("Matching brands…"));
  });

  it("reads streamed progress without waiting for the whole order", async () => {
    const response = new Response(
      `${JSON.stringify({ type: "progress", message: "Reading part 2 of 5…", ratio: 0.4 })}\n${JSON.stringify({
        type: "result",
        analysis: { lines: [{ name: "Tide" }], learned: [] },
      })}\n`,
      { headers: { "content-type": "application/x-ndjson" } }
    );
    const messages: string[] = [];
    const analysis = await readNdjsonResponse(response, (event) => messages.push(String(event?.message || "")));
    assert.deepEqual(messages, ["Reading part 2 of 5…"]);
    assert.equal(analysis.lines[0].name, "Tide");

    resetReceiptReads();
    const file = new File([Uint8Array.from([1, 2, 3, 4])], "order.jpg", { type: "image/jpeg" });
    let posts = 0;
    const once = await readReceiptBatch(
      {
        photo: true,
        postPhoto: async () => {
          posts += 1;
          return { lines: [{ name: "Milk" }] };
        },
      },
      { files: [file] }
    );
    const twice = await readReceiptBatch(
      {
        photo: true,
        postPhoto: async () => {
          posts += 1;
          return { lines: [{ name: "Milk" }] };
        },
        onProgress: (event) => messages.push(String(event?.message || "")),
      },
      { files: [file] }
    );
    assert.equal(posts, 1);
    assert.equal(once.lines[0]?.name, "Milk");
    assert.equal(twice.lines[0]?.name, "Milk");
    assert.ok(messages.includes("Already read this file."));
    await assert.rejects(
      readNdjsonResponse(new Response(`${JSON.stringify({ type: "error", error: "nope" })}\n`), () => {}),
      /nope/
    );
  });
});
