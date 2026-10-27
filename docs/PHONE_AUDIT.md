# Phone audit — Grocery Gitter first run

Audited as a brand-new shopper on the product-family tiles branch (PR #42), before the calm shop flow landed on `main`. Local demo server, no retailer keys, ZIP `45202`. Playwright drove headless Chrome with `isMobile`, `hasTouch`, and the screen size set to the viewport (`deviceScaleFactor: 1`, CSS pixels).

`main` has since merged that tiles work (PR #42) and the mobile redesign (PR #47, calm shop flow, merge `bcae665`, plus the coupon follow-up in PR #46). The four defects this audit fixed are already on `main` in that redesign. This branch keeps the write-up and the screenshots. It does not change shopper code.

Screenshots under `docs/phone-audit/` show the UI at audit time. Treat them as evidence of what was on screen then. The file and selector notes below are checked against `main` after the merge.

Viewports:

| Folder | Size | Device |
| --- | --- | --- |
| `docs/phone-audit/390x844/` | 390×844 | iPhone 14 portrait |
| `docs/phone-audit/360x740/` | 360×740 | small Android |
| `docs/phone-audit/430x932/` | 430×932 | large phone |
| `docs/phone-audit/844x390/` | 844×390 | iPhone 14 landscape |
| `docs/phone-audit/390x844-safe/` | 390×844 | same, with 47px top / 34px bottom safe-area variables |
| `docs/phone-audit/844x390-safe/` | 844×390 | landscape, with 47px side insets and 21px bottom |
| `docs/phone-audit/390x844-dark/` | 390×844 | dark color scheme |
| `docs/phone-audit/before/` | 390×844 | welcome dialog before the overflow fix |

The safe-area folders were captured before a follow-up that applied the insets (the init script ran too early). The safe-area notes in the original findings came from a second pass that set `--safe-area-inset-*` on `<html>` after load.

Journey, in order: welcome (including a bad ZIP), empty list, empty alerts, settings, filters, search for Oreo, Coca-Cola, milk, eggs, and dog food, size and quantity inside the tile, product detail, list and savings, plan-without-ZIP, trip plan, store handoff, per-store list, in-store mode, empty search, offline reload, failed browse, search with a shortened viewport (keyboard stand-in), filters with that same shortened viewport.

Shelves settled in about 550ms. Typeahead was about 40ms. Planning the trip was about 100–150ms. Nothing in that path felt slow on the demo catalog.

## Fixed on main

The redesign (PR #47, calm shop flow) and the phone chrome that shipped with it already cover these. Selectors below are the ones on `main`.

### Overflow and first-run blockers

1. **Welcome “Next” left the screen.** `.top-actions` and `.toolbar-actions` were nowrap flex rows. On a 360–430px phone their min-content width was about 484–500px, so the layout viewport grew and `#onboard-next` sat at x≈388. Evidence: `docs/phone-audit/before/390-welcome-next-clipped.png`. On `main`, `.top-actions`, `.toolbar-actions`, `.topbar`, and `.toolbar` wrap and use `min-width: 0; max-width: 100%` (`public/styles.css`). Phones also hide `.brand-kicker` and `#list-toggle` under 1099px, so the header has one Settings button.

2. **The trip plan scrolled sideways.** `.store-card p.muted` printed an unbroken Flipp setup URL. Page `scrollWidth` was 429 on a 390px phone. On `main`, `.trip`, `.store-grid`, and `.store-card` use `min-width: 0`, `.store-card header` wraps, and `.store-card p` / `.handoff-detail` use `overflow-wrap: anywhere`. `shopperCopy` in `public/shopper/calmPlan.js` also drops operator text (env vars, `api.flipp.com`, FlyerKit, “Open Coverage”), so that URL is no longer rendered.

3. **“Plan the trip” with no ZIP hid the error and the field.** `#plan-error` sat below the screen inside the open list sheet, which covered `#zip`. On `main`, `planTrip` in `public/app.js` uses main’s line: `const sheetCoversZip = window.matchMedia("(max-width: 1099px)").matches && listPanel.classList.contains("open");` then closes the sheet, toasts, and focuses `#zip`.

4. **Offline restore left “Loading shelves…”.** On `main`, the offline path sets `#result-count` to “Saved on this device” (`public/app.js`).

### Layout, copy, and touch (redesign)

5. **The chrome ate the phone.** The audit header was about 247px and `.list-bar` about 104px (button, meter, caption). On `main`, phones hide the brand kicker and the duplicate list toggle, visually hide the ZIP label and `#zip-hint`, and hide `.list-bar .meter`, `.bar-caption`, and `.bar-save`. Landscape (`max-height: 520px`) shortens `--step-h` / `--plan-h` and the header. The redesign’s remaining bottom chrome is `#step-bar` (Add items / See your plan / Shop) above `#list-bar`. `--bar-h` is the sum of those two bars plus the safe area.

6. **Two Settings buttons in the header.** The audit header had `.settings-btn.settings-open` and `#settings-open`. On `main` the header button is only `#settings-open`. A text Settings control remains in `.site-footer` and `.panel-legal` (`button.linkish.settings-open`), which is the legal-nav link.

7. **The first screen talked like an operator console.** The shelf banner described demo shelves, partner feeds, and Coverage. `#zip-hint` explained circulars. On `main`, `#coverage-banner` is `shelfNote` from `public/shopper/calmPlan.js` (“Sample prices. Not a receipt.”, or a one-line ZIP / weekly-ad note). `#coverage-open` is `hidden`. `#zip-hint` reads “Saved on this phone.” and is clipped off screen.

8. **Store cards showed env-var setup.** Aldi and Walmart paragraphs named `FLIPP_ACCESS_TOKEN`, `WALMART_CONSUMER_ID`, and API docs (`renderStore`, `.store-card p.muted`). On `main`, that slot is `shopperCopy(store.pricing?.detail)`, which returns an empty string for operator setup text.

9. **Welcome said “send to carts”; the button opened a checklist.** `CARTS_OPEN` in `public/shopper/onboarding.js` now says “Shop each store's list” and “A cart button appears only when that store can take one. Otherwise you open the list there.” Handoff buttons stay `.handoff-btn` / `[data-shop-list]` when no cart can be sent.

10. **Add sat below a tile taller than the phone.** Oreo’s flavor chips, size list, and unit toggle pushed `.card-actions` off the first screen (`390x844/14-oreo-size-qty.png`). On `main`, under 1099px, `.card-actions` is `position: sticky` above `--bar-h`, so Add stays reachable. The tile can still be long; that remaining density is listed under still open.

11. **Several controls were under 44px.** On `main` these are at least 44px tall in `public/styles.css`: `.chip`, `.dept-link`, `.choice-chip`, `.stepper button` (44×44), `.value-toggle button`, `.item-watch`, `.target-price` and its input, `label.got-it`, `.watch-toggle`, `.export-row .ghost`, `.move select`.

12. **Bottom sheets stayed under the keyboard.** `#filters.open` and `#list-panel.open` used `bottom: 0`. On `main` both use `bottom: var(--keyboard, 0px)`, and `keyboardOverlap` in `public/shopper/phone.js` (called from `public/app.js`) sets `--keyboard` from `visualViewport`. Inputs inside those sheets and `dialog.sheet` get a scroll margin that includes `--keyboard`.

13. **Dialogs ignored the safe area.** On `main`, `dialog.sheet` and `.sheet-body` cap height and pad with `--safe-top`, `--safe-bottom`, and `--keyboard`.

14. **Every list row opened a price watch immediately.** `renderListRows` showed “Watch price” and “Target $” as soon as an item was added, at 32px / 36px. On `main` those controls sit in `.alert-controls` and stay `hidden` until the row has a watch or a target. The disclosure is `button.watch-toggle` (“Price watch”), at 44px. The button itself is still on every row; see still open.

15. **Department chips scrolled with no hint.** `#chip-hint` (“More”) sits on the right of `.dept-scroller` with a fade. Chips are 44px.

16. **“Fewer stops” stated a $2 rule as a setting.** The checkbox `#fewer-stops` is gone. `fewerStopsOffer` in `public/shopper/calmPlan.js` offers a plain sentence and `#use-fewer-stops` (“Use fewer stops”) only when the gap is within $2.

17. **“Demo catalog” on every price.** The shelf line is now “Sample prices. Not a receipt.” Seed prices can add `calmPriceNote` (“sample price”). The estimate prefix “about $X” is still there; see still open.

18. **“Delete my data” led the bottom of a long settings dialog.** It is now `<details class="delete-box">` with summary “Delete my data” (`public/index.html`). The dialog is still long; see still open.

19. **In-store mode was understandable, and its dialog missed the status bar.** The safe-area padding in item 13 covers `dialog.sheet`, including in-store and the per-store list.

## Still open

These are the audit items `main` has not closed. None of them are the overflow blockers.

### P2 — A family tile is still a long read

`public/app.js` — `cardHtml`, selectors `article.card`, `.choice-row .choice-chip`, `[data-size-row] .size-list`

Oreo is still one card with flavor chips and a size list (unit price, “Best value”, `.value-toggle`). Sticky `.card-actions` keeps Add on screen. The amount of reading before the first add is unchanged. Shot from the audit: `390x844/14-oreo-size-qty.png`.

### P2 — Prices still say “about $X”

`public/shopper/calmPlan.js` — `aboutMoney`

`public/app.js` — `.price` via `aboutMoney`

Estimates render as `about ${formatMoney(value)}` on the tile, the list, and the trip. The redesign kept that label on purpose. It is still the dominant money wording on a first run.

### P2 — Every new list row still offers “Price watch”

`public/app.js` — `renderListRows`, selector `button.watch-toggle`

The checkbox and target field are hidden until that tap, and both are 44px when open. The button is on the row as soon as the item is added, before the person has a reason to watch a price. Shot from the audit (controls expanded, pre-redesign): `390x844/21-list-with-items.png`.

### P2 — Settings is still a long first dialog

`public/index.html` — `#settings-dialog`

Account, plan, theme, ZIP, Kroger, and “Show welcome” are one scrolling dialog. Delete is collapsed, so the destructive action is out of the first glance. On 390×844 the audit dialog was about 716px and fit; on 360×740 it scrolled. Shots: `390x844/10-settings-top.png`, `390x844/11-settings-bottom.png` (pre-redesign, delete expanded).

## Kept on purpose

Empty, error, and offline states were in good shape at audit time, and the redesign’s shopper modules still own those sentences (`public/shopper/emptyStates.js` and the offline line above).

| State | Selector | Audit result |
| --- | --- | --- |
| Empty list | `#list-empty` | “Your list is empty” + “Browse the aisle”. `390x844/08-empty-list.png` |
| No alerts | `#alerts-empty` | “No price drops yet” + “Turn on list alerts”. `390x844/09-alerts-empty.png` |
| No search hits | `#grid .empty-state` | “No matches” for `zzzznotagrocery`, with Clear search. `390x844/29-empty-search.png` |
| Browse failed | `#grid .empty-state` | “Couldn’t reach Grocery Gitter” + Try again. `390x844/31-network-error.png` |
| Offline with a saved trip | `#catalog-error`, `#trip .offline-note` | Trip comes back. Status line is “Saved on this device”. `390x844/30c-offline-after.png` |
| Bad welcome ZIP | `#onboard-zip-error` | “Enter a 5-digit ZIP, or leave it blank.” `390x844/05-welcome-zip-error.png` |

Contrast of the palette on `main` matches the colors sampled in the audit (`--muted` `#5c5348` on `#fffdfb` about 7.4:1, muted on `#f4efe6` about 6.6:1, dark muted `#c3baac` on `#24302a` about 7.1:1, white on `#0e7a45` about 5.4:1). This pass did not re-sample pixels. Do not lighten `--muted` further if the type stays under 18px.

In-store mode (“In the store”, department groups, on-device checkoffs) was understandable. The safe-area gap on that dialog is in the fixed list.

## Screenshot index (390×844)

The same step names exist under `360x740/`, `430x932/`, and `844x390/` unless noted. These frames are the pre-redesign audit.

| File | Step |
| --- | --- |
| `01-welcome-pick.png` | Welcome, “Pick items” |
| `02-welcome-split.png` | “Split by the cheapest store” |
| `03-welcome-carts.png` | Carts step (wording has since changed on main) |
| `04-welcome-zip.png` | ZIP step |
| `05-welcome-zip-error.png` | Invalid ZIP (390 only) |
| `06-welcome-kroger.png` | Kroger step, connect unavailable |
| `07-home-shelves.png` | Shelf after welcome |
| `08-empty-list.png` | My list, nothing added |
| `09-alerts-empty.png` | Alerts |
| `10-settings-top.png` / `11-settings-bottom.png` | Settings |
| `12-filters.png` | Filters sheet |
| `13-oreo-suggest.png` / `13-oreo-results.png` | Oreo typeahead and results |
| `14-oreo-size-qty.png` / `15-oreo-added.png` | Size, quantity 3, added |
| `16-coke-*` | Coca-Cola |
| `17-milk-*` | milk |
| `18-eggs-*` | eggs |
| `19-dogfood-*` | dog food |
| `20-product-detail.png` | Product sheet |
| `21-list-with-items.png` / `22-list-savings.png` | List and savings |
| `23-plan-zip-error.png` | Missing ZIP before the focus fix |
| `23b-plan-zip-error-after.png` | Same moment after the fix |
| `24-trip-plan.png` | Trip before the card wrap (sideways overflow) |
| `24b-trip-plan-after-wrap.png` | Trip after the wrap |
| `25-store-handoff.png` / `25b-store-handoff-after-wrap.png` | Open {Store} list |
| `27-store-list-modal.png` / `27b-store-list-after.png` | Per-store checklist |
| `28-instore-mode.png` / `28b-instore-after.png` | In-store mode |
| `29-empty-search.png` | No matches |
| `30-offline.png` / `30c-offline-after.png` | Offline reload, before and after the status fix |
| `31-network-error.png` | Browse request aborted |
| `32-keyboard-search.png` | Search with a short viewport |
| `33-keyboard-filters.png` | Filters with a short viewport |

`390x844-dark/` repeats the core path in dark mode. `*-safe/` repeats it with the safe-area variables attempted at load.
