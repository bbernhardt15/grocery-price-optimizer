import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  basketTeaser,
  foundLabel,
  readCardHtml,
  storeChoiceHtml,
} from "../../public/shopper/intakePresent.js";
import { learnedSummaryHtml } from "../../public/shopper/receiptCopy.js";

describe("intake presentation", () => {
  it("names a live file count the way the screen reads it", () => {
    assert.equal(foundLabel("kroger-order.pdf", 24), "Kroger order, 24 items found");
    assert.equal(foundLabel("notes.txt", 1), "notes, 1 item found");
    assert.equal(foundLabel("Pasted order", 0), "Pasted order, 0 items found");
  });

  it("checks nearby stores and marks Kroger and Walmart cart ready", () => {
    const html = storeChoiceHtml(["Kroger", "Walmart", "Aldi"], { open: true });
    assert.equal((html.match(/checked/g) || []).length, 3);
    assert.equal((html.match(/Cart ready/g) || []).length, 2);
    assert.match(html, /data-chain="kroger"/);
    assert.match(html, /data-chain="walmart"/);
    const aldi = html.slice(html.indexOf('data-chain="aldi"'));
    assert.equal(aldi.includes("Cart ready"), false);
  });

  it("gives each file a real progress bar, a live count, and a plain retry", () => {
    const html = readCardHtml({
      index: 0,
      name: "Kroger order.pdf",
      found: 24,
      ratio: 0.4,
      status: "reading",
      items: ["Large eggs"],
    });
    assert.match(html, /<progress max="1" value="0.4"><\/progress>/);
    assert.match(html, /Kroger order, 24 items found/);
    assert.match(html, /Large eggs/);
    const failed = readCardHtml({ index: 1, name: "bad.pdf", status: "error", error: "That file was empty.", ratio: 1 });
    assert.match(failed, /That file was empty/);
    assert.match(failed, /data-read-retry="1"/);
    assert.match(failed, />Retry</);
  });

  it("groups what we learned and teases the basket without inventing a lower price", () => {
    const html = learnedSummaryHtml(
      [
        { family: "eggs", label: "Eggs", mode: "storeBrand", brand: "Kroger", confidence: "low", count: 2, receipts: 2 },
        { family: "laundry-detergent", label: "Laundry detergent", mode: "brand", brand: "Tide", confidence: "high", count: 3, receipts: 2 },
      ],
      { lines: [{ price: 2.99 }, { price: 11.99 }] }
    );
    assert.match(html, /Dairy &amp; eggs/);
    assert.match(html, /Household/);
    assert.match(html, /Is this right\?/);
    assert.match(html, /Store brand/);
    assert.match(html, /On 2 orders/);
    assert.match(html, /Tide/);
    assert.match(html, /Name brand/);
    assert.match(html, /\$14\.98/);
    assert.match(html, /We'll find it for less/);
    assert.match(html, /We'll handle the math/);
    assert.equal(html.includes("meal prep"), false);
    const quiet = basketTeaser([]);
    assert.equal(quiet.before, "");
    assert.equal(quiet.after, "We'll find it for less.");
  });
});
