import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { savingsNudge, savingsNudgeHtml } from "../../public/shopper/savingsNudge.js";

function plans(saved: number, single = 100, stops = 2) {
  return {
    saved,
    best: { stops, total: single - saved },
    baseline: { storeName: "Kroger", total: single, complete: true },
  };
}

describe("savings nudge", () => {
  it("offers the single store when the split saves under $5 or 3 percent", () => {
    const small = savingsNudge(plans(2.24, 274.81));
    assert.match(small.text, /Two stores only saves \$2\.24/);
    assert.match(small.text, /Shop just at Kroger for \$274\.81 instead\?/);
    const html = savingsNudgeHtml(small);
    assert.match(html, /data-nudge-single/);
    assert.match(html, /Keep the split/);
    assert.equal(savingsNudge(plans(6, 100)), null);
    assert.ok(savingsNudge(plans(6, 400)));
    assert.equal(savingsNudge(plans(0, 100)), null);
    assert.equal(savingsNudge({ ...plans(2, 100), best: { stops: 1, total: 98 } }), null);
  });
});
