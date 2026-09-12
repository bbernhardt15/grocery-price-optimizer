# Grocery List Optimizer API

Node.js Express backend (TypeScript) that will optimize a grocery list against product prices at different stores.

## What it includes

- **Product** Mongoose schema: `name`, `brand`, `storeName`, `price`, `unit` (oz, lbs, count, …), `normalizedUnit`, `lastUpdated`
- **`POST /api/optimize-list`** — accepts a grocery list and currently returns `[]` (placeholder)

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

The API listens on **http://localhost:43141** by default (`PORT` in `.env`).

MongoDB is optional for the placeholder route. If nothing is running at `MONGODB_URI`, the server still starts and `/api/optimize-list` works. Start MongoDB when you persist or query `Product` documents:

```bash
# example
docker run -d -p 27017:27017 --name grocery-mongo mongo:7
```

## Endpoints

### `GET /`

Health/info JSON.

### `POST /api/optimize-list`

Send either a raw string array or `{ "items": [...] }`.

```bash
curl -s -X POST http://localhost:43141/api/optimize-list \
  -H "Content-Type: application/json" \
  -d '["milk", "eggs", "bread"]'
```

```bash
curl -s -X POST http://localhost:43141/api/optimize-list \
  -H "Content-Type: application/json" \
  -d '{"items":["milk","eggs","bread"]}'
```

Both currently respond with `[]`.

Invalid bodies return `400`.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | TypeScript watch server (`tsx`) |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run compiled `dist/index.js` |
| `npm run typecheck` | `tsc --noEmit` |

## Product schema

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | Required |
| `brand` | string | Required |
| `storeName` | string | Required |
| `price` | number | Required, ≥ 0 |
| `unit` | string | Package unit: `oz`, `lbs`, `count`, `g`, `kg`, `ml`, `l`, `gal` |
| `normalizedUnit` | string | Canonical unit for price-per-unit comparison (same enum) |
| `lastUpdated` | Date | Defaults to now |
