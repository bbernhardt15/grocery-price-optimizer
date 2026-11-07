import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { frequencyLine } from "../../public/shopper/intakePresent.js";
import { savingsClaimAllowed } from "../../public/shopper/planFallback.js";
import { receiptBackPhase, receiptReadCurrent } from "../../public/shopper/receiptNav.js";
import { storeConnectCopy } from "../../public/shopper/storeConnect.js";
import { joinBrandName } from "../../public/shopper/tripAdd.js";

describe("receipt back and a late parse", () => {
  it("returns from the trip list to the parsed review", () => {
    assert.equal(receiptBackPhase("trip"), "learned");
    assert.equal(receiptBackPhase("learned"), "upload");
    assert.equal(receiptBackPhase("reading"), "upload");
  });

  it("ignores a receipt response after Back", () => {
    assert.equal(receiptReadCurrent(2, 2, "reading"), true);
    assert.equal(receiptReadCurrent(2, 3, "reading"), false);
    assert.equal(receiptReadCurrent(2, 2, "upload"), false);
  });
});

describe("receipt frequency copy", () => {
  it("does not call two units or two products two purchases", () => {
    assert.equal(frequencyLine({ receipts: 1, count: 2 }), "2 on the order");
    assert.equal(frequencyLine({ receipts: 1, count: 1 }), "Bought once");
    assert.equal(frequencyLine({ receipts: 2, count: 2 }), "On 2 orders");
  });
});

describe("brand already in the name", () => {
  it("does not repeat Dave's Killer Bread", () => {
    assert.equal(joinBrandName("Dave's Killer Bread", "Dave's Killer Bread"), "Dave's Killer Bread");
    assert.equal(joinBrandName("Dave's Killer Bread", "Dave's Killer Bread Dave's Killer Bread"), "Dave's Killer Bread");
    assert.equal(joinBrandName("Dave's Killer Bread", "21 oz loaf"), "Dave's Killer Bread 21 oz loaf");
  });
});

describe("savings claims", () => {
  it("withholds savings until every store check is ok", () => {
    assert.equal(savingsClaimAllowed({ pendingStores: ["Walmart"], pricingByStore: [{ storeName: "Kroger", check: "ok" }], coverageOpen: true }), false);
    assert.equal(savingsClaimAllowed({ pendingStores: [], pricingByStore: [], coverageOpen: true }), false);
    assert.equal(
      savingsClaimAllowed({
        pendingStores: [],
        coverageOpen: false,
        pricingByStore: [
          { storeName: "Kroger", check: "ok" },
          { storeName: "Walmart", check: "ok" },
        ],
      }),
      true
    );
  });
});

describe("store connection offer", () => {
  it("offers Kroger's own sign-in and does not call Walmart an account", () => {
    const offer = storeConnectCopy({ stores: ["Kroger", "Walmart"], oauthConfigured: true, connected: false });
    assert.equal(offer.showNow, true);
    assert.match(offer.body, /never see your password/i);
    assert.match(offer.body, /may still ask you to sign in/i);
    assert.match(offer.walmart, /no account connection/i);
    assert.equal(storeConnectCopy({ stores: ["Walmart"], oauthConfigured: true }).showNow, false);
    assert.equal(storeConnectCopy({ stores: ["Kroger"], oauthConfigured: false }).showNow, false);
  });
});
