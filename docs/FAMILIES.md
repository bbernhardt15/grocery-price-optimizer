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

Each category asks what kind, when the shelf has that cut or type, and offers **I don't buy this**. Then it asks name brand, store brand, or cheapest. Name brands are brands on the shelf in that family, not a fixed list. There is no price on those tiles. **Skip rest, I'll teach it as I shop** leaves the rest unset.

**I don't buy this** keeps that family off later suggestions. A saved name brand is used until they Change it. Store brand picks that store's house brand. Cheapest uses the lowest price per unit already on the catalog row. A missing price stays missing.

The same answers live in My products and on the account as `categoryPreferences`.

## Asking for several items

What do you need? accepts a list such as `bread, milk, eggs, bacon, steak, chili, cilantro`. Each word becomes a family. A saved preference adds that product. A family they don't buy is left off. Anything still unset is one question, with a choice to remember it. The screen says how many items were added and gives Change on each line, then **Review the split**.

The plan can stay spread across stores for the lowest price, or move to fewer stores. Fewer stores keeps at most two stops and prefers Kroger and Walmart, because those can take a cart. Other stores stay lists. The control shows what the shorter trip saves or costs. Allergy and diet rules still win.
