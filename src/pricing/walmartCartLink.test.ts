import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  WALMART_IMPACT_AD_ID,
  WALMART_IMPACT_CAMPAIGN_ID,
  WALMART_IMPACT_SOURCE_ID,
  readWalmartPublisherId,
  walmartAddToCartUrl,
} from "./walmartCartLink";

afterEach(() => {
  delete process.env.WALMART_PUBLISHER_ID;
});

describe("walmartAddToCartUrl", () => {
  it("builds the documented multi-item add-to-cart URL without attribution", () => {
    const url = walmartAddToCartUrl(
      [
        { itemId: "554433", quantity: 2 },
        { itemId: "998877", quantity: 1 },
      ]
    );
    assert.ok(url);
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, "https://affil.walmart.com/cart/addToCart");
    assert.equal(parsed.searchParams.get("items"), "554433|2,998877|1");
    assert.equal(parsed.searchParams.get("publisherId"), null);
  });

  it("wraps the cart URL with the documented Impact tracking link when a publisher id is set", () => {
    const url = walmartAddToCartUrl(
      [{ itemId: "554433", quantity: 1 }],
      "impact-123"
    );
    assert.ok(url);
    const parsed = new URL(url);
    assert.equal(
      parsed.origin + parsed.pathname,
      `https://goto.walmart.com/c/impact-123/${WALMART_IMPACT_CAMPAIGN_ID}/${WALMART_IMPACT_AD_ID}`
    );
    assert.equal(parsed.searchParams.get("veh"), "aff");
    assert.equal(parsed.searchParams.get("sourceid"), WALMART_IMPACT_SOURCE_ID);
    const destination = parsed.searchParams.get("u");
    assert.ok(destination);
    const cart = new URL(destination);
    assert.equal(cart.origin + cart.pathname, "https://affil.walmart.com/cart/addToCart");
    assert.equal(cart.searchParams.get("items"), "554433|1");
  });

  it("refuses a cart URL when any item id is not a Walmart item id", () => {
    assert.equal(
      walmartAddToCartUrl([
        { itemId: "554433", quantity: 1 },
        { itemId: "flyer-99", quantity: 1 },
      ]),
      undefined
    );
  });

  it("reads WALMART_PUBLISHER_ID without requiring the private key", () => {
    assert.equal(readWalmartPublisherId(), undefined);
    process.env.WALMART_PUBLISHER_ID = "  pending-impact  ";
    assert.equal(readWalmartPublisherId(), "pending-impact");
  });
});
