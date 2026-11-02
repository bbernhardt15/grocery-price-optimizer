import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  KROGER_LEAVE_NOTE,
  clearKrogerTrip,
  krogerAddedConfirmation,
  krogerBrowserShouldClose,
  krogerCallbackSucceeded,
  krogerLoginMode,
  krogerReturnMarksConnected,
  parseKrogerReturn,
  readKrogerTrip,
  saveKrogerTrip,
} from "../../public/shopper/krogerReturn.js";

describe("Kroger return", () => {
  it("sends a connect return to the plan and a cart return to the shop", () => {
    const connected = parseKrogerReturn("?kroger=connected&step=plan&message=Kroger%20connected.");
    assert.ok(connected);
    assert.equal(connected.kind, "connected");
    assert.equal(connected.step, "plan");
    assert.equal(connected.message, "Kroger connected.");

    const added = parseKrogerReturn("https://grocery.example/?kroger=added&step=shop&message=Added");
    assert.ok(added);
    assert.equal(added.kind, "added");
    assert.equal(added.step, "shop");

    const error = parseKrogerReturn("kroger=error&step=plan&message=Try%20again");
    assert.ok(error);
    assert.equal(error.kind, "error");
    assert.equal(error.step, "plan");
    assert.equal(parseKrogerReturn("?kroger=nope"), null);
    assert.equal(parseKrogerReturn(""), null);
  });

  it("closes the in-app browser only after the shopper is sent back", () => {
    assert.equal(
      krogerBrowserShouldClose("https://api.example/api/kroger/oauth/callback?code=abc&state=xyz"),
      false
    );
    assert.equal(krogerBrowserShouldClose("https://grocery.example/?kroger=connected&step=plan"), true);
    assert.equal(krogerBrowserShouldClose("https://grocery.example/?kroger=added&step=shop"), true);
    assert.equal(krogerBrowserShouldClose("https://www.kroger.com/cart"), false);
    assert.equal(krogerCallbackSucceeded("https://api.example/api/kroger/oauth/callback?code=abc&state=xyz"), true);
    assert.equal(
      krogerCallbackSucceeded("https://api.example/api/kroger/oauth/callback?error=access_denied&state=xyz"),
      false
    );
    assert.equal(krogerReturnMarksConnected("connected"), true);
    assert.equal(krogerReturnMarksConnected("added"), true);
    assert.equal(krogerReturnMarksConnected("error"), false);
  });

  it("keeps the shop tab across a Kroger sign-in and says how many items were added", () => {
    assert.equal(KROGER_LEAVE_NOTE, "Kroger will ask you to sign in once, then bring you right back.");
    assert.equal(
      krogerLoginMode({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", standalone: true }),
      "popup"
    );
    assert.equal(krogerLoginMode({ userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 0 }), "same-tab");
    assert.equal(krogerAddedConfirmation("9 of 11 items sent"), "Added 9 items to your Kroger cart");
    assert.equal(krogerAddedConfirmation("1 of 1 items sent"), "Added 1 item to your Kroger cart");
    const storage = new Map<string, string>();
    const bag = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    };
    assert.equal(
      saveKrogerTrip(bag, { scroll: 240, itemCount: 4, plan: { stores: [{ storeName: "Kroger" }] }, checks: { a: true } }),
      true
    );
    const saved = readKrogerTrip(bag);
    assert.equal(saved?.step, "shop");
    assert.equal(saved?.scroll, 240);
    assert.equal(saved?.itemCount, 4);
    assert.equal(saved?.pendingSend, true);
    assert.equal(saved?.plan?.stores?.[0]?.storeName, "Kroger");
    clearKrogerTrip(bag);
    assert.equal(readKrogerTrip(bag), null);
  });
});
