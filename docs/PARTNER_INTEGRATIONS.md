# Partner integrations playbook

**Product:** anyone in the US picks grocery items → cheapest **multi-store split** → hand off toward **real carts**.

**Rule:** official retailer APIs first. Licensed partners when a chain has no public API. Never scrape authenticated storefronts as the production cart-fill path. Never report “added to cart” unless a retailer/partner API returned HTTP 2xx.

This doc is the outreach list Brandon can act on. Code stubs live in `src/pricing/partnerFeed.ts` and `src/pricing/partnerProviders.ts`. They stay **dark** until credentials exist.

---

## What Grocery Gitter needs

Every price partner must be able to answer, for a shopper ZIP (or store id):

| Need | Why |
| --- | --- |
| **Local unit price** | The 15/5/10 split is only useful if prices are for *this* ZIP/store, not a national list |
| **Product identity** | `upc` / GTIN and a retailer `productId` so handoff can deep-link or (later) write a cart |
| **Banner / store name** | Trip plan groups by store (`Publix`, `H-E-B`), not by the data vendor |
| **Optional cart-write or documented deep link** | Phase 3. Most partners will only give search URLs. That is OK — say so in the UI |

Nice-to-have: package size/unit, brand, store id, in-stock flag, whether the price is **in-store shelf** vs **delivery marketplace** (Instacart markup).

---

## Price partners vs cart/fulfillment partners

These are different contracts. Do not assume a price feed can fill a cart, or that a cart partner’s prices are in-aisle.

### Price partners (shelf / catalog)

Goal: local prices so optimize can split the list.

| Partner | Role today / target |
| --- | --- |
| **Kroger Products + Locations** | Live (client-credentials). Keep. |
| **Walmart Affiliate Marketing API** | Optional. **walmart.com catalog**, not in-aisle shelf. |
| **Target licensed feed** | Stub (`TARGET_PARTNER_*`). No public API. |
| **Datasembly-class shelf feed** | Fastest path to many banners’ **in-store** prices. Stub: `SHELF_FEED_*`. |
| **Flipp / weekly ads** | Circulars and featured prices, **not** a full shelf file. **Wired** as `FlippDealsProvider` (`FLIPP_ACCESS_TOKEN` / `FLIPP_ENABLED`). Dashboard label: **Weekly ad**. Do not treat flyer rows as aisle-wide unit prices. |
| **Albertsons / Ahold / Publix / H-E-B / Meijer feeds** | Per-chain licensed files or the shelf-feed vendor above. |

### Cart / fulfillment partners

Goal: shopper can actually buy the split trip.

| Partner | Honest expectation |
| --- | --- |
| **Kroger Cart API** | Only path with a documented write (`PUT /v1/cart/add`) after **shopper** OAuth. Redirect URI must be unlocked. |
| **Instacart Connect / Platform** | Best multi-banner **fulfillment** bet (Aldi, many regionals). Sales-led. Prices often include **markup**. Cart create only if the contract says so. |
| **Instacart Developer Platform shopping list** | **Not a price feed.** Self-serve (when applications are open) `POST /idp/v1/products/products_link` link. Shopper picks a retailer and checks out on Instacart. See the section below. Env: `INSTACART_API_KEY`, `INSTACART_API_BASE_URL`. |
| **Retailer site search deep links** | Default handoff for Walmart, Target, Publix, H-E-B, Meijer, Albertsons family, Ahold banners, club stores. **Not** a cart fill. |
| **Amazon / club apps** | Cart-write for third parties is effectively **unavailable**. Membership and app-only prices. |

If a vendor sells “add to cart,” ask: *whose* cart (retailer vs Instacart), pickup vs delivery, and whether the write is acknowledged with an order/cart id. Until that is in writing, Grocery Gitter keeps `coming_soon` or `search_deeplink`.

---

## Coverage map (why these partners)

