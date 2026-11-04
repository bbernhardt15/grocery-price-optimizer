# Beta testing

Grocery Gitter can take a private group of testers before a public launch. The invite gate, feedback box, and counters below are the tools for that. The privacy policy and terms are **drafts**. Have an attorney review them before a public launch.

## Invite testers

Set `BETA_INVITE_CODES` to a comma-separated list of codes, one per group if you want to tell groups apart (`friends,family`). Leave it unset and the gate stays off, so the app opens the way it does today.

A tester opens the app and sees **Enter your invite code**. The code is remembered on that device. The server stores the code and a device id, not an email address.

Counts, newest activity first:

```
curl -s -H "Authorization: Bearer $GG_ADMIN_TOKEN" \
  https://YOUR-APP/api/admin/beta/signups
```

`ADMIN_TOKEN` is accepted on that route too, same as the other admin routes.

## Read feedback

The menu and the Help section both say **Send feedback**. The sheet asks for a 1 to 5 rating, a note, and an optional screen name. The app attaches the shell cache, the tab, the user agent, how many items are on the trip, how many stores are in the plan, and a timestamp. It does not attach list names, receipt text, passwords, or tokens.

```
curl -s -H "Authorization: Bearer $GG_ADMIN_TOKEN" \
  https://YOUR-APP/api/admin/beta/feedback

curl -s -H "Authorization: Bearer $GG_ADMIN_TOKEN" \
  -o feedback.csv \
  https://YOUR-APP/api/admin/beta/feedback.csv
```

Newest notes are first. The same token unlocks `GET /api/admin/beta/events`, which is a set of counters: onboarding completed, receipt imported, plan built, Kroger cart sent, Walmart opened, trip completed, and feedback sent. The counters are totals. They are not tied to a person.

## Ready check

`GET /api/health/ready` returns `{ "ok": true, "mongo": "connected" }` when the database is up, and 503 when it is not.

## Known limits

- Kroger is the only retailer where Grocery Gitter can write a cart. The shopper still checks out on Kroger.
- Walmart opens a link. It does not sign in to a Walmart account and it does not write the cart itself.
- Coupons cannot be clipped or applied automatically. The app can open a store’s coupon page and total coupons the shopper typed in.
- Crash reports go to Sentry only when `SENTRY_DSN` is set. With it unset, the app still keeps a short throttled error log at `POST /api/beta/client-errors` and shows **Something went wrong** with Retry and Send feedback.
- **Delete my account and data** (Settings, type `DELETE`) calls `DELETE /api/me/data`. That removes this device’s rows, and the account when the tester is signed in. Product counters stay, because they are not tied to a device.

## Railway variables this feature reads

- `GG_ADMIN_TOKEN` — required to read feedback, signup counts, and counters. `ADMIN_TOKEN` is also accepted.
- `BETA_INVITE_CODES` — optional. Unset means no invite screen.
- `SENTRY_DSN` — optional. Unset means client errors are not sent to Sentry.
