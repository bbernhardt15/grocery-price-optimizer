import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { clearTripAction, CLEAR_TRIP_EVENT, completeTripAction, FINISH_TRIP_UNDO_MS } from "../../public/shopper/tripActions.js";
import {
  clearCompletedTrip,
  readCompletedAt,
  restoreActiveTrip,
  restoreWouldResurrect,
  writeCompletedTrip,
} from "../../public/shopper/tripCompletion.js";
import { mergeSavedStores, setShowAdStores, visibleStoreNames } from "../../public/shopper/storeScope.js";

function memory() {
  const bag = new Map<string, string>();
  return {
    getItem: (key: string) => bag.get(key) ?? null,
    setItem: (key: string, value: string) => {
      bag.set(key, value);
    },
    removeItem: (key: string) => {
      bag.delete(key);
    },
  };
}

describe("trip completion", () => {
  it("does not restore a trip that was already finished", () => {
    const storage = memory();
    const at = writeCompletedTrip(storage, 5_000);
    assert.equal(readCompletedAt(storage), 5_000);
    const finished = { items: [{ id: "milk", name: "Milk" }], savedAt: 4_000, plan: { total: 3 } };
    assert.equal(restoreWouldResurrect(finished, at), true);
    assert.equal(restoreActiveTrip(finished, { items: [{ id: "milk" }], at: 4_000 }, at), null);
    assert.equal(restoreWouldResurrect({ items: [{ id: "bread" }], savedAt: 6_000 }, at), false);
    assert.equal(restoreWouldResurrect({ items: [{ id: "milk" }] }, at), true);
    const idb = { items: [], plan: null, savedAt: at, completedAt: at };
    const handoff = { items: [{ id: "milk", name: "Milk" }], at: 1_000, savedAt: 1_000 };
    assert.equal(restoreActiveTrip(idb, handoff, at), null);
    clearCompletedTrip(storage);
    assert.equal(readCompletedAt(storage), 0);
    assert.equal(FINISH_TRIP_UNDO_MS, 4_500);
    assert.equal(clearTripAction().event, CLEAR_TRIP_EVENT);
    assert.equal(clearTripAction().label, "Clear trip");
    assert.equal(completeTripAction().label, "Save this trip");
    const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
    assert.match(app, /finishCurrentTrip/);
    assert.match(app, /id="clear-trip-open"/);
    assert.match(app, /data-complete-trip/);
    assert.match(app, /CLEAR_TRIP_EVENT/);
  });
});

describe("visible stores", () => {
  it("hides ad stores until the flag is on and keeps a saved hidden store", () => {
    setShowAdStores(false);
    assert.deepEqual(visibleStoreNames(["Kroger", "Target", "Aldi", "Walmart", "Costco", "Sam's Club", "Whole Foods", "Meijer"]), ["Kroger", "Walmart"]);
    assert.deepEqual(mergeSavedStores(["Kroger", "Walmart"], ["Target", "Kroger"], true), ["Kroger", "Walmart", "Target"]);
    assert.deepEqual(mergeSavedStores(["Kroger", "Walmart"], [], true), []);
    setShowAdStores(true);
    assert.ok(visibleStoreNames(["Target", "Aldi"]).includes("Target"));
    setShowAdStores(false);
  });
});
