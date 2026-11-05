import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planHasDisplay, planIsShowable, readPlanCache, writePlanCache } from "../../public/shopper/planCache.js";
import { chooseDisplayedPlan, listDisplayPlan } from "../../public/shopper/planFallback.js";
import { reviewHeadlineReady } from "../../public/shopper/reviewStable.js";

describe("plan fallback after a store timeout", () => {
  it("paints a priced partial and ignores an empty final body", () => {
    const partial = {
      partial: true,
      pendingStores: ["Walmart"],
      pricingByStore: [
        { storeName: "Kroger", check: "ok" },
        { storeName: "Walmart", check: "timeout" },
      ],
      stores: [{ storeName: "Kroger", items: [{ name: "Milk", price: 3.2, quantity: 1 }] }],
    };
    const shown = chooseDisplayedPlan({ stores: [], partial: true }, partial, 50);
    assert.ok(shown);
    assert.equal(shown?.partial, false);
    assert.deepEqual(shown?.pendingStores, []);
    assert.equal(planIsShowable(shown), true);
    assert.equal(reviewHeadlineReady(shown), true);
    assert.equal(reviewHeadlineReady(partial), false);
    const placeholder = listDisplayPlan(
      [{ itemId: "custom:bbq", quantity: 1, product: { name: "BBQ sauce", familyName: "BBQ sauce" } }],
      ["Kroger"],
      10
    );
    const priced = chooseDisplayedPlan(placeholder, partial, 60);
    assert.equal(priced?.stores?.[0]?.items?.some((item) => Number(item.price) > 0), true);
    assert.equal(reviewHeadlineReady(priced), true);
  });

  it("keeps the shopping list on screen when no store returned a price", () => {
    const plan = listDisplayPlan(
      [
        { itemId: "custom:milk", quantity: 2, product: { id: "custom:milk", name: "Milk", familyName: "Milk" } },
        { itemId: "custom:eggs", quantity: 1, product: { id: "custom:eggs", name: "Eggs", familyName: "Eggs", price: 2.5 } },
      ],
      ["Kroger", "Walmart"],
      80
    );
    assert.equal(plan?.stores?.[0]?.storeName, "Kroger");
    assert.equal(plan?.stores?.[0]?.items?.length, 2);
    assert.equal(planHasDisplay(plan), true);
    assert.equal(reviewHeadlineReady(plan), true);
    const storage = {
      value: "",
      getItem: () => storage.value,
      setItem: (_key: string, value: string) => {
        storage.value = value;
      },
    };
    assert.equal(writePlanCache(storage, { signature: "list", zip: "45103", savedAt: 80, payload: plan }), true);
    const cached = readPlanCache(storage);
    assert.equal(cached?.signature, "list");
    assert.equal(reviewHeadlineReady(cached?.payload), true);
    assert.equal(cached?.payload?.stores?.[0]?.items?.[1]?.price, 2.5);
  });
});
