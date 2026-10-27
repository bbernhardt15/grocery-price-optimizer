import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../../public/styles.css", import.meta.url), "utf8");

function slice(source: string, start: string, end: string) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing ${start}`);
  return source.slice(from, to);
}

describe("phone audit leftovers", () => {
  it("keeps quantity and Add above the flavor and size choices", () => {
    const card = slice(app, "function cardHtml", "function skeletons");
    const template = card.slice(card.indexOf("return `"));
    const actions = template.indexOf("card-actions");
    const price = template.indexOf("data-price");
    const flavor = template.indexOf("${flavorRow}");
    const size = template.indexOf("${sizeRow}");
    assert.ok(price > 0 && actions > price, "price and Add sit in the lead");
    assert.ok(flavor > actions && size > flavor, "flavor and size follow Add");
    assert.ok(card.indexOf("data-size-row") > 0);
    assert.match(card, /class="card-lead"/);
    assert.match(css, /\.choice-row\s*\{[^}]*overflow-x:\s*auto/s);
    assert.match(css, /\.choice-row\s*\{[^}]*flex-wrap:\s*nowrap/s);
    assert.match(css, /\.size-list\s*\{[^}]*max-height:\s*148px/s);
    assert.match(css, /\.best-badge/);
    assert.match(app, /Per item/);
    assert.match(app, /unitSortLabel/);
    assert.doesNotMatch(slice(css, "@media (max-width: 1099px)", "@media (max-width: 799px)"), /position:\s*sticky/);
  });

  it("states the estimate once per screen and leaves prices plain", () => {
    const card = slice(app, "function cardHtml", "function skeletons");
    assert.doesNotMatch(card, /about \$/);
    assert.doesNotMatch(card, /about \$\{/);
    assert.doesNotMatch(slice(app, "function renderSuggestionRows", "function chooseSuggestion"), /about /);
    assert.doesNotMatch(slice(app, "function calmItemRow", "function customizeBlock"), /about /);
    assert.match(app, /class="estimate-note"/);
    assert.match(app, /ESTIMATE_NOTE/);
    assert.doesNotMatch(slice(app, "function cardHtml", "function skeletons"), /demo-badge|sample price|Demo catalog/);
    assert.match(css, /\.estimate-note/);
  });

  it("hides price watch controls behind a small opt-in", () => {
    const rows = slice(app, "function renderListRows", "function setQuantity");
    assert.match(rows, /class="watch-opt"/);
    assert.match(rows, /Price watch/);
    assert.match(rows, /class="alert-controls"[^>]*hidden/);
    assert.doesNotMatch(rows, /watch-toggle/);
    assert.match(css, /\.alert-controls\[hidden\]\s*\{[^}]*display:\s*none\s*!important/s);
    assert.match(css, /\.watch-opt\s*\{[^}]*font-size:\s*0\.78rem/s);
    assert.doesNotMatch(slice(css, ".watch-opt", ".estimate-note"), /min-height:\s*44px/);
  });

  it("already splits settings into Account, Pro, and this phone", () => {
    const dialog = slice(html, 'id="settings-dialog"', 'id="paywall-dialog"');
    assert.match(dialog, /id="account-box"/);
    assert.match(dialog, />Account</);
    assert.match(dialog, /Grocery Gitter Pro/);
    assert.match(dialog, /id="settings-phone-title">On this phone/);
    assert.match(dialog, /<details class="delete-box">/);
    assert.match(dialog, /<summary[^>]*>Delete my data<\/summary>/);
    assert.equal(dialog.includes("<details class=\"delete-box\" open"), false);
  });
});
