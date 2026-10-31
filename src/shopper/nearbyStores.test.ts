import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { knownStoreNames } from "../../public/shopper/tripPlan.js";
import { milesBetween, stateForZip, storesForZip } from "../../public/shopper/nearbyStores.js";

describe("stores near a ZIP", () => {
  it("includes Costco, Meijer, and Kroger around Cincinnati and leaves Publix out", () => {
    assert.equal(stateForZip("45202"), "OH");
    const nearby = storesForZip("45202");
    assert.equal(nearby.source, "nearby");
    assert.ok(nearby.stores.includes("Costco"));
    assert.ok(nearby.stores.includes("Kroger"));
    assert.ok(nearby.stores.includes("Walmart"));
    assert.ok(nearby.stores.includes("Target"));
    assert.ok(nearby.stores.includes("Aldi"));
    assert.ok(nearby.stores.includes("Sam's Club"));
    assert.ok(nearby.stores.includes("Meijer"));
    assert.equal(nearby.stores.includes("Publix"), false);
    assert.equal(nearby.stores.includes("H-E-B"), false);
    assert.ok(nearby.stores.length < knownStoreNames().length);
    assert.equal(nearby.stores.includes("Giant Eagle"), false);
    assert.match(nearby.note, /25/);
  });

  it("leaves Giant Eagle off Batavia and keeps it in Columbus and Pittsburgh", () => {
    const batavia = storesForZip("45103");
    assert.equal(batavia.source, "nearby");
    assert.equal(batavia.stores.includes("Giant Eagle"), false);
    assert.ok(batavia.stores.includes("Kroger"));
    assert.ok(batavia.stores.includes("Meijer"));
    assert.ok(batavia.stores.includes("Walmart"));
    assert.ok(batavia.stores.includes("Target"));
    assert.ok(milesBetween([39.0916, -84.1437], [39.9612, -82.9988]) > 25);
    assert.ok(storesForZip("43215").stores.includes("Giant Eagle"));
    assert.ok(storesForZip("15222").stores.includes("Giant Eagle"));
    assert.equal(storesForZip("19103").stores.includes("Giant Eagle"), false);
    assert.doesNotMatch(batavia.note, /every chain/i);
  });

  it("includes Publix in Miami and H-E-B in Houston", () => {
    const miami = storesForZip("33101");
    assert.ok(miami.stores.includes("Publix"));
    assert.ok(miami.stores.includes("Costco"));
    assert.equal(miami.stores.includes("Meijer"), false);
    const houston = storesForZip("77002");
    assert.ok(houston.stores.includes("H-E-B"));
    assert.ok(houston.stores.includes("Costco"));
    assert.equal(houston.stores.includes("Meijer"), false);
  });

  it("falls back to every chain, including Costco, when the ZIP is blank or unknown", () => {
    const blank = storesForZip("");
    assert.equal(blank.source, "fallback");
    assert.deepEqual(blank.stores, knownStoreNames());
    assert.ok(blank.stores.includes("Costco"));
    assert.match(blank.note, /ZIP/i);
    const unknown = storesForZip("00000");
    assert.equal(unknown.source, "fallback");
    assert.ok(unknown.stores.length > 0);
    assert.match(unknown.note, /every chain/i);
  });
});
