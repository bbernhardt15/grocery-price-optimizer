# Coupons

Grocery Gitter does not clip store coupons, and it does not read a store’s coupon list. None of the stores in the trip plan offer a public coupon feed a shopper app can call on its own. Kroger’s public Products API has no coupon scope. Walmart does not offer digital clip coupons through the Affiliate API; Walmart Cash offers come from Ibotta. Flipp’s weekly-ad feed is a circular, not a coupon wallet, and Flipp’s coupon product is partner-only. Ibotta’s Instant Purchase Notification (IPN) is partner-only too.

So the app links out to each store’s own coupon page or app. It never scrapes those pages, and it never invents a coupon or a sale.

## What you see in the trip plan

**On sale.** A small “On sale” badge appears on a trip line only when that line’s price source already says the selling price is a sale.

| Source | When the badge shows | “was $X” | End date |
| --- | --- | --- | --- |
| Kroger Products API | The promo price is the selling price, and it is below the regular price (or no regular price was sent) | The regular price, only when it is higher | Not sent by this API |
| Flipp weekly ad | The row is a circular deal | `original_price`, or a plain dollar amount in `pre_price_text` such as `$3.49` | The flyer’s `valid_to` day, when it is a real date |
| Walmart Affiliate | `msrp` is higher than `salePrice`, and `salePrice` is the selling price | `msrp` | Not sent by this API |

“2 for $5”, “BOGO”, and “Save $1” are not treated as a previous price. A `salePrice` by itself is the current Walmart price, not a sale. If the source did not send an old price or an end date, those words are left off the badge.

**Check store coupons.** Each store in the trip has a section, “Check Kroger coupons before you shop” (the store’s name fills in). It opens that store’s real coupon, deals, or weekly-ad page. Under the link is a short list of the items on that store’s part of the trip (“Look for coupons on: Oreo, Coca-Cola…”). “I clipped my coupons” is a reminder for this trip. It is stored on the device. It is not a dollar amount, and it does not tell us the clip succeeded.

**A coupon you already have.** You can type one coupon per item on a store: dollars or percent off, and a date if the coupon has one. It applies to that store’s subtotal, never below $0. An expired coupon stays visible and is not subtracted. The line is labeled “Your coupon” so it is not confused with the shelf price.

These typed coupons are saved on the device (`gg-own-coupons`). When you are signed in, they are also saved with your account list. Leaving them off a save does not wipe coupons already stored. A shared-list link does not store them as structured rows. Copy, share, and print include them as estimated text lines.

## What stays out of the price comparison

The “save versus one store” figure compares shelf prices only (`singleStoreSavings` in `public/shopper/tripPlan.js` and the trip totals in `src/optimizeGroceryList.ts`). Coupon dollars are not mixed into that number.

`couponSavingsSummary` in `public/shopper/coupons.js` is the separate estimate. The trip shows:

- “Estimated coupon savings (if clipped): $X” — only coupons you typed that have not expired
- “Trip total including estimated coupons” — labeled **estimated**

Store clips you make on Kroger, Target, or anywhere else are not in either number. We cannot see them.

## Free and Pro

Coupon links and the item checklist are free. Typing in a coupon you already have is a Pro feature once billing is on (`ownCoupons` in `src/billing/limits.ts`). While `REVENUECAT_WEBHOOK_SECRET` is unset, billing is off and that form stays open, same as the other plan limits. `PLAN_FREE_OWN_COUPONS=true` opens it on the free plan. See [Subscriptions](SUBSCRIPTIONS.md).

## Where the links live

`src/coupons/pages.json` is the list of pages we checked. Each Flipp banner in `src/pricing/flipp/merchants.json` has a `couponUrl` for that same page. `buildStoreHandoff` in `src/storeHandoff.ts` puts the link on the trip card. The shopper app keeps a copy in `public/shopper/coupons.js` so a trip you edit offline still has the link. Tests check that the two lists match.

A homepage is used only when a public coupon page could not be confirmed (Food Lion, Amazon Fresh). Aldi, Costco, Sam’s Club, and Whole Foods do not offer a clip page we can link, so those rows open the weekly ad or savings page and say so.

On the iOS and Android app, the link opens with the existing in-app browser helper. On the website it opens in a new tab.

## Partner path, if we want real clip data later

Do not scrape a coupon page to fill this in. A real feed means a partner agreement:

1. **Kroger.** The public developer app can request Products and Locations. Coupon clip and balance are not in that public scope. Ask Kroger’s partner team for a coupon API, then store the credential the same way the cart OAuth secret is stored. Until that exists, the Kroger button opens `https://www.kroger.com/savings/cl/coupons/`.
2. **Ibotta IPN.** Walmart Cash offers are Ibotta’s. IPN is a partner integration, not a public key. A partner deal would be the way to show Walmart Cash offers inside the trip. Until then the button opens `https://www.walmart.com/walmartcash`.
3. **Flipp.** Weekly ads already supply featured prices and, when the circular sends them, a previous price and an end date. Flipp’s coupon inventory is a separate partner product. Do not treat flyer rows as clipped coupons.

Any of those feeds should arrive as labeled offers (“Clipped at Kroger”, “Walmart Cash”) and stay out of `singleStoreSavings` until the shopper has actually clipped them.
