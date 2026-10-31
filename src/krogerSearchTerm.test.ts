import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildKrogerSearchTerm, shorterKrogerSearchTerm } from "./krogerSearchTerm";

const KATZ =
  "Katz Gluten Free Gingerbread Donuts |Gluten Free, Dairy Free, Nut Free, Soy Free, Kosher | (3 Pack, 10.5 Ounce Each)";
const DISHWASHER =
  "208-240V High-Temp Undercounter Commercial Dishwasher/Glasswasher Built-In Booster, 30 inch door";
const CHEF = "(12 pack) Chef Boyardee Beefaroni Pasta, 15 oz";

describe("Kroger search terms", () => {
  it("keeps brand plus the core name and drops pipes, packs, and claim text", () => {
    assert.equal(buildKrogerSearchTerm(KATZ), "Katz Gingerbread Donuts");
    assert.equal(buildKrogerSearchTerm(CHEF), "Chef Boyardee Beefaroni Pasta");
    assert.equal(buildKrogerSearchTerm("milk"), "milk");
    assert.equal(buildKrogerSearchTerm("Cheerios"), "Cheerios");
    const machine = buildKrogerSearchTerm(DISHWASHER);
    assert.ok(machine);
    assert.doesNotMatch(machine, /[|/®™()]|\d{3}\s*-\s*\d{3}\s*v/i);
    assert.ok(machine.split(/\s+/).length <= 8);
    assert.match(machine, /Dishwasher/);
  });

  it("offers one shorter retry that is not the same term", () => {
    const primary = buildKrogerSearchTerm(KATZ) || "";
    assert.equal(shorterKrogerSearchTerm(KATZ, primary), "Katz Gingerbread");
    const machine = buildKrogerSearchTerm(DISHWASHER) || "";
    const shorter = shorterKrogerSearchTerm(DISHWASHER, machine);
    assert.ok(shorter);
    assert.notEqual(shorter?.toLowerCase(), machine.toLowerCase());
    assert.ok((shorter || "").split(/\s+/).length <= 4);
    assert.equal(shorterKrogerSearchTerm("milk", "milk"), null);
  });
});
