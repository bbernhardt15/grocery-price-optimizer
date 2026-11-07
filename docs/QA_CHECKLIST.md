# QA checklist

Run this before a beta deploy. Unit tests do not open the app. The end-to-end script does, at an iPhone size (390 by 844, touch), against the real server and an in-memory database.

## Local

```bash
npm test
npm run e2e
```

`npm test` is the existing unit suite. `npm run e2e` installs nothing by itself. The first time, install the browser:

```bash
npx playwright install chromium
npm run e2e
```

The e2e server sets `BETA_INVITE_CODES=Brandon-50y4`, leaves retailer and vision keys unset, and prices the sample receipt from deterministic catalog rows. It does not call Kroger, Walmart, or a vision API. Screenshots land in `e2e-artifacts/`.

GitHub Actions runs `npm test` and `npm run e2e` on every pull request. A failure blocks the PR.

## Flows the e2e suite covers

1. Invite gate on a fresh device. A wrong code is rejected. `Brandon-50y4` is accepted with that capitalization. Reload stays in.
2. Onboarding: Get started, ZIP 45202 or 45103, stores, Teach Gitter with `e2e/fixtures/sample-order.pdf`, the learned screen, and add to the trip. Typing the ZIP does not scroll the page. The "Reading your orders" screen is not shown.
3. Shopping list does not open by itself after those items are added. The shopper opens it. Quantity, remove, department headers, and a total that is not `$0.00` still work. Review the split finishes on Review.
4. Review shows the same dollar total on three visits and after reload. The list is not empty and priced lines are not duplicated.
5. In-store shows the checklist with item text.
6. Themed lists open, scroll inside the sheet (the page behind does not scroll), close, and do not leave Lists, Thanksgiving, or Football tailgate on Review.
7. Share explains what is shared and shows the link with Copy link. Make view-only and Revoke run after a link exists. The price-alert checkbox is absent when push is not configured.
8. Paste import returns a result. Photo or screenshot stays available. When photo reading is off, the note says it is not set up, and choosing a photo shows a progress line and then an explicit error. A non-grocery photo says no grocery items were found.
9. No uncaught page errors and no failed `/api` responses, other than the expected 401 for a wrong invite code.
10. Choosing a brand rule highlights that rule, shows Saved on the same row, and does not move the sheet or the page scroll. The swap checkbox does not move the sheet either.
11. Build has no large empty gap between the blocks on screen, and an unfocused Chrome toolbar is not treated as the keyboard.
12. Gitter's "Not yet" chip is followed by another prompt. The thread does not go blank.
13. A priced plan still paints when one store times out. In-store lists those items by store. A failed price check still shows the item names instead of blank rows or "No trip yet".
14. Fourteenth phone walkthrough, Chrome on iPhone (390 by 844): invite `brandon-50y4`, ZIP 45103, receipt teach, brand rule, add the learned items without the shopping list opening itself, Build chat and spacing, photo import feedback, Review paints a priced split, In-store shows the items.

## After a deploy

```bash
npm run smoke -- https://grocery-price-optimizer-production.up.railway.app YOUR_CODE
```

The script checks the invite gate, health, a two-item plan with a non-zero Kroger or Walmart price, and that the plan includes store rows for In-store. It exits non-zero on any failure. It prints statuses only. It does not print the invite code or any secret.

The shell cache is `v52` (`public/sw.js` and `public/shopper/betaContext.js`). A phone that is still on an older shell needs one reload in the browser so the new worker takes over.
