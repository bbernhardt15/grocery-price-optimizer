# Grocery Gitter

The product is **Grocery Gitter**. This GitHub repository’s slug remains `grocery-price-optimizer` (npm package id: `grocery-list-optimizer`).

Node.js Express backend (TypeScript) that maps each grocery item to the store selling it at the lowest price, then groups the shopping trip by store so you can actually buy the split cart. The shopper UI in `public/` is a mobile-first browse app (department shelves, search, filters, a persistent list, then the same trip plan).

## Browse the shelves

Open `/` and shop by department instead of typing a list first.

- **Departments** — Produce, Dairy & Eggs, Meat & Seafood, Bakery, Deli, Pantry, Frozen, Snacks, Beverages, Breakfast, Baby, Household, Personal Care, Pet
- **Product cards** — image (or a generated placeholder), name, size, best price and store, sale badge, checkbox, quantity stepper
- **Search** — typeahead over the cached catalog; submitting search refreshes from configured providers (cached)
- **Sort / filter** — relevance, lowest price, lowest unit price, name, on sale first; department, store, brand, size class, price range, on sale, store brand
- **My list** — saved in the browser, with a live estimated total and a savings meter versus buying everything at one store
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
| **Target** | No public taxonomy. A licensed `TARGET_PARTNER_*` feed is searched with the same seed terms and labeled partner, not a full catalog. Flipp weekly ads are **not** used as a browse shelf. | Demo catalog. Weekly ads still apply only inside trip planning |
| **Aldi** | No catalog API. | Demo catalog only. Flipp can still price circular items on the trip plan, labeled **Weekly ad** |
| **Partner banners** | Search-by-term stub when that feed's env vars are set. Unconfigured banners are omitted. | Not shown as a live catalog |

Demo UPCs are synthetic (`009999…`) so they do not merge with a real retailer code. Live rows win over a demo row for the same store and UPC. Department and search responses are cached in memory and in Mongo (`CatalogCache`, TTL index). Override with `CATALOG_DEPT_TTL_MINUTES` (default 360) and `CATALOG_SEARCH_TTL_MINUTES` (default 60).

When `CATALOG_INGEST_ENABLED` or `CATALOG_DB_FIRST` is on and Mongo already has catalog rows, browse, typeahead, filters, sort, substitutes, and the trip optimizer read that database first. A live provider call runs only when the database has nothing for that shelf or line, and the result is written back. Aldi and Target stay on the demo shelf. The one-page Walmart sample and the two-term Kroger sample above are the fallback while the database is empty.

## Catalog ingestion

A background job fills `CatalogMaster` (one row per UPC) and `CatalogOffer` (one price per store and, for Kroger, per location). Restarts continue from the checkpoint. Upserts are idempotent. Items not seen for `CATALOG_STALE_DAYS` (14) are marked stale; after `CATALOG_DISCONTINUE_DAYS` (45) they are discontinued and drop off the shelf. Images stay on the master.

### What each provider can actually fill

Checked 2026-09-25.

| Provider | Browse mechanism | Published limit | Job budget (defaults) |
| --- | --- | --- | --- |
| **Walmart Affiliate** | `GET /taxonomy`, then `GET /paginated/items?category=&count=25`. The next page is the response `nextPage` (URL or cursor). Stop when `nextPage` is empty or `nextPageExist` is false. Only grocery leaves are walked (electronics and similar paths are skipped). UPC is read from `upc` or `gtin` (string or number) so a row can share a Kroger master. | The public Affiliate introduction and taxonomy pages do **not** publish a numeric daily quota. Marketplace rate-limit tables are a different API and are not used here. HTTP **429** is the throttle. Search documents `numItems` max 25, so each catalog page asks for 25. | **1,500 calls/day**, at least **5 seconds** apart, and that gap is kept across scheduler ticks. The 1,500 figure is a hard ledger: a call is counted only when the day's row is still under the cap. Shopper calls are not charged against this ledger and are never refused by it. |
| **Kroger Products** | No category browse. `GET /v1/products` with `filter.term`, optional `filter.brand`, `filter.locationId`, `filter.start`, and `filter.limit`. A full page advances `filter.start`. A short page ends the term. A **400** ends that term (it is not retried). Three 400s in a row on the same `locationId` skip that store. | **10,000 product calls/day**. **1,600 location calls/day**. Published docs describe `filter.start` as how many rows to skip and `filter.limit` as how many to return. They do not publish a maximum `filter.start`. Locations documents `filter.limit` max **200**; this job asks for **50**. A start past what Products will accept comes back as **400**. | **4,000 product calls/day** (6,000 left for shoppers and on-demand refresh), **200 location calls/day**, at least **500 ms** apart. |
| **Kroger prices** | Stored per `locationId`. The product master is written once, keyed by UPC with leading zeros stripped (UPC-A, EAN-13, and GTIN-14 of the same code share one master). The offer key is product + store + location, so six seed stores are six offers. | — | Seed ZIPs `45103` (Brandon), `10001`, `60601`, `75201`, `90012`, `30303`, plus up to 12 ZIPs that real shoppers have used (`hits` > 0). Seeds are not written into the shopper-ZIP list. A new shopper ZIP is priced on the next tick (inserted in front of the Kroger walk). A finished cycle starts again after `CATALOG_REFRESH_HOURS` (24). Ingest never substitutes the demo location id `01400441` when a ZIP lookup fails. |
| **Target, Aldi, other banners** | No catalog ingestion. | — | Demo shelf only. Flipp weekly ads stay on the trip plan. |

