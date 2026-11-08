import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chromeFixIsApproximate,
  handoffBridgePath,
  handoffResultRecord,
  handoffTabPlan,
  isChromeIos,
  locationDeniedCopy,
  pwaInstallApplies,
  readHandoffResult,
  safeHandoffUrl,
  viewportInsets,
  writeHandoffResult,
} from "../../public/shopper/chromeIos.js";
import { readFileSync } from "node:fs";
import { shouldStreamSnapshot } from "../pricing/streamPlan";
import { krogerLoginMode } from "../../public/shopper/krogerReturn.js";

const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

const CRIOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1";
const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

describe("Chrome on iPhone", () => {
  it("recognizes CriOS and ignores a home-screen install", () => {
    assert.match(sw, /grocery-gitter-shell-v62/);
    assert.match(app, /openStoreHandoff/);
    assert.match(app, /applySharedHandoff/);
    assert.match(app, /handoffBridgePath/);
    assert.equal(krogerLoginMode({ userAgent: CRIOS, standalone: true }), "bridge");
    assert.equal(isChromeIos(CRIOS), true);
    assert.equal(isChromeIos(SAFARI), false);
    assert.equal(isChromeIos(DESKTOP), false);
    assert.equal(pwaInstallApplies(CRIOS), false);
    assert.equal(pwaInstallApplies(SAFARI), true);
  });

  it("treats a Chrome location fix as approximate even when the meter looks precise", () => {
    assert.equal(chromeFixIsApproximate(CRIOS, 12, false), true);
    assert.equal(chromeFixIsApproximate(SAFARI, 12, false), false);
    assert.equal(chromeFixIsApproximate(SAFARI, 500, false), true);
    assert.match(locationDeniedCopy(CRIOS), /Chrome on this iPhone/);
    assert.match(locationDeniedCopy(SAFARI), /Type a ZIP/);
  });

  it("does not close the new tab or message an opener on Chrome", () => {
    const chrome = handoffTabPlan(CRIOS, {});
    assert.equal(chrome.showReturn, true);
    assert.equal(chrome.tryClose, false);
    assert.equal(chrome.postToOpener, false);
    assert.equal(chrome.relyOnStorage, true);
    const safari = handoffTabPlan(SAFARI, { closed: false });
    assert.equal(safari.tryClose, true);
    assert.equal(safari.postToOpener, true);
    assert.equal(handoffTabPlan(SAFARI, null).tryClose, false);
    assert.equal(handoffTabPlan(SAFARI, null).showReturn, true);
  });

  it("shares the handoff through storage and only allows store urls", () => {
    const storage = new Map<string, string>();
    const bag = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    };
    const record = handoffResultRecord("Kroger", "cart", { phase: "opened" }, 1_700_000_000_000);
    assert.equal(writeHandoffResult(bag, record), true);
    assert.equal(readHandoffResult(bag, 1_700_000_000_000 + 1000)?.kind, "cart");
    assert.equal(readHandoffResult(bag, 1_700_000_000_000 + 31 * 60 * 1000), null);
    assert.equal(safeHandoffUrl("https://www.kroger.com/cart"), "https://www.kroger.com/cart");
    assert.equal(safeHandoffUrl("https://www.walmart.com/walmartcash"), "https://www.walmart.com/walmartcash");
    assert.equal(safeHandoffUrl("https://evil.example/cart"), "");
    assert.equal(safeHandoffUrl("javascript:alert(1)"), "");
    assert.equal(
      safeHandoffUrl("https://shop.example/api/kroger/authorize", "https://shop.example"),
      "https://shop.example/api/kroger/authorize"
    );
    assert.match(handoffBridgePath("Kroger", "coupons", "https://www.kroger.com/savings/cl/coupons/"), /handoff\.html/);
  });

  it("keeps the Chrome toolbar separate from the keyboard", () => {
    const toolbar = viewportInsets({ innerHeight: 844, visualHeight: 780, offsetTop: 0, focused: false });
    assert.equal(toolbar.keyboard, 0);
    assert.equal(toolbar.toolbar, 64);
    const keyboard = viewportInsets({ innerHeight: 844, visualHeight: 420, offsetTop: 0, focused: true });
    assert.equal(keyboard.keyboard, 424);
    assert.equal(keyboard.toolbar, 0);
    const tall = viewportInsets({ innerHeight: 844, visualHeight: 500, offsetTop: 0, focused: false });
    assert.equal(tall.keyboard, 0);
    assert.equal(tall.toolbar, 96);
  });

  it("streams a plan once a screenful of a store is priced", () => {
    assert.equal(shouldStreamSnapshot(0, 70), false);
    assert.equal(shouldStreamSnapshot(8, 70), true);
    assert.equal(shouldStreamSnapshot(16, 70), true);
    assert.equal(shouldStreamSnapshot(70, 70), true);
    assert.equal(shouldStreamSnapshot(7, 70), false);
  });
});
