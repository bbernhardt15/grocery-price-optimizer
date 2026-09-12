# Grocery List Optimizer API

Node.js Express backend (TypeScript) that maps each grocery item to the store selling it at the lowest price, then groups the shopping trip by store.

## What it includes

- **Product** Mongoose schema: `name`, `brand`, `storeName`, `price`, `unit`, `normalizedUnit`, `lastUpdated`
- **`optimizeGroceryList`** — pure function that picks the cheapest matching product per item and groups by `storeName`
- **`POST /api/optimize-list`** — loads matching products from MongoDB, then runs that function
- **`npm run scrape -- "milk"`** — Puppeteer script that searches Vitacost and returns title/price JSON

On first launch with an empty database the API seeds a sample catalog for Aldi, Walmart, Kroger, and Target. If nothing is listening on `MONGODB_URI` / localhost:27017, it starts an in-memory MongoDB so product queries still hit a real database.

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

The API listens on **http://localhost:43141** by default.

To use your own MongoDB, set `MONGODB_URI` in `.env`.

## Endpoints

### `GET /`

Health/info JSON.

### `POST /api/optimize-list`

```bash
curl -s -X POST http://localhost:43141/api/optimize-list \
  -H "Content-Type: application/json" \
  -d '{
    "groceryList": ["milk", "eggs", "bread", "bananas", "chicken", "rice", "apples", "butter"],
    "stores": ["Aldi", "Walmart", "Kroger", "Target"]
  }'
```

`stores` is optional. Omit it (or send `[]`) to consider every store in the catalog. `items` is accepted as an alias for `groceryList`.

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
          "unit": "gal",
          "normalizedUnit": "gal"
        }
      ],
      "subtotal": 4.57
    }
  ],
  "unavailable": ["saffron"],
  "total": 16.26
}
```

Each grocery item is assigned to **one** store: the retailer in `stores` whose matching product has the lowest shelf `price`. Matching is a case-insensitive substring on product `name` (so `"milk"` matches `"Whole Milk"`). Items with no match appear in `unavailable`.

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

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | TypeScript watch server (`tsx`) |
| `npm test` | Unit tests for the optimizer and scraper |
| `npm run scrape -- "milk"` | Puppeteer grocery search → JSON |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run compiled `dist/index.js` |
| `npm run typecheck` | `tsc --noEmit` |

## Product schema

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | Required |
| `brand` | string | Required |
| `storeName` | string | Required |
| `price` | number | Required, ≥ 0. Used as the comparison price. |
| `unit` | string | Package unit: `oz`, `lbs`, `count`, `g`, `kg`, `ml`, `l`, `gal` |
| `normalizedUnit` | string | Canonical unit for later price-per-unit work (same enum) |
| `lastUpdated` | Date | Defaults to now |
