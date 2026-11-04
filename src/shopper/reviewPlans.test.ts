import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { customizeChoice, gitterSavedLine } from "../../public/shopper/reviewCustomize.js";
import { dedupeReviewLines } from "../../public/shopper/reviewList.js";
import { missingAccordionHtml, missingHeading, rankSwapSuggestions } from "../../public/shopper/reviewMissing.js";
import { estimatePlanSeconds, planStatusHtml, planStatusModel } from "../../public/shopper/reviewProgress.js";
import {
  buildReviewPlans,
  selectPlan,
  selectRepeatedly,
} from "../../public/shopper/reviewPlans.js";
import { reviewCheckoutLabel, reviewStoreCardHtml, withCheckoutLabel } from "../../public/shopper/reviewStoreCard.js";

const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");

function offer(storeName: string, price: number) {
  return { storeName, price, name: "Item" };
}

function item(partial: {
  lineId: string;
  name: string;
  store: string;
  price: number;
  quantity?: number;
  upc?: string;
  size?: string;
  offers?: Array<{ storeName: string; price: number }>;
}) {
  const quantity = partial.quantity || 1;
  return {
    lineId: partial.lineId,
    query: partial.name,
    name: partial.name,
    upc: partial.upc,
    size: partial.size,
    storeName: partial.store,
    price: partial.price,
    quantity,
    itemTotal: Math.round(partial.price * quantity * 100) / 100,
    offers: partial.offers || [offer(partial.store, partial.price)],
  };
}

function group(rows: ReturnType<typeof item>[]) {
  const stores = new Map<string, ReturnType<typeof item>[]>();
  for (const row of rows) {
    const list = stores.get(row.storeName) || [];
    list.push(row);
    stores.set(row.storeName, list);
  }
  return [...stores.entries()].map(([storeName, items]) => ({
    storeName,
    items,
    subtotal: items.reduce((sum, entry) => sum + entry.itemTotal, 0),
  }));
}

function ids(plan: { stores: Array<{ items?: Array<{ lineId?: string }> }> }) {
  return plan.stores.flatMap((store) => store.items || []).map((entry) => entry.lineId).sort();
}

