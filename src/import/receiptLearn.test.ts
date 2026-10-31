import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gtinCheckDigit, upcForStorage } from "../catalog/normalize";
import { extractPdfText } from "./pdfText";
import {
  analyzeReceipt,
  inferReceiptPreferences,
  isReceiptStoreBrand,
  PAPER_RECEIPT_NOTE,
  parseReceiptText,
  type ReceiptLine,
} from "./receiptLearn";

function krogerCode(serial: number): string {
  const body = String(111100000000 + serial).padStart(12, "0");
  const last = (gtinCheckDigit(body) + 3) % 10;
  return `${body}${last}`;
}

const SAMPLE: Array<{ name: string; qty: number; price: number }> = [
  { name: "Kroger Large Eggs Grade A, 12 Count", qty: 1, price: 2.99 },
  { name: "Kroger Butter Spread, 15 oz", qty: 1, price: 2.49 },
  { name: "Kroger Cream Cheese, 8 oz", qty: 1, price: 1.99 },
  { name: "Kroger American Singles, 16 ct", qty: 2, price: 3.49 },
  { name: "Kroger Flour Tortillas, 10 ct", qty: 1, price: 2.19 },
  { name: "Kroger Potato Chips, 8 oz", qty: 1, price: 2.5 },
  { name: "Barilla Spaghetti, 16 oz", qty: 1, price: 1.67 },
  { name: "Bertolli Olive Oil and Garlic Pasta Sauce, 24 oz", qty: 1, price: 2.79 },
  { name: "Sweet Baby Ray's Barbecue Sauce, 18 oz", qty: 1, price: 2.49 },
  { name: "Tide Liquid Laundry Detergent, 92 oz", qty: 1, price: 11.99 },
  { name: "Snuggle Fabric Softener, 60 oz", qty: 1, price: 4.99 },
  { name: "Lysol Disinfectant Spray, 19 oz", qty: 1, price: 5.49 },
  { name: "Dove Sensitive Body Wash, 22 oz", qty: 1, price: 6.99 },
  { name: "Head & Shoulders Classic Clean Shampoo, 12.5 oz", qty: 1, price: 6.49 },
  { name: "Oreo Chocolate Sandwich Cookies, 13.29 oz", qty: 1, price: 4.29 },
  { name: "Kraft Macaroni and Cheese Cups, 4 ct", qty: 1, price: 1.25 },
  { name: "Tyson Dino Nuggets, 29 oz", qty: 1, price: 6.99 },
  { name: "Kool-Aid Jammers Cherry, 10 ct", qty: 1, price: 2.49 },
  { name: "Go-GURT Strawberry Yogurt, 8 ct", qty: 1, price: 3.29 },
  { name: "Healthy Choice Cafe Steamers, 10 oz", qty: 2, price: 3.49 },
  { name: "Dave's Killer Bread, 21 oz", qty: 1, price: 5.99 },
  { name: "Little Debbie Oatmeal Creme Pies, 12 ct", qty: 1, price: 2.79 },
  { name: "Kroger Vitamin D Whole Milk, 1 gal", qty: 1, price: 3.19 },
  { name: "Heinz Tomato Ketchup, 20 oz", qty: 1, price: 3.29 },
  { name: "Jif Creamy Peanut Butter, 16 oz", qty: 1, price: 3.49 },
  { name: "Folgers Classic Roast Ground Coffee, 30.5 oz", qty: 1, price: 8.99 },
  { name: "Coca-Cola, 12 ct", qty: 1, price: 7.49 },
  { name: "Bounty Select-A-Size Paper Towels, 6 ct", qty: 1, price: 8.99 },
  { name: "Charmin Ultra Soft Toilet Paper, 12 ct", qty: 1, price: 9.49 },
  { name: "Dawn Ultra Dish Soap, 19 oz", qty: 1, price: 3.79 },
  { name: "Cheerios Toasted Whole Grain Oat Cereal, 12 oz", qty: 1, price: 4.29 },
  { name: "Mahatma Jasmine Rice, 32 oz", qty: 1, price: 3.49 },
  { name: "Oscar Mayer Hardwood Smoked Bacon, 16 oz", qty: 1, price: 6.99 },
  { name: "Perdue Boneless Skinless Chicken Breast, 2 lb", qty: 1, price: 8.99 },
  { name: "Kroger Ground Beef 80/20, 1 lb", qty: 1, price: 5.49 },
  { name: "Fresh Bananas", qty: 1, price: 0.29 },
  { name: "Yellow Onions, 3 lb", qty: 1, price: 2.99 },
  { name: "Roma Tomatoes, 1 lb", qty: 1, price: 1.99 },
  { name: "Romaine Lettuce Hearts", qty: 1, price: 2.99 },
  { name: "Fresh Cilantro", qty: 1, price: 0.99 },
  { name: "Quaker Instant Oatmeal, 12 ct", qty: 1, price: 3.99 },
  { name: "Tropicana Orange Juice, 52 oz", qty: 1, price: 4.49 },
  { name: "Pepperidge Farm Goldfish Cheddar, 6.6 oz", qty: 1, price: 2.99 },
  { name: "Hellmann's Real Mayonnaise, 30 oz", qty: 1, price: 4.99 },
  { name: "Hidden Valley Ranch, 16 oz", qty: 1, price: 3.49 },
  { name: "Private Selection Vanilla Ice Cream, 48 oz", qty: 1, price: 4.99 },
  { name: "Kroger Italian Bread Crumbs, 15 oz", qty: 1, price: 1.79 },
  { name: "Kroger Purified Water, 24 pack", qty: 1, price: 3.99 },
];

