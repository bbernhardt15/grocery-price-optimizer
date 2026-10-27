import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  krogerBrowserShouldClose,
  krogerCallbackSucceeded,
  krogerReturnMarksConnected,
  parseKrogerReturn,
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
});
