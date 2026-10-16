import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(__filename);
const {
  DEFAULT_NATIVE_API,
  resolveApiOrigin,
  resolveSyncApiUrl,
  resolveMediaUrl,
  isExternalHttp,
  isExternalNavigation,
} = require("../public/native-shell.js") as {
  DEFAULT_NATIVE_API: string;
  resolveApiOrigin: (input: {
    native?: boolean;
    location?: { protocol?: string; hostname?: string };
    configured?: string;
  }) => string;
  resolveSyncApiUrl: (value?: string) => string;
  resolveMediaUrl: (url: string, apiOrigin: string) => string;
  isExternalHttp: (url: string) => boolean;
  isExternalNavigation: (href: string, pageHref: string) => boolean;
};

const PRODUCTION = "https://grocery-price-optimizer-production.up.railway.app";

test("website and installed PWA stay on the page origin", () => {
  assert.equal(DEFAULT_NATIVE_API, PRODUCTION);
  assert.equal(
    resolveApiOrigin({ native: false, location: { protocol: "https:", hostname: "grocery.example" } }),
    ""
  );
  assert.equal(
    resolveApiOrigin({
      native: false,
      location: { protocol: "https:", hostname: "localhost" },
      configured: PRODUCTION,
    }),
    ""
  );
});

test("bundled native shell calls the configured https API", () => {
  assert.equal(
    resolveApiOrigin({
      native: true,
      location: { protocol: "capacitor:", hostname: "localhost" },
      configured: "",
    }),
    PRODUCTION
  );
  assert.equal(
    resolveApiOrigin({
      native: true,
      location: { protocol: "https:", hostname: "localhost" },
      configured: "https://staging.example/",
    }),
    "https://staging.example"
  );
  assert.equal(
    resolveApiOrigin({
      native: true,
      location: { protocol: "https:", hostname: "localhost" },
      configured: "http://192.168.1.20:3000",
    }),
    PRODUCTION
  );
});

test("live reload keeps API calls on the loaded server", () => {
  assert.equal(
    resolveApiOrigin({
      native: true,
      location: { protocol: "http:", hostname: "192.168.1.20" },
      configured: PRODUCTION,
    }),
    ""
  );
  assert.equal(
    resolveApiOrigin({
      native: true,
      location: { protocol: "https:", hostname: "grocery-price-optimizer-production.up.railway.app" },
      configured: "https://staging.example",
    }),
    ""
  );
});

test("sync accepts only an https origin", () => {
  assert.equal(resolveSyncApiUrl(""), PRODUCTION);
  assert.equal(resolveSyncApiUrl("https://staging.example/"), "https://staging.example");
  assert.throws(() => resolveSyncApiUrl("http://localhost:3000"), /https/);
  assert.throws(() => resolveSyncApiUrl("https://user:pass@example.com"), /credentials/);
  assert.throws(() => resolveSyncApiUrl("https://example.com/api"), /origin/);
});

test("only /api media is rewritten onto the native API origin", () => {
  const placeholder = "/api/catalog/placeholder.svg?department=produce&title=Bananas";
  assert.equal(resolveMediaUrl(placeholder, PRODUCTION), `${PRODUCTION}${placeholder}`);
  assert.equal(resolveMediaUrl("https://img.example/milk.jpg", PRODUCTION), "https://img.example/milk.jpg");
  assert.equal(resolveMediaUrl("/instacart-carrot.svg", PRODUCTION), "/instacart-carrot.svg");
  assert.equal(resolveMediaUrl(placeholder, ""), placeholder);
});

test("retailer handoffs leave the webview; in-app links do not", () => {
  assert.equal(isExternalHttp("https://www.kroger.com/search?query=milk"), true);
  assert.equal(isExternalHttp("/api/kroger/cart/start"), false);
  const android = "https://localhost/index.html";
  assert.equal(isExternalNavigation("https://www.kroger.com/search?query=milk", android), true);
  assert.equal(isExternalNavigation("https://affil.walmart.com/cart/addToCart?items=1", android), true);
  assert.equal(isExternalNavigation("#catalog", android), false);
  assert.equal(isExternalNavigation("/instacart-carrot.svg", android), false);
  const ios = "capacitor://localhost/index.html";
  assert.equal(isExternalNavigation("#catalog", ios), false);
  assert.equal(isExternalNavigation("https://www.target.com/s?searchTerm=milk", ios), true);
});

test("committed native config does not pin the website to Railway", () => {
  const source = readFileSync(new URL("../public/native-config.js", import.meta.url), "utf8");
  assert.match(source, /window\.GROCERY_GITTER_API_ORIGIN = "";/);
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /rel="manifest"/);
  assert.match(html, /native-config\.js/);
  assert.match(html, /native-shell\.js/);
  const shellBeforeApp = html.indexOf("native-shell.js") < html.indexOf("app.js");
  const configBeforeShell = html.indexOf("native-config.js") < html.indexOf("native-shell.js");
  assert.equal(configBeforeShell && shellBeforeApp, true);
});