function orderText(items = SAMPLE): string {
  const blocks = items.map((item, index) =>
    [item.name, `Qty: ${item.qty}`, `$${item.price.toFixed(2)}`, `UPC: ${krogerCode(index + 1)}`].join("\n")
  );
  return [
    "Kroger",
    "Order Number: 6150091827364501928",
    "Pickup location",
    "4145 Ferguson Road",
    "Cincinnati, OH 45245",
    "(513) 555-0199",
    "jane.shopper@example.com",
    "Loyalty card: 4812345678901234",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

function byFamily(lines: ReceiptLine[]) {
  return Object.fromEntries(lines.filter((line) => line.family).map((line) => [line.family, line]));
}

describe("receipt learning", () => {
  it("reads a Kroger order and keeps UPC, size, quantity, and price", () => {
    const lines = parseReceiptText(orderText());
    assert.equal(lines.length, 48);
    const eggs = lines.find((line) => line.family === "eggs");
    assert.ok(eggs);
    assert.equal(eggs?.brand, "Kroger");
    assert.equal(eggs?.storeBrand, true);
    assert.match(eggs?.size || "", /12/);
    assert.equal(eggs?.quantity, 1);
    assert.equal(eggs?.price, 2.99);
    assert.equal(eggs?.upc, krogerCode(1));
    assert.equal(upcForStorage(krogerCode(1)), krogerCode(1));
    assert.equal(eggs?.upc.length, 13);
    const singles = lines.find((line) => /singles/i.test(line.name));
    assert.equal(singles?.quantity, 2);
    const blob = JSON.stringify(lines);
    assert.equal(blob.includes("4145"), false);
    assert.equal(blob.includes("Ferguson"), false);
    assert.equal(blob.includes("6150091827364501928"), false);
    assert.equal(blob.includes("4812345678901234"), false);
    assert.equal(blob.includes("jane.shopper"), false);
    assert.equal(blob.includes("555-0199"), false);
    assert.equal(blob.includes("45245"), false);
  });

  it("normalizes a 12-digit UPC the same way Kroger and Walmart lookup does", () => {
    const lines = parseReceiptText("Coca-Cola\nUPC: 049000042566\nQty: 1\n$7.49");
    assert.equal(lines[0]?.upc, upcForStorage("049000042566"));
    assert.equal(lines[0]?.upc, "0004900004256");
    const already = parseReceiptText("Barilla Spaghetti\nUPC: 0004900004256");
    assert.equal(already[0]?.upc, "0004900004256");
  });

  it("detects store brands and name brands", () => {
    for (const brand of ["Kroger", "Simple Truth", "Private Selection", "Great Value", "Equate", "Marketside", "Good & Gather", "Market Pantry"]) {
      assert.equal(isReceiptStoreBrand(brand), true, brand);
    }
    assert.equal(isReceiptStoreBrand("Barilla"), false);
    assert.equal(isReceiptStoreBrand("Tide"), false);
    const lines = parseReceiptText(orderText());
    const families = byFamily(lines);
    assert.equal(families.eggs?.storeBrand, true);
    assert.equal(families.butter?.storeBrand, true);
    assert.equal(families["cream-cheese"]?.storeBrand, true);
    assert.equal(families.chips?.storeBrand, true);
    assert.equal(families.tortillas?.storeBrand, true);
    assert.equal(families.pasta?.brand, "Barilla");
    assert.equal(families.pasta?.storeBrand, false);
    assert.equal(families["pasta-sauce"]?.brand, "Bertolli");
    assert.equal(families["bbq-sauce"]?.brand, "Sweet Baby Ray's");
    assert.equal(families["laundry-detergent"]?.brand, "Tide");
    assert.equal(families.bread?.brand, "Dave's Killer Bread");
    assert.equal(families["chicken-nuggets"]?.brand, "Tyson");
    assert.equal(families.chicken?.brand, "Perdue");
    assert.equal(families.yogurt?.brand, "Go-GURT");
  });

  it("infers a preference per family and marks one order as a guess", () => {
    const analysis = analyzeReceipt(orderText());
    const learned = Object.fromEntries(analysis.learned.map((row) => [row.family, row]));
    assert.equal(analysis.paper, false);
    assert.equal(learned.eggs?.mode, "storeBrand");
    assert.equal(learned.eggs?.label, "Eggs");
    assert.equal(learned.eggs?.confidence, "low");
    assert.equal(learned.butter?.mode, "storeBrand");
    assert.equal(learned.chips?.mode, "storeBrand");
    assert.equal(learned.pasta?.mode, "brand");
    assert.equal(learned.pasta?.brand, "Barilla");
    assert.equal(learned["pasta-sauce"]?.mode, "brand");
    assert.equal(learned["pasta-sauce"]?.brand, "Bertolli");
    assert.equal(learned["pasta-sauce"]?.label, "Pasta sauce");
    assert.notEqual(learned.pasta?.family, learned["pasta-sauce"]?.family);
    assert.equal(learned["laundry-detergent"]?.brand, "Tide");
    assert.equal(learned["laundry-detergent"]?.label, "Laundry detergent");
    assert.equal(learned.bread?.brand, "Dave's Killer Bread");
    assert.equal(learned["chicken-nuggets"]?.brand, "Tyson");
    assert.equal(learned.chicken?.brand, "Perdue");
    assert.equal(learned["snack-cakes"]?.brand, "Little Debbie");
    assert.equal(learned["frozen-meal"]?.brand, "Healthy Choice");
    assert.equal(learned.bananas?.mode, "cheapest");
    assert.equal(learned.cheese?.count, 2);
    const again = analyzeReceipt(`${orderText()}\n--- receipt ---\n${orderText()}`);
    const eggs = again.learned.find((row) => row.family === "eggs");
    assert.equal(eggs?.confidence, "high");
    assert.equal(eggs?.receipts, 2);
    assert.equal(eggs?.count, 2);
    const mixed = inferReceiptPreferences([
      { ...analysis.lines.find((line) => line.family === "eggs")!, receipt: 1 },
      {
        ...(analysis.lines.find((line) => line.family === "eggs") as ReceiptLine),
        brand: "Eggland's Best",
        storeBrand: false,
        receipt: 2,
      },
    ]);
    assert.equal(mixed[0]?.confidence, "low");
  });

  it("flags a paper receipt that shortens names and has no UPC", () => {
    const paper = analyzeReceipt(`
KROGER #412
123 MAIN ST
MILK GALLON                 3.29
EGGS 18CT                   4.99
BREAD                       3.49
SUBTOTAL                   11.77
TAX                         0.84
VISA 4242
`);
    assert.equal(paper.paper, true);
    assert.equal(paper.paperNote, PAPER_RECEIPT_NOTE);
    assert.ok(paper.lines.length >= 3);
    assert.equal(paper.lines.some((line) => line.upc), false);
    assert.equal(JSON.stringify(paper.lines).includes("MAIN"), false);
    assert.equal(paper.lines.some((line) => /subtotal|visa/i.test(line.name)), false);
  });

  it("reads a Kroger receipt block with quantity, coupons, and a UPC", () => {
    const text = `
U by Kotex Tampons, Click, Compact,
Multipack Absorbencies 30 Count, 30
count
1.0 x $8.24 $8.99 ea.
Item Coupon/Sale: -$0.75
UPC:0003600051588

Bertolli® Olive Oil & Garlic Pasta Sauce,
24 oz
1.0 x $1.99 $2.99 ea.
Item Coupon/Sale: -$1.00
UPC:0003620021933

Head and Shoulders Dandruff 2 in 1 Shampoo and Conditioner, Classic Clean for Daily Use, 28.2 fl oz
1.0 x $14.99 ea.
UPC:0003077206404

Barilla Whole Grain Spaghetti Non-GMO and Kosher Pasta Made With Whole Wheat, 16 oz
1.0 x $0.99 $1.99 ea.
Item Coupon/Sale: -$0.40
Item Coupon/Sale: -$0.60
UPC:0007680800584

Bloom Sparkling Energy Shirley Temple, 12 fl oz
2.0 x $2.89 ea.
UPC:0084259514137

Order Number: 1262986136500120401
262 W Main St
Amelia, OH 45102 USA
Loyalty Card (last 4): #9085
Item Details
48 Items
`;
    const lines = parseReceiptText(text);
    const kotex = lines.find((line) => /kotex/i.test(line.name));
    assert.ok(kotex);
    assert.equal(kotex?.quantity, 1);
    assert.equal(kotex?.price, 8.24);
    assert.equal(kotex?.upc, upcForStorage("0003600051588"));
    const sauce = lines.find((line) => /olive oil/i.test(line.name));
    assert.equal(sauce?.brand, "Bertolli");
    assert.equal(sauce?.family, "pasta-sauce");
    assert.equal(sauce?.upc, upcForStorage("0003620021933"));
    const shampoo = lines.find((line) => /shoulders/i.test(`${line.brand} ${line.name}`));
    assert.equal(shampoo?.brand, "Head & Shoulders");
    assert.equal(shampoo?.family, "shampoo");
    const pasta = lines.find((line) => /spaghetti/i.test(line.name));
    assert.equal(pasta?.brand, "Barilla");
    assert.equal(pasta?.family, "pasta");
    const drink = lines.find((line) => /shirley/i.test(line.name));
    assert.equal(drink?.quantity, 2);
    assert.equal(drink?.upc, upcForStorage("0084259514137"));
    const blob = JSON.stringify(lines);
    assert.equal(blob.includes("1262986136500120401"), false);
    assert.equal(blob.includes("Main St"), false);
    assert.equal(blob.includes("45102"), false);
    assert.equal(blob.includes("9085"), false);
    assert.equal(lines.some((line) => /coupon/i.test(line.name)), false);
    assert.equal(lines.some((line) => line.name === "48 Items" || /item details/i.test(line.name)), false);
  });

  it("reads item text out of a digital PDF and does not keep the bytes", () => {
    const body = `BT
(Kroger Large Eggs Grade A, 12 Count) Tj
(UPC: ${krogerCode(7)}) Tj
(Qty: 1) Tj
($2.99) Tj
ET`;
    const pdf = Buffer.from(
      `%PDF-1.1
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj
4 0 obj << /Length ${body.length} >> stream
${body}
endstream
endobj
trailer << /Root 1 0 R >>
%%EOF`,
      "latin1"
    );
    const text = extractPdfText(pdf);
    assert.match(text, /Kroger Large Eggs/);
    assert.match(text, new RegExp(krogerCode(7)));
    const analysis = analyzeReceipt(text);
    assert.equal(analysis.lines[0]?.family, "eggs");
    assert.equal(analysis.lines[0]?.storeBrand, true);
    assert.equal(analysis.lines[0]?.upc, krogerCode(7));
  });
});
