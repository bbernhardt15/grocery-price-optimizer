import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { catalogPriceIsFresh, priceCacheKey } from "./freshPriceKey";
import { shouldStreamReview } from "./reviewStream";
import { shouldStreamSnapshot } from "./streamPlan";

describe("review price streaming", () => {
  it("streams the first priced item and keeps the later cadence", () => {
    assert.equal(shouldStreamReview(0, 35), false);
    assert.equal(shouldStreamReview(1, 35), true);
    assert.equal(shouldStreamReview(8, 70), true);
    assert.equal(shouldStreamReview(7, 70), false);
    assert.equal(shouldStreamSnapshot(7, 70), false);
    assert.equal(shouldStreamSnapshot(8, 70), true);
  });

  it("treats a catalog price from the last 24 hours as fresh for a store and UPC", () => {
    const now = Date.parse("2026-11-04T00:00:00Z");
    assert.equal(catalogPriceIsFresh(new Date(now - 60 * 60 * 1000), now), true);
    assert.equal(catalogPriceIsFresh(new Date(now - 25 * 60 * 60 * 1000), now), false);
    assert.equal(catalogPriceIsFresh(undefined, now), false);
    const left = priceCacheKey("Kroger", "45202", "049000042566");
    const right = priceCacheKey(" kroger ", "45202", "0004900004256");
    assert.equal(left, right);
    assert.match(left, /^kroger\|45202\|/);
    const cache = readFileSync(new URL("../priceCache.ts", import.meta.url), "utf8");
    assert.match(cache, /findFreshUpcPrices/);
    assert.match(cache, /shouldStreamReview/);
    const route = readFileSync(new URL("../routes/optimizeList.ts", import.meta.url), "utf8");
    assert.match(route, /estimateSeconds/);
    assert.match(route, /publishPartial/);
  });
});