| Shopper region | Live in app today | Biggest gap | First partner to call |
| --- | --- | --- | --- |
| Kroger-family markets | Kroger Locations + Products | Other banners in the same ZIP | Shelf feed + Instacart for Aldi |
| National big-box | Walmart.com catalog (optional keys) | In-aisle Walmart, Target shelf | Target partner feed, Datasembly-class |
| Southeast | — | **Publix**, Food Lion | Publix, Ahold, Instacart |
| Texas | — | **H-E-B** | H-E-B / Favor, Instacart |
| Midwest | Aldi demo catalog only | **Meijer**, Aldi in-store | Meijer, shelf feed, Instacart |
| West / Mid-Atlantic | — | Safeway, Albertsons, Giant, Stop & Shop | Albertsons Cos., Ahold Delhaize |
| Club | — | Costco, Sam’s | See honest limits below |
| Urban grocery | — | Amazon Fresh, Whole Foods | Amazon — catalog only, not Fresh shelf |

Kroger’s official API already covers many **Kroger banners** (Ralphs, King Soopers, Fred Meyer, Harris Teeter, …) via Locations. The app still labels those trips “Kroger.” Expanding labels is a later UX task, not a new partner.

---

## Status legend (copy this into notes)

Use one of:

- **not contacted**
- **intro sent** (date)
- **NDA / intake in progress**
- **pilot credentials** (env vars set, mapping in `partnerFeed.ts`)
- **live in production**
- **blocked** (reason: no API, membership-only, declined, legal)
- **won’t pursue** (reason)

Update the **Status** line under each partner when you send mail. This repo does not track CRM.

---

## Priority partners

### 1. Instacart Connect / Platform (multi-banner)

