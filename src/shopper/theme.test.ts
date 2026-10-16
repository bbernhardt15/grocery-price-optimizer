import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  nextTheme,
  parseThemeChoice,
  THEME_COLOR,
  THEME_KEY,
  themeButtonLabel,
  themeColor,
  themeGlyph,
  themeIsDark,
} from "../../public/shopper/theme.js";

const root = path.resolve(__dirname, "../..");

describe("theme choice", () => {
  it("cycles system, dark, and light, and ignores unknown saved values", () => {
    assert.equal(parseThemeChoice(null), "system");
    assert.equal(parseThemeChoice("sepia"), "system");
    assert.equal(nextTheme("system"), "dark");
    assert.equal(nextTheme("dark"), "light");
    assert.equal(nextTheme("light"), "system");
    assert.equal(themeIsDark("system", true), true);
    assert.equal(themeIsDark("system", false), false);
    assert.equal(themeIsDark("light", true), false);
    assert.equal(themeIsDark("dark", false), true);
    assert.equal(themeColor("dark", false), THEME_COLOR.dark);
    assert.equal(themeColor("light", true), THEME_COLOR.light);
    assert.equal(themeGlyph("dark"), "☾");
    assert.match(themeButtonLabel("system", true), /dark/i);
  });

  it("paints a warm dark canvas before the stylesheet, never pure black", () => {
    const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
    const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
    const bootAt = html.indexOf(THEME_KEY);
    const styleAt = html.indexOf("styles.css");
    assert.ok(bootAt > 0, "theme boot should read the saved choice");
    assert.ok(bootAt < styleAt, "theme boot should run before the stylesheet");
    assert.ok(html.includes(THEME_COLOR.dark));
    assert.ok(html.includes(THEME_COLOR.light));
    assert.ok(css.includes(THEME_COLOR.dark));
    assert.equal(css.includes("#000000"), false);
    assert.equal(css.includes("--bg: #000"), false);
    assert.notEqual(THEME_COLOR.dark.toLowerCase(), "#000000");
    assert.notEqual(THEME_COLOR.dark.toLowerCase(), "#000");
  });
});
