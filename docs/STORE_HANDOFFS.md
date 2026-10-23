# Store handoffs

Grocery Gitter splits a list across stores, then has to hand the shopper something they can actually use at each one. A price with no next step is not a finished trip.

Each banner has a **tier** in `src/storeHandoffConfig.ts`:

| Tier | What the shopper gets |
| --- | --- |
| `cart` | Push the lines into that store's cart. Kroger uses shopper OAuth and `PUT /v1/cart/add`. Walmart opens an add-to-cart URL. If that write isn't available, the card falls back to the checklist. |
| `link` | No cart write. **Shop this list at {store}** opens a checklist. Each line has **Open in {store}** (a product page when we have a real id, otherwise that store's search). |
| `list` | No verified item link. The same checklist, with quantities and a check-off box, and nothing that pretends to open the store. |

The trip is segmented by store. Each segment shows the items, quantity, price, a price-source label (**Live shelf price** or **Weekly ad**, plus Demo catalog or Partner feed when that's the truth), a store total, and the savings versus the cheapest one-store trip that can fill every line. The shopper can move a line to another store that has a price, lock one store for the whole trip, copy or share the list, and shop it offline.

Per-store **Copy list** is one item per line, with quantity and size (`2 Whole Milk, 1 gal`), so it pastes into notes or a store app's list. The whole trip adds the store name above each group. Share uses the Capacitor Share plugin when the native shell has it, then the Web Share API, then copy. **Shareable link** creates a list with the existing shared-list API. **Add to Instacart** appears only when `INSTACART_API_KEY` and `INSTACART_API_BASE_URL` are set.

Checked items are stored on the device (`gg-trip-checks`). The last trip is stored too (`gg-last-trip`), so in-store mode still opens when the phone is offline.

## Supported stores

Price source is what we are willing to claim. A weekly ad is not a full shelf. Walmart Affiliate prices are walmart.com catalog prices, not the shelf at the store down the street.

Link checks below were HTTP fetches on 23 Oct 2026 with a normal browser user agent. **200** means the URL returned a page. **403** means the store's own search URL is still the one we ship, and the host blocked the scripted fetch (a bot wall, not a 404).

| Store | Price source | Tier | Link format |
| --- | --- | --- | --- |
| Kroger | Kroger Products API (live shelf at the shopper's store), weekly ad as a fallback | cart | Cart: `PUT /v1/cart/add` after shopper OAuth. Search: `https://www.kroger.com/search?query={upc\|name}` |
| Walmart | Walmart Affiliate catalog (walmart.com, not in-aisle) or weekly ad | cart | Cart: `https://www.walmart.com/sc/cart/addToCart?items={itemId}\|{qty}`. Item: `https://www.walmart.com/ip/{itemId}`. Search: `https://www.walmart.com/search?q={query}` |
| Target | Weekly ad, or a licensed partner feed when `TARGET_PARTNER_*` is set | link | Product by TCIN: `https://www.target.com/p/-/A-{tcin}` (200). Search: `https://www.target.com/s?searchTerm={query}` (200). A weekly-ad flyer id is not used as a TCIN. |
| Aldi | Weekly ad or the demo catalog. No Aldi shelf API | link | Search: `https://www.aldi.us/store/aldi/search?q={query}` (200). This is Aldi's online shop (delivery or pickup), not an in-aisle map. |
| Publix | Weekly ad | link | Search: `https://www.publix.com/search?searchTerm={query}` (200; the site redirects into results). |
| H-E-B | Weekly ad | link | Search: `https://www.heb.com/search/?q={query}` (200). |
| Meijer | Weekly ad | link | Search: `https://www.meijer.com/shopping/search.html?query={query}` (403 from a script; this is Meijer's own search page). |
| Safeway | Weekly ad or a licensed partner feed | link | Search: `https://www.safeway.com/shop/search-results.html?q={query}` (200). |
| Albertsons | Weekly ad or a licensed partner feed | link | Search: `https://www.albertsons.com/shop/search-results.html?q={query}` (200). |
| Food Lion | Weekly ad | link | Search: `https://www.foodlion.com/shop/search-results.html?q={query}` (403 from a script; the banner's own search path). |
| Giant | Weekly ad | link | Search: `https://giantfood.com/shop/search-results.html?q={query}` (403 from a script). This is Giant Food, not Giant Eagle. |
| Stop & Shop | Weekly ad | link | Search: `https://stopandshop.com/shop/search-results.html?q={query}` (403 from a script). |
| Costco | Weekly ad. Warehouse prices can require a membership | link | Search: `https://www.costco.com/CatalogSearch?keyword={query}` (200). No third-party cart write. |
| Sam's Club | No shelf feed. Club prices can require a membership | link | Search: `https://www.samsclub.com/s/{query}` (200). No third-party cart write. |
| Whole Foods | No shelf feed | link | Search: `https://www.wholefoodsmarket.com/search?text={query}` (200). |
| Amazon Fresh | No shelf feed | link | Search: `https://www.amazon.com/s?k={query}` (200). Not a Fresh shelf price. |
| Giant Eagle | Weekly ad | list | No verified item link. Checklist only. |

A banner that shows up from a weekly ad and is not in this table is `list` until someone verifies a search or product URL and adds it to the config. That includes banners a parallel Flipp change might start pricing. Do not invent a cart write for them.

## Candidate sources for more shelf prices

The goal is an in-aisle or store-level price, with a UPC and a banner name, under a license that allows this app to show it. Cost below is what is public. Where a vendor does not publish a price, this doc says so instead of guessing.

### Official retailer APIs

**Kroger** is the one public grocery API that already does live shelf prices and a cart write. The developer app is an approval, not a posted data fee. Locations and Products use client credentials. The cart write is separate: the shopper signs in (authorization code), the redirect URI has to match the portal, and Grocery Gitter reports success only on HTTP 2xx from `PUT /v1/cart/add`. Terms of the developer program apply; this is not a license to scrape kroger.com.

**Walmart Affiliate Marketing API** is the official item and store API. Applying is free; commission depends on Impact attribution (`WALMART_PUBLISHER_ID`), not on a price-feed invoice. Search does not filter to a store's shelf price. `GET /stores` labels the nearest store and can add `storeId` and `ap` to the cart link. Treat the number as a walmart.com price.

**Target** has no public product or price API. RedSky, Circle offers, and RedCard discounts are not a feed we can call. A licensed partner file (`TARGET_PARTNER_BASE_URL`) is the honest shelf path, and it is a contract. The TCIN URL above is only a handoff, and only when the id came from that feed rather than a flyer.

Other banners in the table (Publix, H-E-B, Meijer, Aldi, Albertsons, Ahold, Costco) do not offer a Kroger-style public products API. Weekly ads are the price we can show without a contract.

### Affiliate feeds

Affiliate programs pay commission on a sale. They are a poor shelf-price source:

- Walmart's Impact link is how we attribute the add-to-cart URL. It does not add store-level prices.
- Target's affiliate program, where a publisher is approved, is a tracking and creative relationship. It is not an in-aisle price file for a comparison app.
- Amazon Associates can deep-link a search. It does not provide Amazon Fresh shelf prices.

Use affiliate links for handoff and attribution. Do not describe them as a shelf feed.

### Paid aggregators (Datasembly and peers)

A grocery-intelligence vendor is the practical way to cover many banners' **in-store** prices without ten chain legal teams. Datasembly is the example already stubbed as `SHELF_FEED_*`. Peers in the same category sell a licensed panel of store observations (price, UPC, banner, store or ZIP, observed-at).

What to expect:

- **Cost.** Sales-quoted. There is no public list price or self-serve key. A trial is usually a sample file under an NDA.
- **Terms.** A data license: where the prices may be shown, whether they can be stored, redistribution, and attribution. Cart write is out of scope; the vendor observed a shelf, it did not open the retailer's cart.
- **Fit.** Ask which banners and ZIPs are actually in the panel before promising a shopper those stores. Label the price as a shelf observation, and keep weekly-ad rows in the Weekly ad column so the two are not mixed.

The HTTP shape the app already accepts is `PARTNER_FEED_CONTRACT` in `src/pricing/partnerFeed.ts`. Put a proxy in front of the vendor if their API does not match it.

### Instacart Developer Platform, when it reopens

Instacart IDP is a **checkout handoff**, not a shelf-price feed. The call is `POST /idp/v1/products/products_link`. The shopper leaves Grocery Gitter for an Instacart list and picks a retailer there. Prices on that list can include delivery markup. The app already hides **Add to Instacart** until `INSTACART_API_KEY` and `INSTACART_API_BASE_URL` are set.

As of 24 Sep 2026, Instacart's developer page said they are **not accepting new applications** and there is no waitlist. There is no published fee for the key. Their terms allow a charge only if you ask for use beyond their limits. A live integration can optionally join an affiliate program.

When applications reopen, IDP is still the right tool for "buy this list on Instacart," including banners we cannot cart-write ourselves (Aldi in many markets, some regionals). It does not replace a shelf feed. Instacart Connect / Platform, sold separately, is the contract path if we need their catalog and prices; those prices are often marked up and must be labeled as delivery prices.

### What we will not do

Do not scrape a storefront, a logged-in account, or an internal endpoint (Target RedSky, a grocery site's private JSON) when the terms or the robots rules disallow it. A weekly-ad partnership, an official API, an affiliate program, or a paid license is the path for another banner's shelf price. A new Flipp merchant can join the trip as `list` the day its circular is mapped, and move to `link` or `cart` only after the URL or the cart API is real.
