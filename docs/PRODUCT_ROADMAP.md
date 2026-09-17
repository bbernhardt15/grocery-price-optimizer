# Grocery Gitter — product roadmap

**Goal:** the shopper picks specific grocery items. The app assigns each item to the cheapest retailer that can take an online order (example: **15 Kroger + 5 Walmart + 10 Target**), then helps push those selections toward each retailer’s cart/checkout so the split trip can actually be bought.

This is not a single-store price comparison page. The durable product is a **multi-cart trip plan**.

## What exists today

- Grocery Gitter search-first dashboard: pick catalog items, ZIP, **Find Cheapest Stores**
- `POST /api/optimize-list` groups the list by cheapest `storeName` with unit prices and subtotals
- Trip plan summary + per-store checkout handoff (Phase 1)
- Live Kroger **Products** and **Locations** APIs via **client-credentials** (`product.compact`)
- Pluggable store pricing providers: Kroger (live), Walmart Affiliate API (live when keys are set), Target licensed partner feed (live only with a contracted base URL)
- Seed catalog samples for Aldi, Walmart, Kroger, and Target — labeled **Demo catalog** until a live provider returns rows
- Dashboard badges + `pricingByStore` so live vs demo is obvious

Client-credentials can look up stores and shelf prices. They **cannot** write a shopper’s Kroger, Walmart, or Target cart.

---

## Phase 1 — Trip plan + Kroger handoff (unmerged on `cursor/trip-plan-kroger-handoff-5b62`, included in this PR)

Customer-visible slice:

1. After optimize, show a trip plan summary (`15 Kroger + 5 Walmart + 10 Target`) and a primary action on each store card.
2. Each store group in the API includes a **handoff** object: item identities (name, brand, quantity, price, `productId` / `upc` / `locationId` when known) plus an `action` of `kroger_cart` | `search_deeplink` | `coming_soon`.
3. **Kroger (working path):** “Open at Kroger” search/product deep links using `productId`/UPC when the Products API returned them, otherwise the item name. Shopper completes add-to-cart on kroger.com.
4. **Kroger (optional next step in this phase):** authorization-code OAuth (`cart.basic:write`) + `PUT /v1/cart/add` when `KROGER_REDIRECT_URI` is registered. This **requires the shopper to log in** at Kroger. It is not the client-credentials token already used for pricing. If the Cart API rejects the app (missing partner/cart scopes) the UI stays on deep links and does **not** pretend the cart was filled.
5. **Walmart + Target:** same handoff shape with public search deep links (and honest copy that authenticated cart APIs are closed or partner-only). Live pricing for those retailers is Phase 2.
6. **Aldi / others:** `coming_soon` — no fake checkout.

---

## Phase 2 — Live multi-store pricing (this PR)

Price the same verified items at more than Kroger so the 15/5/10 split reflects real local shelves **when a documented live source exists**:

| Store | Live source | Status | Keys |
| --- | --- | --- | --- |
| **Kroger** | Official Locations + Products APIs (`product.compact`) | Working (unchanged) | `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET` |
| **Walmart** | Official [Affiliate Marketing API](https://walmart.io/apidocs/affiliates/affiliate-marketing-api) `GET /search` with RSA headers | Adapter shipped; live when keys are set. Prices are **walmart.com catalog**, not in-aisle local shelf (the search API has no store-price filter). `/stores?zip=` is used only to label a nearby store id. | `WALMART_CONSUMER_ID`, `WALMART_PRIVATE_KEY`, `WALMART_PUBLISHER_ID` |
| **Target** | **No public product/price API.** RedSky is an internal storefront endpoint and is **not** used. | Adapter shipped for a licensed partner feed (`GET {TARGET_PARTNER_BASE_URL}/products?query=&zip=`). Until those keys exist, Target is demo catalog. | `TARGET_PARTNER_BASE_URL`, `TARGET_PARTNER_API_KEY` |
| **Aldi** | None | Demo catalog / `coming_soon` handoff | — |

Pipeline:

- `StorePricingProvider` interface in `src/pricing/`
- MongoDB remains a 24-hour **live** price cache (`priceSource: "live"`). Seed rows are **not** treated as live cache.
- `POST /api/optimize-list` returns `pricingByStore[]` (`source`, `label`, `detail`, `error`) and each store card gets `pricing`.
- Partial success is OK: one retailer failing still splits the rest. Configured-but-failed providers set `pricingWarning`; a total miss still returns **503**.
- Dashboard badges: **Live prices** / **Cached live** / **Demo catalog**.

Until Walmart/Target keys are present, non-Kroger (and unconfigured Kroger) prices still come from the seed catalog and are labeled as demo.

---

## Phase 3 — Authenticated multi-cart fill

Where a retailer actually allows it, fill the shopper’s cart after they authorize the app:

| Retailer | Likely requirement | Notes |
| --- | --- | --- |
| Kroger | Authorization-code OAuth, `cart.basic:write` (or `cart.basic:rw`), registered redirect URI | `PUT https://api.kroger.com/v1/cart/add` with `{ upc, quantity, modality }`. Client-credentials are not enough. |
| Walmart | Shopper OAuth / partner cart APIs | Public cart-write is typically closed. Search deep links remain the fallback. |
| Target | Partner / RedCard / shopper OAuth | Same: do not invent a cart API. |
| Aldi | Instacart or similar, if ever licensed | Stay `coming_soon` until a real contract exists. |

Phase 3 success looks like: one tap per store card → shopper login (if needed) → items appear in **that** retailer’s cart → shopper pays on the retailer site. Never report “added to cart” unless the retailer API acknowledged the write.
