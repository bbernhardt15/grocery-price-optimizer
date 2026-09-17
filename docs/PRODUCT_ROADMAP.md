# Cheapest Cart — product roadmap

**Goal:** the shopper picks specific grocery items. The app assigns each item to the cheapest retailer that can take an online order (example: **15 Kroger + 5 Walmart + 10 Target**), then helps push those selections toward each retailer’s cart/checkout so the split trip can actually be bought.

This is not a single-store price comparison page. The durable product is a **multi-cart trip plan**.

## What exists today

- Search-first dashboard: pick catalog items, ZIP, **Find Cheapest Stores**
- `POST /api/optimize-list` groups the list by cheapest `storeName` with unit prices and subtotals
- Live Kroger **Products** and **Locations** APIs via **client-credentials** (`product.compact`)
- Seed catalog samples for Aldi, Walmart, Kroger, and Target

Client-credentials can look up stores and shelf prices. They **cannot** write a shopper’s Kroger, Walmart, or Target cart.

---

## Phase 1 — Trip plan + Kroger handoff (this PR)

Customer-visible slice:

1. After optimize, show a trip plan summary (`15 Kroger + 5 Walmart + 10 Target`) and a primary action on each store card.
2. Each store group in the API includes a **handoff** object: item identities (name, brand, quantity, price, `productId` / `upc` / `locationId` when known) plus an `action` of `kroger_cart` | `search_deeplink` | `coming_soon`.
3. **Kroger (working path):** “Open at Kroger” search/product deep links using `productId`/UPC when the Products API returned them, otherwise the item name. Shopper completes add-to-cart on kroger.com.
4. **Kroger (optional next step in this phase):** authorization-code OAuth (`cart.basic:write`) + `PUT /v1/cart/add` when `KROGER_REDIRECT_URI` is registered. This **requires the shopper to log in** at Kroger. It is not the client-credentials token already used for pricing. If the Cart API rejects the app (missing partner/cart scopes) the UI stays on deep links and does **not** pretend the cart was filled.
5. **Walmart + Target:** same handoff shape with public search deep links (and honest copy that authenticated cart APIs are closed or partner-only).
6. **Aldi / others:** `coming_soon` — no fake checkout.

Out of scope for Phase 1: scraping logged-in retailer carts; claiming a successful multi-retailer cart fill; live Walmart/Target pricing.

---

## Phase 2 — Live multi-store pricing

Price the same verified items at more than Kroger so the 15/5/10 split reflects real local shelves:

- Walmart, Target, and other retailers **only** through official APIs, documented affiliate feeds, or licensed partners
- Keep MongoDB as a short-lived price cache
- Do not make HTML scraping of authenticated storefronts the primary price source
- Surface per-store freshness and failures the way Kroger outages already return `pricingWarning` / 503

Until Phase 2 ships, non-Kroger prices may still come from the seed catalog.

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
