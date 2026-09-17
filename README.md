# Grocery List Optimizer API

Node.js Express backend (TypeScript) that maps each grocery item to the store selling it at the lowest price, then groups the shopping trip by store. A vanilla HTML dashboard is served from `public/`.

## What it includes

- **Dashboard** — search the catalog, pick verified items with quantities, add a ZIP, click **Find Cheapest Stores**, see a trip plan (`15 Kroger + 5 Walmart + 10 Target`) and a primary Open / Add to cart / Coming soon action per store
- **Product** Mongoose schema: `name`, `brand`, `storeName`, `locationId`, `productId`, `upc`, `price`, `unit`, `normalizedUnit`, `lastUpdated`, `updatedAt`
- **`optimizeGroceryList`** — pure function that picks the cheapest matching product per item and groups by `storeName`
- **`storeHandoff`** — attaches checkout actions (Kroger search / optional cart OAuth, Walmart/Target search stubs)
- **`GET /api/search-catalog`** — FatSecret catalog autocomplete (`?query=milk`)
- **`npm run scrape -- "milk"`** — Puppeteer script that searches Vitacost and returns title/price JSON

On first launch with an empty database the API seeds a sample catalog for Aldi, Walmart, Kroger, and Target. Set `MONGO_URL` (preferred in cloud) to connect to Atlas or any MongoDB and skip the in-memory server. If `MONGO_URL` is unset and nothing is listening on `MONGODB_URI` / localhost:27017, local dev starts an in-memory MongoDB.

## Kroger Locations API

`src/krogerService.ts` talks to Kroger’s official Locations API (`https://api.kroger.com/v1/locations`). `getClosestStoreLocation(zipCode)` sends `filter.zipCode.near` and `filter.limit=1`, then returns that store’s `locationId`.

Auth is client-credentials: the service POSTs to `/v1/connect/oauth2/token` with `KROGER_CLIENT_ID` / `KROGER_CLIENT_SECRET` and reuses the bearer token until it expires. Set those values in `.env` (see `.env.example`). If credentials are missing or the official API rejects them, the service returns a demo `locationId` (`01400441`) so the dashboard still prices the seeded Kroger catalog.

`POST /api/optimize-list` treats MongoDB as a 24-hour price cache. For each grocery item it first queries products whose `updatedAt` is less than a day old. A hit skips the live Products API. A miss (`GET https://api.kroger.com/v1/products?filter.term=…`) upserts the fresh rows with `findOneAndUpdate` (`upsert: true`) before the optimizer splits the trip. Live Kroger rows keep `productId` / `upc` so checkout handoff can deep-link or (later) call Cart API.

## Checkout handoff (Phase 1)

See [`docs/PRODUCT_ROADMAP.md`](docs/PRODUCT_ROADMAP.md) for the 15/5/10 multi-cart vision.

After optimize, each store group includes a `handoff` object: `storeName`, `itemCount`, `subtotal`, items with identity for checkout, and `action: { type, label, url?, status, detail? }`.

| Retailer | Phase 1 action | What it actually does |
| --- | --- | --- |
| **Kroger** | `search_deeplink` → **Open at Kroger** | Public `https://www.kroger.com/search?query=` using `productId`/UPC when the Products API returned one, otherwise the item name. Shopper adds to cart on kroger.com. |
| **Kroger** (optional) | `kroger_cart` → **Add to Kroger cart** | Only when `KROGER_REDIRECT_URI` is set **and** at least one item has a UPC. Starts **authorization-code** OAuth (`cart.basic:write`). The shopper must log in. Then `PUT https://api.kroger.com/v1/cart/add`. Client-credentials used for pricing **cannot** do this. |
| **Walmart / Target** | `search_deeplink` | Public search URLs. Not a cart fill — those APIs are typically closed or partner-only. |
| **Aldi / others** | `coming_soon` | No fake checkout. |

The app **never** reports a successful cart fill unless Kroger’s Cart API returns HTTP 2xx.

### Optional Kroger shopper OAuth

Production already uses `KROGER_CLIENT_ID` / `KROGER_CLIENT_SECRET` for Locations and Products (`product.compact`, client-credentials). Cart write needs extra setup:

