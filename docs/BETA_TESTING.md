# Beta testing

Grocery Gitter can take a private group of testers before a public launch. The invite gate, feedback box, and counters below are the tools for that. The privacy policy and terms are **drafts**. Have an attorney review them before a public launch.

## Invite testers

Set `BETA_INVITE_CODES` to a comma-separated list of codes, one code per tester (`mom-uqq6,dad-uqq6`). Leave it unset and the gate stays off, so the app opens the way it does today.

A tester opens the app and sees **Enter your invite code**. The code is remembered on that device. The server stores that code and a device id. It does not store an email address or any other personal detail. The code is how you tell one tester from another.

Feedback notes, client error reports, and the per-code event counters use the code already saved for that device. The server looks it up from the device id. A code typed into the feedback note, the error report, or the event request is ignored, so a tester cannot file a result under someone else's code. A device that never redeemed a code is stored with a blank code.

Signup rows are newest first. Each code includes the number of devices that redeemed it, when the first device redeemed it (`firstSeen`), the latest note, error, or visit (`lastActive`), the feedback count, the trip-complete count, and the client error count.

```
curl -s -H "Authorization: Bearer $GG_ADMIN_TOKEN" \
  https://YOUR-APP/api/admin/beta/signups

curl -s -H "Authorization: Bearer $GG_ADMIN_TOKEN" \
  "https://YOUR-APP/api/admin/beta/signups?code=mom-uqq6"
```

`ADMIN_TOKEN` is accepted on that route too, same as the other admin routes. `?code=` matches without regard to case. The response has no device ids and no email addresses.

## Read feedback

The menu and the Help section both say **Send feedback**. The sheet asks for a 1 to 5 rating, a note, and an optional screen name. The app attaches the shell cache, the tab, the user agent, how many items are on the trip, how many stores are in the plan, and a timestamp. The server adds the invite code for that device. It does not attach list names, receipt text, passwords, tokens, or an email address.

```
curl -s -H "Authorization: Bearer $GG_ADMIN_TOKEN" \
  https://YOUR-APP/api/admin/beta/feedback

curl -s -H "Authorization: Bearer $GG_ADMIN_TOKEN" \
  "https://YOUR-APP/api/admin/beta/feedback?code=mom-uqq6"

curl -s -H "Authorization: Bearer $GG_ADMIN_TOKEN" \
  -o feedback.csv \
  https://YOUR-APP/api/admin/beta/feedback.csv

curl -s -H "Authorization: Bearer $GG_ADMIN_TOKEN" \
  -o feedback.csv \
  "https://YOUR-APP/api/admin/beta/feedback.csv?code=mom-uqq6"
```

Newest notes are first. Each note includes `code`. The CSV keeps the existing columns and adds `code` at the end. The same token unlocks `GET /api/admin/beta/events`. The counters are onboarding completed, receipt imported, plan built, Kroger cart sent, Walmart opened, trip completed, and feedback sent. `count` is the total across every tester. `byCode` is that total split by invite code. Events from a device with no invite code stay in the total only.

```
curl -s -H "Authorization: Bearer $GG_ADMIN_TOKEN" \
  https://YOUR-APP/api/admin/beta/events

curl -s -H "Authorization: Bearer $GG_ADMIN_TOKEN" \
  "https://YOUR-APP/api/admin/beta/events?code=mom-uqq6"
```

With `?code=`, each row still has the overall `count`, plus `codeCount` for that tester. The counters are not an email address and they are not deleted with the account.

## Ready check

`GET /api/health/ready` returns `{ "ok": true, "mongo": "connected" }` when the database is up, and 503 when it is not.

## Known limits

- Kroger is the only retailer where Grocery Gitter can write a cart. The shopper still checks out on Kroger.
- Walmart opens a link. It does not sign in to a Walmart account and it does not write the cart itself.
- Coupons cannot be clipped or applied automatically. The app can open a store’s coupon page and total coupons the shopper typed in.
- Crash reports go to Sentry only when `SENTRY_DSN` is set. With it unset, the app still keeps a short throttled error log at `POST /api/beta/client-errors` and shows **Something went wrong** with Retry and Send feedback. The stored log includes the invite code for that device when one was redeemed. It does not include an email address.
- **Delete my account and data** (Settings, type `DELETE`) calls `DELETE /api/me/data`. That removes this device’s feedback, invite signup, and client errors, and the account when the tester is signed in. Product counters stay, including the per-code split, because those totals are not removed with the device.

## Railway variables this feature reads

- `GG_ADMIN_TOKEN` — required to read feedback, signup summaries, and counters. `ADMIN_TOKEN` is also accepted.
- `BETA_INVITE_CODES` — optional. Comma-separated, one code per tester. Unset means no invite screen.
- `SENTRY_DSN` — optional. Unset means client errors are not sent to Sentry.
