import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aboutMoney, calmPriceNote, ESTIMATE_NOTE, fewerStopsOffer, plainSwap, priceFigure, savingsCard, shelfNote, shopperCopy } from "../../public/shopper/calmPlan.js";
import { singleStoreSavings } from "../../public/shopper/tripPlan.js";

function line(partial: Record<string, unknown>) {
  return {
    quantity: 1,
    ...partial,
    itemTotal: partial.itemTotal ?? Number(partial.price),
  };
}

describe("calm trip plan", () => {
  it("says a swap in plain language and hides technical price sources", () => {
    const swap = plainSwap({
      matchKind: "swap",
      substitutedFor: "Whole Milk",
      name: "Great Value Milk",
      storeName: "Kroger",
    });
    assert.equal(swap?.text, "We swapped Whole Milk for Great Value Milk at Kroger");
    assert.equal(swap?.change, "Change");
    assert.equal(plainSwap({ name: "Whole Milk", storeName: "Kroger" }), null);
    assert.equal(calmPriceNote("weekly_ad"), "this week's ad");
    assert.equal(calmPriceNote("seed"), "");
    assert.equal(calmPriceNote("live"), "");
    assert.equal(calmPriceNote("cached_live"), "");
    assert.equal(priceFigure(2.5), "$2.50");
    assert.equal(priceFigure(Number.NaN), "");
    assert.equal(aboutMoney(2.5), "about $2.50");
    assert.equal(aboutMoney(Number.NaN), "");
    assert.equal(shopperCopy("Aldi has no public product API. Set FLIPP_ACCESS_TOKEN from https://api.flipp.com/flyerkit"), "");
    assert.equal(shopperCopy("Set WALMART_CONSUMER_ID and WALMART_PRIVATE_KEY at walmart.io"), "");
    assert.equal(shopperCopy("Weekly ad, not a shelf price"), "Weekly ad, not a shelf price");
    assert.equal(shelfNote({ demo: true, zipOk: true, weeklyAds: false }), "Sample prices. Not a receipt.");
    assert.equal(shelfNote({ demo: false, zipOk: false, weeklyAds: true }), "Add a ZIP to see this week's ads.");
    assert.equal(shelfNote({ demo: false, zipOk: true, weeklyAds: true }), "Some prices are from this week's ad. Not a receipt.");
    assert.equal(shelfNote({ demo: false, zipOk: true, weeklyAds: false }), ESTIMATE_NOTE);
  });

  it("compares one store with the split plan using the prices it was given", () => {
    const lines = [
      line({
        name: "Milk",
        price: 2,
        storeName: "Aldi",
        offers: [
          { storeName: "Aldi", price: 2 },
          { storeName: "Kroger", price: 3 },
        ],
      }),
      line({
        name: "Eggs",
        price: 3,
        storeName: "Kroger",
        offers: [
          { storeName: "Aldi", price: 4 },
          { storeName: "Kroger", price: 3 },
        ],
      }),
    ];
    const card = savingsCard(singleStoreSavings(lines));
    assert.equal(card.title, "One store or this plan");
    assert.equal(card.lines[0].label, "Everything at Aldi");
    assert.equal(card.lines[0].value, "$6.00");
    assert.equal(card.lines[1].label, "This plan");
    assert.equal(card.lines[1].value, "$5.00");
    assert.equal(card.saved, "You save $1.00.");
    assert.equal(card.note, ESTIMATE_NOTE);

    const nowhere = savingsCard({ splitTotal: 5, singleStore: null, savings: 0 });
    assert.equal(nowhere.title, "No one store has this whole list");
    assert.equal(nowhere.lines[0].value, "$5.00");
    assert.match(nowhere.saved, /stops that actually have the items/);
  });

  it("offers fewer stops only when the difference is small", () => {
    const milk = line({
      lineId: "m",
      name: "Milk",
      storeName: "Aldi",
      price: 2,
      offers: [
        { storeName: "Aldi", name: "Milk", price: 2 },
        { storeName: "Kroger", name: "Milk", price: 2.4 },
      ],
    });
    const eggs = line({
      lineId: "e",
      name: "Eggs",
      storeName: "Kroger",
      price: 3,
      offers: [
        { storeName: "Kroger", name: "Eggs", price: 3 },
        { storeName: "Aldi", name: "Eggs", price: 3.4 },
      ],
    });
    const small = fewerStopsOffer([
      { storeName: "Aldi", items: [milk], subtotal: 2 },
      { storeName: "Kroger", items: [eggs], subtotal: 3 },
    ]);
    assert.ok(small);
    assert.equal(small?.stops, 1);
    assert.match(small?.text || "", /Only if that sounds easier/);
    assert.ok(Math.abs(small?.delta || 0) <= 2);
    assert.equal(small?.action, "Use fewer stops");

    const costlyMilk = line({
      ...milk,
      offers: [
        { storeName: "Aldi", name: "Milk", price: 2 },
        { storeName: "Kroger", name: "Milk", price: 9 },
      ],
    });
    const costlyEggs = line({
      ...eggs,
      offers: [
        { storeName: "Kroger", name: "Eggs", price: 3 },
        { storeName: "Aldi", name: "Eggs", price: 8 },
      ],
    });
    assert.equal(
      fewerStopsOffer([
        { storeName: "Aldi", items: [costlyMilk], subtotal: 2 },
        { storeName: "Kroger", items: [costlyEggs], subtotal: 3 },
      ]),
      null
    );
    assert.equal(fewerStopsOffer([{ storeName: "Aldi", items: [milk], subtotal: 2 }]), null);
  });
});