describe("review plans", () => {
  it("best price is the minimum of every offered plan", () => {
    const milk = item({
      lineId: "milk",
      name: "Milk",
      store: "Kroger",
      price: 4,
      offers: [offer("Kroger", 4), offer("Walmart", 3)],
    });
    const bread = item({
      lineId: "bread",
      name: "Bread",
      store: "Walmart",
      price: 5,
      offers: [offer("Walmart", 5), offer("Kroger", 2)],
    });
    const plans = buildReviewPlans(group([milk, bread]));
    assert.equal(plans.best.total, 5);
    assert.equal(plans.best.stops, 2);
    assert.equal(plans.fewer?.stops, 1);
    assert.ok(plans.best.total <= (plans.fewer?.total || plans.best.total));
    assert.match(plans.fewer ? `+${(plans.fewer.total - plans.best.total).toFixed(2)}` : "", /1\.00|/);
    assert.deepEqual(ids(plans.best), ids(plans.fewer!));

    for (let seed = 1; seed <= 24; seed += 1) {
      let state = seed * 97 + 11;
      const next = () => {
        state = (state * 16807) % 2147483647;
        return state;
      };
      const names = ["Kroger", "Walmart", "Target"];
      const rows = [];
      const count = 3 + (next() % 4);
      for (let index = 0; index < count; index += 1) {
        const offers = names
          .filter(() => next() % 5 !== 0)
          .map((storeName) => offer(storeName, ((next() % 800) + 50) / 100));
        if (!offers.length) offers.push(offer("Kroger", 1));
        const first = offers[0];
        rows.push(
          item({
            lineId: `line-${seed}-${index}`,
            name: `Item ${index}`,
            store: first.storeName,
            price: first.price,
            offers,
          })
        );
      }
      const built = buildReviewPlans(group(rows));
      const offered = [built.best, built.fewer].filter((plan): plan is NonNullable<typeof plan> => Boolean(plan));
      const min = Math.min(...offered.map((plan) => plan.total));
      assert.ok(Math.abs(built.best.total - min) < 0.02, `seed ${seed} best ${built.best.total} min ${min}`);
      if (built.fewer) {
        assert.ok(built.fewer.stops < built.best.stops);
        assert.ok(built.best.total <= built.fewer.total + 0.02);
        assert.deepEqual(ids(built.best), ids(built.fewer));
      }
    }
  });

  it("does not show fewer stores when the stop count matches", () => {
    const milk = item({
      lineId: "milk",
      name: "Milk",
      store: "Kroger",
      price: 2,
      offers: [offer("Kroger", 2)],
    });
    const bread = item({
      lineId: "bread",
      name: "Bread",
      store: "Walmart",
      price: 3,
      offers: [offer("Walmart", 3)],
    });
    const plans = buildReviewPlans(group([milk, bread]));
    assert.equal(plans.best.stops, 2);
    assert.equal(plans.fewer, null);
    assert.ok(plans.coverageNotes.some((note) => note.text === "Kroger is missing 1 item"));
    assert.ok(plans.coverageNotes.some((note) => note.text === "Walmart is missing 1 item"));
  });

  it("says a store is missing items instead of quoting a shorter list", () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      item({
        lineId: `item-${index}`,
        name: `Item ${index}`,
        store: index === 0 ? "Kroger" : "Walmart",
        price: index === 0 ? 1 : 1,
        offers: index === 0 ? [offer("Kroger", 1), offer("Walmart", 1.5)] : [offer("Walmart", 1)],
      })
    );
    const plans = buildReviewPlans(group(rows));
    assert.equal(plans.best.itemCount, 10);
    assert.equal(plans.fewer?.itemCount, 10);
    assert.equal(plans.fewer?.total, 10.5);
    assert.ok(plans.fewer && plans.fewer.total > plans.best.total);
    assert.ok(plans.coverageNotes.some((note) => note.text === "Kroger is missing 9 items"));
    assert.notEqual(plans.fewer?.total, 1);
    assert.equal(ids(plans.best).length, 10);
    assert.equal(ids(plans.fewer!).length, 10);
  });

  it("keeps a stable total when a plan is selected again", () => {
    const milk = item({
      lineId: "milk",
      name: "Milk",
      store: "Kroger",
      price: 4,
      quantity: 2,
      offers: [offer("Kroger", 4), offer("Walmart", 3)],
    });
    const bread = item({
      lineId: "bread",
      name: "Bread",
      store: "Walmart",
      price: 5,
      offers: [offer("Walmart", 5), offer("Kroger", 2)],
    });
    const once = group([milk, bread]);
    const doubled = [
      { storeName: "Kroger", subtotal: 99, items: [milk, bread, { ...milk }, { ...bread }] },
      { storeName: "Walmart", subtotal: 99, items: [{ ...milk }, { ...bread }, milk, bread] },
    ];
    const single = selectPlan(once, "spread");
    const merged = selectPlan(doubled, "spread");
    assert.equal(merged.total, single.total);
    assert.equal(merged.total, 8);
    const totals = selectRepeatedly(doubled, ["spread", "spread", "fewer", "spread", "fewer", "spread"]);
    assert.equal(totals[0], totals[1]);
    assert.equal(totals[0], totals[3]);
    assert.equal(totals[0], totals[5]);
    assert.equal(totals[2], totals[4]);
    assert.ok(totals[2] >= totals[0]);
    const again = selectPlan(selectPlan(once, "spread").stores, "spread");
    assert.equal(again.total, single.total);
  });
});

describe("review list", () => {
  it("merges the same product and keeps distinct titles", () => {
    const copies = dedupeReviewLines(
      [
        { lineId: "a", upc: "00011111111117", name: "Homemade Brand TM Chocolate", quantity: 1, price: 2, itemTotal: 2 },
        { lineId: "a", upc: "00011111111117", name: "Homemade Brand TM Chocolate", quantity: 1, price: 2, itemTotal: 2 },
      ],
      () => "Homemade Brand Chocolate"
    );
    assert.equal(copies.length, 1);
    assert.equal(copies[0].quantity, 1);

    const requested = dedupeReviewLines(
      [
        { lineId: "a", upc: "00011111111117", name: "Homemade Brand TM Chocolate", quantity: 1, price: 2, itemTotal: 2 },
        { lineId: "b", upc: "00011111111117", name: "Homemade Brand TM Chocolate", quantity: 2, price: 2, itemTotal: 4 },
      ],
      () => "Homemade Brand Chocolate"
    );
    assert.equal(requested.length, 1);
    assert.equal(requested[0].quantity, 3);

    const heads = dedupeReviewLines(
      [
        { lineId: "c", upc: "00022222222224", name: "Head & Shoulders Classic Clean", size: "12.5 oz", quantity: 1 },
        { lineId: "d", upc: "00033333333331", name: "Head & Shoulders Citrus", size: "8.5 oz", quantity: 1 },
      ],
      () => "Head & Shoulders"
    );
    assert.equal(heads.length, 2);
    assert.notEqual(heads[0].title, heads[1].title);
    assert.match(heads.map((row) => row.title).join(" "), /12\.5 oz/);
    assert.match(heads.map((row) => row.title).join(" "), /8\.5 oz/);
  });
});

