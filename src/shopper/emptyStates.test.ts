import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  catalogEmptyKind,
  EMPTY_STATES,
  emptyState,
  emptyStateInner,
  emptyStateMarkup,
  networkKind,
  searchEmpty,
  tripStoreEmpty,
} from "../../public/shopper/emptyStates.js";

const root = path.resolve(__dirname, "../..");
const escapeHtml = (value: string) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

describe("empty states", () => {
  it("gives every requested gap one next action", () => {
    for (const kind of ["list", "search", "stores", "alerts", "shared", "offline", "network"] as const) {
      const state = emptyState(kind);
      assert.ok(state.title.length > 0, kind);
      assert.ok(state.body.length < 140, kind);
      assert.ok(state.action, kind);
      assert.ok(state.actionId, kind);
    }
    assert.equal(emptyState("alerts").actionId, "enable-alerts");
    assert.equal(emptyState("alertsOn").actionId, "browse");
    assert.equal(emptyState("stores").title, "No stores near this ZIP");
    assert.equal(emptyState("shared").action, "Share list");
    assert.equal(EMPTY_STATES.offline.action, "Try again");
    assert.equal(EMPTY_STATES.network.action, "Try again");
  });

  it("tells search, filters, and a missing trip apart", () => {
    assert.equal(catalogEmptyKind({ query: "oat milk", filtered: true }), "search");
    assert.equal(catalogEmptyKind({ query: "  ", filtered: true }), "filters");
    assert.equal(catalogEmptyKind({ query: "", filtered: false }), "shelf");
    assert.match(searchEmpty("milk & honey").body, /milk & honey/);
    assert.equal(tripStoreEmpty({ zipCode: "45202", stores: [] }), true);
    assert.equal(tripStoreEmpty({ zipCode: "45202", stores: [{ storeName: "Kroger" }] }), false);
    assert.equal(tripStoreEmpty({ zipCode: "", stores: [] }), false);
    assert.equal(tripStoreEmpty(null), false);
  });

  it("treats a dropped connection differently from a server error", () => {
    assert.equal(networkKind(new TypeError("Failed to fetch"), true), "network");
    assert.equal(networkKind(new TypeError("Failed to fetch"), false), "offline");
    assert.equal(networkKind(new Error("Browse failed (500)"), true), "");
    const abort = new Error("stopped");
    abort.name = "AbortError";
    assert.equal(networkKind(abort, true), "");
  });

  it("escapes the query and exposes the action to the keyboard", () => {
    const html = emptyStateMarkup(searchEmpty(`<img "`), escapeHtml, "status");
    assert.match(html, /role="status"/);
    assert.match(html, /data-empty-action="clear-search"/);
    assert.equal(html.includes("<img"), false);
    assert.match(html, /&lt;img/);
    const alert = emptyStateMarkup(emptyState("offline"), escapeHtml, "alert");
    assert.match(alert, /role="alert"/);
    assert.match(alert, /Try again/);
    const inner = emptyStateInner({ ...emptyState("shared"), action: "", bodyId: "share-empty-body" }, escapeHtml);
    assert.match(inner, /id="share-empty-body"/);
    assert.equal(inner.includes("<button"), false);
  });

  it("uses theme tokens so empty states follow dark mode", () => {
    const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
    const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
    assert.match(css, /\.empty-state\[hidden\]\s*\{\s*display:\s*none/);
    assert.match(css, /\.empty-state[\s\S]*background:\s*var\(--surface\)/);
    assert.match(css, /\.empty-state[\s\S]*color:\s*var\(--ink\)/);
    assert.match(html, /id="list-empty"/);
    assert.match(html, /id="alerts-empty"/);
    assert.match(html, /id="share-empty"/);
    assert.match(html, /No shared lists/);
    assert.match(html, /Your list is empty/);
    assert.match(html, /No price alerts/);
    const sheet = css.indexOf(".sheet {");
    assert.ok(sheet > 0);
    assert.match(css.slice(sheet, sheet + 240), /var\(--surface\)/);
    assert.match(css.slice(sheet, sheet + 240), /var\(--ink\)/);
  });
});
