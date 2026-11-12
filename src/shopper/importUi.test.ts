import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../../public/shopper/import.css", import.meta.url), "utf8");
const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
const manifest = readFileSync(new URL("../../public/manifest.webmanifest", import.meta.url), "utf8");

describe("import entry on the phone dock", () => {
  it("keeps the dock, the drawer, and Refine, and loads the import sheet above the dock", () => {
    assert.match(html, /id="bottom-dock"/);
    assert.match(html, /id="app-drawer"/);
    assert.match(html, /id="refine-title"[^>]*>Refine</);
    assert.match(html, /id="start-here"/);
    assert.match(html, /shopper\/import\.css\?v=shelf-1/);
    assert.match(html, /app\.js\?v=shelf-1/);
    assert.match(html, /id="ask-mic"/);
    assert.match(html, /id="add-items"/);
    assert.match(html, /Search the catalog/);
    assert.equal(html.includes('id="import-dialog"'), false);
    const drawer = html.slice(html.indexOf('id="app-drawer"'), html.indexOf('id="drawer-scrim"'));
    assert.equal(/Import your list|Speak your list/.test(drawer), false);
    assert.match(app, /mountImport\(/);
    assert.match(html, /a list like bread, milk, eggs/);
    assert.doesNotMatch(html, /a meal like taco night/);
    assert.match(app, /isPreferenceList/);
    assert.match(app, /addFromPreferences/);
    const form = app.slice(app.indexOf('id="search-form"') >= 0 ? 0 : app.indexOf('"search-form"'), app.indexOf('searchEl.addEventListener("input"'));
    assert.ok(form.includes("isPreferenceList"));
    assert.ok(form.indexOf("isPreferenceList") < form.indexOf("quietMeal"));
    assert.match(css, /dialog\.import-sheet/);
    assert.match(css, /calc\(var\(--bar-h\) \+ 8px\)/);
    assert.match(css, /\.import-mic/);
  });

  it("accepts a shared list, photo, or voice memo without caching the post", () => {
    const parsed = JSON.parse(manifest) as { share_target?: { action?: string; method?: string; params?: { files?: Array<{ name?: string; accept?: string[] }> } } };
    assert.equal(parsed.share_target?.action, "/import-share");
    assert.equal(parsed.share_target?.method, "POST");
    const accept = parsed.share_target?.params?.files?.[0]?.accept || [];
    assert.ok(accept.includes("image/*"));
    assert.ok(accept.includes("audio/*"));
    assert.match(sw, /grocery-gitter-shell-v88/);
    assert.match(sw, /pathname === "\/import-share"/);
    assert.match(sw, /gg-import-share/);
  });

  it("asks again for photo and push status after the invite is saved and when the sheet opens", () => {
    const importer = readFileSync(new URL("../../public/shopper/import.js", import.meta.url), "utf8");
    assert.match(importer, /cache: "no-store"/);
    assert.match(importer, /zipCode: zip/);
    assert.match(app, /zipCode: zip/);
    assert.match(importer, /gg-beta-unlocked/);
    const open = importer.slice(importer.indexOf("function open("), importer.indexOf("function close("));
    assert.match(open, /loadStatus\(\)/);
    const photo = importer.slice(importer.indexOf("async function runPhoto"), importer.indexOf("async function runFile"));
    assert.match(photo, /await loadStatus\(\)/);
    assert.equal(photo.includes("isn't switched on yet"), false);
    assert.match(app, /\/api\/price-alerts\/status"\), \{ cache: "no-store" \}/);
    assert.match(app, /gg-beta-unlocked/);
    const listOpen = app.slice(app.indexOf("function openList("), app.indexOf("function openFilters("));
    assert.match(listOpen, /loadPushStatus\(\)/);
  });
});
