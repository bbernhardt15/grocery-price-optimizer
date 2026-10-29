# Taste profile and My products

Grocery Gitter asks a new shopper a short series of questions before the first list. The point is the groceries they want and how many stores are worth the trip. Each screen is one question. They tap a chip, then Next. Every screen has Back and **Skip this one**. Closing it saves the step, and the next visit starts there.

A phone that already finished the older two-screen welcome is not sent through the guide again. **Edit my taste profile** in the menu opens the summary so they can fill it in.

See [FAMILIES.md](FAMILIES.md) for how a word becomes a grocery family and how a preference picks a product.

## What it asks

1. How many people. That number scales quantities. It does not plan meals.
2. Allergies. These are never included.
3. Diets. The list includes carnivore, Atkins, paleo, Whole30, low-carb, keto, gluten-free, vegetarian, vegan, pescatarian, halal, kosher, low sodium, and diabetic-friendly, plus a free-text other. A diet beats a saved product. Low sodium is saved and is not used as a hard ban, because salt shows up on too many labels.
4. How many stores are worth it: 1, 2, 3, or as many as it takes. The plan can still switch between the lowest price and fewer stores.
5. What they buy. First a compact list of all categories, so they can mark **I don't buy this** before any drill-down. Then one category at a time, with progress such as **12 of 29**. A category asks the cut or variety (and packaged versus loose for produce) before the brand. Name brand appears only when at least three real brands are on the shelf. Chicken cuts are not brands. Cereal sub-brands show as the parent. Fresh produce asks variety and offers store brand, cheapest, or organic. **Use defaults: cheapest for everything I skip** fills the rest. **Skip rest** leaves the rest unset. Tiles do not show a price or a store. Switching modes keeps the cut and the brand.
6. A summary. Each section has Edit. **Start shopping** closes the guide.

Pickup, delivery, and in-store are chosen in the store's own cart when that store has one. Kroger can take a cart. Walmart opens an add-to-cart link. Other stores get a list.

## Modules the ask box should call

These live in the shopper bundle and do not invent a product or a price.

| Call | File | What it returns |
| --- | --- | --- |
| `getUserProfile()` | `public/shopper/profile.js` | The saved profile, or an empty one. |
| `profileToConstraints(profile)` | `public/shopper/profileConstraints.js` | Allergies, diets, likes, never-buy text, brand mode, and products the shopper already picked. |
| `resolveProductPreference({ profile, query, products })` | `public/shopper/productPreference.js` | The catalog row for that word, or a same-family swap when the saved row is missing. |

`products` has to be real catalog rows. A missing price stays missing. The ask route accepts `constraints` from `profileToConstraints` and adds those lists to the model request. It still refuses prices and store names. The import review drops rows the profile excludes before the sheet is drawn.

## How a word becomes a product

`butter` uses the butter they picked. The list line has one **Change** link. Peanut butter is a different family, so a peanut allergy does not change their butter, and their butter is not peanut butter.

If the saved product is not on the shelf, the closest same-family catalog row is used. The plan is the only place that says **We swapped X for Y**, with **Change**. Tiles do not say which store.

After a single add of a product they have not locked, the app asks **Always use this butter?** **Always** locks it. **Just this time** does not ask again for that same product. Onboarding picks start locked. A diet or allergy still wins over a lock.

Brand mode is the default when they have not picked an exact product. Store brand uses the same house-brand list as the catalog. Cheaper uses a price that is already on the row.

## Where the rules apply

Hard exclusions filter the shelf, typeahead, starter lists, and meal-idea matches. If they type an excluded item themselves, the results stay and a note says why, including that matching uses the product words and they should still read the label.

Search, speech, and a pasted list all go through the same resolver. An imported row that is only an excluded item is left off.

## Storage

Guests keep the profile in `gg-profile` on the device. Signing in sends it with the list as `tasteProfile`. A missing profile on a later save leaves the account copy alone. The newer write wins. A product preference is kept per family by its own time, so an older phone does not wipe a newer butter lock.

**My products** in the menu lists locked and learned products and anything they marked never. Remove and Allow edit that list. Delete my data clears `gg-profile` with the other `gg-` keys, and deletes the account copy with the saved list.

## What Brandon does not have to set up

The guide and the filters run without a new environment variable. Demo shelves use the catalog placeholder image. A live catalog shows the retailer's front-of-package image when that row has one. The app does not draw a fake package or invent a price.

Allergies and diets are word filters, not a medical certification. The allergy screen says that, and shoppers should still read the label.
