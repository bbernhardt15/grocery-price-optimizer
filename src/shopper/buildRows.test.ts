import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const css = readFileSync(new URL("../../public/styles.css", import.meta.url), "utf8");

describe("Build tab row spacing", () => {
  it("uses one row-gap token between the aisle row and Past trips", () => {
    assert.match(css, /--row-gap:\s*10px/);
    assert.match(css, /\.start-here\s*\{[^}]*gap:\s*var\(--row-gap\)/);
    assert.match(css, /\.start-here\s*\{[^}]*margin:\s*0 0 var\(--row-gap\)/);
    assert.match(css, /\.list-home\s*\{[^}]*gap:\s*var\(--row-gap\)/);
    assert.match(css, /\.browse\s*\{[^}]*gap:\s*var\(--row-gap\)/);
    assert.match(css, /\.browse\s*\{[^}]*margin-top:\s*0/);
    assert.match(css, /\.feature-cards\s*\{[^}]*gap:\s*var\(--row-gap\)/);
    assert.match(css, /\.feature-cards\s*\{[^}]*margin:\s*0/);
    assert.match(css, /#past-trips-home\s*\{\s*margin:\s*0/);
  });
});
