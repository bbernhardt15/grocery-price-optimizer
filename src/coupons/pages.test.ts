import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { FLIPP_MERCHANT_MAPPINGS } from "../pricing/flipp/merchants";
import { STORE_HANDOFF_CONFIG } from "../storeHandoffConfig";
import { COUPON_PAGES, couponPageFor, publicCouponLink } from "./pages";

const pagesJson = JSON.parse(readFileSync(new URL("./pages.json", import.meta.url), "utf8")) as Array<{
  storeName: string;
  url: string;
}>;

describe("coupon pages", () => {
  it("uses https pages and covers every store handoff", () => {
    assert.ok(COUPON_PAGES.length > 0);
    for (const page of COUPON_PAGES) {
      const url = new URL(page.url);
      assert.equal(url.protocol, "https:");
      assert.equal(url.href.includes("{q}"), false);
      assert.ok(page.label.length > 0);
      assert.ok(page.note.length > 0);
    }
    for (const store of STORE_HANDOFF_CONFIG) {
      const page = couponPageFor(store.storeName);
      assert.ok(page, store.storeName);
      assert.equal(publicCouponLink(store.storeName)?.url, page?.url);
    }
    assert.equal(couponPageFor("Food Lion")?.url, "https://shop.foodlion.com/");
    assert.equal(couponPageFor("Food Lion")?.kind, "home");
    assert.equal(couponPageFor("Kroger")?.url, "https://www.kroger.com/savings/cl/coupons/");
    assert.equal(publicCouponLink("Corner Market"), undefined);
  });

  it("keeps each Flipp banner couponUrl on the same page as the coupon table", () => {
    for (const mapping of FLIPP_MERCHANT_MAPPINGS) {
      const page = pagesJson.find((row) => row.storeName === mapping.storeName);
      assert.ok(page, mapping.storeName);
      assert.equal(mapping.couponUrl, page?.url);
      assert.equal(couponPageFor(mapping.storeName)?.url, mapping.couponUrl);
    }
  });
});
