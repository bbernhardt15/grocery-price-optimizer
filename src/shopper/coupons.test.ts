import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COUPON_PAGES as serverPages, couponPageFor as serverPageFor, publicCouponLink } from "../coupons/pages";
import { STORE_HANDOFF_CONFIG } from "../storeHandoffConfig";
import {
  COUPON_PAGES,
  bestCouponLine,
  checklistSentence,
  couponChecklist,
  couponNamesMatch,
  couponDraftFields,
  couponExpired,
  couponLineLabel,
  couponPageFor,
  couponSavingsSummary,
  couponsForStore,
  parseCouponForm,
  readClipped,
  readCoupons,
  removeCoupon,
  saleBadge,
  shopCouponHint,
  storeCouponMarkup,
  upsertCoupon,
  writeClipped,
} from "../../public/shopper/coupons.js";

function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

const kroger = {
  storeName: "Kroger",
  subtotal: 5,
  items: [
    { lineId: "0:oreo", name: "Oreo", price: 3, quantity: 1, itemTotal: 3 },
    { lineId: "1:cola", name: "Coca-Cola", price: 2, quantity: 1, itemTotal: 2 },
  ],
};

describe("shopper coupon pages", () => {
  it("matches the server coupon table", () => {
    assert.equal(COUPON_PAGES.length, serverPages.length);
    for (const page of serverPages) {
      const client = COUPON_PAGES.find((row) => row.storeName === page.storeName);
      assert.ok(client, page.storeName);
      assert.equal(client?.url, page.url);
      assert.equal(client?.label, page.label);
      assert.equal(client?.note, page.note);
      assert.equal(client?.kind, page.kind);
      for (const alias of page.aliases) {
        assert.equal(client?.aliases.includes(alias), true, `${page.storeName} ${alias}`);
      }
    }
    for (const store of STORE_HANDOFF_CONFIG) {
      assert.equal(couponPageFor(store.storeName)?.url, serverPageFor(store.storeName)?.url);
      assert.equal(couponPageFor(store.storeName)?.url, publicCouponLink(store.storeName)?.url);
    }
  });
});

describe("sale badge", () => {
  it("shows was-price and end date only when the line is already on sale", () => {
    assert.equal(saleBadge({ price: 2, regularPrice: 3 }), null);
    assert.deepEqual(saleBadge({ onSale: true, price: 2.14 }), { label: "On sale", was: "", ends: "" });
    assert.deepEqual(saleBadge({ onSale: true, price: 2.14, regularPrice: 2.14, saleEndsOn: "2026-11-08" }), {
      label: "On sale",
      was: "",
      ends: "ends Nov 8",
    });
    assert.equal(saleBadge({ onSale: true, price: 2.14, regularPrice: 2.64, saleEndsOn: "2026-11-08" })?.was, "was $2.64");
  });
});

