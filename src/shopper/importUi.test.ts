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
    assert.match(html, /id="refine-title">Refine</);
    assert.match(html, /id="start-here"/);
    assert.match(html, /shopper\/import\.css\?v=add-calm-1/);
    assert.match(html, /app\.js\?v=add-calm-1/);
    assert.match(html, /id="ask-mic"/);
    assert.match(html, /What do you need\?/);
    assert.equal(html.includes('id="import-dialog"'), false);
    const drawer = html.slice(html.indexOf('id="app-drawer"'), html.indexOf('id="drawer-scrim"'));
    assert.equal(/Import your list|Speak your list/.test(drawer), false);
    assert.match(app, /mountImport\(/);
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
    assert.match(sw, /grocery-gitter-shell-v14/);
    assert.match(sw, /pathname === "\/import-share"/);
    assert.match(sw, /gg-import-share/);
  });
});
