# Grocery Gitter — product roadmap

**Goal:** the shopper picks specific grocery items. The app assigns each item to the cheapest retailer that can take an online order (example: **15 Kroger + 5 Walmart + 10 Target**), then helps push those selections toward each retailer’s cart/checkout so the split trip can actually be bought.

This is not a single-store price comparison page. The durable product is a **multi-cart trip plan**.

## What exists today

- Grocery Gitter search-first dashboard: pick catalog items, ZIP, **Find Cheapest Stores**
- `POST /api/optimize-list` groups the list by cheapest `storeName` with unit prices and subtotals
- Trip plan summary + per-store checkout handoff (Phase 1)
- Live Kroger **Products** and **Locations** APIs via **client-credentials** (`product.compact`)
- Pluggable store pricing providers: Kroger (live), Walmart Affiliate API (live when keys are set), Target licensed partner feed (live only with a contracted base URL), Flipp weekly-ad deals (Aldi / Target-without-partner-feed / Publix-like banners when enabled)
- Seed catalog samples for Aldi, Walmart, Kroger, and Target — labeled **Demo catalog** until a live or weekly-ad provider returns rows
- Dashboard badges + `pricingByStore` so **Live prices**, **Weekly ad**, and **Demo catalog** stay distinct
- **Kroger shopper cart fill** (Phase 3): authorization-code OAuth + `PUT /v1/cart/add` when `KROGER_REDIRECT_URI` is registered. Success is reported only on HTTP 2xx.

Client-credentials can look up stores and shelf prices. They **cannot** write a shopper’s Kroger, Walmart, or Target cart.

---

## Phase 1 — Trip plan + Kroger handoff (shipped)

Customer-visible slice:

1. After optimize, show a trip plan summary (`15 Kroger + 5 Walmart + 10 Target`) and a primary action on each store card.
2. Each store group in the API includes a **handoff** object: item identities (name, brand, quantity, price, `productId` / `upc` / `locationId` when known) plus an `action` of `kroger_cart` | `search_deeplink` | `coming_soon`.
3. **Kroger (always-available path):** “Open at Kroger” search/product deep links using `productId`/UPC when the Products API returned them, otherwise the item name. Shopper completes add-to-cart on kroger.com.
4. **Walmart + Target:** same handoff shape with public search deep links (and honest copy that authenticated cart APIs are closed or partner-only).
5. **Aldi / others:** `coming_soon` — no fake checkout.

---

## Phase 2 — Live multi-store pricing (shipped)

Price the same verified items at more than Kroger so the 15/5/10 split reflects real local shelves **when a documented live source exists**:

| Store | Live source | Status | Keys |
| --- | --- | --- | --- |
| **Kroger** | Official Locations + Products APIs (`product.compact`) | Working (unchanged) | `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET` |
| **Walmart** | Official [Affiliate Marketing API](https://walmart.io/apidocs/affiliates/affiliate-marketing-api) `GET /search` with RSA headers | Adapter shipped; live when keys are set. Prices are **walmart.com catalog**, not in-aisle local shelf (the search API has no store-price filter). `/stores?zip=` is used only to label a nearby store id. | `WALMART_CONSUMER_ID`, `WALMART_PRIVATE_KEY`, `WALMART_PUBLISHER_ID` |
| **Target** | **No public product/price API.** RedSky is an internal storefront endpoint and is **not** used. | Adapter shipped for a licensed partner feed (`GET {TARGET_PARTNER_BASE_URL}/products?query=&zip=`). Until those keys exist, Target can use Flipp weekly ads (if enabled) or the demo catalog. | `TARGET_PARTNER_BASE_URL`, `TARGET_PARTNER_API_KEY` |
| **Aldi** | None (retailer). Flipp weekly-ad optional. | Demo catalog / `coming_soon` handoff until Flipp is enabled | `FLIPP_ENABLED` / `FLIPP_ACCESS_TOKEN` |

Pipeline:

- `StorePricingProvider` interface in `src/pricing/`
- MongoDB remains a 24-hour cache for `priceSource: "live"` and `weekly_ad`. Seed rows are **not** treated as live cache.
- `POST /api/optimize-list` returns `pricingByStore[]` (`source`, `label`, `detail`, `error`) and each store card gets `pricing`.
- Partial success is OK: one retailer failing still splits the rest. Configured-but-failed providers set `pricingWarning`; a total miss still returns **503**.
- Dashboard badges: **Live prices** / **Cached live** / **Weekly ad** / **Demo catalog**. Weekly ad is flyer/circular pricing, not a full shelf feed.

Until Walmart/Target keys (or Flipp) are present, non-Kroger (and unconfigured Kroger) prices still come from the seed catalog and are labeled as demo.

---

## Phase 2b — Multi-store weekly ads (Flipp)

Give Aldi, Target-without-partner-feed, Publix-like banners, and other mapped circulars a **real** deals source without inventing retailer cart APIs or scraping authenticated storefronts.

| Piece | Behavior |
| --- | --- |
| Provider | `FlippDealsProvider` behind `StorePricingProvider`. Dedicated retailer APIs still run first (Kroger Products, Walmart Affiliate, Target partner feed). |
| Official path | FlyerKit v4.0 with `FLIPP_ACCESS_TOKEN` from a Flipp technical contact. |
| Opt-in path | Consumer flyer search `backflipp.wishabi.com/flipp/items/search` only when `FLIPP_ENABLED=true`. Unofficial; ToS-sensitive; ZIP required. |
| Mapping | Flipp merchants → Grocery Gitter `storeName` (Aldi, Target, Walmart, Kroger family as secondary, Publix, Meijer, …). |
| Label | `priceSource: "weekly_ad"` → dashboard **Weekly ad**. Never claim full-shelf live prices. BOGO rows with no numeric price are skipped. |
| Cart | Unchanged: no fake “added to cart.” Aldi handoff stays `coming_soon`. |

---

## Phase 3 — Authenticated multi-cart fill (this PR)

Where a retailer actually allows it, fill the shopper’s cart after they authorize the app:

| Retailer | Requirement | Status in Grocery Gitter |
| --- | --- | --- |
| **Kroger** | Authorization-code OAuth, `cart.basic:write` (or `cart.basic:rw`), redirect URI registered on the Kroger developer app **and** set as `KROGER_REDIRECT_URI` (must match the Railway/production HTTPS URL exactly) | **Implemented.** Dashboard shows **Add to Kroger cart** when that env is set and items have UPC/`productId`. Shopper logs in at Kroger, callback exchanges the code, then `PUT https://api.kroger.com/v1/cart/add` with `{ upc, quantity, modality }`. Success HTML/JSON only on HTTP 2xx. Cancelled login, missing scopes, or API rejection fall back to **Open at Kroger** search links — never a fake “added to cart”. Client-credentials tokens used for Products/Locations are **not** used for cart writes. |
| **Walmart** | Shopper OAuth / partner cart APIs | **Not implemented.** Public cart-write is typically closed. Search deep links remain the fallback. Do not invent a Walmart cart API. |
| **Target** | Partner / RedCard / shopper OAuth | **Not implemented.** Same: do not invent a cart API. Search deep links only. |
| **Aldi** | Instacart or similar, if ever licensed | Stay `coming_soon` until a real contract exists. |

Phase 3 success for Kroger looks like: one tap on the Kroger card → shopper login (if needed) → items appear in **that** shopper’s Kroger cart → shopper pays on kroger.com.

Enable it on Railway: see README **Enable Kroger shopper cart fill**.
