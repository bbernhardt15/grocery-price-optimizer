import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { bearerHeader, pathWithoutSession, sessionFromSearch, SESSION_KEY } from "../../public/shopper/account.js";

describe("account session handoff", () => {
  it("reads a session token from the redirect and then drops it from the url", () => {
    const token = "a".repeat(43);
    assert.equal(sessionFromSearch(`?from=apple&session=${token}`), token);
    assert.equal(sessionFromSearch("?session=short"), "");
    assert.equal(sessionFromSearch(""), "");
    assert.equal(pathWithoutSession("/", `?from=apple&session=${token}`), "/?from=apple");
    assert.equal(pathWithoutSession("/list/abc", `?session=${token}`), "/list/abc");
    assert.deepEqual(bearerHeader(""), {});
    assert.equal(bearerHeader(token).Authorization, `Bearer ${token}`);
    assert.equal(SESSION_KEY, "gg-session");
  });

  it("offers sign-in in Settings and still lets a guest delete data", () => {
    const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
    const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
    assert.match(html, /id="account-box"/);
    assert.match(html, /id="sign-in-apple"/);
    assert.match(html, /id="sign-in-google"/);
    assert.match(html, /id="magic-link-form"/);
    assert.match(html, /id="sign-out"/);
    assert.match(app, /\/api\/auth\/status/);
    assert.match(app, /\/api\/auth\/apple/);
    assert.match(app, /\/api\/auth\/google/);
    assert.match(app, /\/api\/auth\/email\/start/);
    assert.match(app, /\/api\/auth\/merge/);
    assert.match(app, /\/api\/me\/list/);
    assert.match(app, /SignInWithApple/);
    assert.match(html, /Delete my data/);
  });
});