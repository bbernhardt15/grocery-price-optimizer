# Phone audit — Grocery Gitter first run

Audited as a brand-new shopper on this branch (product-family tiles, PR #42). Local demo server, no retailer keys, ZIP `45202`. Playwright drove headless Chrome with `isMobile`, `hasTouch`, and the screen size set to the viewport (`deviceScaleFactor: 1`, CSS pixels).

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
| `docs/phone-audit/before/` | 390×844 | welcome dialog **before** the overflow fix |

The safe-area folders were captured before the follow-up check that actually applied the insets (the init script ran too early). The safe-area results in the findings below come from a second pass that set `--safe-area-inset-*` on `<html>` after load.

Journey, in order: welcome (including a bad ZIP), empty list, empty alerts, settings, filters, search for Oreo, Coca-Cola, milk, eggs, and dog food, size and quantity inside the tile, product detail, list and savings, plan-without-ZIP, trip plan, store handoff, per-store list, in-store mode, empty search, offline reload, failed browse, search with a shortened viewport (keyboard stand-in), filters with that same shortened viewport.

Shelves settled in about 550ms. Typeahead was about 40ms. Planning the trip was about 100–150ms. Nothing in that path felt slow on the demo catalog.

## Fixed in this branch

These were clear defects. Each is its own commit. The redesign can replace the layout; please do not put the overflow back.

1. **Welcome “Next” was off the screen.** `.top-actions` and `.toolbar-actions` are nowrap flex rows. On a 360–430px phone their min-content width is about 484–500px. Mobile Chrome then grows the layout viewport to that width while the visual viewport stays at the device width, so `position: fixed` dialogs size against the wider viewport. `#onboarding` became 440px wide and `#onboard-next` started at x≈388, with only a couple of pixels on screen. Playwright could not tap it; a person would have had to pan sideways to leave the welcome. Evidence: `docs/phone-audit/before/390-welcome-next-clipped.png`. Fix: `flex-wrap: wrap; max-width: 100%; min-width: 0` on `.top-actions` and `.toolbar-actions`, and the same min/max width on `.topbar` and `.toolbar` (`public/styles.css`).

2. **The trip plan scrolled sideways.** `.store-card p.muted` prints the operator setup hint, including `https://api.flipp.com/flyerkit/v4.0/documentation` with no break. That word plus the store total made the card about 413px wide inside a 358px column (page `scrollWidth` 429 on a 390px phone, 440 on a 360px phone). Fix: `min-width: 0` on `.trip`, `.store-grid`, `.store-card`, and the header’s text column; `flex-wrap: wrap` on `.store-card header`; `overflow-wrap: anywhere` on `.store-card p` and `.handoff-detail`. After the fix, `scrollWidth` matches the viewport at 360, 390, and 430. Shots: `390x844/24b-trip-plan-after-wrap.png`, `390x844/25b-store-handoff-after-wrap.png`.

3. **“Plan the trip” with no ZIP hid both the error and the field.** `#plan-error` rendered at y≈923 (below an 844px screen) inside `#list-panel`, and `planTrip` focused `#zip`. The ZIP’s box is y≈143–187 while the open sheet starts at y≈124, so the field is underneath the sheet. Fix in `planTrip` (`public/app.js`): on a viewport under 1100px, close the sheet, toast the same sentence, then focus `#zip`. Shot: `390x844/23b-plan-zip-error-after.png`.

4. **Offline restore left the shelf status on “Loading shelves…”.** The saved trip and `#catalog-error` were correct, but `#result-count` kept the initial HTML. It now reads “Saved on this device”. Shot: `390x844/30c-offline-after.png`.

## P0

None still open. The two overflow bugs above were P0 because the first screen’s primary button and the trip’s store cards were not fully on the phone.

## P1

### 1. The chrome eats the phone

`public/styles.css` — `.topbar`, `.top-actions`, `.list-bar`, `:root` (`--bar-h`)

After the wrap fix the header is **247px** tall at 360, 390, and 430 (brand, search, then two rows of ZIP / Settings / theme / Settings / Alerts / My list). `.list-bar` is **104px** (button, meter, caption). Together that is about 350px before any shelf. On 360×740 the products start halfway down the screen. See `390x844/07-home-shelves.png` and `360x740/07-home-shelves.png`.

With a 47px status-bar inset the header becomes **294px** and the bar **138px** (`padding-top` 61px, `padding-bottom` 42px). The variables work. The cost is more chrome.

Landscape 844×390: header **141px**, bar **104px**. The first `article.card .card-open` starts around y=150 and the bar starts at y=286, so the photo is covered and the size/add controls are below the fold. See `844x390/07-home-shelves.png`.

`--bar-h` is `118px + safe-area`, while the real bar is ~104px, so `.body` padding is a little taller than the bar. Not the main problem. The main problem is two stacked toolbars plus a three-line summary bar.

### 2. Two Settings buttons

`public/index.html` — `.settings-btn.settings-open` and `#settings-open`

Both are visible, both say “Settings”, both carry `.settings-open`. Only `#settings-open` has `aria-haspopup`, `aria-controls`, and `aria-expanded`. The extra control is part of why `.top-actions` wraps to two rows (each Settings button is ~90px).

### 3. First screen talks like an operator console

`public/app.js` — `#coverage-banner` (copy set in `loadPage`)

`public/index.html` — `#zip-hint`

On every shelf, before a search:

> Demo shelves — store prices here are samples until Walmart, Kroger, or a partner feed is configured. Open Coverage for what each store can actually browse.

`#zip-hint` is always under the header: “5-digit US ZIP… Target, Aldi, and other weekly ads use this ZIP’s circular, not a national shelf.”

A new shopper has not asked what a circular, a partner feed, or Coverage is. The banner is `0.92rem` muted text and it sits above the products.

### 4. Store cards show env-var setup, not a price explanation

`public/app.js` — `renderStore`, selector `.store-card p.muted` (fed by `store.pricing.detail`)

`src/pricing/flipp/flippProvider.ts` — `FLIPP_SETUP_HINT` / `setupHint()`

`src/pricing` Walmart provider setup hint (same slot)

On the demo trip the Aldi card includes:

> Aldi has no public product API. Weekly-ad prices (not a full shelf catalog) use Flipp. Official FlyerKit: set FLIPP_ACCESS_TOKEN from a Flipp technical contact (https://api.flipp.com/…)

Walmart’s paragraph names `WALMART_CONSUMER_ID`, `WALMART_PRIVATE_KEY`, and `walmart.io`. Wrapping the URL fixed the overflow. The sentence is still the wrong audience. Shopper-facing copy already exists for the case when Flipp is on (`FLIPP_ENABLED_HINT` does not mention the token). The unconfigured path still uses the operator hint, and the tile prints it in full.

### 5. Welcome says “send to carts”; the button opens an in-app checklist

`public/shopper/onboarding.js` — `CARTS_OPEN` (“Send each store’s items to its cart or a search page.”)

`public/app.js` — `.handoff-btn`, `[data-shop-list]`, `[data-kroger]`, `a.handoff-btn`

`src/storeHandoff.ts` — `krogerAction`, `walmartAction`, `shopListAction`

With no Kroger OAuth and no numeric Walmart item ids (demo / seed rows), every store button was **“Open Aldi list”** or **“Open Walmart list”**. There was no “Send to Kroger cart” and no “Send to Walmart cart”. The button opens `#trip-dialog` (`openChecklist`), not the retailer. The checklist’s per-item link is `a.text-btn` (“Open in {Store}”) when `item.url` exists. That is a reasonable fallback, and the label does not match the welcome step. Shots: `390x844/03-welcome-carts.png`, `390x844/25b-store-handoff-after-wrap.png`, `390x844/27b-store-list-after.png`.

### 6. One family tile is taller than the phone

`public/app.js` — `cardHtml`, selectors `article.card`, `.choice-row .choice-chip`, `[data-size-row] .size-list`, `.card-actions`

`public/shopper/familyTile.js` — labels only; the height is the rendered tile

Oreo is one card with eight flavor chips (Original, Double Stuf, Double Stuf Gluten Free, Double Stuf Golden, Mini, Mint, Thins, Zero Sugar) and a size list with a “Best value” badge, unit price, and a `.value-toggle` (“Per ounce” / “Per item”). Add and the quantity stepper sit under all of that. Coca-Cola is the same shape. Choosing a size and tapping `+` before Add does work (quantity is staged on `article.card` via `data-qty`). The cost is a long, dense card and a lot of reading before the first add. Shot: `390x844/14-oreo-size-qty.png`.

### 7. Several controls are under 44px

`public/styles.css`

| Selector | Measured / declared | Where it hurts |
| --- | --- | --- |
| `.chip`, `.dept-link` | `min-height: 40px` | `#dept-chips button.chip` (All, Produce, …) |
| `.choice-chip` | `min-height: 40px` | flavor radios inside `article.card` |
| `.stepper button` | `40×40` | `article.card .stepper button`, `#list-items .stepper button` |
| `.value-toggle button` | `min-height: 36px` | “Per ounce” / “Per item” on the tile |
| `.item-watch` | `min-height: 32px` | “Watch price” on each `#list-items .list-row` |
| `.target-price input` | `min-height: 36px` | “Target $” on each list row |
| `label.got-it` | about **24px** tall | the check-off control; `.got-it input` is `1.15rem` |
| `.export-row .ghost` | `min-height: 40px` | Copy list, Share, Print or PDF, Shareable link |
| `.move select` | `min-height: 40px` | “Change store” select |

`.size-option` and `.handoff-btn` are 44px or taller. The checkbox inside `label.check` is small, but that label is 44px tall, so Add is fine.

### 8. Bottom sheets stay under the keyboard

`public/styles.css` — `#filters.open` (`position: fixed; bottom: 0; z-index: 8`), `#list-panel.open` (same pattern)

`public/index.html` — `#filter-min`, `#filter-max`, `#display-name`, `#delete-confirm`

Shrinking the viewport by 336px (a stand-in for the iOS keyboard) left `#search` usable, because it is in the header. The filter sheet did not move. `#filter-min` and `#filter-max` sat below the list bar (field top 464, bar top 404 in the short viewport). `#onboard-zip` is in a centered dialog and stayed usable. Shots: `390x844/33-keyboard-filters.png`, `390x844/32-keyboard-search.png`.

### 9. Dialogs ignore the safe area

`public/styles.css` — `dialog.sheet`, `#trip-dialog.checklist-sheet`, `#onboarding`

`--safe-top` / `--safe-bottom` are applied on `.topbar`, `.list-bar`, `#filters.open`, and `#list-panel.open`. A centered or top-aligned `dialog` does not use them. After the trip overflow fix, `#trip-dialog` in in-store mode was top **19px**, height 806, on an 844px screen. A 47px status-bar inset covers the title. Landscape welcome ZIP (`#onboarding` on the zip step) is `max-height` constrained and scrolls (`scrollHeight` 406 vs client 359 at 844×390); the dialog still sits 16px from the top. Shot: `390x844/28b-instore-after.png`.

### 10. List rows ask for a price watch before the person has a list habit

`public/app.js` — `renderListRows`

`public/styles.css` — `.alert-controls`, `.item-watch`, `.target-price`

Every row shows “Watch price” and “Target $” as soon as the item is added, under a paragraph about comparing “the best price across stores with the price when you saved each item.” That is accurate and early. Combined with the 32px / 36px targets above, the sheet is busy on a first add. Shot: `390x844/21-list-with-items.png`.

## P2

### 11. Department chips scroll with no hint

`public/styles.css` — `.dept-chips` (`overflow-x: auto`)

`public/app.js` — `renderDepartments`, selector `#dept-chips button.chip`

The row is the right pattern (it does not widen the page). Nothing marks that Bakery through Pet are off to the right. Chips are also 40px tall (P1 table).

### 12. “Fewer stops” states a dollar rule with no context

`public/app.js` — `paintTrip`, selector `#fewer-stops` / `.fewer-stops`

> Fewer stops. Only add a store when it saves at least $2.

The $2 / $8 switch is real behavior and reads like a setting the shopper did not ask for. The headline above it is clear: “No single store carries this whole list”, with a per-store total and “This trip”. Keep that block; the threshold sentence is the confusing line.

### 13. “about $X” and “Demo catalog” on every price

`public/app.js` — `.price` via `aboutMoney`, `.badge-demo` via `labelClass`

Useful honesty, repeated on the tile, the list, and each trip line. On a demo server it is the dominant badge. Fine as a temporary state; loud if this build is what a first-run review sees.

### 14. Settings is a long first dialog

`public/index.html` — `#settings-dialog`

Account, Pro, theme, ZIP, Kroger, “Show welcome”, and “Delete my data” (type DELETE) are one scrolling dialog. On 390×844 it is about 716px and fits. On 360×740 it scrolls (`scrollHeight` 716, client 702). Nothing is trapped. It is a lot to meet before the first shop. Shot: `390x844/10-settings-top.png`, `390x844/11-settings-bottom.png`.

### 15. Empty, error, and offline states are in good shape

Worth keeping while the layout changes:

| State | Selector | Result |
| --- | --- | --- |
| Empty list | `#list-empty` | “Your list is empty” + “Browse the aisle”. `390x844/08-empty-list.png` |
| No alerts | `#alerts-empty` | “No price drops yet” path + “Turn on list alerts”. `390x844/09-alerts-empty.png` |
| No search hits | `#grid .empty-state` | “No matches” for `zzzznotagrocery`, with Clear search. `390x844/29-empty-search.png` |
| Browse failed | `#grid .empty-state` | “Couldn’t reach Grocery Gitter” + Try again. `390x844/31-network-error.png` |
| Offline with a saved trip | `#catalog-error`, `#trip .offline-note` | Trip comes back. Status line fixed in this branch. `390x844/30c-offline-after.png` |
| Bad welcome ZIP | `#onboard-zip-error` | “Enter a 5-digit ZIP, or leave it blank.” `390x844/05-welcome-zip-error.png` |

### 16. Contrast of the current palette passes WCAG AA

Sampled text on the home shelf in light and dark. Muted `#5c5348` on `#fffdfb` is about **7.4:1**. Muted on the page background `#f4efe6` is about **6.6:1**. Dark muted `#c3baac` on `#24302a` is about **7.1:1**. White on accent `#0e7a45` is about **5.4:1**. No contrast failure turned up on visible text. Do not lighten `--muted` further if the type stays under 18px.

### 17. In-store mode itself is understandable

`public/app.js` — `[data-instore="trip"]`, `#trip-dialog`

Title “In the store”, grouped by department, checkboxes, “Checked items stay on this device, including offline.” The per-store list uses the same dialog (`[data-shop-list]`). After the overflow fix the portrait dialog fits the width. The safe-area gap is P1.9.

## Screenshot index (390×844)

The same step names exist under `360x740/`, `430x932/`, and `844x390/` unless noted.

| File | Step |
| --- | --- |
| `01-welcome-pick.png` | Welcome, “Pick items” |
| `02-welcome-split.png` | “Split by the cheapest store” |
| `03-welcome-carts.png` | “Send to store carts” |
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
| `21-list-with-items.png` / `22-list-savings.png` | List and savings meter |
| `23-plan-zip-error.png` | Missing ZIP **before** the focus fix |
| `23b-plan-zip-error-after.png` | Same moment after the fix |
| `24-trip-plan.png` | Trip **before** the card wrap (sideways overflow) |
| `24b-trip-plan-after-wrap.png` | Trip after the wrap |
| `25-store-handoff.png` / `25b-store-handoff-after-wrap.png` | Open {Store} list |
| `27-store-list-modal.png` / `27b-store-list-after.png` | Per-store checklist |
| `28-instore-mode.png` / `28b-instore-after.png` | In-store mode |
| `29-empty-search.png` | No matches |
| `30-offline.png` / `30c-offline-after.png` | Offline reload, before and after the status fix |
| `31-network-error.png` | Browse request aborted |
| `32-keyboard-search.png` | Search with a short viewport |
| `33-keyboard-filters.png` | Filters with a short viewport |

`390x844-dark/` repeats the core path in dark mode. `*-safe/` repeats it with the safe-area variables attempted at load; trust the P1.9 note over those shots.