| | |
| --- | --- |
| **Type** | Cart/fulfillment first; prices second (often marked up) |
| **What we need** | Catalog + price by retailer location or ZIP; retailer banner name; UPC/SKU; **optional** cart create / add-line; pickup vs delivery |
| **Access path** | **Sales**, not self-serve for a comparison app. Start at [Instacart partners](https://www.instacart.com/company/partners) and retailer Connect docs ([docs.instacart.com](https://docs.instacart.com/)). Expect NDA, commercial contract, and a mapping layer — there is **no** public “search milk by ZIP” API we can ship against. |
| **Banners it can unlock** | Aldi (many markets), Publix delivery, Costco Instacart (≠ warehouse), regional grocers, some Albertsons/Ahold stores |
| **Code stub** | `INSTACART_PARTNER_BASE_URL`, `INSTACART_PARTNER_API_KEY`, `INSTACART_PARTNER_STORES` |
| **Status** | not contacted |
| **Do not** | Scrape instacart.com while logged in; treat Instacart price as in-store; report cart filled without Connect 2xx |

Ask on the first call: *in-store vs delivery price*, *which banners are in-contract for this app*, *whether cart write is in scope or only storefront links*.

#### Developer Platform shopping list (separate env vars)

This is the handoff already wired in `src/instacartHandoff.ts`. It does **not** use `INSTACART_PARTNER_*` and it does **not** return prices.

| | |
| --- | --- |
| **Type** | Checkout handoff only. Shopper leaves Grocery Gitter for an Instacart-hosted list. |
| **Endpoint** | `POST {INSTACART_API_BASE_URL}/idp/v1/products/products_link` — [Create shopping list page](https://docs.instacart.com/developer_platform_api/api/products/create_shopping_list_page) |
| **Bases** | Development `https://connect.dev.instacart.tools`. Production `https://connect.instacart.com`. |
| **Auth** | `Authorization: Bearer` the Developer Platform API key. Server-side only. |
| **Retailer** | The POST body has no retailer field. [FAQ](https://docs.instacart.com/developer_platform_api/faq): directing users to a specific merchant is not supported. For one store section, Grocery Gitter may append `retailer_key` when [`GET /idp/v1/retailers`](https://docs.instacart.com/developer_platform_api/api/retailers/get_nearby_retailers) returns a **name** match. That query param is documented for [recipe URLs](https://docs.instacart.com/developer_platform_api/get_started/recipe) and can require a separate key. If lookup fails, the shopper still gets the list and picks the store. |
| **UI** | **Shop on Instacart** on trip-plan sections that are not a Kroger cart write (Target, Aldi, regional/Flipp/partner banners, Walmart search). Plus “or shop the whole list on Instacart” on the trip total. Hidden when the env vars are unset. |
| **Code** | `INSTACART_API_KEY`, `INSTACART_API_BASE_URL` |
| **Do not** | Point these at the partner price proxy. Do not treat the returned URL as an in-store cart fill. |

**How to get a key**

1. Start at [Get started](https://docs.instacart.com/developer_platform_api/get_started/overview) and use **Apply today**, which goes to [instacart.com/company/business/developers](https://www.instacart.com/company/business/developers).
2. As of 24 Sep 2026 that page says Instacart is **not accepting new applications** and there is **no waitlist**.
3. Once an account exists: Developer Dashboard → API Keys → Create New API Key → Development or Production → copy the `keys.…` value once. [Get an API key](https://docs.instacart.com/developer_platform_api/get_started/api-keys).
4. Pair a development key with the development base. Production keys come after a demo review ([pre-launch checklist](https://docs.instacart.com/developer_platform_api/guide/concepts/launch_activities/pre-launch_checklist)).

**Whether it is free**

Instacart does not list a price for the API key or for Create shopping list page. Access is approval-gated. [Terms](https://docs.instacart.com/developer_platform_api/guide/terms_and_policies/developer_terms) allow a charge only if you request use beyond their limits. A live integration can optionally join the affiliate program and receive commissions. Shoppers pay Instacart at checkout.

**Railway:** set `INSTACART_API_KEY` and `INSTACART_API_BASE_URL` on the service. Leave them empty to hide the buttons.

---

### 2. Datasembly-class shelf price feeds

| | |
| --- | --- |
| **Type** | **Price** partner (multi-retailer in-aisle / advertised shelf) |
| **What we need** | Price + UPC by store or ZIP, banner name, observed-at timestamp. Cart-write is **out of scope**. |
| **Access path** | Commercial grocery intelligence vendors (Datasembly and peers). Typically **sales** with a trial file; not a consumer API key page. This is the fastest nationwide **shelf** coverage without 10 chain legal teams. |
| **Banners it can unlock** | Publix, Meijer, H-E-B, Albertsons family, Ahold banners, Walmart/Target *if licensed* — whatever the vendor’s store panel includes. Confirm coverage by ZIP before promising a shopper. |
| **Code stub** | `SHELF_FEED_BASE_URL`, `SHELF_FEED_API_KEY`, `SHELF_FEED_STORES` |
| **Status** | not contacted |
| **Do not** | Use weekly-ad-only rows as the only price; mix delivery-marketplace prices into the same column without labeling |

HTTP contract the stub already implements (put a proxy in front of the vendor if needed): see `PARTNER_FEED_CONTRACT` in `src/pricing/partnerFeed.ts`.

---

### 3. Albertsons / Safeway family

| | |
| --- | --- |
| **Type** | Price (licensed feed or shelf vendor) + cart (site search or Instacart) |
| **Banners** | Albertsons, Safeway, Vons, Jewel-Osco, Acme, Shaw’s, Tom Thumb, Randalls, Pavilions, Carrs, United, … |
| **What we need** | Same as “what Grocery Gitter needs,” plus which banner a store id maps to |
| **Access path** | **Sales / partnerships** at Albertsons Companies. No Kroger-style public Products API. Weekly ads may appear in Flipp; that is not a shelf file. Fulfillment is often Instacart. |
| **Code stub** | Put banners on `SHELF_FEED_STORES` or `INSTACART_PARTNER_STORES` (e.g. `Safeway,Albertsons`). Handoff already deep-links Albertsons and Safeway search. |
| **Status** | not contacted |
| **Do not** | Scrape safeway.com / albertsons.com after login |

---

### 4. Ahold Delhaize USA (Food Lion / Giant / Stop & Shop)

| | |
| --- | --- |
| **Type** | Price + cart (same split as Albertsons) |
| **Banners** | Food Lion, Giant Food, The Giant Company, Stop & Shop, Hannaford |
| **What we need** | Local prices by store; UPC; banner name (Giant ≠ Giant Eagle) |
| **Access path** | **Sales**. Peapod is not a third-party cart API for this app. Delivery is often Instacart. No public product API. |
| **Code stub** | `SHELF_FEED_STORES=Food Lion,Giant,Stop & Shop` (add Hannaford if the feed covers it) |
| **Status** | not contacted |
| **Do not** | Treat “Giant” as Giant Eagle (different company) |

---

### 5. Publix

| | |
| --- | --- |
| **Type** | Price (licensed or shelf vendor); cart = Publix site search or Instacart delivery |
| **What we need** | Florida/Georgia/Alabama/… store prices by ZIP; UPC |
| **Access path** | **Sales** ([corporate.publix.com](https://corporate.publix.com/)). No public Products API. |
| **Code stub** | `PUBLIX_PARTNER_BASE_URL` + `PUBLIX_PARTNER_API_KEY` **or** list `Publix` on `SHELF_FEED_STORES` / `INSTACART_PARTNER_STORES` |
| **Status** | not contacted |
| **Cart** | Search deep link only. Instacart cart only with a Connect contract. |

---

### 6. H-E-B

| | |
| --- | --- |
| **Type** | Price; cart = heb.com search or Favor (H-E-B owned) — Favor is not a public cart API |
| **What we need** | Texas store prices by ZIP; UPC |
| **Access path** | **Sales**. No public grocery price API. |
| **Code stub** | `HEB_PARTNER_BASE_URL` + `HEB_PARTNER_API_KEY` or `SHELF_FEED_STORES=H-E-B` |
| **Status** | not contacted |
| **Cart** | Search deep link. Do not fake Favor/Instacart add-to-cart. |

---

### 7. Meijer

| | |
| --- | --- |
| **Type** | Price; cart = meijer.com search or Instacart/Shipt if licensed |
| **What we need** | Midwest store prices by ZIP; UPC |
| **Access path** | **Sales**. No public product API. |
| **Code stub** | `MEIJER_PARTNER_BASE_URL` + `MEIJER_PARTNER_API_KEY` or `SHELF_FEED_STORES=Meijer` |
| **Status** | not contacted |

---

### 8. Costco / Sam’s Club (honest limits)

| | |
| --- | --- |
| **Type** | Weak price partner; **not** a cart partner for this app |
| **Limits** | Membership gates many prices and almost all checkout. Warehouse price ≠ Instacart Costco price (markup + different SKUs). Kirkland items often fail UPC match to other banners. No public local warehouse API. Third-party **cart-write is not available**. |
| **What we could still use** | Licensed shelf observations for *member* prices **if** the shopper is told they need a membership; or Instacart Costco as a **labeled delivery** option, never mixed unlabeled with warehouse. |
| **Access path** | Costco / Sam’s: partnerships, likely **blocked** for a comparison cart app. Instacart Costco: under the Instacart contract, labeled separately (`Costco (Instacart)` — do not call it warehouse). |
| **Code stub** | Only if listed on `SHELF_FEED_STORES` or `INSTACART_PARTNER_STORES`. Handoff is search + membership copy, never `kroger_cart`-style success. |
| **Status** | won’t pursue warehouse cart-write; price feed = not contacted |
| **Do not** | Promise “add to Costco cart”; scrape Costco while logged in as a member |

---

### 9. Amazon Fresh / Whole Foods

| | |
| --- | --- |
| **Type** | Catalog/affiliate at best; **not** Fresh in-store shelf |
| **Limits** | [Product Advertising API](https://webservices.amazon.com/paapi5/documentation/) is **amazon.com catalog**, Prime/Fresh local prices are not in PA-API. Whole Foods in-store vs Amazon delivery differ. No grocery cart-write for third parties. |
| **What we need** | If Amazon ever licenses Fresh/WF store prices: ZIP or store, ASIN + UPC, Prime vs member price labeled. |
| **Access path** | PA-API is self-serve for **affiliate search**, not this product. Fresh/WF local: **sales**, likely blocked. |
| **Code stub** | Optional `SHELF_FEED_STORES=Whole Foods,Amazon Fresh` only with a licensed file. Do not wire PA-API and call it Fresh. |
| **Status** | won’t pursue PA-API as a Fresh shelf source; local feed = not contacted |
| **Cart** | Search deep link only (`coming_soon` is also honest). |

---

### Already in the app (do not replace)

| Partner | Status | Notes |
| --- | --- | --- |
| **Kroger** Products/Locations | live | Client-credentials. Cart = separate shopper OAuth. |
| **Walmart Affiliate** | optional keys | Catalog, not aisle. Search handoff. |
| **Target partner feed** | stub `TARGET_PARTNER_*` | Same idea as `PartnerFeedProvider`; keep RedSky unused. |
| **Flipp weekly ads** | **live** (optional) | FlyerKit (`FLIPP_ACCESS_TOKEN`) or opt-in consumer search (`FLIPP_ENABLED=true`). Labeled **Weekly ad**, not a shelf catalog. Licensed partner feeds beat Flipp for the same banner. |

---

## What NOT to do

1. **Do not scrape authenticated storefronts** (Kroger, Target RedSky, Instacart, Walmart, Publix, H-E-B, club sites) as the production price or cart-fill strategy. Puppeteer against a public marketing page is not a partner integration.
2. **Do not invent Instacart Connect / Datasembly price clients** from blog posts. Use the stub HTTP contract + proxy, or wait for official docs with the contract. The Developer Platform shopping-list client (`POST /idp/v1/products/products_link`) is the documented handoff and is separate from `INSTACART_PARTNER_*`.
3. **Do not report cart success** without a 2xx from a documented cart API. Deep link ≠ filled cart.
4. **Do not treat weekly ads / Flipp as shelf prices.** Featured “2 for $5” is not the unit price optimize should pick. Grocery Gitter already labels Flipp rows **Weekly ad**.
5. **Do not mix Instacart delivery prices with in-store prices** in one column. Label the source (`Partner feed`, `Live prices`, `Weekly ad`, `Demo catalog`).
6. **Do not promise Costco/Sam’s/Amazon cart write.** Club and Amazon grocery checkout are not third-party APIs.
7. **Do not replace** Kroger, Walmart Affiliate, or Target adapters with a generic feed when those keys already work.

---

## Env vars (when credentials arrive)

See `.env.example`. Short version:

```bash
# Datasembly-class multi-banner shelf file
SHELF_FEED_BASE_URL=
SHELF_FEED_API_KEY=
SHELF_FEED_STORES=Publix,Meijer,H-E-B,Safeway,Food Lion

# Instacart Connect-style price adapter (same HTTP contract; map vendor JSON in a proxy)
INSTACART_PARTNER_BASE_URL=
INSTACART_PARTNER_API_KEY=
INSTACART_PARTNER_STORES=Aldi,Publix

# Developer Platform shopping-list handoff (not the price adapter)
INSTACART_API_KEY=
INSTACART_API_BASE_URL=https://connect.dev.instacart.tools

# Optional single-banner licensed feeds
PUBLIX_PARTNER_BASE_URL=
PUBLIX_PARTNER_API_KEY=
HEB_PARTNER_BASE_URL=
HEB_PARTNER_API_KEY=
MEIJER_PARTNER_BASE_URL=
MEIJER_PARTNER_API_KEY=
```

Named banner env vars **win** over `SHELF_FEED_*`, which **wins** over `INSTACART_PARTNER_*` for the same store (prefer true shelf over marketplace markup). Kroger / Walmart / Target are never overridden.

Unconfigured partner banners are **not** added to the default trip (no fake Publix demo catalog).

---

## First email (template)

> We’re building Grocery Gitter: shoppers pick items, we split the list across the cheapest nearby stores, then hand off toward each store’s cart.
>
> We need a **licensed** feed of local grocery prices (ZIP or store id), product UPC/SKU, and banner name. Optional: documented add-to-cart or deep link. We will **not** scrape your storefront.
>
> Happy to sign an NDA and limit display to the shopper who opted in. Who owns partner APIs / data licensing on your side?

---

## After credentials

1. Set the env vars above (or put a proxy at `*_BASE_URL` that implements `GET /products?query&zip&store`).
2. Restart the API. `POST /api/optimize-list` will include those banners in the default competitor list.
3. Confirm the dashboard badge reads **Partner feed** (not Demo catalog) for that store.
4. Handoff stays **Search at {store}** or **Coming soon** until a real cart API is wired — same honesty as Walmart/Target.
5. Move this partner’s **Status** line to `pilot credentials` / `live in production`.
