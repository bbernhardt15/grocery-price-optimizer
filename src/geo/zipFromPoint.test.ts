import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { censusCoordinatesUrl, parseLatLng, zipFromCensus } from "./zipFromPoint";

describe("ZIP from a point", () => {
  it("rejects coordinates outside the valid range", () => {
    assert.deepEqual(parseLatLng("39.1", "-84.5"), { lat: 39.1, lng: -84.5 });
    assert.equal(parseLatLng("91", "0"), null);
    assert.equal(parseLatLng("0", "181"), null);
    assert.equal(parseLatLng("nope", "1"), null);
    assert.equal(parseLatLng("", ""), null);
  });

  it("reads a ZCTA from a Census geographies payload and ignores other numbers", () => {
    assert.equal(
      zipFromCensus({
        result: {
          geographies: {
            "Census Tracts": [{ GEOID: "39061000100", BASENAME: "1" }],
            "2020 Census ZIP Code Tabulation Areas": [{ ZCTA5CE20: "45202", GEOID: "45202" }],
          },
        },
      }),
      "45202"
    );
    assert.equal(zipFromCensus({ result: { geographies: {} } }), "");
    assert.equal(zipFromCensus(null), "");
  });

  it("asks Census for the point and does not put a secret in the URL", () => {
    const url = new URL(censusCoordinatesUrl(39.1031, -84.512));
    assert.equal(url.origin, "https://geocoding.geo.census.gov");
    assert.equal(url.searchParams.get("y"), "39.1031");
    assert.equal(url.searchParams.get("x"), "-84.512");
    assert.equal(url.searchParams.get("format"), "json");
  });
});
