import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { cartCouponCallout, CLIP_HONESTY, KROGER_CLIP_NOTE, WALMART_CLIP_NOTE } from "../../public/shopper/cartCouponNote.js";
import { applyInStoreScroll, inStoreLayout, inStoreSkeletonHtml, SHOP_ROW_MIN_PX } from "../../public/shopper/inStoreEntry.js";
import { KROGER_SEND_BUSY, KROGER_SEND_CONNECTED, KROGER_SEND_IDLE, krogerSendPatch } from "../../public/shopper/krogerSendProgress.js";
import { reviewStoreCardHtml } from "../../public/shopper/reviewStoreCard.js";
import {
  reviewCardMinPx,
  reviewFramesMatch,
  reviewHeadlineReady,
  reviewLayoutFrames,
  reviewGaveUpHtml,
  reviewLoadingHtml,
  reviewSkeletonHtml,
  REVIEW_GAVE_UP_STATUS,
} from "../../public/shopper/reviewStable.js";
import {
  cartCardFigures,
  coverageVisible,
  storeLineLabel,
  createDisplayedTotal,
  createReviewEntrySession,
  quietRetryPlan,
  reviewEntryPaints,
} from "../../public/shopper/reviewSettle.js";
import { SHELL_CACHE } from "../../public/shopper/betaContext.js";

const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../../public/shopper/review.css", import.meta.url), "utf8");
const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

function line(name: string, price: number) {
  return { name, price, quantity: 1, itemTotal: price };
}

/** 20 Kroger lines and 15 Walmart lines. Components sum to $229.20. */
function cart229() {
  const kroger = Array.from({ length: 20 }, (_, index) => line(`Kroger item ${index}`, 6));
  const walmart = [...Array.from({ length: 14 }, (_, index) => line(`Walmart item ${index}`, 7)), line("Walmart item 14", 11.2)];
  return [
    { storeName: "Kroger", subtotal: 265.89, items: kroger },
    { storeName: "Walmart", subtotal: 286.09, items: walmart },
  ];
}

function settled229() {
  const figures = cartCardFigures(cart229());
  return {
    total: figures.total,
    partial: false,
    pendingStores: [],
    stores: figures.stores,
    pricingByStore: [
      { storeName: "Kroger", check: "ok" },
      { storeName: "Walmart", check: "ok" },
    ],
  };
}

function streamed(total: number) {
  return {
    total,
    partial: true,
    pendingStores: ["Walmart"],
    pricingByStore: [
      { storeName: "Kroger", check: "ok" },
      { storeName: "Walmart", check: "timeout" },
    ],
    stores: [{ storeName: "Kroger", subtotal: total, items: [{ name: "Milk", price: total, quantity: 1 }] }],
    coverageNotes: [{ text: "Walmart couldn't check right now, retry" }, { text: "Kroger is missing 3 items" }],
  };
}