A Walmart **429** keeps the same category and `nextPage`, sets status to paused, and waits 15 minutes (doubling each strike in a row, capped at 6 hours and at the next UTC midnight). The next tick does not call Walmart until that time, then it resumes the same page. A run does not stay paused overnight. Other 5xx responses still use a short backoff (1s, 2s, 4s, … capped at 60s) and, after 5 failures, skip that category. A Kroger **400** is logged with provider, status, term, brand, start, limit, locationId, and ZIP (no secrets) and that term is skipped. `runs[].calls` counts each HTTP call once. `budget.*.used` / `budget.*.limit` is the daily ledger. Read the ledger for the cap; the run counter is only a progress total.

The first production day (2026-09-25) showed `calls` well above 1,500 because each page save added the tick's running total again, and showed `offers == products` because a numeric Walmart `upc` was dropped, so those rows were stored as `local:walmart:{itemId}` and could not share a Kroger master. Kroger had also only priced the first seed store at that point. Seed ZIPs were inserted into `shopperZips` with `hits: 0`. Those three are fixed on the next deploy. Existing Mongo rows are kept. See the cleanup section below before deleting anything.

### Size and time

At the default caps (40,000 products, 160,000 offers) the estimate is about **1.2 KB × products + 0.4 KB × offers**, roughly **110 MB** of documents, and often about the same again for indexes, so plan on **about 200 MB**. New UPCs and offers are refused at the cap; prices for keys already stored still refresh.

Walmart: 1,500 calls × 25 items is at most ~37,500 rows per day, and the 5 second gap is about 2 hours of call time, spread by the scheduler. A grocery taxonomy of ~1,000 leaves × a few pages is on the order of **a few days** for a first fill at this budget. Kroger: 6 locations × ~70 terms × up to 8 pages is a few thousand calls, so **one full pass fits in the 4,000 call day**. The term list is `src/ingest/krogerTerms.ts` (`KROGER_TERMS_VERSION`). Bump the version when the list changes so a resume does not skip ahead.

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
3. **New service** (empty start command override):
   - Start command: `npm run ingest`
   - `CATALOG_INGEST_ENABLED=true`
   - Same `MONGO_URL` and the same Walmart and Kroger keys.
   - Do not set `PORT` handling; the process does not serve HTTP. It loops until Railway sends SIGTERM, then the next boot resumes the checkpoint.
4. Optional on that worker: `WALMART_INGEST_DAILY_BUDGET`, `KROGER_INGEST_DAILY_BUDGET`, `KROGER_LOCATION_DAILY_BUDGET`, `WALMART_INGEST_MIN_INTERVAL_MS`, `KROGER_INGEST_MIN_INTERVAL_MS`, `CATALOG_INGEST_INTERVAL_SECONDS` (20), `CATALOG_INGEST_BATCH_CALLS` (4), `CATALOG_SEED_ZIPS`, `CATALOG_MAX_PRODUCTS`, `CATALOG_MAX_OFFERS`, `CATALOG_STALE_DAYS`, `CATALOG_DISCONTINUE_DAYS`, `CATALOG_REFRESH_HOURS`, `WALMART_INGEST_ENABLED`, `KROGER_INGEST_ENABLED`.
5. Single-service alternative: set `CATALOG_INGEST_ENABLED=true` on the web service only. `src/index.ts` starts an in-process timer. A Mongo lock stops a second replica from crawling at the same time. Checkpoints still resume after a restart.
6. Progress: `curl -H "Authorization: Bearer $ADMIN_TOKEN" https://grocery-price-optimizer-production.up.railway.app/api/admin/catalog/status`  
   The JSON has counts per store and department, checkpoint phase, `budget.walmart.used` / `limit` (and the same for Kroger), `cooldownUntil` after a 429, and `errors[]` with provider, status, params, and timestamp. `shopperZips` is real demand (`hits` > 0). `seedZips` and `seedLocations` are the configured metros. The route returns 503 until `ADMIN_TOKEN` is set and 401 when the token is wrong.
