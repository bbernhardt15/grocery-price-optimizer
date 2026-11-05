import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { alertDeliveryState } from "../../public/shopper/alertDelivery.js";
import {
  SHARE_BUTTON_LABEL,
  SHOPPING_LIST_PURPOSE,
  SUB_SWAP_LABEL,
  SUB_SWAP_NOTE,
  alertControlVisible,
  listRemoveHtml,
} from "../../public/shopper/shoppingListSheet.js";

const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");

describe("shopping list sheet", () => {
  it("states the purpose, one Share button, and what a swap changes", () => {
    assert.match(SHOPPING_LIST_PURPOSE, /Change a quantity/);
    assert.match(html, /id="shopping-list-note"/);
    assert.match(html, /Change a quantity, take something off, or send this list to whoever is shopping with you/);
    assert.equal(SHARE_BUTTON_LABEL, "Share");
    assert.match(html, /id="share-btn"[^>]*>Share</);
    assert.equal(SUB_SWAP_LABEL, "OK to swap for similar items");
    assert.match(SUB_SWAP_NOTE, /similar product there instead of adding another stop/);
    assert.match(html, /OK to swap for similar items/);
    assert.match(html, /id="sub-swap-note"/);
    assert.match(app, /data-list-remove/);
    assert.match(listRemoveHtml("milk", "Whole Milk", (value) => value), /data-list-remove="milk"/);
    assert.match(listRemoveHtml("milk", "Whole Milk", (value) => value), /Remove Whole Milk/);
  });

  it("hides the price alert control unless the server has a push key", () => {
    const hidden = alertDeliveryState(null);
    assert.equal(alertControlVisible(hidden), false);
    assert.equal(alertControlVisible(alertDeliveryState({ webPush: { enabled: true, publicKey: "" } })), false);
    const ready = alertDeliveryState({ webPush: { enabled: true, publicKey: "vapid-public" } });
    assert.equal(alertControlVisible(ready), true);
    assert.match(html, /id="list-alert-block"[^>]*hidden/);
    assert.doesNotMatch(html, /class="alert-state"/);
    assert.doesNotMatch(html, /id="list-alerts"[^>]*disabled/);
    assert.match(app, /block\.hidden = !state\.visible/);
    assert.match(app, /enablePush\(\)/);
  });
});