describe("twelfth phone test, Review and In-store", () => {
  it("bumps the shell cache to v82", () => {
    assert.equal(SHELL_CACHE, "v82");
    assert.match(sw, /grocery-gitter-shell-v82/);
  });

  it("ends a cold review with a retry instead of an endless checking shell", () => {
    const html = reviewGaveUpHtml(["Milk", "Milk"], REVIEW_GAVE_UP_STATUS);
    assert.match(html, /No store price came back/);
    assert.match(html, /stopped after 22 seconds/);
    assert.match(html, /data-plan-retry="1"/);
    assert.match(html, /Try this check again/);
    assert.match(html, />Milk</);
    assert.equal(html.includes("Checking store prices"), false);
    assert.equal(html.includes("$"), false);
    assert.match(html, /data-review-stable="gave-up"/);
  });

  it("keeps Review card heights stable and withholds the headline while prices load", () => {
    assert.equal(reviewFramesMatch(["Kroger", "Walmart", "Aldi"]), true);
    const frames = reviewLayoutFrames(["Kroger", "Walmart", "Aldi"]);
    assert.equal(frames.count, 3);
    assert.equal(frames.loading.length, frames.loaded.length);
    frames.loading.forEach((card, index) => {
      assert.equal(card.minHeight, frames.loaded[index].minHeight);
      assert.equal(card.height, frames.loaded[index].height);
      assert.equal(card.minHeight, reviewCardMinPx(card.name));
    });
    assert.equal(frames.loading[0].minHeight, 256);
    assert.equal(frames.loading[1].minHeight, 304);
    assert.equal(frames.loading[2].minHeight, 148);
    assert.equal(frames.headMinHeight, 0);
    const loading = reviewLoadingHtml(["Kroger", "Walmart"]);
    assert.equal((loading.match(/data-review-skel=/g) || []).length, 2);
    assert.match(loading, /min-height:256px;height:256px/);
    assert.match(loading, /min-height:304px;height:304px/);
    assert.match(loading, /data-review-progress="1"/);
    assert.equal(loading.includes("One store or this plan"), false);
    assert.equal(loading.includes("No one store has this whole list"), false);
    assert.equal(loading.includes("$265.89"), false);
    assert.equal(loading.includes("$265.53"), false);
    assert.equal(loading.includes("$286.09"), false);
    assert.equal(loading.includes("couldn't check"), false);
    assert.equal(loading.includes("missing 3"), false);
    const loaded = reviewStoreCardHtml({
      name: "Kroger",
      countLabel: "20 items",
      total: "$120.00",
      minHeight: reviewCardMinPx("Kroger"),
      actionHtml: "<button type=\"button\">Send to Kroger cart</button>",
      itemsHtml: "<li class=\"review-line\"></li>",
    });
    assert.match(loaded, /min-height:256px/);
    assert.match(reviewSkeletonHtml(["Kroger"]), /data-review-skel="Kroger"[^>]*min-height:256px;height:256px/);
    assert.match(reviewSkeletonHtml(["Walmart"]), /data-review-skel="Walmart"[^>]*min-height:304px;height:304px/);
    assert.equal(reviewHeadlineReady(streamed(265.89)), false);
    assert.equal(
      reviewHeadlineReady({ partial: false, total: 0, displaySettled: true, stores: [{ storeName: "Kroger", items: [{ name: "Milk", price: 0, quantity: 1 }] }] }),
      false
    );
    assert.equal(reviewHeadlineReady({ ...streamed(12), partial: false, pendingStores: [] }), true);
    assert.equal(reviewHeadlineReady(settled229()), true);
    assert.match(css, /overflow-anchor:\s*auto/);
    assert.match(css, /animation:\s*none/);
    assert.match(css, /min-height:\s*0/);
    assert.match(app, /reviewLoadingHtml/);
    assert.match(app, /reuseSettledReview/);
    assert.doesNotMatch(app, /renderTrip\(adoptReviewResult\(lastOptimize, partial\)/);
  });

  it("shows one total for the same list and ignores streamed totals", () => {
    const figures = cartCardFigures(cart229());
    assert.equal(figures.itemCount, 35);
    assert.equal(figures.countLabel, "35 lines");
    assert.equal(storeLineLabel(1, 2), "1 line · 2 units");
    assert.equal(figures.total.toFixed(2), "229.20");
    assert.equal(figures.stores[0].subtotal.toFixed(2), "120.00");
    assert.equal(figures.stores[1].subtotal.toFixed(2), "109.20");
    const components = figures.stores.reduce((sum, store) => sum + store.subtotal, 0);
    assert.equal(components.toFixed(2), figures.total.toFixed(2));
    const lock = createDisplayedTotal();
    assert.equal(lock.publish("list", 265.89, { complete: false }), null);
    assert.equal(lock.publish("list", 265.53, { complete: false }), null);
    assert.equal(lock.publish("list", 286.09, { complete: false }), null);
    assert.equal(lock.publish("list", figures.total, { complete: true })?.toFixed(2), "229.20");
    assert.equal(lock.publish("list", 286.09, { complete: true })?.toFixed(2), "229.20");
    assert.equal(lock.publish("list", 265.53, { complete: true })?.toFixed(2), "229.20");
    const session = createReviewEntrySession();
    let calls = 0;
    const price = () => {
      calls += 1;
      if (calls > 1) throw new Error("Review priced the same list again");
      return settled229();
    };
    const snapshots = [streamed(265.89), streamed(265.53), streamed(286.09)];
    const first = session.enter({ signature: "trip", zip: "45202", now: 1_000, price, snapshots });
    const fromInStore = session.enter({ signature: "trip", zip: "45202", now: 5_000, price, snapshots });
    const reviewAgain = session.enter({ signature: "trip", zip: "45202", now: 9_000, price, snapshots });
    assert.equal(first.total.toFixed(2), "229.20");
    assert.equal(fromInStore.fetch, false);
    assert.equal(reviewAgain.fetch, false);
    assert.equal(fromInStore.total.toFixed(2), "229.20");
    assert.equal(reviewAgain.total.toFixed(2), "229.20");
    assert.equal(calls, 1);
    assert.equal(session.partialPaints, 0);
    assert.deepEqual(
      session.totals.map((total) => total.toFixed(2)),
      ["229.20", "229.20", "229.20"]
    );
    const kept = session.enter({
      signature: "trip",
      zip: "45202",
      now: 12_000,
      force: true,
      price: () => streamed(286.09),
      snapshots,
    });
    assert.equal(kept.total.toFixed(2), "229.20");
    assert.deepEqual(kept.notes, []);
    assert.deepEqual(
      coverageVisible(
        [
          { text: "Walmart couldn't check right now, retry" },
          { text: "Kroger is missing 3 items" },
        ],
        { settled: false }
      ),
      []
    );
    assert.equal(quietRetryPlan({ attempt: 0, hasSettled: true, incomingComplete: false }).showErrors, false);
    assert.equal(quietRetryPlan({ attempt: 0, hasSettled: true, incomingComplete: false }).retry, false);
    assert.equal(quietRetryPlan({ attempt: 0, hasSettled: false, incomingComplete: false }).retry, true);
    const cached = reviewEntryPaints({ cacheComplete: true, memoryComplete: true, snapshotCount: 3 });
    assert.equal(cached.fetch, false);
    assert.equal(cached.partials, 0);
    assert.equal(cached.legacy, 2);
    const timedOut = reviewEntryPaints({ cacheComplete: false, memoryComplete: false, snapshotCount: 3 });
    assert.equal(timedOut.fetch, true);
    assert.equal(timedOut.legacy, 4);
    assert.match(app, /cartCardFigures/);
    assert.match(app, /settledReviewPayload/);
  });

  it("opens In-store at the top with skeleton rows that match the list", () => {
    const layout = inStoreLayout(35);
    assert.equal(layout.count, 35);
    assert.equal(
      layout.rows.every((row) => row.minHeight === SHOP_ROW_MIN_PX && row.height === SHOP_ROW_MIN_PX),
      true
    );
    const html = inStoreSkeletonHtml(3);
    assert.equal((html.match(/shop-skel-row/g) || []).length, 3);
    assert.match(html, /min-height:64px;height:64px/);
    const calls: number[][] = [];
    applyInStoreScroll((x, y) => calls.push([x, y]));
    assert.deepEqual(calls, [
      [0, 0],
      [0, 0],
    ]);
    assert.match(app, /applyInStoreScroll/);
    assert.match(app, /listShopHtml/);
    assert.doesNotMatch(app, /No trip yet/);
    assert.match(app, /pinTabTop/);
    assert.doesNotMatch(app, /Updating the plan/);
    assert.match(css, /\.shop-skel-row \{[\s\S]*min-height:\s*64px/);
  });

  it("shows a visible coupon note above the Kroger and Walmart cart buttons", () => {
    const kroger = cartCouponCallout("Kroger");
    assert.match(kroger, new RegExp(KROGER_CLIP_NOTE));
    assert.match(kroger, /Clip your Kroger coupons first so they apply to your cart/);
    assert.match(kroger, new RegExp(CLIP_HONESTY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(kroger, /https:\/\/www\.kroger\.com\/savings\/cl\/coupons\//);
    assert.match(kroger, /<aside class="cart-coupon-callout"/);
    assert.doesNotMatch(kroger, /<details/);
    const walmart = cartCouponCallout("Walmart");
    assert.match(walmart, new RegExp(WALMART_CLIP_NOTE));
    assert.match(walmart, /Clip your Walmart coupons first so they apply to your cart/);
    assert.match(walmart, /https:\/\/www\.walmart\.com\/walmartcash/);
    assert.match(walmart, /not by Grocery Gitter/);
    assert.equal(cartCouponCallout("Aldi"), "");
    const card = reviewStoreCardHtml({
      name: "Kroger",
      countLabel: "20 items",
      total: "$120.00",
      minHeight: 256,
      actionHtml: `${kroger}<button type="button" data-kroger="Kroger">Send to Kroger cart</button>`,
      itemsHtml: "",
    });
    assert.ok(card.indexOf("cart-coupon-callout") < card.indexOf("Send to Kroger cart"));
    assert.match(app, /cartCouponCallout/);
  });

  it("keeps Send to Kroger progress inside the button", () => {
    const busy = krogerSendPatch("sending", { connected: true });
    assert.equal(busy.insertSibling, false);
    assert.equal(busy.text, KROGER_SEND_BUSY);
    assert.equal(busy.ariaLabel, KROGER_SEND_CONNECTED);
    assert.equal(busy.disabled, true);
    const idle = krogerSendPatch("idle", { connected: true });
    assert.equal(idle.text, KROGER_SEND_IDLE);
    assert.equal(idle.disabled, false);
    assert.match(app, /paintKrogerSend/);
    assert.match(app, /Sending with your saved Kroger sign-in/);
    assert.doesNotMatch(app, /kroger-leave-note/);
    assert.match(css, /\[data-kroger-send\] \{[\s\S]*height:\s*48px/);
    assert.match(css, /max-height:\s*48px/);
  });
});