describe("review missing items", () => {
  it("collapses the list and ranks same-brand swaps first", () => {
    assert.equal(missingHeading(9), "9 items we couldn't find");
    const html = missingAccordionHtml(["Milk", "Bread", "Eggs"]);
    assert.match(html, /<details class="missing-fold">/);
    assert.doesNotMatch(html, /<details[^>]*\sopen/);
    assert.match(html, /3 items we couldn't find/);
    assert.match(html, /same brand/);
    assert.match(html, /Remove/);
    const ranked = rankSwapSuggestions("Homemade Brand Chocolate", [
      { id: "1", name: "Other Brand Vanilla", brand: "Other", bestOffer: { price: 1 } },
      { id: "2", name: "Homemade Brand Dark Chocolate", brand: "Homemade Brand", bestOffer: { price: 3 } },
      { id: "3", name: "Homemade Brand Milk Chocolate", brand: "Homemade Brand", bestOffer: { price: 2 } },
      { id: "4", name: "Homemade Brand Mint Chocolate", brand: "Homemade Brand", bestOffer: { price: 4 } },
      { id: "5", name: "Homemade Brand White Chocolate", brand: "Homemade Brand", bestOffer: { price: 5 } },
    ]);
    assert.equal(ranked.length, 3);
    assert.equal(ranked[0].product.id, "3");
    assert.ok(ranked.every((row) => row.sameBrand));
    assert.match(app, /missingAccordionHtml/);
    assert.match(app, /selectReviewMode/);
  });
});

describe("review customize", () => {
  it("shows the other store's price and the savings", () => {
    const choice = customizeChoice(
      {
        lineId: "choc",
        name: "Chocolate",
        storeName: "Kroger",
        price: 7.99,
        quantity: 1,
        itemTotal: 7.99,
        offers: [
          { storeName: "Kroger", price: 7.99 },
          { storeName: "Walmart", price: 15.35 },
        ],
      },
      "Chocolate"
    );
    assert.ok(choice);
    assert.equal(choice?.switchText, "Switch to Walmart: $15.35 (+$7.36 more)");
    assert.equal(choice?.saveText, "You save $7.36 buying this at Kroger");
    assert.equal(gitterSavedLine([choice]), "Gitter saved you $7.36 vs the other store");
    assert.match(app, /customizeRowsHtml/);
  });
});

describe("review store cards", () => {
  it("puts checkout on the collapsed card and keeps coupon links", () => {
    const html = reviewStoreCardHtml({
      name: "Kroger",
      countLabel: "16 items",
      total: "$40.00",
      actionHtml: `<button class="handoff-btn" type="button">Send to Kroger cart</button>`,
      itemsHtml: "<li>Milk</li>",
      couponsHtml: `<details class="coupon-panel"><summary>Check Kroger coupons before you shop</summary></details>`,
    });
    const detailsEnd = html.indexOf("</details>");
    const button = html.indexOf("Send to Kroger cart");
    assert.ok(detailsEnd > 0);
    assert.ok(button > detailsEnd);
    assert.match(html, /16 items/);
    assert.match(html, /Check Kroger coupons/);
    const walmart = withCheckoutLabel(
      `<button type="button">Open in Walmart cart</button>`,
      reviewCheckoutLabel({ storeName: "Walmart", handoff: { action: { type: "walmart_cart", label: "Open in Walmart cart" } } })
    );
    assert.match(walmart, />Open Walmart cart</);
    assert.match(app, /reviewStoreCardHtml/);
  });
});

describe("review progress", () => {
  it("shows a store checklist, counts, and a seconds estimate", () => {
    const model = planStatusModel(["Kroger", "Walmart"], { Kroger: { checked: 4, total: 10 } }, { itemCount: 10, startedAt: 1_000, now: 2_000 });
    const html = planStatusHtml(model);
    assert.match(html, /Kroger/);
    assert.match(html, /Walmart/);
    assert.match(html, /10 items/);
    assert.match(html, /about \d+s/);
    assert.doesNotMatch(html, /spinner/);
    assert.ok(estimatePlanSeconds({ itemCount: 40, storeCount: 2 }) <= 9);
    assert.ok(estimatePlanSeconds({ itemCount: 40, storeCount: 2, startedAt: 0, now: 8_000 }) <= 9);
    assert.match(app, /planStatusHtml/);
  });
});
