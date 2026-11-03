/**
 * The tab Chrome on iPhone opens for a store handoff.
 * window.close() and opener postMessage are not available here.
 * The trip is shared through localStorage, IndexedDB, and BroadcastChannel.
 */

import { returnScreenCopy, TRIP_CHANNEL, writeTripDb } from "./tripSync.js";
import { handoffBridgePath, handoffResultRecord, readHandoffResult, safeHandoffUrl, writeHandoffResult } from "./chromeIos.js";

const params = new URLSearchParams(window.location.search);
const store = params.get("store") || "the store";
const kind = params.get("kind") || "store";
const next = safeHandoffUrl(params.get("next") || "", window.location.origin);
const record = handoffResultRecord(store, kind, { phase: "opened", url: next });

writeHandoffResult(localStorage, record);
void writeTripDb(typeof indexedDB !== "undefined" ? indexedDB : null, { handoff: record, savedAt: record.at, step: "plan", items: [] });
try {
  const channel = new BroadcastChannel(TRIP_CHANNEL);
  channel.postMessage(record);
  channel.close();
} catch {
  /* storage event still reaches the other tab */
}

const copy = returnScreenCopy(store, kind);
const title = document.getElementById("title");
const body = document.getElementById("body");
if (title) title.textContent = copy.title;
if (body) body.textContent = copy.body;
const go = document.getElementById("next");
if (go instanceof HTMLAnchorElement && next) {
  go.hidden = false;
  go.href = next;
  go.textContent = kind === "coupons" ? `Open ${store} coupons` : kind === "cart" ? `Open ${store} cart` : `Continue to ${store}`;
}

const viewport = window.visualViewport;
const apply = () => {
  if (!viewport) return;
  document.documentElement.style.setProperty("--vv-height", `${Math.round(viewport.height)}px`);
};
apply();
viewport?.addEventListener("resize", apply);

export { handoffBridgePath, readHandoffResult };
