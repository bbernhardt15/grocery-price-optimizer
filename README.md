# Grocery Gitter

The product is **Grocery Gitter**. This GitHub repository’s slug remains `grocery-price-optimizer` (npm package id: `grocery-list-optimizer`).

Node.js Express backend (TypeScript) that maps each grocery item to the store selling it at the lowest price, then groups the shopping trip by store so you can actually buy the split cart. A vanilla HTML dashboard is served from `public/`.

## What it includes

- **Dashboard** — Grocery Gitter search-first UI: pick catalog items with quantities, add a ZIP, click **Find Cheapest Stores**, see a trip plan (`15 Kroger + 5 Walmart + 10 Target`), **Live prices** / **Partner feed** / **Weekly ad** / **Demo catalog** badges per store, and a primary Open / Add to cart / Coming soon action per store
- **Product** Mongoose schema: `name`, `brand`, `storeName`, `locationId`, `productId`, `upc`, `price`, `size` (optional retailer package text), `unit`, `normalizedUnit`, `priceSource` (`live` \| `weekly_ad` \| `seed`), `lastUpdated`, `updatedAt`
- **`optimizeGroceryList`** — pure function that picks one product per item (the product itself, then the fair package price) and groups by `storeName`
- **`storeHandoff`** — attaches checkout actions (Kroger search / optional cart OAuth, Walmart/Target search stubs)
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
| **Walmart** | Official Affiliate Marketing API `GET https://developer.api.walmart.com/api-proxy/service/affil/product/v2/search` with RSA headers (`WM_CONSUMER.ID`, timestamp, key version, `WM_SEC.AUTH_SIGNATURE`). Optional `GET /stores?zip=` for a nearby store id only. | Demo catalog, badge **Demo catalog**. No red banner (keys are optional). | **walmart.com catalog** prices (the Affiliate search API has no in-aisle store filter). Sign up at [walmart.io](https://walmart.io/apidocs/affiliates/quickstart), upload a public key, set `WALMART_CONSUMER_ID`, `WALMART_PRIVATE_KEY` (PEM; `\n` for newlines), `WALMART_PUBLISHER_ID`. |
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
| **Walmart / Target** | `search_deeplink` | Public search URLs. Not a cart fill — authenticated cart APIs need partner access (Phase 3 table). Grocery Gitter does not invent those APIs. |
| **Publix / H-E-B / Meijer / Albertsons family / Ahold / club / Amazon** | `search_deeplink` | Public search URLs with honest copy (club membership; no third-party cart-write). |
| **Aldi / unknown banners** | `coming_soon` | No fake checkout. |

Grocery Gitter **never** reports a successful cart fill unless Kroger’s Cart API returns HTTP 2xx. Cancelled login, missing scopes, or a rejected UPC fall back to Open at Kroger search links.

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
