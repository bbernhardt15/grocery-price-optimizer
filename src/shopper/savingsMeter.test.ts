import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeSavings, estimateSavings, formatMoney, roundMoney } from "../../public/shopper/savingsMeter.js";

const milk = {
  quantity: 1,
  quotes: [
    { storeName: "Walmart", price: 3.18 },
    { storeName: "Kroger", price: 3.29 },
    { storeName: "Target", price: 3.49 },
  ],
};

const bananas = {
  quantity: 1,
  quotes: [
    { storeName: "Aldi", price: 0.49 },
    { storeName: "Walmart", price: 0.54 },
    { storeName: "Kroger", price: 0.62 },
    { storeName: "Target", price: 0.69 },
  ],
};

describe("estimateSavings", () => {
  it("stays empty until a priced line is added", () => {
    assert.equal(estimateSavings([]).status, "empty");
    assert.equal(estimateSavings([{ quantity: 0, quotes: milk.quotes }]).status, "empty");
    assert.equal(estimateSavings([{ quantity: 2, quotes: [] }]).status, "partial");
    const copy = describeSavings(estimateSavings([]));
    assert.equal(copy.badge, null);
    assert.match(copy.note, /priciest store/i);
  });

  it("saves against the most expensive complete store, not the cheapest", () => {
    const meter = estimateSavings([milk, bananas]);
    assert.equal(meter.status, "ready");
    assert.equal(meter.baseline?.storeName, "Walmart");
    assert.equal(meter.baseline?.total, 3.72);
    assert.equal(meter.expensive?.storeName, "Target");
    assert.equal(meter.expensive?.total, 4.18);
    assert.equal(meter.splitTotal, 3.67);
    assert.equal(meter.saved, 0.51);
    assert.equal(meter.savedVsBaseline, 0.05);
    assert.equal(meter.ratio, 12);
    assert.equal(meter.storeCount, 3);

    const copy = describeSavings(meter);
    assert.equal(copy.badge, "Save $0.51");
    assert.match(copy.note, /Target/);
    assert.match(copy.note, /\$4\.18/);
    assert.match(copy.note, /Walmart/);
    assert.match(copy.caption, /12% less than Target/);
  });

  it("multiplies quantity and keeps the cheapest quote when a store is listed twice", () => {
    const meter = estimateSavings([
      {
        quantity: 2,
        quotes: [
          { storeName: "Walmart", price: 3.18 },
          { storeName: "Walmart", price: 3.5 },
          { storeName: "Target", price: 3.49 },
        ],
      },
    ]);
    assert.equal(meter.splitTotal, 6.36);
    assert.equal(meter.baseline?.storeName, "Walmart");
    assert.equal(meter.baseline?.total, 6.36);
    assert.equal(meter.expensive?.total, 6.98);
    assert.equal(meter.saved, 0.62);
    assert.equal(meter.savedVsBaseline, 0);
    const copy = describeSavings(meter);
    assert.doesNotMatch(copy.note, /Splitting also beats/);
  });

  it("ignores a store that cannot fill the whole list", () => {
    const meter = estimateSavings([milk, bananas]);
    assert.equal(
      [meter.baseline?.storeName, meter.expensive?.storeName].includes("Aldi"),
      false
    );
    const partial = estimateSavings([
      { quantity: 1, quotes: [{ storeName: "Aldi", price: 1 }] },
      { quantity: 1, quotes: [{ storeName: "Kroger", price: 2 }] },
    ]);
    assert.equal(partial.status, "partial");
    assert.equal(partial.splitTotal, 3);
    assert.equal(partial.saved, 0);
    assert.match(describeSavings(partial).note, /No single store/);
  });

  it("compares each item with its highest price when no store stocks the whole list", () => {
    const meter = estimateSavings([
      {
        quantity: 1,
        quotes: [
          { storeName: "Aldi", price: 1 },
          { storeName: "Kroger", price: 2 },
        ],
      },
      {
        quantity: 1,
        quotes: [
          { storeName: "Walmart", price: 3 },
          { storeName: "Target", price: 5 },
        ],
      },
    ]);
    assert.equal(meter.status, "partial");
    assert.equal(meter.storeCount, 0);
    assert.equal(meter.splitTotal, 4);
    assert.equal(meter.highEachTotal, 7);
    assert.equal(meter.saved, 3);
    assert.equal(meter.ratio, 43);
    const copy = describeSavings(meter, { allowSubstitutes: false });
    assert.equal(copy.badge, "Save $3.00");
    assert.match(copy.note, /highest price/);
    assert.match(copy.note, /Allow substitutes/);
    assert.match(copy.caption, /43%/);
  });

  it("does not invent savings when the cheapest store already matches the split", () => {
    const meter = estimateSavings([
      {
        quantity: 1,
        quotes: [
          { storeName: "Aldi", price: 2 },
          { storeName: "Kroger", price: 2 },
        ],
      },
    ]);
    assert.equal(meter.saved, 0);
    assert.equal(meter.ratio, 0);
    assert.match(describeSavings(meter).note, /already matches/);
  });

  it("names the only store instead of claiming a discount", () => {
    const meter = estimateSavings([{ quantity: 1, quotes: [{ storeName: "Aldi", price: 1.5 }] }]);
    assert.equal(meter.storeCount, 1);
    assert.equal(meter.saved, 0);
    assert.match(describeSavings(meter).note, /only store/);
  });

  it("drops negative and blank quotes", () => {
    const meter = estimateSavings([
      {
        quantity: 1,
        quotes: [
          { storeName: "", price: 1 },
          { storeName: "Kroger", price: -1 },
          { storeName: "Target", price: Number.NaN },
          { storeName: "Walmart", price: 2.25 },
        ],
      },
    ]);
    assert.equal(meter.storeCount, 1);
    assert.equal(meter.splitTotal, 2.25);
  });

  it("compares a planned trip total when one is supplied", () => {
    const higher = estimateSavings([milk], { splitTotal: 4 });
    assert.equal(higher.splitTotal, 4);
    assert.equal(higher.saved, 0);
    assert.match(describeSavings(higher).note, /costs more than Walmart/);

    const lower = estimateSavings([milk], { splitTotal: 3 });
    assert.equal(lower.saved, 0.49);
    assert.equal(lower.expensive?.storeName, "Target");
  });

  it("describes a single item against its highest and lowest store", () => {
    const meter = estimateSavings([bananas]);
    const copy = describeSavings(meter, { subject: "item" });
    assert.equal(copy.badge, "Save $0.20");
    assert.match(copy.note, /Aldi is lowest/);
    assert.match(copy.note, /Target is \$0\.69/);
    const tied = describeSavings(
      estimateSavings([
        {
          quantity: 1,
          quotes: [
            { storeName: "Aldi", price: 1 },
            { storeName: "Kroger", price: 1 },
          ],
        },
      ]),
      { subject: "item" }
    );
    assert.equal(tied.badge, null);
    assert.match(tied.note, /Same price/);
  });

  it("rounds money the way a receipt does", () => {
    assert.equal(roundMoney(1.005), 1.01);
    assert.equal(formatMoney(4.1), "$4.10");
  });
});
