import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../../public/styles.css", import.meta.url), "utf8");

describe("mobile form zoom", () => {
  it("keeps user zoom on and sets form controls to at least 16px", () => {
    const viewport = html.match(/name="viewport" content="([^"]+)"/);
    assert.ok(viewport?.[1]);
    assert.equal(/user-scalable\s*=\s*no/i.test(viewport[1]), false);
    assert.equal(/maximum-scale\s*=\s*1\b/i.test(viewport[1]), false);
    assert.match(css, /#profile-receipt-paste/);
    assert.match(css, /textarea,\n {2}\.search \.ask-field input/);
    const rule = css.slice(css.indexOf("@media (max-width: 899px)"));
    assert.match(rule, /font-size:\s*16px/);
    assert.equal(/font-size:\s*0\.8[0-9]rem/.test(css.slice(css.indexOf("@media (max-width: 719px)"), css.indexOf("@media (max-width: 719px)") + 800)), false);
  });
});
