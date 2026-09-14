# Grocery List Optimizer API

Node.js Express backend (TypeScript) that maps each grocery item to the store selling it at the lowest price, then groups the shopping trip by store. A vanilla HTML dashboard is served from `public/`.

## What it includes

- **Dashboard** — paste a list and ZIP, click **Find Cheapest Stores**, see per-store cards and a grand total
- **Product** Mongoose schema: `name`, `brand`, `storeName`, `locationId`, `price`, `unit`, `normalizedUnit`, `lastUpdated`, `updatedAt`
- **`optimizeGroceryList`** — pure function that picks the cheapest matching product per item and groups by `storeName`
- **`POST /api/optimize-list`** — looks up the nearest Kroger from `zipCode`, serves prices from a 24-hour Mongo cache (live Kroger Products API on miss), then runs that function
- **`npm run scrape -- "milk"`** — Puppeteer script that searches Vitacost and returns title/price JSON

On first launch with an empty database the API seeds a sample catalog for Aldi, Walmart, Kroger, and Target. Set `MONGO_URL` (preferred in cloud) to connect to Atlas or any MongoDB and skip the in-memory server. If `MONGO_URL` is unset and nothing is listening on `MONGODB_URI` / localhost:27017, local dev starts an in-memory MongoDB.

## Kroger Locations API

`src/krogerService.ts` talks to Kroger’s official Locations API (`https://api.kroger.com/v1/locations`). `getClosestStoreLocation(zipCode)` sends `filter.zipCode.near` and `filter.limit=1`, then returns that store’s `locationId`.

Auth is client-credentials: the service POSTs to `/v1/connect/oauth2/token` with `KROGER_CLIENT_ID` / `KROGER_CLIENT_SECRET` and reuses the bearer token until it expires. Set those values in `.env` (see `.env.example`). If credentials are missing or the official API rejects them, the service returns a demo `locationId` (`01400441`) so the dashboard still prices the seeded Kroger catalog.

`POST /api/optimize-list` treats MongoDB as a 24-hour price cache. For each grocery item it first queries products whose `updatedAt` is less than a day old. A hit skips the live Products API. A miss (`GET https://api.kroger.com/v1/products?filter.term=…`) upserts the fresh rows with `findOneAndUpdate` (`upsert: true`) before the optimizer splits the trip.

## FatSecret catalog

`src/services/fatsecretService.ts` talks to FatSecret’s Platform API. `searchGlobalCatalog(query)` requests an OAuth 2.0 client-credentials token from `https://oauth.fatsecret.com/connect/token` (Basic auth plus form body using `FATSECRET_CLIENT_ID` / `FATSECRET_CLIENT_SECRET`), caches it until `expires_in`, then `GET https://platform.fatsecret.com/rest/foods/search/v5` with `Authorization: Bearer`. Results are `{ name, brand, foodId }` (and `barcode` when present).

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

`zipCode` looks up the closest Kroger via `getClosestStoreLocation` and restricts product matches to that store’s `locationId`. `stores` is optional and further limits retailers. Omit `stores` (or send `[]`) to consider every matching product at the resolved location (or the full catalog if `zipCode` is omitted). `items` is accepted as an alias for `groceryList`.

Counts can sit at the start or end of a line: `"2 Milk"`, `"Milk x2"`, `"3 Eggs"`. The clean name is used for the catalog search; `price` is the unit price and `itemTotal` is `price * quantity`.

Response shape:

```json
{
  "stores": [
    {
      "storeName": "Aldi",
      "items": [
        {
          "query": "milk",
          "name": "Whole Milk",
          "brand": "Friendly Farms",
          "storeName": "Aldi",
          "price": 2.19,
          "quantity": 2,
          "itemTotal": 4.38,
          "unit": "gal",
          "normalizedUnit": "gal"
        }
      ],
      "subtotal": 4.38
    }
  ],
  "unavailable": ["saffron"],
  "total": 4.38,
  "zipCode": "45202",
  "locationId": "01400441"
}
```

Each grocery item is assigned to **one** store: the retailer in `stores` whose matching product has the lowest shelf `price`. Matching is a case-insensitive substring on product `name` (so `"milk"` matches `"Whole Milk"`). Store `subtotal` and the list `total` use `itemTotal`. Items with no match appear in `unavailable`. When `zipCode` is sent, `locationId` is the Kroger store used for those prices.

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
| `price` | number | Required, ≥ 0. Used as the comparison price. |
| `unit` | string | Package unit: `oz`, `lbs`, `count`, `g`, `kg`, `ml`, `l`, `gal` |
| `normalizedUnit` | string | Canonical unit for later price-per-unit work (same enum) |
| `lastUpdated` | Date | Defaults to now |
| `updatedAt` | Date | Set automatically by Mongoose on insert and every save. Indexed with `name`. |
