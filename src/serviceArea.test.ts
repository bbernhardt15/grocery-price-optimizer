import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  eligibleCount,
  inServiceArea,
  OUT_OF_AREA_MESSAGE,
  PLAN_ZIP_ERROR,
  requirePlanZip,
  serviceAreaFor,
  zctaCount,
} from "./serviceArea";
import {
  OUT_OF_AREA_MESSAGE as clientMessage,
  serviceAreaFor as clientArea,
} from "../public/shopper/serviceArea.js";

describe("service area", () => {
  it("loads the 10-mile Kroger and Walmart allow-list", () => {
    assert.equal(eligibleCount, 6443);
    assert.equal(zctaCount, 33791);
    assert.match(OUT_OF_AREA_MESSAGE, /isn’t available in your area yet/);
    assert.match(OUT_OF_AREA_MESSAGE, /Kroger-family store and a Walmart nearby/);
    assert.equal(clientMessage, OUT_OF_AREA_MESSAGE);
  });

  it("accepts an in-area ZCTA and a ZIP+4 of that ZCTA", () => {
    assert.deepEqual(serviceAreaFor("45202"), { ok: true, zip: "45202", via: "zcta" });
    assert.deepEqual(serviceAreaFor("45202-1234"), { ok: true, zip: "45202", via: "zcta" });
    assert.equal(inServiceArea("45103"), true);
    assert.equal(inServiceArea(45202), true);
  });

  it("blocks Maine and Vermont ZCTAs that have no Kroger nearby", () => {
    assert.deepEqual(serviceAreaFor("04101"), { ok: false, zip: "04101", reason: "out_of_area" });
    assert.deepEqual(serviceAreaFor("05401"), { ok: false, zip: "05401", reason: "out_of_area" });
    assert.equal(inServiceArea("04101"), false);
  });

  it("allows a non-ZCTA ZIP in an eligible 3-digit prefix and blocks one that is not", () => {
    const poBox = serviceAreaFor("45201");
    assert.deepEqual(poBox, { ok: true, zip: "45201", via: "zip3" });
    assert.equal(serviceAreaFor("04100").ok, false);
    assert.equal(serviceAreaFor("04100").reason, "out_of_area");
  });

  it("keeps a known out-of-area ZCTA blocked when its prefix also has an eligible ZIP", () => {
    let blocked = "";
    for (let n = 0; n < 100000 && !blocked; n += 1) {
      const zip = String(n).padStart(5, "0");
      const area = serviceAreaFor(zip);
      if (area.ok || area.reason !== "out_of_area") continue;
      const prefix = zip.slice(0, 3);
      for (let suffix = 0; suffix < 100; suffix += 1) {
        const neighbor = serviceAreaFor(`${prefix}${String(suffix).padStart(2, "0")}`);
        if (neighbor.ok && neighbor.via === "zcta") {
          blocked = zip;
          break;
        }
      }
    }
    assert.notEqual(blocked, "");
    assert.equal(serviceAreaFor(blocked).reason, "out_of_area");
  });

  it("requires a 5-digit in-area ZIP before a plan", () => {
    assert.deepEqual(requirePlanZip(undefined), { ok: false, status: 400, error: PLAN_ZIP_ERROR });
    assert.deepEqual(requirePlanZip(""), { ok: false, status: 400, error: PLAN_ZIP_ERROR });
    assert.deepEqual(requirePlanZip("   "), { ok: false, status: 400, error: PLAN_ZIP_ERROR });
    assert.deepEqual(requirePlanZip("4520"), { ok: false, status: 400, error: PLAN_ZIP_ERROR });
    assert.deepEqual(requirePlanZip("abc"), { ok: false, status: 400, error: PLAN_ZIP_ERROR });
    const maine = requirePlanZip("04101");
    assert.equal(maine.ok, false);
    if (maine.ok) throw new Error("expected an out-of-area ZIP");
    assert.equal(maine.status, 422);
    assert.equal(maine.code, "not_in_service_area");
    assert.deepEqual(requirePlanZip("45202"), { ok: true, zip: "45202" });
    assert.deepEqual(requirePlanZip("45202-1234"), { ok: true, zip: "45202" });
    assert.deepEqual(requirePlanZip(45202), { ok: true, zip: "45202" });
  });

  it("the phone plan request includes zipCode", () => {
    const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
    const call = app.slice(app.indexOf('"/api/optimize-list"'));
    assert.match(call.slice(0, 600), /zipCode:\s*zip/);
  });

  it("does not treat a blank or partial ZIP as in the service area", () => {
    assert.deepEqual(serviceAreaFor(""), { ok: false, zip: "", reason: "blank" });
    assert.deepEqual(serviceAreaFor("   "), { ok: false, zip: "", reason: "blank" });
    assert.equal(serviceAreaFor("4520").reason, "invalid");
    assert.equal(serviceAreaFor("abc").reason, "invalid");
    assert.equal(inServiceArea(""), false);
    assert.equal(inServiceArea("0410"), false);
  });

  it("matches the phone module for every ZIP", () => {
    for (let n = 0; n < 100000; n += 1) {
      const zip = String(n).padStart(5, "0");
      assert.deepEqual(clientArea(zip), serviceAreaFor(zip));
    }
    assert.deepEqual(clientArea(""), serviceAreaFor(""));
    assert.deepEqual(clientArea("45202-9999"), serviceAreaFor("45202-9999"));
  });
});