7. After the budget fix is deployed, you do **not** need a new variable. Redeploy the web service (the in-process scheduler picks up the new code). If `WALMART_INGEST_MIN_INTERVAL_MS` is set on Railway, a value of `2000` still overrides the new 5 second default — delete it or set `5000`. Leave `WALMART_INGEST_DAILY_BUDGET` unset to keep 1,500, or set it if you want a different hard cap.
8. Existing products and offers stay. Do not drop the database. The crawl resumes from the checkpoint. Two optional cleanups, both refused unless the JSON body carries the exact `confirm` string:
   - Zero the inflated `calls` / `upserted` counters (the crawl position is kept):  
     `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"confirm":"reset-run-counters"}' https://grocery-price-optimizer-production.up.railway.app/api/admin/catalog/reset-run-counters`
   - After Walmart has been crawled again and UPC masters exist, delete `local:` rows that duplicate those UPCs (rows that still have no UPC are kept):  
     `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"confirm":"drop-shadow-local-keys"}' https://grocery-price-optimizer-production.up.railway.app/api/admin/catalog/drop-shadow-local-keys`  
   Nothing runs these on boot.

Local demo, no keys:

```bash
npm run ingest:demo
```

## Phone and tablet apps (later)

This PR does **not** add Xcode or Android Studio projects. The UI is a static SPA in `public/` (no frontend build), with a web manifest, icons, and a network-first service worker so it can be installed as a PWA.

Recommended store path when you are ready:

1. Keep secrets on the Express server. The native shell should load the deployed site, not embed API keys.
2. Add Capacitor in a follow-up (not this PR):

```bash
npm install @capacitor/core @capacitor/ios @capacitor/android
npm install -D @capacitor/cli
npx cap init "Grocery Gitter" com.grocerygitter.app --web-dir public
```

3. Point the WebView at production so Railway stays the API and the UI updates with the site:

```ts
// capacitor.config.ts
const config = {
  appId: "com.grocerygitter.app",
  appName: "Grocery Gitter",
  webDir: "public",
  server: { url: "https://grocery-price-optimizer-production.up.railway.app", cleartext: false },
};
```

