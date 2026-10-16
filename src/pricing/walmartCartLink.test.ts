import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  WALMART_ADD_TO_CART_URL,
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
  it("uses a bare item id when quantity is 1 and does not require a publisher id", () => {
    const url = walmartAddToCartUrl([
      { itemId: "554433", quantity: 1 },
      { itemId: "998877", quantity: 1 },
    ]);
    assert.ok(url);
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, WALMART_ADD_TO_CART_URL);
    assert.equal(parsed.searchParams.get("items"), "554433,998877");
    assert.equal(parsed.searchParams.get("offers"), null);
    assert.equal(parsed.searchParams.get("storeId"), null);
    assert.equal(parsed.searchParams.get("ap"), null);
    assert.equal(parsed.searchParams.get("publisherId"), null);
  });

  it("uses itemId|qty when quantity is greater than 1", () => {
    const url = walmartAddToCartUrl([
      { itemId: "554433", quantity: 2 },
      { itemId: "998877", quantity: 1 },
    ]);
    assert.ok(url);
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, WALMART_ADD_TO_CART_URL);
    assert.equal(parsed.searchParams.get("items"), "554433|2,998877");
  });

  it("adds storeId and ap when the locator already provided them", () => {
    const url = walmartAddToCartUrl(
      [{ itemId: "554433", quantity: 3 }],
      undefined,
      { storeId: "2066", accessPointId: "6168c2e3-fc36-4827-98e6-d717d10af1d6" }
    );
    assert.ok(url);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("items"), "554433|3");
    assert.equal(parsed.searchParams.get("storeId"), "2066");
    assert.equal(parsed.searchParams.get("ap"), "6168c2e3-fc36-4827-98e6-d717d10af1d6");
  });

  it("omits storeId and ap when they are unknown", () => {
    const url = walmartAddToCartUrl([{ itemId: "554433", quantity: 2 }], undefined, {});
    assert.ok(url);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("storeId"), null);
    assert.equal(parsed.searchParams.get("ap"), null);
  });

  it("omits a store id or access point that is not a locator token", () => {
    const url = walmartAddToCartUrl([{ itemId: "554433", quantity: 1 }], undefined, {
      storeId: "not-a-store",
      accessPointId: "bad point",
    });
    assert.ok(url);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("items"), "554433");
    assert.equal(parsed.searchParams.get("storeId"), null);
    assert.equal(parsed.searchParams.get("ap"), null);
  });

  it("skips lines without a numeric item id and still links the rest", () => {
    const url = walmartAddToCartUrl([
      { itemId: "554433", quantity: 2 },
      { itemId: "flyer-99", quantity: 1 },
      { itemId: "  ", quantity: 1 },
      { itemId: "998877", quantity: 1 },
    ]);
    assert.ok(url);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("items"), "554433|2,998877");
    assert.equal(parsed.searchParams.get("offers"), null);
  });

  it("returns undefined when every line lacks a numeric item id and an offer id", () => {
    assert.equal(
      walmartAddToCartUrl([
        { itemId: "flyer-99", quantity: 1 },
        { itemId: "", quantity: 2 },
      ]),
      undefined
    );
    assert.equal(walmartAddToCartUrl([]), undefined);
  });

  it("uses offers only when the caller already has offer ids and no item ids", () => {
    const url = walmartAddToCartUrl([
      { offerId: "E4463E9F89294147BB57304778A66539", quantity: 2 },
      { offerId: "ABC123", quantity: 1 },
    ]);
    assert.ok(url);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("items"), null);
    assert.equal(
      parsed.searchParams.get("offers"),
      "E4463E9F89294147BB57304778A66539|2,ABC123"
    );
  });

  it("prefers items when both an item id and an offer id are present", () => {
    const url = walmartAddToCartUrl([
      {
        itemId: "554433",
        offerId: "E4463E9F89294147BB57304778A66539",
        quantity: 1,
      },
    ]);
    assert.ok(url);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("items"), "554433");
    assert.equal(parsed.searchParams.get("offers"), null);
  });

  it("wraps the new cart URL with the Impact tracking link when a publisher id is set", () => {
    const url = walmartAddToCartUrl(
      [{ itemId: "554433", quantity: 1 }],
      "impact-123",
      { storeId: "2066", accessPointId: "ap-9" }
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
    assert.equal(cart.origin + cart.pathname, WALMART_ADD_TO_CART_URL);
    assert.equal(cart.searchParams.get("items"), "554433");
    assert.equal(cart.searchParams.get("storeId"), "2066");
    assert.equal(cart.searchParams.get("ap"), "ap-9");
  });

  it("reads WALMART_PUBLISHER_ID without requiring the private key", () => {
    assert.equal(readWalmartPublisherId(), undefined);
    process.env.WALMART_PUBLISHER_ID = "  pending-impact  ";
    assert.equal(readWalmartPublisherId(), "pending-impact");
  });
});
