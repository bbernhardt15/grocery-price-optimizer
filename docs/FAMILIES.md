# Staple families and how you buy them

Grocery Gitter matches a word like butter to a grocery family, then uses the shopper's preference for that family. A title that merely contains the word is not enough.

## What belongs

A product is in a family only when both of these hold:

- The head noun is the product. Butter is the dairy food. It is not peanut butter, butter-flavored popcorn, Butterfinger, or a wine named Butter.
- When the catalog sent a department, subcategory, or Kroger/Walmart category path, that path has to be the family's aisle. Pet food, candy, wine, soup, cosmetics, and other non-grocery departments stay out of human food families.

The families include eggs, milk, butter, bread, bacon, toilet paper, paper towels, cheese, chicken, ground beef, steak, pasta, rice, cereal, coffee, soda, yogurt, cilantro, lettuce, onions, tomatoes, bananas, peanut butter, ketchup, oil, laundry detergent, dish soap, chili, and chips.

Name brands and a sensible size are ranked first. A picker hides a missing image or a `WM` placeholder tile when another product in that family has a real image. Sizes of one brand are one tile.

`npx tsx scripts/staple-family-report.ts` prints the top matches and the suspected mismatches from the demo catalog. `GET /api/admin/catalog/staple-families` does the same against the stored catalog when `ADMIN_TOKEN` is set.

## How a shopper sets it

The first-run guide asks how many people (for quantities), allergies, diets, and how many stores are worth the trip. It then walks grocery categories one at a time.

The guide starts with a compact list of every category. Tap the ones you never buy, then answer the rest. **Use defaults: cheapest for everything I skip** fills the ones you did not answer. **Skip rest** leaves those unset. Progress reads like **12 of 29**.

Each category asks the cut or variety first (breast versus drums for chicken; bunch versus packaged for cilantro; yellow, red, or sweet onions). Name brand is a separate step, and only when the shelf has at least three real brands. Cuts are not brands. Sub-brands fold into the parent (Count Chocula is General Mills). Marks, case, and punctuation are folded so Chobani® and Chobani are one chip. Numeric ids, Unbranded, and distributor names such as Japanese Food Express Inc are dropped. Fresh produce skips the brand step and offers store brand, cheapest, or organic. A prepared mix such as chopped cilantro and onions is not a match for either item. There is no price on those tiles.

Switching Store brand and Cheapest keeps the cut and any name brand you already picked, and the screen says which mode is chosen.

**I don't buy this** keeps that family off later suggestions. A saved name brand is used until they Change it. Store brand picks that store's house brand. Cheapest uses the lowest price per unit already on the catalog row. A missing price stays missing.

The same answers live in My products and on the account as `categoryPreferences`.

## Asking for several items

What do you need? accepts a list such as `bread, milk, eggs, bacon, steak, chili, cilantro`, including a spoken line like “I need bread, onions, cereal and milk.” Filler words are stripped. Each family uses the saved preference. A family they don't buy is left off. A mixed or prepared product is not used in place of a single item. The screen says **Added 5 items from your favorites** and gives Change on each line, then **Review the split**.

The microphone stops itself after a short pause and still has a Stop button. `GET /api/health` reports `ai`, `vision`, and `speech` as booleans and nothing else. When smart parsing is off, the ask box says **Smart parsing is off; basic matching used**. Set `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`) to turn parsing, photo reading, and server transcription on. The guide, basic matching, and on-device speech do not need that key.

The plan can stay spread across stores for the lowest price, or move to fewer stores. Fewer stores keeps at most two stops and prefers Kroger and Walmart, because those can take a cart. Other stores stay lists. The control shows what the shorter trip saves or costs. Allergy and diet rules still win.
