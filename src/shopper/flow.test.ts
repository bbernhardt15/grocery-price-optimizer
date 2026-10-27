import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { FLOW_STEPS, nextFlowStep, planBarCopy, readFlowStep, shouldAskToSignIn } from "../../public/shopper/flow.js";

const root = path.resolve(__dirname, "../..");

describe("three-step flow", () => {
  it("stays on add, plan, and shop", () => {
    assert.deepEqual(
      FLOW_STEPS.map((step) => step.label),
      ["Add items", "See your plan", "Shop"]
    );
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
    assert.equal(empty.button, "See your plan");
    assert.equal(empty.enabled, false);

    const add = planBarCopy({ step: "add", itemCount: 3, total: 12.5 });
    assert.equal(add.countLabel, "3 items");
    assert.equal(add.totalLabel, "$12.50");
    assert.equal(add.button, "See your plan");
    assert.equal(add.enabled, true);

    const missing = planBarCopy({ step: "add", itemCount: 2, total: Number.NaN });
    assert.equal(missing.totalLabel, "");

    const plan = planBarCopy({ step: "plan", itemCount: 2, total: 4, hasPlan: true });
    assert.equal(plan.button, "Shop");
    assert.equal(plan.enabled, true);

    const planning = planBarCopy({ step: "plan", itemCount: 2, total: 4, hasPlan: false, planning: true });
    assert.equal(planning.enabled, false);
    assert.equal(planning.button, "See your plan");

    const shop = planBarCopy({ step: "shop", itemCount: 4, left: 1, total: 9, complete: false });
    assert.equal(shop.countLabel, "1 left");
    assert.equal(shop.button, "Done");
    assert.equal(shop.enabled, false);

    const done = planBarCopy({ step: "shop", itemCount: 4, left: 0, total: 9, complete: true });
    assert.equal(done.countLabel, "All checked");
    assert.equal(done.enabled, true);
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
    assert.match(html, /id="step-bar"/);
    assert.match(html, /Add items/);
    assert.match(html, /See your plan/);
    assert.match(html, /id="bar-primary"/);
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