describe("coupon name matching", () => {
  it("matches the coupon sentence and rejects the wrong brand, variant, or original-only name", () => {
    const tide = "Tide PODS Original Laundry Detergent 42 ct";
    assert.equal(couponNamesMatch("Save $1 on any 2 Tide PODS", tide), true);
    assert.equal(couponNamesMatch("Tide PODS", tide), true);
    assert.equal(couponNamesMatch("Bounty paper towels", tide), false);
    assert.equal(couponNamesMatch("Gain laundry detergent", tide), false);
    assert.equal(couponNamesMatch("original", tide), false);
    assert.equal(couponNamesMatch("Tide Original", tide), true);
    assert.equal(couponNamesMatch("Tide Original", "Tide PODS 42 ct"), true);
    assert.equal(couponNamesMatch("Coke", "Diet Coke 12 pk"), false);
    assert.equal(couponNamesMatch("any Coke", "Diet Coke 12 pk"), true);
    assert.equal(couponNamesMatch("any size Coke", "Diet Coke 12 pk"), false);
    assert.equal(couponNamesMatch("any 12 pk", "Diet Coke 12 pk"), false);
    assert.equal(couponNamesMatch("any 2", "Diet Coke 12 pk"), false);
    assert.equal(couponNamesMatch("any variety Coke", "Diet Coke 12 pk"), true);
    assert.equal(couponNamesMatch("any flavor Coke", "Diet Coke 12 pk"), true);
    assert.equal(couponNamesMatch("all varieties of Coke", "Diet Coke 12 pk"), true);
    assert.equal(couponNamesMatch("any variety", "Diet Coke 12 pk"), false);
    assert.equal(couponNamesMatch("any Coke products", "Diet Coke 12 pk"), true);
    assert.equal(couponNamesMatch("Milk", "Almond Milk"), false);
    assert.equal(couponNamesMatch("Milk", "Chocolate Milk"), false);
    assert.equal(couponNamesMatch("Milk", "Whole Milk 1 gal"), false);
    assert.equal(couponNamesMatch("detergent", tide), false);
    assert.equal(couponNamesMatch("Kroger 2% Milk", "Kroger Vitamin D Milk gallon"), false);
    assert.equal(couponNamesMatch("Kroger 2% Milk", "Kroger 2% Milk gallon"), true);
    assert.equal(couponNamesMatch("Almond Milk", "Almond Milk 64 oz"), true);
    assert.equal(couponNamesMatch("Chocolate Milk", "Almond Milk"), false);
    assert.equal(couponNamesMatch("Coca-Cola", "Coke 12 pk"), true);
    assert.equal(couponNamesMatch("Coca-Cola Cherry", "Cherry Coke 12 pk"), true);
    assert.equal(couponNamesMatch("Diet Coke", "Coke 12 pk"), false);
    assert.equal(couponNamesMatch("Cheerios", "Honey Nut Cheerios"), false);
    assert.equal(couponNamesMatch("any Cheerios", "Honey Nut Cheerios"), true);
    assert.equal(couponNamesMatch("Honey Nut Cheerios", "Cheerios"), false);
    assert.equal(couponNamesMatch("Honey Nut Cheerios", "Honey Nut Cheerios 18 oz"), true);
    const lines = [
      { value: "tide", name: tide },
      { value: "bounty", name: "Bounty Select-A-Size Paper Towels" },
      { value: "diet", name: "Diet Coke 12 pk" },
      { value: "coke", name: "Coke 12 pk" },
    ];
    assert.equal(bestCouponLine(lines, "Save $1 on any 2 Tide PODS")?.value, "tide");
    assert.equal(bestCouponLine(lines, "Coke")?.value, "coke");
    assert.equal(bestCouponLine(lines, "Coca-Cola Cherry"), null);
    const summary = couponSavingsSummary(
      [
        {
          storeName: "Kroger",
          subtotal: 12.99,
          items: [{ lineId: "tide", name: tide, price: 12.99, quantity: 2, itemTotal: 12.99 }],
        },
      ],
      [{ id: "c-tide", storeName: "Kroger", lineId: "", itemName: "Save $1 on any 2 Tide PODS", kind: "dollars" as const, amount: 1 }],
      "2026-11-13"
    );
    assert.equal(summary.savings, 1);
  });
});

