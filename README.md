# Grocery Gitter

The product is **Grocery Gitter**. This GitHub repository’s slug remains `grocery-price-optimizer` (npm package id: `grocery-list-optimizer`).

Node.js Express backend (TypeScript) that maps each grocery item to the store selling it at the lowest price, then groups the shopping trip by store so you can actually buy the split cart. The shopper UI in `public/` is a mobile-first browse app (department shelves, search, filters, a persistent list, then the same trip plan).

## Browse the shelves

Open `/` and shop by department instead of typing a list first.

- **Departments** — Produce, Dairy & Eggs, Meat & Seafood, Bakery, Deli, Pantry, Frozen, Snacks, Beverages, Breakfast, Baby, Household, Personal Care, Pet
- **Product cards** — image (or a generated placeholder), name, size, best price and store, sale badge, checkbox, quantity stepper
- **Search** — debounced typeahead over the cached catalog, with the match highlighted and brand, department, size, and price when the shelf has them. Arrow keys, Enter, and Escape work. Submitting search refreshes from configured providers (cached)
- **Sort / filter** — relevance, lowest price, lowest unit price, name, on sale first; department, store, brand, size class, price range, on sale, store brand
- **My list** — saved in the browser, with a live estimated total and a savings meter versus the most expensive store that can fill the list
- **Price alerts** — opt in on My list, or on a single item. A badge and an Alerts panel show when the best price drops. See [Price drop alerts](#price-drop-alerts)
- **Theme** — light, dark, or match this device. The choice is remembered in the browser and applied before the first paint so dark mode does not flash pure black
- **Substitutes** — when a UPC is missing at a store, the closest same-department item is labeled **Substitute**, never as an exact match. **Allow substitutes in the trip plan** lets that item compete on price
- **Plan the trip** — `POST /api/optimize-list` with the selected `catalogId`s. Checkout handoffs are unchanged (Kroger, Walmart add-to-cart, Instacart when configured)
- **ZIP** — remembered in `localStorage`

`GET /api/search-catalog` (FatSecret autocomplete) still works. The browse API is separate:

| Route | Purpose |
| --- | --- |
| `GET /api/catalog/departments` | Shared department tree |
| `GET /api/catalog/browse` | Filter, sort, paginate (`cursor` is the next offset) |
| `GET /api/catalog/suggest?q=` | Typeahead. Does **not** call retailer APIs |
| `GET /api/catalog/products/:id` | One grouped product plus per-store substitute gaps |
| `GET /api/catalog/coverage` | Honest per-store catalog coverage |
| `GET /api/catalog/placeholder.svg` | Local placeholder image |

Offers that share a UPC (leading zeros ignored) become one product. Package size still uses `parsePackageSize` / `formatUnitPrice`.

### Catalog coverage (do not treat every shelf as live)

| Store | Browse source when keys are set | Without keys |
| --- | --- | --- |
| **Walmart** | Affiliate `GET /taxonomy` plus the first page of `GET /paginated/items?category=`. If that is empty, a few search terms via `GET /search`. Prices are **walmart.com catalog**, not the nearest store's shelf. Not the full assortment. Cached 6 hours. | Demo catalog, badged **Demo** |
| **Kroger** | **No category browse.** Each department runs two seeded `filter.term` searches. Hits are classified with the `categories` field when Products returns one, otherwise the product name. A sample of the aisle, not the full Kroger catalog. Nearest store when a ZIP is set. | Demo catalog |
| **Target** | No public taxonomy. A licensed `TARGET_PARTNER_*` feed is searched with the same seed terms and labeled partner, not a full catalog. With `FLIPP_ENABLED` and a ZIP, browse/search also show this week's circular, labeled **Weekly ad**. | Demo catalog until Flipp or a partner feed is set |
| **Aldi** | No catalog API. With `FLIPP_ENABLED` and a ZIP, browse/search show circular items labeled **Weekly ad**. | Demo catalog. Trip planning uses the same circular when a ZIP is set |
| **Partner banners** | Search-by-term stub when that feed's env vars are set. Unconfigured banners are omitted. | Not shown as a live catalog |

Demo UPCs are synthetic (`009999…`) so they do not merge with a real retailer code. Live rows win over a demo row for the same store and UPC. Department and search responses are cached in memory and in Mongo (`CatalogCache`, TTL index). Override with `CATALOG_DEPT_TTL_MINUTES` (default 360) and `CATALOG_SEARCH_TTL_MINUTES` (default 60).

When `CATALOG_INGEST_ENABLED` or `CATALOG_DB_FIRST` is on and Mongo already has catalog rows, browse, typeahead, filters, sort, substitutes, and the trip optimizer read that database first. A live provider call runs only when the database has nothing for that shelf or line, and the result is written back. Aldi and Target are not ingested. When Flipp is on, browse still merges that ZIP's weekly-ad items on top of the saved catalog and does not delete or rewrite ingest rows. The one-page Walmart sample and the two-term Kroger sample above are the fallback while the database is empty.

## Catalog ingestion

A background job fills `CatalogMaster` (one row per UPC) and `CatalogOffer` (one price per store and, for Kroger, per location). Restarts continue from the checkpoint. Upserts are idempotent. Items not seen for `CATALOG_STALE_DAYS` (14) are marked stale; after `CATALOG_DISCONTINUE_DAYS` (45) they are discontinued and drop off the shelf. Images stay on the master.

### What each provider can actually fill

Checked 2026-09-25.

| Provider | Browse mechanism | Published limit | Job budget (defaults) |
| --- | --- | --- | --- |
| **Walmart Affiliate** | `GET /taxonomy`, then `GET /paginated/items?category=&count=25`. The next page is the response `nextPage` (URL or cursor). Stop when `nextPage` is empty or `nextPageExist` is false. Only grocery leaves are walked. Jewelry, office, home improvement, apparel, electronics, toys, furniture, pet accessories, health devices, and Industrial & Scientific (except janitorial and food-service disposables) are not crawled. UPC is read from `upc` or `gtin` (string or number) so a row can share a Kroger master. | The public Affiliate introduction and taxonomy pages do **not** publish a numeric daily quota. Marketplace rate-limit tables are a different API and are not used here. HTTP **429** is the throttle. Search documents `numItems` max 25, so each catalog page asks for 25. | **500 calls/day**, at least **10 seconds** apart, and that gap is kept across scheduler ticks. The 500 figure is a hard ledger for the crawler only. Shopper searches are not charged and are not blocked. |
| **Kroger Products** | No category browse. `GET /v1/products` with `filter.term`, optional `filter.brand`, `filter.locationId`, `filter.start`, and `filter.limit`. A full page advances `filter.start`. A short page ends the term. `filter.start` is a skip count: the first page omits it (checkpoint `start` 0). Kroger accepts a sent value only from **1 to 250** (PRODUCT-2021). The crawl stops at 250 and, for a broad term, continues with `filter.brand` or a narrower term instead of sending 300. A **400** ends that term (it is not retried). Three 400s in a row on the same `locationId` skip that store. | **10,000 product calls/day**. **1,600 location calls/day**. Locations documents `filter.limit` max **200**; this job asks for **50**. | **4,000 product calls/day** (6,000 left for shoppers and on-demand refresh), **200 location calls/day**, at least **500 ms** apart. |
| **Kroger prices** | Stored per `locationId`. The product master is written once, keyed by UPC with leading zeros stripped (UPC-A, EAN-13, and GTIN-14 of the same code share one master). The offer key is product + store + location, so six seed stores are six offers. | — | Seed ZIPs `45103` (Brandon), `10001`, `60601`, `75201`, `90012`, `30303`, plus up to 12 ZIPs that real shoppers have used (`hits` > 0). Seeds are not written into the shopper-ZIP list. A new shopper ZIP is priced on the next tick (inserted in front of the Kroger walk). A finished cycle starts again after `CATALOG_REFRESH_HOURS` (24). Ingest never substitutes the demo location id `01400441` when a ZIP lookup fails. |
| **Target, Aldi, other banners** | No catalog ingestion. | — | Demo shelf, plus Flipp weekly ads on browse and the trip when `FLIPP_ENABLED` and a ZIP are set. |

A Walmart **429** keeps the same category and `nextPage`, sets status to paused, and waits 15 minutes, then 30. The response's Retry-After header, any rate-limit headers, and the body are stored on that error. One successful page does not clear the strike count; three clean pages in a row do. A third 429 stops Walmart ingest until the next UTC midnight, or for six hours when that is longer. The next tick does not call Walmart until that time, then it resumes the same page. Other 5xx responses still use a short backoff (1s, 2s, 4s, … capped at 60s) and, after 5 failures, skip that category. A Kroger **400** is logged with provider, status, term, brand, start, limit, locationId, and ZIP (no secrets) and that term is skipped. `runs[].calls` counts each HTTP call once. `budget.*.used` / `budget.*.limit` is the daily ledger. Read the ledger for the cap; the run counter is only a progress total. Shopper searches never touch this ledger.

The first production day (2026-09-25) showed `runs.walmart.calls` 2,712 against `budget.walmart.used` 1,137, and `runs.kroger.calls` 149 against `budget.kroger.used` 81 plus 6 location calls. Taxonomy, `nextPage`, and retries were already charged; the run counter was the number that ran ahead, because each page save added the tick's running total again (a 4-call tick adds 10). Walmart returned 429 at about 1,137 charged calls, under the 1,500 cap, because the 2 second burst was too fast. Every ingest HTTP call now starts in one function, `chargeCall`, which consumes the ledger and increments the run counter together. Shopper searches are still not charged and are not blocked.

`offers` and `byStore` count distinct offer documents. On that snapshot Kroger 2,803 + Walmart 10,205 = 13,008 offers = 13,008 products, so each master had one offer and nothing had merged across stores. `upserted` counts writes, including the inflated counter, so it can be higher than the number of Kroger documents. Walmart's 12-digit UPC-A includes a check digit. Kroger's 13-digit `upc` / `productId` does not (the last digit fails the GTIN check). The key drops a valid check digit, then strips leading zeros, so those two codes match. A numeric Walmart `upc` is read as well.

Department counts were piled into pantry, with bakery, frozen, snacks, and breakfast at 0. Two things did that. Walmart's taxonomy `path` is often just `Food` on every child, and any leaf that did not match a rule was forced to pantry, which then overrode the item's own category path. Kroger was also still on the first store (`locationIndex` 0, `queryIndex` 21 of a list that reaches bakery and frozen later). Mapping now walks the full path from the leaf upward, and a stored category path wins over that pantry fallback. A later `Pantry` segment does not beat an earlier specific aisle (`Food/Breakfast Foods/Cereal` stays breakfast). Kroger labels such as Snacks, Frozen, Pet Care, Baby, and Cleaning Products map to those departments. Canned & Packaged, Condiments & Sauces, Baking Goods, Pasta, Sauces, Grain, and International stay pantry. A lone `Pantry` label does not override the search term when the product name does not name a department. `errors[]` for a Kroger 400 includes the term, brand, start, limit, locationId, ZIP, and the response body. Seed ZIPs are no longer written into `shopperZips`. Existing Mongo rows are kept. See the cleanup section below before deleting anything.

On 2026-09-29 the catalog sat at the 40,000 product cap (pantry about half of that), Walmart had about 23.6k offers, and `drop-shadow-local-keys` deleted nothing. New Walmart UPCs were refused, including the upgrade of an existing `local:walmart:{itemId}` row into the UPC master, so no UPC sibling existed for that cleanup to find. That upgrade is now an in-place rename and does not count against the cap. The default caps are 150,000 masters and 500,000 offers. `counts.masters` on the status route splits local Walmart keys, Kroger-only UPCs, Walmart UPCs, and rows that carry both store ids.

Grocery baby is diapers, wipes, training pants, pull-ups, infant or baby formula, and baby food. A bare `Baby` label does not keep a product in baby. Feeding gear (bottles, bottle brushes, pumps, sippy cups, plates, food makers, nursing covers, wipe warmers), nursery, travel, activities, resale, and shop-by-brand leaves map to Other and are not crawled. A bottle brush stays Other even when Walmart files it under Baby Wipes, because the name is gear. Baby carrots, baby spinach, and baby back ribs still follow the food name. Recategorize writes every department change, including a move to Other, and does not delete rows.

Other is the general-merchandise aisle (`generalMerchandise: true` on that department). Shopper browse and search hide it unless the request asks for `department=other`. The department chips hide it too. Vitamins and supplements, digestive health, consumable first aid (isopropyl alcohol, bandages), OTC pain relievers, diabetic test strips, and teething pain relief map to personal care, subcategory Health. There is no separate health department. A product name moves to that same Health subcategory even when the stored path is Letter Vitamins, Vitamin B Complex, Health and Medicine, or general merchandise. The name match is vitamin, multivitamin, B-complex, supplement, probiotic, fish oil, melatonin, or electrolyte. Omega-3 counts when the name also has a dosage form, the word supplement, fish oil, or a supplement brand. Nature Made, Nature's Bounty, Centrum, One A Day, Olly, Vitafusion, Nordic Naturals, and Garden of Life count when the name also says tablets, capsules, softgels, gummies, caplets, or chewables. Pill organizers stay Other. A serum, including vitamin C serum, is personal care, subcategory Body. Books, testosterone, health devices, infant formula, nutrition shakes, and pet medicines stay on their own rules. Leaves named Letter Vitamins or Vitamin B Complex are crawled. Walmart taxonomy version 5 re-reads the tree so those leaves are picked up. A product under Baby/Health stays Other unless the name itself is one of those consumables (teething relief, Tylenol). The Health and Medicine aisle is what maps vitamins and OTC medicine. Massage guns, shower chairs, air purifiers, sound machines, sleep masks, hot and cold packs, and testosterone boosters stay Other. Ensure and other nutrition shakes or powders map to beverages. Pet food, treats, litter, and bedding (including cedar bedding) map to pet. Pet toys, wheels, aquarium ornaments, and feeders stay Other. Food gifts, gift towers, and gift baskets map to pantry, subcategory Gifts. Swiffer dusters, janitorial cleaners, and food-service disposables such as Dixie cup lids map to household. Jewelry, office supplies, home improvement, apparel, electronics, toys, furniture, and the rest of Industrial & Scientific stay Other and are not crawled. Kroger category labels for those grocery aisles map to a grocery department. A Kroger id on a product that is still Other is almost certainly a miss: Kroger's catalog is groceries.

`GET /api/admin/catalog/other-breakdown` returns the top stored category paths in Other (Walmart `categoryPath` or Kroger `categories`), a count, and three example names, plus `withKrogerId`. `GET /api/admin/catalog/sample?department=baby&limit=50` returns a random compact sample (name, brand, stores, paths, stored department, the department the current rules would pick, and the rule). `GET /api/admin/catalog/match-sample` returns a few normalized keys from each store. `counts` on status includes `match` lookups, `refreshQueue` (Walmart and Kroger offers still waiting), and `refreshedToday`. `match.queue` is how many masters are still waiting on a cross-store lookup, `match.hitRate` is today's hits over attempts, and `match.mergedToday` is how many masters gained both store ids that UTC day.

The same product already shares one key when both stores have sent a code: Walmart UPC-A (12 digits, check digit), EAN-13, GTIN-14, and Kroger's 13-digit code with no check digit. A numeric Walmart `upc` that dropped a leading zero is padded back when that restores a valid check digit. A UPC-E (8 digits, number system 0 or 1) expands to that same UPC-A before the key is built, so the short code and the long code land on one master. Most masters still have only one store id because each crawl saw a different set of products, not because the keys disagree.

Cross-store lookup and stale-offer refresh share the existing daily budgets and the Walmart 429 pause. `CATALOG_MATCH_LOOKUP_SHARE` (default `0.5`) is the fraction of each Walmart tick and each Kroger tick spent on lookups. `CATALOG_REFRESH_SHARE` (default `0.3`) is the fraction spent re-pricing the oldest stale offers. With the default batch of 4 calls, that is 2 lookup calls, 1 refresh call, and 1 discovery call. Lookup is reserved first. When a queue is empty, that tick's remaining calls go back to discovery. Walmart sends up to 20 UPCs on one `GET /items?upc=` (`WALMART_LOOKUP_BATCH`, default 20, the same cap as the Affiliate `ids` list). Kroger still takes one `filter.productId` per call. That id is 13 digits: drop the UPC-A check digit and left-pad, including when the stored digit fails the GS1 check. `070708200500` becomes `0007070820050`, `003063880160` becomes `0000306388016`, and `073214835404` becomes `0007321483540`. A 12-digit or 14-digit pad is not sent. If that id returns HTTP 400 or no rows, the same lookup tries `filter.term` with the product name and keeps a row only when the UPC or product id matches. A 400 on a lookup or that name search is a miss: it does not pause the crawl and it does not add to the three-in-a-row location skip, which still applies to discovery searches. For lookups, staples are first, and a product on a shopper's saved list or in a recent search or recent priced result goes ahead of the aisle. For refresh, the order is saved lists, shared lists, price-alert watches, recent searches, then merged products, then the oldest stale offer. Walmart still tries the 12-digit UPC-A, then EAN-13, then GTIN-14. A lookup miss is tried again after `CATALOG_MATCH_RETRY_DAYS` (default 14). A refresh miss waits a day and does not delete the offer. A 400 on a multi-UPC Walmart call switches that crawl cycle to one UPC at a time and does not burn the batch. A new Walmart taxonomy version re-reads the category tree once so general-merchandise leaves drop out and grocery leaves are walked. Production logged 1,220 Kroger match attempts and 3 hits while those calls were still sending the 12-digit UPC. That 0.2% rate was invalid ids, not assortment overlap. With the 13-digit id, the hit rate should track how many of those UPCs Kroger sells at the queried store. National grocery brands are often tens of percent. Walmart-only and store-brand items still miss.

### Size and time

At the default caps (150,000 products, 500,000 offers) the estimate is about **1.2 KB × products + 0.4 KB × offers**, roughly **380 MB** of documents, and often about the same again for indexes, so plan on **about 760 MB**. New UPCs and offers are refused at the cap. Prices for keys already stored still refresh. Renaming `local:walmart:{itemId}` onto that item's UPC reuses the same master and does not count as a new product.

Walmart: 500 calls × 25 items is at most ~12,500 rows per day, and the 10 second gap is about 80 minutes of call time, spread by the scheduler. A grocery taxonomy of ~1,000 leaves is several days at this budget. Kroger: 6 locations × the term list × pages that stop at `filter.start` 250. A full page past that ceiling splits the term by brand (up to 6) instead of requesting start 300. The term list is `src/ingest/krogerTerms.ts` (`KROGER_TERMS_VERSION`). Bump the version when the list changes so a resume does not skip ahead.

Without Walmart and Kroger keys, `CATALOG_INGEST_ENABLED=true` loads the demo catalog once (or run `npm run ingest:demo`).

### Railway setup

Recommended: a second service so the crawl is not tied to web deploys. One service also works.

1. Use the same repo and the same `MONGO_URL` as the web service.
2. **Web service** variables:
   - `CATALOG_DB_FIRST=true` so browse and trip planning read Mongo.
   - `CATALOG_INGEST_ENABLED=false` so the web process does not crawl.
   - `ADMIN_TOKEN` set to a long random string.
   - Existing `WALMART_CONSUMER_ID`, `WALMART_PRIVATE_KEY`, optional `WALMART_KEY_VERSION` / `WALMART_PUBLISHER_ID`.
   - Existing `KROGER_CLIENT_ID` and `KROGER_CLIENT_SECRET`.
   - Optional price-alert Web Push: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and optional `VAPID_SUBJECT`. Set the same values on the ingest worker. Leave them unset to keep alerts in the app only. Generate a pair with `npx web-push generate-vapid-keys` (steps under Price drop alerts).
   - `FLIPP_ENABLED=true` on the web service so Target, Aldi, and the other mapped circulars load for a shopper ZIP. Do not set it only on the ingest worker. Leave `FLIPP_ACCESS_TOKEN` empty unless Flipp issued a FlyerKit token. See “Verify weekly ads (Railway)” below.
3. **New service** (empty start command override):
   - Start command: `npm run ingest`
   - `CATALOG_INGEST_ENABLED=true`
   - Same `MONGO_URL` and the same Walmart and Kroger keys.
   - Do not set `PORT` handling; the process does not serve HTTP. It loops until Railway sends SIGTERM, then the next boot resumes the checkpoint.
4. Optional on that worker: `WALMART_INGEST_DAILY_BUDGET`, `KROGER_INGEST_DAILY_BUDGET`, `KROGER_LOCATION_DAILY_BUDGET`, `WALMART_INGEST_MIN_INTERVAL_MS`, `KROGER_INGEST_MIN_INTERVAL_MS`, `CATALOG_INGEST_INTERVAL_SECONDS` (20), `CATALOG_INGEST_BATCH_CALLS` (4), `CATALOG_MATCH_LOOKUP_SHARE` (0.5), `CATALOG_REFRESH_SHARE` (0.3), `CATALOG_MATCH_RETRY_DAYS` (14), `WALMART_LOOKUP_BATCH` (20), `CATALOG_SEED_ZIPS`, `CATALOG_MAX_PRODUCTS`, `CATALOG_MAX_OFFERS`, `CATALOG_STALE_DAYS`, `CATALOG_DISCONTINUE_DAYS`, `CATALOG_REFRESH_HOURS`, `WALMART_INGEST_ENABLED`, `KROGER_INGEST_ENABLED`.
5. Single-service alternative: set `CATALOG_INGEST_ENABLED=true` on the web service only. `src/index.ts` starts an in-process timer. A Mongo lock stops a second replica from crawling at the same time. Checkpoints still resume after a restart.
6. Progress: `curl -H "Authorization: Bearer $ADMIN_TOKEN" https://grocery-price-optimizer-production.up.railway.app/api/admin/catalog/status`  
   The JSON has counts per store and department, `counts.masters` (local Walmart keys, Kroger-only, Walmart UPC, merged), `counts.refreshQueue` and `counts.refreshedToday` (stale offers still waiting, and how many prices refresh wrote today), `match.queue` (masters still waiting on a Walmart or Kroger lookup), `match.hitRate` (today's hits and attempts), `match.mergedToday`, `refresh.share`, checkpoint phase, `budget.walmart.used` / `limit` (and the same for Kroger), `cooldownUntil` after a 429, and `errors[]` with provider, status, params, body, rate-limit headers, and timestamp. `shopperZips` is real demand (`hits` > 0). `seedZips` and `seedLocations` are the configured metros. The route returns 503 until `ADMIN_TOKEN` is set and 401 when the token is wrong.
   The next lookup batch, without spending a call: `curl -H "Authorization: Bearer $ADMIN_TOKEN" https://grocery-price-optimizer-production.up.railway.app/api/admin/catalog/match-queue`
   Other paths, without spending a call: `curl -H "Authorization: Bearer $ADMIN_TOKEN" https://grocery-price-optimizer-production.up.railway.app/api/admin/catalog/other-breakdown`
7. Redeploy after this catalog fix. No new variable is required. On the service that crawls, delete `WALMART_INGEST_DAILY_BUDGET` or set `500` (a saved `1500` still overrides the new default). Delete `WALMART_INGEST_MIN_INTERVAL_MS` or set `10000` (a saved `5000` or `2000` still overrides the new 10 second default). Delete `CATALOG_MAX_PRODUCTS` or set `150000`, and delete `CATALOG_MAX_OFFERS` or set `500000`, if those were pinned to the old caps. Shopper traffic is unchanged.
8. Existing products and offers stay. Do not drop the database. The crawl resumes from the checkpoint. Nothing below runs on boot. Each POST is refused unless the JSON body carries the exact `confirm` string.
   - Read a random sample before remapping. `department` is a department id (`baby`, `household`, `pantry`, …) and `limit` is at most 50:  
     `curl -H "Authorization: Bearer $ADMIN_TOKEN" "https://grocery-price-optimizer-production.up.railway.app/api/admin/catalog/sample?department=baby&limit=50"`
   - Read a few normalized keys from each store (`krogerId` is 13 digits, `walmartUpc` is 12 with the check digit, `key` should match for the same product):  
     `curl -H "Authorization: Bearer $ADMIN_TOKEN" https://grocery-price-optimizer-production.up.railway.app/api/admin/catalog/match-sample`
   - Remap departments from the category path already stored on each product, including Kroger rows. The POST returns a `jobId` immediately and walks the catalog in batches, so a proxy timeout does not stop it. Progress is `recategorize` on the status route (`examined`, `updated`, `clearedExclusions`, `total`). A second POST while it is running returns the same job. A restart resumes from the saved cursor. Every department change is written, including a move to Other. A product that leaves Other has `refreshExcluded` cleared on its offers, including a vitamin the name rule moves out of Other. Nothing is deleted. Run this before exclude so vitamins, training pants, and the other grocery misses leave Other. If exclude already ran, this pass still clears those flags:  
     `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"confirm":"recategorize-catalog"}' https://grocery-price-optimizer-production.up.railway.app/api/admin/catalog/recategorize`
   - Optional, after recategorize finishes (`recategorize.status` is `completed`). Marks offers for products that are still Other under the current rules so refresh does not spend a call on jewelry, office supplies, and the rest of general merchandise. Offers for groceries that are still stored as Other, or that have already moved, have the flag cleared. Running it again leaves the same offers excluded. Nothing is deleted:  
     `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"confirm":"exclude-nongrocery-refresh"}' https://grocery-price-optimizer-production.up.railway.app/api/admin/catalog/exclude-nongrocery-refresh`
   - Optional, and only after a later status check shows UPC masters for items that still have a `local:` duplicate. The crawl itself renames `local:walmart:{itemId}` onto the UPC when it sees the item again, so this delete is not required for that upgrade. Rows that still have no UPC are kept:  
     `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"confirm":"drop-shadow-local-keys"}' https://grocery-price-optimizer-production.up.railway.app/api/admin/catalog/drop-shadow-local-keys`
   - Optional: zero the old inflated `calls` / `upserted` counters (the crawl position is kept):  
     `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"confirm":"reset-run-counters"}' https://grocery-price-optimizer-production.up.railway.app/api/admin/catalog/reset-run-counters`  
   ZIP 10001 was stored as location `01400441`, which is the demo id the old lookup used when Locations failed. The next location pass will not substitute that id. This cycle keeps the saved locations until it finishes or you start a new cycle.

   From PowerShell, set the token and call the same admin routes. `Invoke-RestMethod` sends the bearer token in a header. POST bodies are a JSON string:

   ```powershell
   $base = "https://grocery-price-optimizer-production.up.railway.app"
   $headers = @{ Authorization = "Bearer $env:ADMIN_TOKEN" }
   Invoke-RestMethod "$base/api/admin/catalog/status" -Headers $headers
   Invoke-RestMethod "$base/api/admin/catalog/other-breakdown" -Headers $headers
   Invoke-RestMethod "$base/api/admin/catalog/sample?department=other&limit=20" -Headers $headers
   Invoke-RestMethod "$base/api/admin/catalog/recategorize" -Method POST -Headers $headers -ContentType "application/json" -Body '{"confirm":"recategorize-catalog"}'
   Invoke-RestMethod "$base/api/admin/catalog/status" -Headers $headers
   Invoke-RestMethod "$base/api/admin/catalog/exclude-nongrocery-refresh" -Method POST -Headers $headers -ContentType "application/json" -Body '{"confirm":"exclude-nongrocery-refresh"}'
   ```

Local demo, no keys:

```bash
npm run ingest:demo
```

## Price drop alerts

Turn on **Alert me when prices on this list drop** in My list. Every item on that list is watched. You can also watch a single item while the list switch is off, or turn one item off while the list is on. An optional target on an item is included when you set it under the price you saved.

The price that matters is the best in-stock price across stores in the saved catalog (`CatalogOffer`). A Kroger row only counts for the list's ZIP. A Walmart row with no ZIP is the catalog price and still counts. The check runs at the end of each catalog ingest pass, including the demo load, so it does not need its own service. The same drop is stored once. A later lower price can alert again. A price that goes back up and returns to a price you were already told about does not alert again.

The Alerts panel lists the item, the store, the old price, the new price, and the savings. The badge is the number you have not opened yet.

A shared list uses the same controls. The choice stays on this device; each collaborator sets their own. While a share link is open, alerts follow that link. A new link, or turning the link off, stops alerts for the previous one.

Browser notifications are optional. They stay off until both `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are set. Set the same keys on the web service and on the ingest worker (the worker is what sends the notification).

Generate a key pair:

```bash
npx web-push generate-vapid-keys
```

The command prints a Public Key and a Private Key. Set:

- `VAPID_PUBLIC_KEY` to the Public Key
- `VAPID_PRIVATE_KEY` to the Private Key
- `VAPID_SUBJECT` optionally, to a `mailto:` address or an `https:` URL, for example `mailto:you@example.com`

When `VAPID_SUBJECT` is unset, or is not a `mailto:` or `https:` URL, the server uses `mailto:price-alerts@grocerygitter.app`. Leave both keys unset to keep alerts in the app only. `POST /api/price-alerts/push` then returns 503, and a price drop is not sent to a push service. The in-app Alerts panel still works.

Phone push (APNs or FCM) is not sent yet. The Capacitor shell already shows the in-app badge and Alerts panel. A native transport can register later without a new collection. `GET /api/price-alerts/status` reports `nativePush.enabled: false` until that exists.

## Share a list

A shopper can share the list on this device. There is still no account. The device keeps a secret for that saved list, plus an optional name ("Sam", "Alex") that is only used to label who added or checked an item.

Tap **Share list**. Grocery Gitter creates a long random link. On a phone it opens the system share sheet (`navigator.share`, or the Capacitor Share plugin when `Capacitor.Plugins.Share` is present). Otherwise it copies the link.

Anyone with the link can open the same list, add items, change quantities, and check items off. The page keeps up by listening for live updates, and falls back to checking every few seconds. If two people edit the same item, the later edit wins and the other item is left alone. When a name was entered, the row says who added it and who checked it off.

The person who created the link can **Make view-only** or **Revoke link**. A view-only link can still be opened, but only that person can change it. A revoked link stops working. Sharing again makes a new link. One list never includes another list, and the link is not a guessable id.

A shared list holds at most 100 items. Edits are rate-limited. The database stores hashes of the secrets, not the secrets themselves.

Share links use the hosted origin from `CAPACITOR_API_URL` / `apiUrl()`. That helper reads `GroceryGitterNative.resolveApiOrigin`, the same origin the native shell uses for API calls. On the website the link is this site's origin. In the bundled app it is `CAPACITOR_API_URL`, or the production Railway origin when that variable is unset, so the link is not `capacitor://localhost` or `https://localhost`.

## Phone and tablet apps (Capacitor)

The shopper UI stays a static SPA in `public/` (no frontend bundler). The website and the installed PWA are unchanged: the manifest, icons, and network-first service worker still install from the browser, and `/api` stays on the same origin.

Capacitor is an extra native shell. App id `app.grocerygitter`, display name **Grocery Gitter**. `npm run cap:sync` copies `public/` into `ios/` and `android/`. Railway does not run that step. `npm run build` is still only the TypeScript server (`tsc` → `dist/`), and `npm start` still serves `public/` from Express.

The native WebView loads those copied files. It then calls the HTTPS API at `CAPACITOR_API_URL`, or `https://grocery-price-optimizer-production.up.railway.app` when that variable is unset. Retailer secrets stay on the server. Express already enables CORS, so the WebView origin (`capacitor://localhost` on iOS, `https://localhost` on Android) can call the API.

Kroger, Walmart, Target, and Instacart handoffs open in the system browser (`@capacitor/browser`). The Kroger redirect URI stays the Railway HTTPS callback. There is no custom inbound URL scheme: checkout returns to that HTTPS page, not into the app.

### Prerequisites

- **Node.js 20+** (same as the API)
- **iOS:** a Mac with current Xcode and the iOS 15+ simulator runtime. The Xcode project’s deployment target is iOS 15. A paid Apple Developer account is only needed for a physical device or App Store upload. Capacitor 8 links plugins with Swift Package Manager (`ios/App/CapApp-SPM`), so CocoaPods is not required to run the simulator. `ios/App/Podfile` is there so the Codemagic Mac build can run `pod install` and open a workspace. To ship an iPhone build without a Mac, follow `docs/IOS_CLOUD_BUILD.md`.
- **Android:** Android Studio, with Android SDK 36 (the project’s compile SDK) and an emulator or a device with USB debugging. Minimum device SDK is 24.

`npm install` on a machine where you will run the native apps. The Capacitor packages are dev dependencies, so a production Railway install can omit them.

### First-time setup

```bash
npm install
npm run cap:sync
```

The copies of the website inside `ios/` and `android/` are generated by that command and are not committed. Open Xcode or Android Studio after syncing.

`npm run cap:sync` reads `.env` when that file exists. Optional variables (see `.env.example`):

| Variable | Effect |
| --- | --- |
| `CAPACITOR_API_URL` | HTTPS origin written into the native copies of `public/native-config.js`. Unset uses the Railway production URL above. `http://` is rejected. |
| `CAPACITOR_SERVER_URL` | Live reload. The WebView loads this URL instead of the copied files, and API calls stay on that origin. Use `http://<your-LAN-ip>:3000` while `npm run dev` is running. Unset it and sync again before a store build. |

### Sync after web changes

Edit `public/` (HTML, CSS, `app.js`). Then:

```bash
npm run cap:sync
```

That refreshes both native projects. One platform at a time:

```bash
npm run cap:sync:ios
npm run cap:sync:android
```

Railway deploys the same `public/` files on the next web deploy. You do not run Capacitor on Railway.

### Open and run

iOS simulator or device (Mac):

```bash
npm run cap:open:ios
```

In Xcode, select an iPhone simulator (or a connected iPhone), then Product → Run (⌘R).

From the terminal, with Xcode’s simulators installed:

```bash
npm run cap:run:ios
```

Android emulator or device:

```bash
npm run cap:open:android
```

In Android Studio, select a device or emulator and press Run.

From the terminal, with a device or emulator already running:

```bash
npm run cap:run:android
```

Live reload against the local API (example):

```bash
npm run dev
CAPACITOR_SERVER_URL=http://192.168.1.20:3000 npm run cap:sync
npm run cap:run:android
```

Use your computer’s LAN address. `http://localhost` on a phone is the phone, not your computer. Android’s emulator can use `http://10.0.2.2:3000`.

### What the shell already handles

- **Safe areas.** `viewport-fit=cover` was already set. The top bar, side edges, bottom list bar, and sheets pad with `env(safe-area-inset-*)`, and with Capacitor’s `--safe-area-inset-*` variables on older Android WebViews. The iOS web view is edge-to-edge (`contentInset: never`).
- **Status bar.** Capacitor SystemBars follows the light or dark theme (dark icons on the cream bar, light icons on the dark theme).
- **Splash.** Dark `#1c221e` launch screen, hidden when the page boots (and auto-hidden if the page never boots).
- **Deep links that already exist.** Walmart add-to-cart, Kroger and Target search, and Instacart open outside the WebView. Kroger shopper login does too, so the Railway OAuth callback is unchanged.
- **Service worker.** Registered on the website only, so the native shell does not cache a second copy of the UI.
- **Price alerts.** The badge and Alerts panel show inside the WebView. The website can also register browser push. Native push (APNs or FCM) registers later through `registerNativePushTransport` in `src/alerts/push.ts`.

### App Store / Play Store prep

Icons, splash screens, and the public privacy and terms pages are in the repo. The checklist of what you still do on a Mac and in the store consoles — bundle id, version numbers, screenshots, privacy answers, and signing — is [docs/APP_STORE.md](docs/APP_STORE.md). This repo does not submit either store. `codemagic.yaml` builds a signed iOS app and sends it to TestFlight, and builds a signed Android App Bundle without uploading it to Play. The steps for someone without a Mac are in `docs/IOS_CLOUD_BUILD.md`.

The source mark is `assets/logo.svg` (dark canvas `#1c221e`). `npm run assets:generate` rebuilds the iOS, Android, and home-screen icons from it. Privacy is at `/privacy` and terms at `/terms`, linked from the page footer and from My list.

## What it includes

- **Browse app** — department shelves, search, filters, My list, savings meter, then **Plan the trip** (`15 Kroger + 5 Walmart + 10 Target`) with **Live prices** / **Partner feed** / **Weekly ad** / **Demo catalog** badges and the existing Open / Add to cart / Coming soon actions
- **Product** Mongoose schema: `name`, `brand`, `storeName`, `locationId`, `productId`, `upc`, `price`, `size` (optional retailer package text), `unit`, `normalizedUnit`, `priceSource` (`live` \| `weekly_ad` \| `seed`), `lastUpdated`, `updatedAt`
- **`optimizeGroceryList`** — pure function that picks one product per item (the product itself, then the fair package price) and groups by `storeName`
- **`storeHandoff`** — attaches checkout actions (Kroger search / optional cart OAuth, Walmart add-to-cart deep link or search, Target search)
- **`src/pricing/`** — pluggable price providers (Kroger Products API, Walmart Affiliate API, Target partner feed, licensed partner-feed stubs, Flipp weekly-ad deals)
- **`GET /api/search-catalog`** — FatSecret catalog autocomplete (`?query=milk`)
- **`npm run scrape -- "milk"`** — Puppeteer script that searches Vitacost and returns title/price JSON

On first launch with an empty database the API seeds a sample catalog for Aldi, Walmart, Kroger, and Target. Set `MONGO_URL` (preferred in cloud) to connect to Atlas or any MongoDB and skip the in-memory server. If `MONGO_URL` is unset and nothing is listening on `MONGODB_URI` / localhost:27017, local dev starts an in-memory MongoDB.

## Matching and unit price

For each grocery line, each store search still returns every catalog hit. The optimizer keeps the strongest keyword set that hits (full name, then without a generic trailing word such as Cereal, then the first two words) and ranks inside that set.

**The product itself beats a flavor or ingredient.** A row counts as the product when the name ends with the search words ("Clover Honey", "Whole Milk", "Large Eggs"), or the only words after them are a cut or form (breast, sliced, organic, roasted, …). A trailing jar, bottle, bag, or box is ignored. The row is only a modifier when a different food follows ("Honey Nut Cheerios", "Honey Roasted Peanuts", "chicken broth", "egg noodles", "milk chocolate") or when flavored / flavor / style / scented / infused follows the query. Modifier rows are used only if nothing in the product-itself group matched. Words match as whole tokens with a light plural stem, so "honey" does not hit "Honeycrisp" and "egg" does hit "eggs".

**Size decides the price comparison.** Package size is read from the retailer size field and the title: oz, fl oz, lb, g, kg, ml, L, gallon, half gallon, quart, pint, count/ct, pack, dozen, and simple multipacks such as "6 x 12 fl oz". Volume is compared in fluid ounces, weight in ounces, and counts per item.

- If the list item names a size ("gallon of milk", "12 ct eggs"), pick the closest package in that dimension. The same size breaks ties on shelf price, because that is what the shopper pays for the package they asked for. A better unit price on the wrong size does not win.
- If the list item does not name a size, and the packages share a dimension, pick the lower unit price. A half gallon must not beat a gallon just because the sticker is lower. Eggs use price per each.
- If size cannot be parsed, or the dimensions differ, fall back to shelf price.

When a size is parsed, the trip card shows that unit price next to the line total (`$3.50 ($3.50/gal)`, `$3.60 ($0.20/ct)`). Milk-sized volumes (a quart and up) are shown per gallon; smaller volumes per fl oz; weights of a pound and up per lb.

| List item | Before | After |
| --- | --- | --- |
| Honey | Cheapest name that contained "honey", often Honey Nut Cheerios or honey-roasted peanuts | A product whose name ends in honey (Clover Honey), even when the sticker is higher |
| milk | Half gallon at $2.00 beats a gallon at $3.50 | Gallon wins: $3.50/gal vs $4.00/gal |
| gallon of milk | Same sticker sort | The gallon, even if a half gallon is $1.50 ($3.00/gal) |
| eggs | 12 ct at $3.00 beats 18 ct at $3.60 | 18 ct wins at $0.20/ct vs $0.25/ct. "12 ct eggs" still picks the dozen |

## Kroger Locations API

`src/krogerService.ts` talks to Kroger’s official Locations API (`https://api.kroger.com/v1/locations`). `getClosestStoreLocation(zipCode)` sends `filter.zipCode.near` and `filter.limit=1`, then returns that store’s `locationId`.

Auth is client-credentials: the service POSTs to `/v1/connect/oauth2/token` with `KROGER_CLIENT_ID` / `KROGER_CLIENT_SECRET` and reuses the bearer token until it expires. Set those values in `.env` (see `.env.example`). If credentials are missing or the official API rejects them, the service returns a demo `locationId` (`01400441`) so the dashboard still prices the seeded Kroger catalog.

`POST /api/optimize-list` treats MongoDB as a 24-hour price cache for **live** retailer rows (`priceSource: "live"`) and **weekly-ad** rows (`priceSource: "weekly_ad"`). Seed/demo rows are not treated as live. For each grocery item and each competing store (Kroger, Walmart, Target, Aldi by default) it:

1. Uses live rows whose `updatedAt` is less than a day old (`Cached live`).
2. On a miss, calls that store’s dedicated retailer API when credentials are configured (Kroger Products, Walmart Affiliate, Target partner feed), then upserts with `priceSource: "live"`.
3. If that store still has no live row and a ZIP is set, calls the Flipp weekly-ad provider when enabled, then upserts with `priceSource: "weekly_ad"`.
4. Otherwise falls back to the seeded catalog and labels it **Demo catalog**.

Kroger still uses `GET https://api.kroger.com/v1/products?filter.term=…` with the ZIP-resolved `locationId`. Live Kroger rows keep `productId` / `upc` so checkout handoff can deep-link or call the Cart API after shopper login. Weekly-ad prices never pretend to be a full Kroger (or Aldi/Target) shelf catalog.

## Live multi-store pricing (Phase 2)

See [`docs/PRODUCT_ROADMAP.md`](docs/PRODUCT_ROADMAP.md). This is **not** a fake Walmart/Target integration.

| Store | What actually runs | Offline / no keys | Live keys |
| --- | --- | --- | --- |
| **Kroger** | Official Locations + Products (`product.compact`) | Demo catalog + `pricingWarning` mentioning `KROGER_CLIENT_ID` | Local shelf prices for the ZIP’s store |
| **Walmart** | Official Affiliate Marketing API `GET https://developer.api.walmart.com/api-proxy/service/affil/product/v2/search` with RSA headers (`WM_CONSUMER.ID`, timestamp, key version, `WM_SEC.AUTH_SIGNATURE`). `GET /stores?zip=` (cached per ZIP) for the nearest store name and address, plus `accessPointId` / `fulfillmentStoreId` when the locator sends them. | Demo catalog, badge **Demo catalog**. No red banner (keys are optional). Search handoff, no cart link. | **walmart.com catalog** prices. The Affiliate search API has **no store-price filter**, so the nearest store does not change the price. It is passed on the add-to-cart link as `storeId` (and `ap` when an access point id is present). Sign up at [walmart.io](https://walmart.io/apidocs/affiliates/quickstart), upload a public key, set `WALMART_CONSUMER_ID` and `WALMART_PRIVATE_KEY` (PEM; `\n` for newlines). `WALMART_PUBLISHER_ID` is optional until Impact approval. |
| **Target** | **No public product API.** This app does **not** call RedSky, Target Circle, or RedCard pricing (those are account-specific and not a shelf feed). If you have a licensed partner feed, `GET {TARGET_PARTNER_BASE_URL}/products?query=&zip=` with `Authorization: Bearer {TARGET_PARTNER_API_KEY}` expecting `{ "products": [{ "name", "brand", "price", "productId"|"tcin", "upc", "unit" }] }`. Otherwise the weekly circular. | Demo catalog until those env vars or Flipp weekly ads are set. | Partner-feed prices tagged live. Circular rows stay **Weekly ad**. |
| **Aldi** (and Publix-like banners) | No retailer product API and no third-party cart. Optional **Flipp weekly-ad** provider (see below). Handoff stays Coming soon — no fake cart. Many everyday Aldi prices are never printed in the ad. | Demo catalog | Weekly-ad / circular prices for the ZIP when Flipp is enabled |

Configured **partner feeds** (Publix, Meijer, H-E-B, Instacart-style banners, Datasembly-class shelf file) use the same optimize path when `SHELF_FEED_*` / `INSTACART_PARTNER_*` / `PUBLIX_PARTNER_*` / `HEB_PARTNER_*` / `MEIJER_PARTNER_*` are set. Hits are labeled **Partner feed**, not a fake retailer API. See [`docs/PARTNER_INTEGRATIONS.md`](docs/PARTNER_INTEGRATIONS.md). Licensed shelf feeds beat Flipp weekly ads for the same banner. Unconfigured partner banners are not added to the default trip.

Each optimize response includes `pricingByStore` and each store group includes `pricing: { source, label, detail, error? }`. `source` is `live`, `cached_live`, `partner_feed`, `weekly_ad`, `cached_weekly_ad`, `seed`, `mixed`, or `unavailable`. Labels are **Live prices**, **Partner feed**, **Weekly ad**, or **Demo catalog**. A configured provider that fails sets `pricingWarning` (partial success still returns 200). If **no** item can be priced at all, the route still returns **503**.

## Weekly-ad / multi-store deals (Flipp)

Banners without a public grocery API (Aldi, Target when the partner feed is absent, Publix, Meijer, and other mapped circulars) can leave the seed catalog during testing by opting into Flipp flyer data.

**Weekly ad ≠ live shelf.** Flipp returns items printed in the current circular near a ZIP. Items not on the flyer are not priced from this source. Grocery Gitter labels those rows **Weekly ad** and never reports “added to cart.”

| Path | When | What it calls | Honesty / risk |
| --- | --- | --- | --- |
| **FlyerKit v4.0** (preferred) | `FLIPP_ACCESS_TOKEN` is set | Documented `GET https://api.flipp.com/flyerkit/v4.0/publications/{merchant_identifier}/products?access_token=&locale=en-US&postal_code=&keywords=` ([FlyerKit docs](https://api.flipp.com/flyerkit/v4.0/documentation)). Tokens are issued by a Flipp technical contact (typically merchant-scoped). | Legitimate partner API. |
| **Consumer circular** | `FLIPP_ENABLED=true` | Unofficial JSON used by flipp.com. Grocery Gitter loads `GET https://backflipp.wishabi.com/flipp/flyers?postal_code={ZIP}` and then each matching flyer. A `merchant AND term` search returns an empty `items` list, so the grocery words are matched on the circular locally. **No HTML scrape, no retailer login.** | Not a public contract. Flipp terms may restrict automated access. Production must set `FLIPP_ENABLED=true` explicitly. Prefer FlyerKit if Flipp issues a token. |

**ZIP.** Weekly ads require a 5-digit US ZIP. `45202-1234` is accepted and sent as `45202`. The price is whatever flyer Flipp publishes for that postal code. It is not a store-locator aisle price, and a banner can appear in the circular even when the nearest store is far away. With no ZIP, browse keeps the demo catalog and says so; the trip labels that store **Unavailable** or **Demo catalog** instead of pretending a circular was checked.

Mapped Grocery Gitter `storeName`s: **Aldi**, **Target**, **Walmart**, **Kroger** (including family banners such as Ralphs / King Soopers / Harris Teeter as a *secondary* signal — live Kroger Products still wins when configured), **Publix**, **Meijer**, **Food Lion**, **H-E-B**, **Safeway**, **Giant Eagle**, **Costco**. When Flipp is on, those banners join the default trip. Pass `stores` to limit the list. Food Lion is merchant `2100`, H-E-B `2467`, US Safeway `5667` (not Safeway Liquor), Giant Eagle `2130`.

Pipeline: dedicated retailer APIs run first. Flipp fills in when that API is missing, empty, or failed **and** a ZIP is present. Flyer items without a numeric price (BOGO / “% off” only) are skipped so we do not invent a price. A flyer id is not a Target TCIN or a Walmart item id; those handoffs stay search links.

### Verify weekly ads (Railway)

On the **web** service (the one that serves `/api`, not the ingest worker):

1. Variables: `FLIPP_ENABLED` = `true`. Leave `FLIPP_ACCESS_TOKEN` empty unless Flipp has issued a FlyerKit token. Do not set fake `TARGET_PARTNER_*` keys.
2. Redeploy the web service. No catalog ingest change and no database delete.
3. From PowerShell, using your public HTTPS host:

```powershell
$base = "https://<your-service>.up.railway.app"
Invoke-RestMethod "$base/api/catalog/coverage"
Invoke-RestMethod "$base/api/catalog/browse?q=chicken&zip=45202"
Invoke-RestMethod "$base/api/catalog/browse?department=meat-seafood&zip=75201"
```

Coverage for Target and Aldi should say **Weekly ad only**, and Food Lion, H-E-B, Safeway, Giant Eagle, Publix, Meijer, and Costco should say **Weekly ad**. A chicken or meat response should include `priceSource` `weekly_ad` when that ZIP's circular actually lists the item. An empty circular for a staple is honest: the offer stays demo or the trip store says **Unavailable**. Browse without `zip` returns a warning that a 5-digit ZIP is required.

`Invoke-RestMethod "$base/api/catalog/browse?q=milk"` (no ZIP) should not invent Aldi or Target shelf prices.

This app does **not** scrape authenticated Aldi, Target, or Publix storefronts.

## Checkout handoff (Phases 1 and 3)

See [`docs/PRODUCT_ROADMAP.md`](docs/PRODUCT_ROADMAP.md) for the 15/5/10 multi-cart vision.

After optimize, each store group includes a `handoff` object: `storeName`, `itemCount`, `subtotal`, items with identity for checkout, and `action: { type, label, url?, status, detail?, fallbackUrl? }`.

| Retailer | Action | What it actually does |
| --- | --- | --- |
| **Kroger** | `search_deeplink` → **Open at Kroger** | Default when `KROGER_REDIRECT_URI` is unset, or when items have no UPC. Public `https://www.kroger.com/search?query=` using `productId`/UPC when the Products API returned one, otherwise the item name. Shopper adds to cart on kroger.com. |
| **Kroger** | `kroger_cart` → **Add to Kroger cart** | When `KROGER_REDIRECT_URI` is set **and** at least one item has a UPC/`productId`. Starts **authorization-code** OAuth (`cart.basic:write`). The shopper must log in. Then `PUT https://api.kroger.com/v1/cart/add`. Client-credentials used for pricing **cannot** do this. |
| **Walmart** | `walmart_cart` → **Add N items to Walmart cart** | When at least one Walmart line has a numeric item id (live or cached live). One link: `https://www.walmart.com/sc/cart/addToCart?items=ITEMID\|QTY,ITEMID`. Quantity 1 is the bare item id. `offers` is used only when a line already has an offer id and no item id. If the shopper's nearest Walmart is known, the link adds `storeId` (the fulfillment store id, or the store number when that is all the locator returned) and `ap` when the locator returned an accessPointId. If `WALMART_PUBLISHER_ID` is set, that URL is wrapped with the Impact template from [`productTrackingUrl`](https://walmart.io/apidocs/affiliates/reviews): `https://goto.walmart.com/c/{publisherId}/568844/9383?veh=aff&sourceid=imp_000011112222333344&u=…`. If it is unset, the unwrapped link still opens the cart. This is a shopper handoff, not an API cart write — Grocery Gitter does not report the cart as filled. Lines without a numeric item id (demo catalog, or a Flipp flyer id) are left off the link and named in the button detail. If none of the lines have an item id, the card stays on **Search at Walmart**. |
| **Target** | `search_deeplink` | Public search URL. Not a cart fill — authenticated cart APIs need partner access. Grocery Gitter does not invent that API. |
| **Publix / H-E-B / Meijer / Albertsons family / Ahold / club / Amazon** | `search_deeplink` | Public search URLs with honest copy (club membership; no third-party cart-write). |
| **Aldi / unknown banners** | `coming_soon` | No fake checkout. |
| **Instacart Developer Platform** | `POST /api/instacart/shopping-list` | Shown only when `INSTACART_API_KEY` and `INSTACART_API_BASE_URL` are set. Not a native cart. See below. |

Grocery Gitter **never** reports a successful cart fill unless Kroger’s Cart API returns HTTP 2xx. Cancelled login, missing scopes, or a rejected UPC fall back to Open at Kroger search links. An Instacart shopping-list link is a handoff to Instacart checkout, not an in-store cart write.

### Instacart shopping list (Developer Platform)

This is separate from the `INSTACART_PARTNER_*` price-feed stub in [`docs/PARTNER_INTEGRATIONS.md`](docs/PARTNER_INTEGRATIONS.md). The partner stub is a licensed price adapter. This handoff only creates a shopping-list page.

**Endpoint:** `POST {INSTACART_API_BASE_URL}/idp/v1/products/products_link` with `Authorization: Bearer`. Docs: [Create shopping list page](https://docs.instacart.com/developer_platform_api/api/products/create_shopping_list_page).

| Environment | Base URL |
| --- | --- |
| Development key | `https://connect.dev.instacart.tools` |
| Production key | `https://connect.instacart.com` |

The key stays on the server. The browser calls `POST /api/instacart/shopping-list` and opens the returned `products_link_url`. If either env var is unset (or the base is not `https`), `GET /api/instacart/status` is `{ "enabled": false }` and the buttons are not rendered.

**What the shopper sees**

- On each trip-plan store that does **not** have a native cart handoff (Target search, Aldi “Coming soon”, Publix/H-E-B/regional search, Walmart **Search at Walmart** fallback, and Kroger when it is only “Open at Kroger”): a **Shop on Instacart** button for that section’s items.
- On the trip total: “or shop the whole list on Instacart”, which sends every store’s items as one list.
- Kroger’s **Add to Kroger cart** section and Walmart’s **Add N items to Walmart cart** section do not get a second per-store Instacart button. Those items are still included in the whole-list option. The nearest Walmart store line and unit prices stay on the card.
- Instacart opens a hosted list. The shopper picks a retailer, reviews matches, and checks out on Instacart (login if needed). Grocery Gitter does not claim the in-store cart was filled, and Instacart prices can differ.

**Retailer hint:** the create-shopping-list body has **no retailer field**. [Instacart’s FAQ](https://docs.instacart.com/developer_platform_api/faq) says directing a shopper to a specific merchant is not supported on that page. The only documented hint is appending `?retailer_key=` after [`GET /idp/v1/retailers`](https://docs.instacart.com/developer_platform_api/api/retailers/get_nearby_retailers), and that query parameter is documented for [recipe page URLs](https://docs.instacart.com/developer_platform_api/get_started/recipe), which may need a separate API key. For a single store section with a ZIP, Grocery Gitter tries that lookup and appends `retailer_key` when the retailer **name** matches the trip-plan store. If lookup fails or nothing matches, the link still opens and the shopper chooses the store. The whole-list option never preselects a retailer.

Line items send `name`, `quantity`, `line_item_measurements` (package `size` when we have it, otherwise Grocery Gitter units, mapped onto [Instacart’s units](https://docs.instacart.com/developer_platform_api/api/units_of_measurement); unknown units are sent as `each` and kept in `display_text`), and `upcs` when we have an 8–14 digit code. A measured size such as `16 oz` is the amount Instacart should match, times how many packages the shopper asked for. Count sizes such as `12 ct` stay one package per line (`each`) with the count in the display text, so Instacart does not add twelve cartons. Retailer product ids are not sent as Instacart `product_ids`.

**Get a key** (as documented; checked 24 Sep 2026)

1. Apply from [Get started](https://docs.instacart.com/developer_platform_api/get_started/overview) → [Apply today](https://www.instacart.com/company/business/developers) (18+, US or Canada resident or registered business, intended use case, accept the [Developer Platform terms](https://docs.instacart.com/developer_platform_api/guide/terms_and_policies/developer_terms)).
2. That apply page currently says **new applications are not being accepted** and there is **no waitlist**. Check back, or use a key you already have.
3. After you have a Developer Account, open the Developer Dashboard → **API Keys** → **Create New API Key** → name it → choose **Development** or **Production** → **Generate Key** → copy it once. Keys look like `keys.` plus a hex id. Steps: [Get an API key](https://docs.instacart.com/developer_platform_api/get_started/api-keys).
4. Use the development base with a development key. A production key is a later step: record a demo and request production access ([pre-launch checklist](https://docs.instacart.com/developer_platform_api/guide/concepts/launch_activities/pre-launch_checklist)). Instacart’s get-started page says access request to production key is often about 30–40 days.
5. Your first key might only allow `/products/products_link` or `/products/recipe`. This app calls **`/products/products_link`**. Nearby retailers may need another key.

**Is it free?** Instacart does not publish a fee for Developer Platform keys or for Create shopping list page. Access is approval-gated, not a self-serve paid SKU. The terms allow Instacart to charge only if you ask to go past usage limits. After a live integration is approved, you can optionally join their affiliate program and **earn** commissions (Impact.com). That is revenue share, not a key price. Shoppers still pay Instacart’s own item, service, and delivery fees at checkout.

**Railway** (service → Variables). Set both, or the button stays hidden:

```bash
INSTACART_API_KEY=keys.<your key>
# development key:
INSTACART_API_BASE_URL=https://connect.dev.instacart.tools
# production key (only after Instacart approves it):
# INSTACART_API_BASE_URL=https://connect.instacart.com
```

Do not put this key in `INSTACART_PARTNER_API_KEY`. Do not commit it. The button copy is Instacart’s approved **Shop on Instacart** CTA (dark theme, 46px, carrot logo) from their [CTA design](https://docs.instacart.com/developer_platform_api/guide/concepts/design/cta_design) guide.

### Enable Kroger shopper cart fill (Railway + Kroger portal)

Production already uses `KROGER_CLIENT_ID` / `KROGER_CLIENT_SECRET` for Locations and Products (`product.compact`, client-credentials). That token **must not** be sent to `PUT /v1/cart/add`. Cart write needs shopper login and a redirect URI that matches production.

**1. Kroger developer portal** ([developer.kroger.com](https://developer.kroger.com/))

1. Open the same app that already has your Client ID / Secret for pricing.
2. Add a **Redirect URI** that matches the public site **exactly** (scheme, host, path, no trailing slash unless you also put one in env):
   - Local: `http://localhost:3000/api/kroger/oauth/callback`
   - Railway default domain: `https://<your-service>.up.railway.app/api/kroger/oauth/callback`
   - Custom domain: `https://<your-domain>/api/kroger/oauth/callback`
3. Confirm the app can request **`cart.basic:write`** (some public apps only have Products/Locations; the portal may list **`cart.basic:rw`** instead — set `KROGER_CART_SCOPE` to whatever the app is granted). If authorize or cart add fails with insufficient scope, keep using Open at Kroger; Grocery Gitter will not pretend the cart was filled.
4. Save. Kroger compares the `redirect_uri` query parameter to this registered value character-for-character.

**2. Railway variables** (service → Variables)

```bash
KROGER_CLIENT_ID=...
KROGER_CLIENT_SECRET=...
KROGER_REDIRECT_URI=https://<your-service>.up.railway.app/api/kroger/oauth/callback
# optional; default cart.basic:write
KROGER_CART_SCOPE=cart.basic:write
# optional; default PICKUP (or DELIVERY)
KROGER_CART_MODALITY=PICKUP
```

Use the **public HTTPS** Railway URL, not `*.railway.internal`. After changing the public domain, update **both** the Kroger portal and `KROGER_REDIRECT_URI` together or login will fail.

**3. What shoppers see**

- Kroger card shows **Add to Kroger cart** (plus **or Open at Kroger**).
- Tap → Kroger login/consent (or a reuse of the encrypted shopper cookie if still valid).
- Callback exchanges the code, then `PUT https://api.kroger.com/v1/cart/add` with `{ items: [{ upc, quantity, modality }] }`.
- Success page only if that write is HTTP 2xx. Then finish checkout on [kroger.com/cart](https://www.kroger.com/cart) while logged into the **same** shopper account.

OAuth `state` is an HMAC of the pending cart so a different Railway instance can finish the callback. Shopper tokens are stored only in an encrypted HttpOnly cookie, not in Mongo.

Routes:

- `GET /api/kroger/auth-status` — whether redirect URI is configured (`requiresShopperLogin` is always true)
- `POST /api/kroger/cart/start` — JSON `{ items, locationId? }` from the Kroger handoff; returns `{ authorizeUrl, status: "needs_shopper_login" }`, `{ status: "added" }` when a shopper cookie can write immediately, or **501** if OAuth is not set up
- `GET /api/kroger/oauth/callback` — exchanges the code, calls Cart API, shows success **only** if Kroger acknowledged the write

## FatSecret catalog

`src/services/fatsecretService.ts` talks to FatSecret’s Platform API. `getAccessToken()` POSTs an OAuth 2.0 client-credentials form (`grant_type=client_credentials`, `scope=premier`, `client_id`, `client_secret`) to `https://oauth.fatsecret.com/connect/token` and caches the bearer token until it is within 60 seconds of expiry. `searchGlobalCatalog(query)` then `GET`s `https://platform.fatsecret.com/rest/server.api` with `method=foods.search.v3`, `search_expression`, `format=json`, and `Authorization: Bearer`. Results are `{ id, name, brand }`.

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

Open **http://localhost:3000** for the Grocery Gitter dashboard. The API is on the same origin (`POST /api/optimize-list`).

To use your own MongoDB, set `MONGO_URL` (or `MONGODB_URI`) in `.env`. When `MONGO_URL` is set, the in-memory fallback is never loaded.

## Endpoints

### `GET /`

Grocery Gitter dashboard (`public/index.html`).

### `GET /api`

Health/info JSON (`name`: `"Grocery Gitter API"`).

### `GET /api/search-catalog`

```bash
curl -s "http://localhost:3000/api/search-catalog?query=milk"
```

`src/routes/catalog.ts` instantiates `FatSecretService` and returns the `{ id, name, brand }` array from `searchGlobalCatalog`. Missing `query` is **400**. FatSecret auth or API failures are **500** `{ "error": "Catalog search failed: …" }` and do not crash the process.

### `POST /api/optimize-list`

```bash
curl -s -X POST http://localhost:3000/api/optimize-list \
  -H "Content-Type: application/json" \
  -d '{
    "groceryList": ["milk", "eggs", "bread", "bananas", "chicken", "rice", "apples", "butter"],
    "zipCode": "45202",
    "stores": ["Aldi", "Walmart", "Kroger", "Target"]
  }'
```

`zipCode` looks up the closest Kroger via `getClosestStoreLocation` and uses that `locationId` for Kroger shelf prices. The same request also asks the Walmart and Target providers for that ZIP when those keys are configured, and (when `FLIPP_ENABLED` or `FLIPP_ACCESS_TOKEN` is set) Flipp weekly-ad prices for mapped banners such as Aldi and Target. Seed/demo rows still compete when a live or weekly-ad source is missing, and they are labeled as demo. `stores` is optional and further limits retailers. Omit `stores` (or send `[]`) to consider every matching product. `items` is accepted as an alias for `groceryList`.

The dashboard sends verified catalog picks as objects:

```json
{
  "zipCode": "45202",
  "items": [
    { "name": "Whole Milk", "brand": "Kroger", "foodId": "demo-whole-milk", "quantity": 2 }
  ]
}
```

Counts can sit at the start or end of a line: `"2 Milk"`, `"Milk x2"`, `"3 Eggs"`. The clean name is used for the catalog search; `price` is the unit price and `itemTotal` is `price * quantity`.

Response shape:

```json
{
  "stores": [
    {
      "storeName": "Kroger",
      "itemCount": 2,
      "items": [
        {
          "query": "milk",
          "name": "Whole Milk",
          "brand": "Kroger",
          "storeName": "Kroger",
          "price": 2.89,
          "quantity": 2,
          "itemTotal": 5.78,
          "unit": "gal",
          "normalizedUnit": "gal",
          "locationId": "01400441",
          "productId": "0001111041700",
          "upc": "0001111041700"
        }
      ],
      "subtotal": 5.78,
      "handoff": {
        "storeName": "Kroger",
        "itemCount": 2,
        "subtotal": 5.78,
        "items": [
          {
            "name": "Whole Milk",
            "brand": "Kroger",
            "quantity": 2,
            "price": 2.89,
            "productId": "0001111041700",
            "upc": "0001111041700",
            "locationId": "01400441",
            "url": "https://www.kroger.com/search?query=0001111041700"
          }
        ],
        "action": {
          "type": "kroger_cart",
          "label": "Add to Kroger cart",
          "url": "/api/kroger/cart/start",
          "status": "needs_shopper_login",
          "fallbackUrl": "https://www.kroger.com/search?query=0001111041700",
          "detail": "Starts Kroger shopper login (authorization-code OAuth), then PUT /v1/cart/add. Grocery Gitter reports success only if Kroger returns HTTP 2xx."
        }
      }
    }
  ],
  "unavailable": ["saffron"],
  "total": 5.78,
  "tripPlan": {
    "summary": "2 Kroger",
    "storeCount": 1,
    "itemCount": 2
  },
  "zipCode": "45202",
  "locationId": "01400441",
  "pricingByStore": [
    {
      "storeName": "Kroger",
      "source": "live",
      "label": "Live prices",
      "configured": true,
      "attempted": true,
      "ok": true,
      "detail": "Live Kroger prices from the retailer API."
    },
    {
      "storeName": "Walmart",
      "source": "seed",
      "label": "Demo catalog",
      "configured": false,
      "ok": false,
      "detail": "Walmart live prices use the official Affiliate Marketing API…"
    }
  ]
}
```

Each grocery item is assigned to **one** store using the [matching and unit-price rules](#matching-and-unit-price): the product itself beats a flavor or ingredient, then the closest requested size or the lower unit price. Matching still splits the name into keywords (ignoring FatSecret serving annotations like `(28g)` and package sizes) and requires those whole words in product `name` (so `"milk"` matches `"Whole Milk"` and `"egg"` matches `"Eggs"`). If nothing matches the full FatSecret name (e.g. `"Honey Nut Cheerios Cereal"`), the lookup retries without generic trailing words (`"Honey Nut Cheerios"`) and then the first two words (`"Honey Nut"`). Picked items include `unitPriceText` (for example `"$3.50/gal"`) when a package size was parsed. Store `subtotal` and the list `total` use `itemTotal` (shelf price × quantity). `tripPlan.summary` is the shopper-facing split (`15 Kroger + 5 Walmart + 10 Target`). Items with no match appear in `unavailable`. When live pricing is down and **no** item can be priced from the local catalog, `POST /api/optimize-list` returns **503** with an actionable `error` instead of a silent `$0.00` empty trip. When some stores fail but others (or the demo catalog) still price the list, the response is **200** with `pricingWarning` and per-store `pricing` badges. When `zipCode` is sent, `locationId` is the Kroger store used for those prices.

### Price drop alerts

`GET /api/price-alerts/status` — `{ webPush: { enabled, publicKey? }, nativePush: { enabled } }`. `publicKey` is present only when Web Push is on. It is not a secret. The private key is never returned.

`PUT /api/price-alerts/watches` — body `{ deviceId, listId, listName?, zip?, enabled, items }`. `listId` is the on-device list id, or the share token while a shared list is open (8–128 characters). Each item is `{ productId, name, brand?, watch?: "inherit"|"on"|"off", baselinePrice, baselineStore?, targetPrice? }`. `baselinePrice` is the price when the shopper saved the item. `productId` is the browse id (`upc:…`).

`GET /api/price-alerts?deviceId=` — `{ unread, alerts }`. Each alert has `itemName`, `storeName`, `oldPrice`, `newPrice`, and `savings`.

`POST /api/price-alerts/seen` — `{ deviceId, ids? }` clears the badge.

`POST /api/price-alerts/push` — `{ deviceId, subscription }` stores a browser push subscription. **503** when the VAPID keys are unset.

`DELETE /api/price-alerts/push` — `{ deviceId, endpoint }` removes that subscription.

`DELETE /api/me/data` — `{ deviceId, lists?: [{ shareToken, ownerToken }] }` deletes this device’s price watches, alert records, and push subscriptions. A shared list is deleted only when its owner token is included, and price rows stored under that share link are removed with it. When the request sends the `kroger_shopper` cookie, the access token and refresh token are revoked at Kroger and the cookie is cleared. The same call with nothing left returns 200 and zero counts. ZIP totals and catalog-demand phrases are not tied to a device and are left in place. See `docs/DATA_DELETION.md`.

`GET /api/kroger/logout` — revokes and clears the Kroger cookie in the browser that opens it. The iOS and Android shells open this in the system browser after Delete my data, because Kroger login stores the cookie there.

### `GET /api/kroger/auth-status`

Whether `KROGER_REDIRECT_URI` is set. Always `requiresShopperLogin: true` — client-credentials cannot write a cart.

### `POST /api/kroger/cart/start`

JSON body `{ "items": [{ "upc" or "productId", "quantity", "name?" }], "locationId?" }`. Returns `{ authorizeUrl, status: "needs_shopper_login" }`, `{ status: "added", added }` when a valid shopper cookie can write immediately, or **501** / **400** with an honest error. Does not add anything to a cart by itself unless that cookie write returns HTTP 2xx.

### `GET /api/kroger/oauth/callback`

Kroger redirect after shopper login. Exchanges the code and calls `PUT /v1/cart/add`. Success HTML is shown only when that write is acknowledged. Cancelled login and API errors include Open at Kroger search links.

## Live grocery scrape

`src/scrape-grocery.ts` opens Vitacost (a grocery/wellness e-commerce store), types a keyword into the search bar, and parses product titles and prices from the HTML results.

```bash
npm run scrape -- "almond milk"
```

It prints a JSON array:

```json
[
  {
    "title": "Pacific Foods, Organic Almond Milk, Unsweetened, 32 Fl Oz (946 Ml)",
    "price": 4.39,
    "brand": "Pacific Foods",
    "storeName": "Vitacost",
    "url": "https://www.vitacost.com/...",
    "currency": "USD"
  }
]
```

Timeouts, a missing search bar, and network failures throw a `GroceryScraperError` with a `code` of `TIMEOUT`, `MISSING_ELEMENT`, `NETWORK`, `INVALID_KEYWORD`, or `BROWSER`. Result cards that lack a title or a parseable price are skipped. Uses the system Chrome binary (`PUPPETEER_EXECUTABLE_PATH` or `/usr/bin/google-chrome-stable`).

The scraper function is `scrapeGrocerySearch` in `src/scraper/scrapeGrocerySearch.ts` and accepts a custom `site` config so the same flow can target another storefront.

## Seed mock products

`src/seed.ts` connects to your local MongoDB (`MONGODB_URI` or `mongodb://127.0.0.1:27017/grocery-list-optimizer`) and inserts **10** products: Gallon of Milk, Loaf of Bread, and Dozen Eggs at Walmart, Target, and Kroger (different prices each), plus Bananas at Walmart. Re-running it replaces those rows so the catalog stays at 10.

```bash
npm run seed
```

Cheapest picks with this catalog: milk at Kroger ($2.89), bread at Walmart ($1.28), eggs at Target ($1.99).

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | TypeScript watch server (`tsx`) |
| `npm test` | Unit tests for the optimizer and scraper |
| `npm run scrape -- "milk"` | Puppeteer grocery search → JSON |
| `npm run seed` | Insert 10 mock products into local MongoDB |
| `npm run build` | Compile the API to `dist/` (Railway). Does not build iOS or Android. |
| `npm start` | Run compiled `dist/index.js` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run cap:sync` | Copy `public/` into the iOS and Android projects |
| `npm run cap:open:ios` | Open the Xcode project |
| `npm run cap:open:android` | Open the Android Studio project |
| `npm run cap:run:ios` | Build and run on an iOS simulator or device |
| `npm run cap:run:android` | Build and run on an Android emulator or device |

## Product schema

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | Required |
| `brand` | string | Required |
| `storeName` | string | Required |
| `locationId` | string | Optional. Kroger physical store id used when `zipCode` is sent. |
| `productId` | string | Optional. Retailer product id (Kroger Products API `productId`). |
| `upc` | string | Optional. UPC/GTIN used for Kroger search links and Cart API. |
| `price` | number | Required, ≥ 0. Used as the comparison price. |
| `priceSource` | string | `live` (upserted from a retailer API), `weekly_ad` (Flipp circular), or `seed` (demo catalog). The API also reports `cached_live` when a live row is served from the 24-hour cache. Weekly-ad cache hits stay labeled **Weekly ad**. |
| `unit` | string | Package unit: `oz`, `lbs`, `count`, `g`, `kg`, `ml`, `l`, `gal` |
| `normalizedUnit` | string | Canonical unit for later price-per-unit work (same enum) |
| `lastUpdated` | Date | Defaults to now |
| `updatedAt` | Date | Set automatically by Mongoose on insert and every save. Indexed with `name`. |
