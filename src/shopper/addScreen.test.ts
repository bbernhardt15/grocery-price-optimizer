import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../../public/styles.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");

describe("calm add screen", () => {
  it("leads with one ask field, chips, and a collapsed aisle", () => {
    assert.match(html, /id="search"[^>]*placeholder="What do you need\?"/);
    assert.match(html, /id="ask-mic"/);
    assert.match(html, /id="ask-import"/);
    assert.match(html, /id="starter-lists"/);
    assert.match(html, /Your usuals/);
    assert.match(html, /id="browse-panel" hidden/);
    assert.match(html, /Browse all items/);
    assert.match(html, /id="refine-count"/);
    assert.match(app, /askIntent/);
    assert.match(app, /importer\?\.find/);
  });

  it("keeps Refine collapsed and leaves ZIP in the menu on a wide screen", () => {
    const wide = css.slice(css.indexOf("@media (min-width: 1100px)"));
    assert.doesNotMatch(wide, /\.app-drawer\s*\{[^}]*position:\s*static/);
    assert.doesNotMatch(wide, /\.filters,\s*\.filters\.open\s*\{[^}]*display:\s*flex;\s*position:\s*static/);
    assert.match(wide, /body\[data-browse="open"\] \.rail/);
    assert.match(css, /\.filters\s*\{[^}]*display:\s*none/s);
    const drawer = html.slice(html.indexOf('id="app-drawer"'), html.indexOf('id="drawer-scrim"'));
    assert.match(drawer, /id="zip"/);
    assert.match(drawer, /id="alerts-toggle"/);
    assert.match(drawer, /id="theme-btn"/);
    assert.match(drawer, /id="settings-open"/);
    assert.match(drawer, /id="refresh-prices"/);
    assert.equal(drawer.includes('id="list-toggle"'), false);
    assert.match(html.slice(html.indexOf("<header"), html.indexOf('id="app-drawer"')), /id="list-toggle"/);
  });

  it("gives My list names a full line instead of a crushed column", () => {
    assert.match(css, /\.list-row\s*\{[^}]*grid-template-columns:\s*48px minmax\(0,\s*1fr\)/s);
    assert.match(app, /class="list-copy"/);
    assert.match(css, /\.list-copy strong,\s*\.got-it strong\s*\{[^}]*overflow-wrap:\s*break-word/s);
  });
});