describe("coupon checklist and savings", () => {
  it("lists the items on that store", () => {
    assert.deepEqual(couponChecklist(kroger.items), ["Oreo", "Coca-Cola"]);
    assert.equal(checklistSentence(["Oreo", "Coca-Cola"]), "Look for coupons on: Oreo and Coca-Cola.");
    assert.equal(checklistSentence([]), "Nothing on this store’s list yet.");
    assert.equal(shopCouponHint(kroger.items), "Look for coupons on: Oreo and Coca-Cola.");
  });

  it("keeps the typed coupon form behind Add a coupon", () => {
    const summary = couponSavingsSummary(
      [kroger],
      [{ id: "c1", storeName: "Kroger", lineId: "0:oreo", itemName: "Oreo", kind: "dollars" as const, amount: 1 }],
      "2026-10-26"
    );
    const html = storeCouponMarkup(kroger, {
      page: couponPageFor("Kroger"),
      rows: summary.byStore[0].rows,
      storeSummary: summary.byStore[0],
      canEnter: true,
      open: false,
    });
    assert.match(html, /Type a coupon/);
    assert.match(html, /coupon-form-wrap" hidden/);
    assert.match(html, /Add coupons/);
    assert.doesNotMatch(html, /Check Kroger coupons before you shop/);
    assert.match(html, /Your coupon · Oreo · \$1\.00 off/);
    assert.ok(html.indexOf("your-coupon") < html.indexOf("Add coupons"));
  });

  it("applies one coupon per line and never goes below zero", () => {
    const storage = memoryStorage();
    const first = parseCouponForm({
      storeName: "Kroger",
      lineId: "0:oreo",
      itemName: "Oreo",
      kind: "dollars",
      amount: "10",
      id: "c-oreo",
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    upsertCoupon(storage, first.coupon);
    const percent = parseCouponForm({
      storeName: "Kroger",
      lineId: "1:cola",
      itemName: "Coca-Cola",
      kind: "percent",
      amount: "50",
      id: "c-cola",
    });
    assert.equal(percent.ok, true);
    if (!percent.ok) return;
    upsertCoupon(storage, percent.coupon);
    const replaced = parseCouponForm({
      storeName: "Kroger",
      lineId: "0:oreo",
      itemName: "Oreo",
      kind: "dollars",
      amount: "1",
      id: "c-oreo-2",
    });
    assert.equal(replaced.ok, true);
    if (!replaced.ok) return;
    const saved = upsertCoupon(storage, replaced.coupon);
    assert.equal(saved.filter((row) => row.lineId === "0:oreo").length, 1);
    assert.equal(saved.find((row) => row.lineId === "0:oreo")?.amount, 1);

    const summary = couponSavingsSummary([kroger], readCoupons(storage), "2026-10-26");
    assert.equal(summary.savings, 2);
    assert.equal(summary.estimatedTotal, 3);
    assert.equal(summary.shelf, 5);
    const rows = couponsForStore(kroger, readCoupons(storage), "2026-10-26");
    assert.match(couponLineLabel(rows.find((row) => row.coupon.lineId === "0:oreo")), /Your coupon · Oreo · \$1\.00 off/);
    assert.match(couponLineLabel(rows.find((row) => row.coupon.lineId === "1:cola")), /50% off/);
  });

  it("leaves an expired coupon off the estimate", () => {
    const coupon = {
      id: "c-old",
      storeName: "Kroger",
      lineId: "0:oreo",
      itemName: "Oreo",
      kind: "dollars" as const,
      amount: 1,
      expiresOn: "2026-10-01",
    };
    assert.equal(couponExpired(coupon, "2026-10-26"), true);
    const summary = couponSavingsSummary([kroger], [coupon], "2026-10-26");
    assert.equal(summary.savings, 0);
    assert.equal(summary.estimatedTotal, 5);
    assert.match(couponLineLabel(summary.byStore[0].rows[0]), /expired Oct 1/);
  });

  it("does not apply a screenshot coupon until the printed quantity is in the cart", () => {
    const fields = couponDraftFields({
      storeName: "Kroger",
      itemName: "Large eggs",
      kind: "dollars",
      amount: 1.5,
      minQuantity: 2,
      conditions: "When you buy 2",
      gaps: [],
    });
    assert.equal(fields.amount, "1.5");
    assert.match(fields.review, /screenshot/);
    const blank = couponDraftFields({ storeName: "Kroger", itemName: "Milk", gaps: ["amount"] });
    assert.equal(blank.amount, "");
    const coupon = {
      id: "c-eggs",
      storeName: "Kroger",
      lineId: "0:eggs",
      itemName: "Large eggs",
      kind: "dollars" as const,
      amount: 1.5,
      minQuantity: 2,
      conditions: "When you buy 2",
      source: "screenshot",
    };
    const one = { ...kroger, items: [{ lineId: "0:eggs", name: "Large eggs", price: 2.19, quantity: 1, itemTotal: 2.19 }] };
    const two = { ...kroger, items: [{ lineId: "0:eggs", name: "Large eggs", price: 2.19, quantity: 2, itemTotal: 4.38 }] };
    assert.equal(couponSavingsSummary([one], [coupon], "2026-11-08").savings, 0);
    assert.match(couponLineLabel(couponSavingsSummary([one], [coupon], "2026-11-08").byStore[0].rows[0]), /not applied/);
    assert.equal(couponSavingsSummary([two], [coupon], "2026-11-08").savings, 1.5);
  });

  it("accepts a trip line id that includes the item words", () => {
    const parsed = parseCouponForm({
      storeName: "Walmart",
      lineId: "0:large eggs",
      itemName: "Large Eggs",
      kind: "dollars",
      amount: "1",
      id: "c-eggs",
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.coupon.lineId, "0:large eggs");
  });

  it("rejects a blank amount and a percent over 100", () => {
    assert.equal(parseCouponForm({ storeName: "Kroger", lineId: "0:oreo", itemName: "Oreo", amount: "0" }).ok, false);
    assert.equal(
      parseCouponForm({ storeName: "Kroger", lineId: "0:oreo", itemName: "Oreo", kind: "percent", amount: "150" }).ok,
      false
    );
  });
});

describe("clipped reminder", () => {
  it("remembers the checkbox for one trip and one store", () => {
    const storage = memoryStorage();
    writeClipped(storage, "trip-a", "Kroger", true);
    writeClipped(storage, "trip-a", "Aldi", false);
    assert.equal(readClipped(storage, "trip-a").kroger, true);
    assert.equal(readClipped(storage, "trip-b").kroger, undefined);
    const left = removeCoupon(memoryStorage(), "missing");
    assert.deepEqual(left, []);
  });
});
