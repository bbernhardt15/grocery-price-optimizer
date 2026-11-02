import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { FLOW_STEPS, bottomChrome, nextFlowStep, planBarCopy, pricesAreIn, readFlowStep, shouldAskToSignIn, stepTitle, totalPhrase } from "../../public/shopper/flow.js";

const root = path.resolve(__dirname, "../..");

describe("three-step flow", () => {
  it("stays on add, plan, and shop", () => {
    assert.deepEqual(
      FLOW_STEPS.map((step) => step.label),
      ["Add", "Review", "Shop"]
    );
    assert.equal(stepTitle("add"), "Add items");
    assert.equal(stepTitle("plan"), "Review the split");
    assert.equal(stepTitle("shop"), "In the store");
    assert.equal(bottomChrome("add"), "steps");
    assert.equal(bottomChrome("plan"), "steps");
    assert.equal(bottomChrome("shop"), "shop");
    assert.equal(bottomChrome("nope"), "steps");
    assert.equal(readFlowStep("shop"), "shop");
    assert.equal(readFlowStep("nope"), "add");
    assert.equal(nextFlowStep("add"), "plan");
    assert.equal(nextFlowStep("plan"), "shop");
    assert.equal(nextFlowStep("shop"), "shop");
  });

  it("keeps one calm primary action and does not invent a total", () => {
    const empty = planBarCopy({ step: "add", itemCount: 0, total: 12 });
    assert.equal(empty.countLabel, "0 items");
    assert.equal(empty.totalLabel, "");
    assert.equal(empty.button, "Review your trip");
    assert.equal(empty.enabled, false);
    assert.equal(empty.showButton, false);
    assert.equal(empty.provisional, true);

    const add = planBarCopy({ step: "add", itemCount: 3, total: 12.5 });
    assert.equal(add.countLabel, "3 items");
    assert.equal(add.totalLabel, "$12.50");
    assert.equal(add.button, "Review your trip");
    assert.equal(add.enabled, true);
    assert.equal(add.showButton, true);
    assert.equal(add.provisional, true);

    const missing = planBarCopy({ step: "add", itemCount: 2, total: Number.NaN });
    assert.equal(missing.totalLabel, "");

    const plan = planBarCopy({ step: "plan", itemCount: 2, total: 4, hasPlan: true });
    assert.equal(plan.button, "Shop");
    assert.equal(plan.enabled, true);
    assert.equal(plan.provisional, false);

    const planning = planBarCopy({ step: "plan", itemCount: 2, total: 4, hasPlan: false, planning: true });
    assert.equal(planning.enabled, true);
    assert.equal(planning.button, "Updating…");

    const shop = planBarCopy({ step: "shop", itemCount: 4, left: 1, total: 9, complete: false });
    assert.equal(shop.countLabel, "1 left");
    assert.equal(shop.button, "Done");
    assert.equal(shop.enabled, true);

    const done = planBarCopy({ step: "shop", itemCount: 4, left: 0, total: 9, complete: true });
    assert.equal(done.countLabel, "All checked");
    assert.equal(done.enabled, true);

    assert.equal(totalPhrase(15.02, false).text, "Estimated total $15.02");
    assert.equal(totalPhrase(16.35, true).text, "Total $16.35");
    assert.equal(totalPhrase(15.02, false).label, totalPhrase(16.35, false).label);
    assert.equal(pricesAreIn([{ items: [{ price: 1 }, { itemTotal: 2 }] }], []), true);
    assert.equal(pricesAreIn([{ items: [{ price: 1 }] }], ["milk"]), false);
    assert.equal(pricesAreIn([{ items: [{ price: 0 }] }]), false);
  });

  it("asks for an account only to save or send a cart", () => {
    assert.equal(shouldAskToSignIn({ accountsEnabled: true, signedIn: false, intent: "save" }), true);
    assert.equal(shouldAskToSignIn({ accountsEnabled: true, signedIn: false, intent: "cart" }), true);
    assert.equal(shouldAskToSignIn({ accountsEnabled: true, signedIn: false, intent: "browse" }), false);
    assert.equal(shouldAskToSignIn({ accountsEnabled: false, signedIn: false, intent: "save" }), false);
    assert.equal(shouldAskToSignIn({ accountsEnabled: true, signedIn: true, intent: "cart" }), false);
    assert.equal(shouldAskToSignIn({ accountsEnabled: true, signedIn: false, intent: "save", declined: true }), false);
  });

  it("puts the step bar and the plan bar in the page, and does not ask for location on launch", () => {
    const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
    const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
    assert.match(html, /id="bottom-dock"/);
    assert.match(html, /id="step-bar"/);
    assert.match(html, /id="shop-bar"/);
    assert.match(html, /aria-label="Add items">Add</);
    assert.match(html, /aria-label="Review the split">Review</);
    assert.match(html, /aria-label="In the store">Shop</);
    assert.match(html, /Add items/);
    assert.match(html, /Review the split/);
    assert.match(html, /id="bar-primary"/);
    assert.match(html, /id="shop-done"/);
    assert.equal(html.includes('id="filter-store"'), false);
    assert.equal(html.includes("Lowest price\" selected"), false);
    assert.match(html, /id="sort"[^>]*>\s*<option value="relevance" selected>Suggested/);
    assert.match(html, />Refine</);
    assert.match(html, /Budget-friendly brands/);
    assert.match(html, /id="menu-open"/);
    assert.match(html, /id="app-drawer"/);
    assert.match(html, /id="refresh-prices"/);
    assert.match(html, /Refresh prices/);
    assert.match(html, /id="kroger-card"/);
    assert.match(html, /Kroger connected/);
    assert.match(html, /Send to Kroger cart/);
    assert.match(html, /https:\/\/www\.kroger\.com\/cart/);
    assert.match(html, /id="shop-status"/);
    assert.match(app, /parseKrogerReturn/);
    assert.match(app, /releasePageForTaps/);
    assert.match(html, /id="find-stores"/);
    assert.match(html, /Find nearby stores/);
    assert.match(html, /id="account-ask"/);
    const bootStart = app.indexOf("async function boot(");
    const bootEnd = app.indexOf("async function bootApp(");
    const boot = app.slice(bootStart, bootEnd);
    assert.equal(/readDeviceCoords|getCurrentPosition|requestPermissions/.test(boot), false);
    const bootAppEnd = app.indexOf('document.addEventListener("click"', bootEnd);
    const bootApp = app.slice(bootEnd, bootAppEnd);
    assert.equal(/readDeviceCoords|getCurrentPosition/.test(bootApp), false);
    assert.match(app, /find-stores/);
  });
});
