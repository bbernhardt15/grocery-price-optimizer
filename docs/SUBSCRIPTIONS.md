# Grocery Gitter Pro

Guest mode and the free plan keep working when subscriptions are off. Limits are enforced only after `REVENUECAT_WEBHOOK_SECRET` is set. Leave that unset until the App Store product, the Play product, and the RevenueCat webhook are live. Until then `GET /api/billing/status` reports `enforced: false` and the API does not block lists, alerts, the multi-store split, or cart handoffs.

The iOS and Android shells use [`@revenuecat/purchases-capacitor`](https://www.revenuecat.com/docs/getting-started/installation/capacitor). The website does not charge. Settings → See Pro explains that subscriptions are available in the apps. Stripe is a stub on `GET /api/billing/status` (`stripe.enabled` is false). There is no Stripe code.

Purchases require a Grocery Gitter account. The app sends the account id as the RevenueCat app user id. Sign in with Apple is already required if Google or email sign-in is offered. See [Optional accounts](ACCOUNTS.md).

## Free and Pro

| | Free | Pro |
| --- | --- | --- |
| Trip plan | One store that can fill the most lines, then the lower total | Split the list across stores |
| Saved list | 1 | Unlimited (`0`) |
| Shared lists | 1 | Unlimited (`0`) |
| Price alerts | Off | On |
| Cart handoffs (Kroger, Walmart, Target, Instacart) | Off | On |
| Store coupon links and the “look for coupons” list | On | On |
| Coupons you type in | Off | On |

A shared-list cap of `0` means unlimited. The one saved list per account is already how sync works. Updating that list is allowed. Creating another shared list, or creating one with no `deviceId` and no session, returns 402 once billing is enforced. Opening the same list again (the saved owner token) is not a new list. Turning price alerts off is always allowed. Turning them on is refused on the free plan.

These numbers are env vars. Pro always keeps price alerts, the multi-store split, cart handoffs, and coupons you type in, even if a free flag is widened. Store coupon links stay available on the free plan. See [Coupons](COUPONS.md).

| Variable | Default | Meaning |
| --- | --- | --- |
| `PLAN_FREE_SAVED_LISTS` | `1` | Saved lists on the free plan. `0` is unlimited |
| `PLAN_FREE_SHARED_LISTS` | `1` | Shared lists on the free plan. `0` is unlimited |
| `PLAN_FREE_PRICE_ALERTS` | `false` | `true`, `1`, `yes`, or `on` to allow alerts without Pro |
| `PLAN_FREE_MULTI_STORE` | `false` | Allow the multi-store split without Pro |
| `PLAN_FREE_CART_HANDOFFS` | `false` | Allow Kroger, Instacart, and the other cart links without Pro |
| `PLAN_FREE_OWN_COUPONS` | `false` | Allow typing in a coupon you already have without Pro |
| `PLAN_PRO_SAVED_LISTS` | `0` | `0` is unlimited |
| `PLAN_PRO_SHARED_LISTS` | `0` | `0` is unlimited |

Set them on the Railway web service. The ingest worker does not read them.

When billing is enforced, `POST /api/optimize-list` for a free shopper uses one store and returns `entitlement: { plan: "free", limited: ["multiStoreSplit", "cartHandoffs", "ownCoupons"] }`. Checkout links on that response are removed. The coupon page link and the item checklist stay. The form for a coupon you type in is hidden. A Pro account gets the split, the store buttons, and that form.

`requirePro` is the Express middleware for a route that should be Pro-only. It calls `next()` when the webhook secret is unset, and when the signed-in account has an active `pro` entitlement. Otherwise it responds 402 `{ code: "pro_required" }`. List, alert, and cart routes check the plan flags above so one free flag can open a single feature. Invalid request bodies stay 400. Kroger still returns 501 when it is not configured and the shopper is allowed to use cart handoffs.

## RevenueCat env vars

Set these on the Railway **web** service.

| Variable | Purpose |
| --- | --- |
| `REVENUECAT_WEBHOOK_SECRET` | Shared secret for `POST /api/billing/revenuecat`. **This is the switch.** Unset means fail open |
| `REVENUECAT_ENTITLEMENT_ID` | Entitlement identifier. Default `pro`. Must match RevenueCat and the value stored on the account |
| `REVENUECAT_SECRET_API_KEY` | Secret API key. Optional. `POST /api/billing/refresh` uses it. Leave unset to trust the webhook only |
| `REVENUECAT_IOS_API_KEY` | Public iOS SDK key (`appl_…`). Returned by `GET /api/billing/status` so the app can configure Purchases. Not a secret |
| `REVENUECAT_ANDROID_API_KEY` | Public Android SDK key (`goog_…`). Same as above |

Do not put the secret API key or the webhook secret in the app.

The account stores `entitlement` (`free` or `pro`), `entitlementExpiresAt`, and `revenueCatAppUserId`. Pro is active when the entitlement is `pro` and the expiry is empty or still in the future. Delete my data deletes the account, which deletes that record. It does not cancel the store subscription. The shopper cancels in the App Store or Play Store. See [DATA_DELETION.md](DATA_DELETION.md).

## App Store Connect

1. Sign the Paid Apps agreement and add banking and tax. Apple will not clear a subscription without them.
2. In the Grocery Gitter app (`app.grocerygitter`), create a subscription group, for example **Grocery Gitter Pro**.
3. Add an auto-renewable subscription. A monthly product id such as `gg_pro_monthly` is enough to start. A yearly product can share the same group. The product id is what RevenueCat maps onto the entitlement. The server does not read the product id. It reads the entitlement id `pro`.
4. Add a price, a display name, and a description. Review needs a screenshot of the paywall (Settings → See Pro) and the terms and privacy URLs (`/terms` and `/privacy`).
5. Submit the subscription with the app version that includes the Purchases plugin. `npm run cap:sync` (Codemagic runs `npx cap sync ios`) picks up `@revenuecat/purchases-capacitor`.

## Play Console

1. Create the app `app.grocerygitter` if it is not there yet, and finish the payments profile.
2. Monetize → Products → Subscriptions. Create a subscription with the same product id you used in App Store Connect, or a Play-specific id such as `gg_pro_monthly`. Add a base plan (monthly) and activate it.
3. Add license testers so a test purchase does not charge a card.
4. The RevenueCat Android app needs a Play service account with access to financial data and orders. RevenueCat’s Android setup page lists the exact roles.

## RevenueCat

1. Create a project. Add an iOS app with bundle id `app.grocerygitter` and an Android app with package `app.grocerygitter`.
2. Create an entitlement with identifier `pro` (or set `REVENUECAT_ENTITLEMENT_ID` to the identifier you chose).
3. Add the App Store and Play products and attach both to that entitlement.
4. Add an offering (the current offering) with a package that points at the product. The paywall lists `offerings.current.availablePackages`.
5. Copy the public SDK keys into `REVENUECAT_IOS_API_KEY` and `REVENUECAT_ANDROID_API_KEY`.
6. Copy the secret API key into `REVENUECAT_SECRET_API_KEY` if you want Settings to refresh from RevenueCat after a purchase. The webhook is the source of truth either way.
7. Webhook URL: `https://<your-railway-domain>/api/billing/revenuecat`. Authorization header value: the same string as `REVENUECAT_WEBHOOK_SECRET`. The server accepts `Bearer <secret>` or the raw secret. Set the secret on Railway **before** you send a test event, or the route returns 503 and RevenueCat will retry.
8. Send a test event only after an account exists. The app user id must be that account’s id (the id from `GET /api/auth/me`). An unknown id returns `200` and `{ "stored": false }` so RevenueCat does not retry forever.

Events that grant `pro`: `INITIAL_PURCHASE`, `RENEWAL`, `UNCANCELLATION`, `NON_RENEWING_PURCHASE`, `PRODUCT_CHANGE`, `TEMPORARY_ENTITLEMENT_GRANT`, `SUBSCRIPTION_EXTENDED`, `TRANSFER`. `CANCELLATION` keeps Pro until `expiration_at_ms`. `EXPIRATION` sets the account back to free. If the event lists entitlement ids and none of them is `pro`, the account is left alone.

## What the shopper sees

Settings always has **See Pro**. The sheet has the free vs Pro list, **Restore purchases**, Terms, Privacy, and **Manage subscription**.

- On the website the note is: “Web checkout is not offered. Subscriptions are available in the iOS and Android apps.” Restore does not charge anything.
- In the app, the shopper signs in first. The Purchases plugin is configured with the public SDK key and the account id. Restore and purchase call `POST /api/billing/refresh` afterward.
- Manage subscription opens `https://apps.apple.com/account/subscriptions` on iOS and `https://play.google.com/store/account/subscriptions?package=app.grocerygitter` on Android.

`GET /api/billing/status` is public. With a session it reports that account’s plan. It returns the public SDK keys, the entitlement id, the manage links, and `stripe.enabled: false`. It does not return the webhook secret or the secret API key.
