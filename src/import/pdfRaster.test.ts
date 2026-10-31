import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { pdfRasterAvailable, rasterizePdf, sliceBands } from "./pdfRaster";

describe("PDF bands", () => {
  it("covers a tall page with overlapping slices", () => {
    const bands = sliceBands(9784, 1500, 200, 12);
    assert.ok(bands.length >= 6);
    assert.equal(bands[0]?.y, 0);
    assert.ok(bands[1] && bands[1].y < bands[0].height);
    const last = bands[bands.length - 1];
    assert.ok(last);
    assert.ok(last.y + last.height >= 9784);
    assert.equal(sliceBands(800).length, 1);
  });

  it("rasterizes the iOS Kroger receipt when poppler is installed", async () => {
    const available = await pdfRasterAvailable();
    if (!available) return;
    const pdf = readFileSync(new URL("./fixtures/kroger-ios-receipt.pdf", import.meta.url));
    const slices = await rasterizePdf(pdf);
    assert.ok(slices.length >= 4);
    assert.ok(slices.every((slice) => slice.jpeg[0] === 0xff && slice.jpeg[1] === 0xd8));
    const heights = new Set(slices.map((slice) => slice.jpeg.length));
    assert.ok(heights.size > 1);
  });
});
