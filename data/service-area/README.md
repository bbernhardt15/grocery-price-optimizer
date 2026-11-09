# Service area

Grocery Gitter plans trips only where a Kroger-family store and a Walmart grocery store (Supercenter or Neighborhood Market) are both within 10 miles of the ZIP's Census center.

## Source

`eligible_zips_10mi.csv` is the allow-list (6,443 ZIPs). Columns: `zip`, `state`, `nearest_kroger_banner`, `kroger_miles`, `walmart_miles`, `population`, plus nearest-store refs. It was built from:

- Kroger-family stores: All The Places `kroger_us` (run 2026-10-17), with Harris Teeter from the 2026-05-23 run and Ruler Foods from `ruler_foods_us` (2026-10-31). Fuel centers, pharmacies, and clinics are excluded. Harris Teeter and Ruler Foods stay in this list.
- Walmart: All The Places `walmart_us`, Supercenter and Neighborhood Market only.
- ZIP centers: US Census 2025 Gazetteer ZCTA internal points.
- Population on the CSV is ACS 2019–2023 and is not used by the app.

Distances are straight-line miles from the ZCTA center, not driving miles. The Kroger Locations API also defaults to a 10-mile radius, so this list matches the lookup the app already makes.

## Runtime files

`scripts/build-service-area.mjs` turns the CSV into two bitsets (eligible ZIPs, and every Census ZCTA):

- `src/serviceAreaData.ts`
- `public/shopper/serviceAreaData.js`

Regenerate after replacing the CSV:

```
node scripts/build-service-area.mjs
node scripts/build-service-area.mjs --gazetteer /path/to/2025_Gaz_zcta_national.txt
```

Without `--gazetteer`, the script downloads the 2025 national ZCTA gazetteer from the Census Bureau. The raw gazetteer is not committed.

## ZIPs that are not ZCTAs

PO-box and unique ZIPs are not in the Census ZCTA file, so they have no center to measure. Blocking every ZIP that is missing from the 6,443-row list would reject those, including a downtown PO box next to stores we already serve.

The gate treats a 5-digit ZIP like this:

1. If it is on the allow-list, it is in the service area.
2. If it is a Census ZCTA and it is not on the allow-list, it is out of area. A neighbor in the same 3-digit prefix does not pull it in.
3. If it is not a Census ZCTA, it is in the service area only when at least one eligible ZCTA shares its 3-digit prefix (the same sectional center). Otherwise it is out of area.

Example: `45202` (downtown Cincinnati) is on the list. `45201` is a Cincinnati PO box with no ZCTA, and prefix `452` has eligible ZCTAs, so it is allowed. `04101` (Portland, Maine) and `05401` (Burlington, Vermont) are ZCTAs with no Kroger-family store nearby, so they are blocked.

A blank ZIP is not in the service area. The phone asks for a 5-digit ZIP and will not build a plan until one is in the area. Skipping the rest of onboarding does not save a blank ZIP as served.

## Shoppers

An out-of-area ZIP, including one already saved on the phone, shows: "Grocery Gitter isn’t available in your area yet — we need a Kroger-family store and a Walmart nearby." The plan is not built. Every route that returns a store price, offer, bestPrice, or store status requires a 5-digit in-area ZIP: missing or malformed is `400`, out of area is `422` with `code: "not_in_service_area"`. `GET /api/search-catalog` stays open and returns name and brand only.