4. Open Kroger, Walmart, Target, and Instacart handoffs in the system browser (`@capacitor/browser`) so OAuth cookies and add-to-cart links work. The Kroger redirect URI stays the Railway HTTPS callback.
5. Android can ship the PWA first. iOS Add to Home Screen uses `/icons/apple-touch-icon.png` until the Capacitor shell exists.

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
| **Walmart** | Official Affiliate Marketing API `GET https://developer.api.walmart.com/api-proxy/service/affil/product/v2/search` with RSA headers (`WM_CONSUMER.ID`, timestamp, key version, `WM_SEC.AUTH_SIGNATURE`). `GET /stores?zip=` (cached per ZIP) for the nearest store name and address. | Demo catalog, badge **Demo catalog**. No red banner (keys are optional). Search handoff, no cart link. | **walmart.com catalog** prices. The Affiliate search API has **no store-price filter**, so the nearest store is a label only. Sign up at [walmart.io](https://walmart.io/apidocs/affiliates/quickstart), upload a public key, set `WALMART_CONSUMER_ID` and `WALMART_PRIVATE_KEY` (PEM; `\n` for newlines). `WALMART_PUBLISHER_ID` is optional until Impact approval. |
| **Target** | **No public product API.** This app does **not** call RedSky. If you have a licensed partner feed, `GET {TARGET_PARTNER_BASE_URL}/products?query=&zip=` with `Authorization: Bearer {TARGET_PARTNER_API_KEY}` expecting `{ "products": [{ "name", "brand", "price", "productId"|"tcin", "upc", "unit" }] }`. | Demo catalog until those env vars or Flipp weekly ads are set. | Partner-feed prices tagged live. |
| **Aldi** (and Publix-like banners) | No retailer product API. Optional **Flipp weekly-ad** provider (see below). Handoff stays Coming soon — no fake cart. | Demo catalog | Weekly-ad / circular prices near the ZIP when Flipp is enabled |

Configured **partner feeds** (Publix, Meijer, H-E-B, Instacart-style banners, Datasembly-class shelf file) use the same optimize path when `SHELF_FEED_*` / `INSTACART_PARTNER_*` / `PUBLIX_PARTNER_*` / `HEB_PARTNER_*` / `MEIJER_PARTNER_*` are set. Hits are labeled **Partner feed**, not a fake retailer API. See [`docs/PARTNER_INTEGRATIONS.md`](docs/PARTNER_INTEGRATIONS.md). Licensed shelf feeds beat Flipp weekly ads for the same banner. Unconfigured partner banners are not added to the default trip.

Each optimize response includes `pricingByStore` and each store group includes `pricing: { source, label, detail, error? }`. `source` is `live`, `cached_live`, `partner_feed`, `weekly_ad`, `cached_weekly_ad`, `seed`, `mixed`, or `unavailable`. Labels are **Live prices**, **Partner feed**, **Weekly ad**, or **Demo catalog**. A configured provider that fails sets `pricingWarning` (partial success still returns 200). If **no** item can be priced at all, the route still returns **503**.

## Weekly-ad / multi-store deals (Flipp)

Banners without a public grocery API (Aldi, Target when the partner feed is absent, Publix, Meijer, and other mapped circulars) can leave the seed catalog during testing by opting into Flipp flyer data.

**Weekly ad ≠ live shelf.** Flipp returns items printed in the current circular near a ZIP. Items not on the flyer are not priced from this source. Grocery Gitter labels those rows **Weekly ad** and never reports “added to cart.”

| Path | When | What it calls | Honesty / risk |
| --- | --- | --- | --- |
| **FlyerKit v4.0** (preferred) | `FLIPP_ACCESS_TOKEN` is set | Documented `GET https://api.flipp.com/flyerkit/v4.0/publications/{merchant_identifier}/products?access_token=&locale=en-US&postal_code=&keywords=` ([FlyerKit docs](https://api.flipp.com/flyerkit/v4.0/documentation)). Tokens are issued by a Flipp technical contact (typically merchant-scoped). | Legitimate partner API. |
| **Consumer flyer search** | `FLIPP_ENABLED=true` | Unofficial JSON used by flipp.com: `GET https://backflipp.wishabi.com/flipp/items/search?locale=en-us&postal_code={ZIP}&q={merchant AND term}`. **No HTML scrape, no retailer login.** | Not a public contract. Flipp terms may restrict automated access. Production must set `FLIPP_ENABLED=true` explicitly. Prefer FlyerKit if Flipp issues a token. |

Mapped Grocery Gitter `storeName`s: **Aldi**, **Target**, **Walmart**, **Kroger** (including family banners such as Ralphs / King Soopers / Harris Teeter as a *secondary* signal — live Kroger Products still wins when configured), **Publix**, **Meijer**, **Food Lion**, **H-E-B**, **Safeway**, **Giant Eagle**, **Costco**. Request extra banners via `stores` on optimize-list; the default trip still considers Kroger, Walmart, Target, and Aldi.

Pipeline: dedicated retailer APIs run first. Flipp fills in when that API is missing, empty, or failed **and** a ZIP is present. Flyer items without a numeric `current_price` (BOGO / “% off” only) are skipped so we do not invent a price.

This app does **not** scrape authenticated Aldi, Target, or Publix storefronts.

## Checkout handoff (Phases 1 and 3)

See [`docs/PRODUCT_ROADMAP.md`](docs/PRODUCT_ROADMAP.md) for the 15/5/10 multi-cart vision.

After optimize, each store group includes a `handoff` object: `storeName`, `itemCount`, `subtotal`, items with identity for checkout, and `action: { type, label, url?, status, detail?, fallbackUrl? }`.

| Retailer | Action | What it actually does |
| --- | --- | --- |
| **Kroger** | `search_deeplink` → **Open at Kroger** | Default when `KROGER_REDIRECT_URI` is unset, or when items have no UPC. Public `https://www.kroger.com/search?query=` using `productId`/UPC when the Products API returned one, otherwise the item name. Shopper adds to cart on kroger.com. |
| **Kroger** | `kroger_cart` → **Add to Kroger cart** | When `KROGER_REDIRECT_URI` is set **and** at least one item has a UPC/`productId`. Starts **authorization-code** OAuth (`cart.basic:write`). The shopper must log in. Then `PUT https://api.kroger.com/v1/cart/add`. Client-credentials used for pricing **cannot** do this. |
| **Walmart** | `walmart_cart` → **Add N items to Walmart cart** | When every Walmart line has a numeric Affiliate `itemId` (live or cached live). One link: `https://affil.walmart.com/cart/addToCart?items=ITEMID\|QTY,ITEMID\|QTY` ([GM add to cart](https://walmart.io/docs/affiliates/v1/gm-add-to-cart), item field `addToCartUrl`). If `WALMART_PUBLISHER_ID` is set, that URL is wrapped with the Impact template from [`productTrackingUrl`](https://walmart.io/apidocs/affiliates/reviews): `https://goto.walmart.com/c/{publisherId}/568844/9383?veh=aff&sourceid=imp_000011112222333344&u=…`. If it is unset, the unwrapped link still opens the cart. This is a shopper handoff, not an API cart write — Grocery Gitter does not report the cart as filled. Any line without a Walmart item id (demo catalog, or a Flipp flyer id) falls back to **Search at Walmart**. |
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
| `npm run build` | Compile to `dist/` |
| `npm start` | Run compiled `dist/index.js` |
| `npm run typecheck` | `tsc --noEmit` |

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
