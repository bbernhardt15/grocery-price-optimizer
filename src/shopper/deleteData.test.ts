import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("delete my data screen", () => {
  const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");

  it("offers Settings and a typed DELETE confirm on the shopper page", () => {
    assert.match(html, /id="settings-open"[^>]*class="ghost settings-open"/);
    assert.equal((html.match(/settings-open/g) || []).length >= 2, true);
    assert.equal(html.includes("settings-btn"), false);
    assert.match(html, /class="linkish settings-open"/);
    assert.match(html, /id="settings-dialog"/);
    assert.match(html, /Delete my data/);
    assert.match(html, /id="delete-confirm"/);
    assert.match(html, /id="delete-data-btn"/);
    assert.match(html, /Type DELETE to confirm/);
  });

  it("calls the deletion API, unsubscribes push, clears local storage, and resets", () => {
    assert.match(app, /apiUrl\("\/api\/me\/data"\)/);
    assert.match(app, /method: "DELETE"/);
    assert.match(app, /credentials: apiOrigin\(\) \? "omit" : "include"/);
    assert.match(app, /subscription\.unsubscribe\(\)/);
    assert.match(app, /key\.startsWith\("gg-"\)/);
    assert.match(app, /localStorage\.removeItem\(key\)/);
    assert.match(app, /apiUrl\("\/api\/kroger\/logout"\)/);
    assert.match(app, /Capacitor\?\.Plugins\?\.Browser/);
    assert.match(app, /window\.location\.replace\("\/"\)/);
    assert.match(app, /window\.location\.reload\(\)/);
    assert.match(app, /confirmEl\.value !== "DELETE"/);
  });
});
