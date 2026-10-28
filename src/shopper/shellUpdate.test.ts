import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { isHomeScreenApp, shouldApplyShellUpdate } from "../../public/shopper/shellUpdate.js";

const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

describe("home screen shell updates", () => {
  it("recognizes Safari's home-screen flag and display-mode standalone", () => {
    assert.equal(isHomeScreenApp({ standalone: true }, () => ({ matches: false })), true);
    assert.equal(
      isHomeScreenApp({}, (query) => ({ matches: query === "(display-mode: standalone)" })),
      true
    );
    assert.equal(isHomeScreenApp({}, () => ({ matches: false })), false);
    assert.equal(isHomeScreenApp(null, undefined), false);
  });

  it("applies a waiting shell on the next open, not while the page is in front", () => {
    assert.equal(shouldApplyShellUpdate({ pending: true, hidden: true, sawHidden: true }), false);
    assert.equal(shouldApplyShellUpdate({ pending: false, sawHidden: true }), false);
    assert.equal(shouldApplyShellUpdate({ pending: true, alreadyReloaded: true, sawHidden: true }), false);
    assert.equal(shouldApplyShellUpdate({ pending: true, sawHidden: true }), true);
    assert.equal(shouldApplyShellUpdate({ pending: true, homeScreen: true }), true);
    assert.equal(shouldApplyShellUpdate({ pending: true, homeScreen: false, sawHidden: false }), false);
  });

  it("activates the new worker and does not serve the shell cache-first", () => {
    assert.match(sw, /skipWaiting\(\)/);
    assert.match(sw, /clients\.claim\(\)/);
    assert.match(sw, /type === "skip-waiting"/);
    assert.match(sw, /cache: shell \? "no-store"/);
    assert.match(sw, /request\.mode === "navigate"/);
    const fetchHandler = sw.slice(sw.indexOf('self.addEventListener("fetch"'), sw.indexOf('self.addEventListener("push"'));
    assert.doesNotMatch(fetchHandler, /caches\.match\([\s\S]*?return cached[\s\S]*?fetch\(/);
    assert.match(fetchHandler, /await fetch\(request\.url/);
  });
});