1. In the [Kroger developer portal](https://developer.kroger.com/), add a redirect URI such as `http://localhost:3000/api/kroger/oauth/callback` (or your production HTTPS equivalent).
2. Confirm the app is allowed to request `cart.basic:write` (some public apps are not; if authorize/cart add fails, keep using Open at Kroger).
3. Set in `.env`:

```bash
KROGER_REDIRECT_URI=http://localhost:3000/api/kroger/oauth/callback
# optional; default cart.basic:write
KROGER_CART_SCOPE=cart.basic:write
# optional; default PICKUP
KROGER_CART_MODALITY=PICKUP
```

Routes:

- `GET /api/kroger/auth-status` — whether redirect URI is configured
- `POST /api/kroger/cart/start` — JSON `{ items, locationId? }` from the Kroger handoff; returns `{ authorizeUrl, status: "needs_shopper_login" }` or **501** if OAuth is not set up
- `GET /api/kroger/oauth/callback` — exchanges the code, calls Cart API, shows success **only** if Kroger acknowledged the write

Pending cart payloads live in memory on this Node process (~15 minutes). Multi-instance production would need a shared store.

## FatSecret catalog

`src/services/fatsecretService.ts` talks to FatSecret’s Platform API. `getAccessToken()` POSTs an OAuth 2.0 client-credentials form (`grant_type=client_credentials`, `scope=premier`, `client_id`, `client_secret`) to `https://oauth.fatsecret.com/connect/token` and caches the bearer token until it is within 60 seconds of expiry. `searchGlobalCatalog(query)` then `GET`s `https://platform.fatsecret.com/rest/server.api` with `method=foods.search.v3`, `search_expression`, `format=json`, and `Authorization: Bearer`. Results are `{ id, name, brand }`.

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

Open **http://localhost:3000** for the dashboard. The API is on the same origin (`POST /api/optimize-list`).

To use your own MongoDB, set `MONGO_URL` (or `MONGODB_URI`) in `.env`. When `MONGO_URL` is set, the in-memory fallback is never loaded.

## Endpoints

### `GET /`

Grocery dashboard (`public/index.html`).

### `GET /api`

Health/info JSON.

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

`zipCode` looks up the closest Kroger via `getClosestStoreLocation` and uses that `locationId` for Kroger shelf prices. Other catalog retailers (Walmart, Target, Aldi) still compete on price so the trip can split. `stores` is optional and further limits retailers. Omit `stores` (or send `[]`) to consider every matching product (Kroger at the resolved location plus other stores). `items` is accepted as an alias for `groceryList`.

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
          "type": "search_deeplink",
          "label": "Open at Kroger",
          "url": "https://www.kroger.com/search?query=0001111041700",
          "status": "ready",
          "detail": "Opens Kroger search for these items. Writing the shopper cart requires authorization-code OAuth…"
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
  "locationId": "01400441"
}
```

Each grocery item is assigned to **one** store: the retailer in `stores` whose matching product has the lowest shelf `price`. Matching splits the name into keywords (ignoring FatSecret serving annotations like `(28g)`) and requires those tokens in product `name` case-insensitively (so `"milk"` matches `"Whole Milk"`). If nothing matches the full FatSecret name (e.g. `"Honey Nut Cheerios Cereal"`), the lookup retries without generic trailing words (`"Honey Nut Cheerios"`) and then the first two words (`"Honey Nut"`). Store `subtotal` and the list `total` use `itemTotal`. `tripPlan.summary` is the shopper-facing split (`15 Kroger + 5 Walmart + 10 Target`). Items with no match appear in `unavailable`. When live Kroger pricing is down and **no** item can be priced from the local catalog, `POST /api/optimize-list` returns **503** with an actionable `error` instead of a silent `$0.00` empty trip. When `zipCode` is sent, `locationId` is the Kroger store used for those prices.

### `GET /api/kroger/auth-status`

Whether `KROGER_REDIRECT_URI` is set. Always `requiresShopperLogin: true` — client-credentials cannot write a cart.

### `POST /api/kroger/cart/start`

JSON body `{ "items": [{ "upc" or "productId", "quantity" }], "locationId?" }`. Returns `{ authorizeUrl, status: "needs_shopper_login" }` or **501** / **400** with an honest error. Does not add anything to a cart by itself.

### `GET /api/kroger/oauth/callback`

Kroger redirect after shopper login. Exchanges the code and calls `PUT /v1/cart/add`. Success HTML is shown only when that write is acknowledged.

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
| `unit` | string | Package unit: `oz`, `lbs`, `count`, `g`, `kg`, `ml`, `l`, `gal` |
| `normalizedUnit` | string | Canonical unit for later price-per-unit work (same enum) |
| `lastUpdated` | Date | Defaults to now |
| `updatedAt` | Date | Set automatically by Mongoose on insert and every save. Indexed with `name`. |
