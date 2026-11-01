import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseImportText } from "./parseImportText";

const INSTACART = `
Your cart · Kroger
2
Organic Whole Milk
1 gal
$4.99
Add to cart
Save for later
1
Bananas
$0.54
Subtotal
$5.53
Tax
$0.40
TOTAL
$5.93
`;

const WALMART = `
Cart
Great Value Whole Milk, Gallon
$3.17
Qty 2
Dave's Killer Bread 21 oz
$5.48
Qty 1
Save for later
Subtotal
$11.82
`;

const AMAZON = `
Shopping List
2  Organic Milk, Gallon
Dave's Killer Bread, 21 oz
Eggs, 18 Count
Add to cart
`;

const NOTES = `
Groceries
☐ 2x milk gallon
☐ Bread - Dave's Killer
- eggs 18ct
• bananas
[ ] salted butter
[x] paper towels
Subtotal
`;

const REMINDERS = `
Milk
Eggs
Bread
2% Milk
Milk
`;

const RECEIPT = `
KROGER #412
123 MAIN ST
MILK GALLON                 3.29
EGGS 18CT                   4.99
BREAD                       3.49
SUBTOTAL                   11.77
TAX                         0.84
TOTAL                      12.61
VISA 4242
`;

const INSTACART_CSV = `delivered_date,store,product_name,qty,price
2024-04-02,Kroger,Organic Whole Milk,2,5.49
2024-04-02,Kroger,Large Eggs 18 ct,1,4.99
2024-04-02,Kroger,Dave's Killer Bread,1,5.99
`;

const AMAZON_CSV = `Order Date,Order ID,Title,Category,ASIN,Quantity
2024-03-01,111-123,OREO Chocolate Sandwich Cookies,Grocery,B000,2
2024-03-01,111-123,Diet Coke 12 Pack,Grocery,B111,1
`;

const WALMART_CSV = `Order date,Item name,Quantity,Item cost
01/02/2024,"Great Value Whole Milk, Gallon",2,3.17
01/02/2024,Bananas,1,0.54
`;

function names(text: string): string[] {
  return parseImportText(text).map((item) => item.name.toLowerCase());
}

describe("parseImportText real lists", () => {
  it("reads an Instacart cart paste and drops chrome", () => {
    const items = parseImportText(INSTACART);
    assert.deepEqual(
      items.map((item) => ({ name: item.name, quantity: item.quantity, size: item.size })),
      [
        { name: "Organic Whole Milk", quantity: 2, size: "1 gal" },
        { name: "Bananas", quantity: 1, size: undefined },
      ]
    );
    assert.equal(JSON.stringify(items).includes("4.99"), false);
    assert.equal(JSON.stringify(items).includes("Subtotal"), false);
  });

  it("reads a Walmart cart paste with Qty lines", () => {
    const items = parseImportText(WALMART);
    assert.equal(items[0]?.name, "Great Value Whole Milk");
    assert.equal(items[0]?.quantity, 2);
    assert.match(items[0]?.size || "", /gallon/i);
    assert.equal(items[1]?.name, "Dave's Killer Bread");
    assert.equal(items[1]?.quantity, 1);
    assert.match(items[1]?.size || "", /21 oz/i);
    assert.equal(items.length, 2);
  });

  it("reads an Amazon list paste", () => {
    const items = parseImportText(AMAZON);
    assert.equal(items.length, 3);
    assert.equal(items[0]?.quantity, 2);
    assert.match(items[0]?.name || "", /milk/i);
    assert.match(items[1]?.name || "", /Dave's Killer Bread/i);
    assert.match(items[2]?.name || "", /eggs/i);
    assert.match(items[2]?.size || "", /18/i);
  });

  it("reads Notes and Reminders, including checkboxes and 2% milk", () => {
    const notes = parseImportText(NOTES);
    const milk = notes.find((item) => item.name.toLowerCase() === "milk");
    assert.equal(milk?.quantity, 2);
    assert.match(milk?.size || "", /gallon/i);
    const bread = notes.find((item) => /bread/i.test(item.name));
    assert.equal(bread?.brand, "Dave's Killer");
    assert.ok(notes.some((item) => /eggs/i.test(item.name) && /18/.test(item.size || "")));
    assert.ok(notes.some((item) => item.name.toLowerCase() === "bananas"));
    assert.ok(notes.some((item) => /butter/i.test(item.name)));
    assert.ok(notes.some((item) => /paper towels/i.test(item.name)));
    assert.equal(notes.some((item) => /subtotal/i.test(item.name)), false);

    const reminders = parseImportText(REMINDERS);
    const plain = reminders.find((item) => item.name === "Milk");
    const twoPercent = reminders.find((item) => item.name === "2% Milk");
    assert.equal(plain?.quantity, 2);
    assert.equal(twoPercent?.quantity, 1);
  });

  it("reads a receipt and ignores totals", () => {
    const items = parseImportText(RECEIPT);
    assert.deepEqual(names(RECEIPT), ["milk", "eggs", "bread"]);
    assert.match(items[0]?.size || "", /gallon/i);
    assert.match(items[1]?.size || "", /18/);
    assert.equal(items.some((item) => /tax|total|visa|main/i.test(item.name)), false);
  });

  it("reads Instacart, Amazon, and Walmart spreadsheet exports", () => {
    const instacart = parseImportText(INSTACART_CSV);
    assert.equal(instacart[0]?.name, "Organic Whole Milk");
    assert.equal(instacart[0]?.quantity, 2);
    assert.match(instacart[1]?.size || "", /18/);
    assert.equal(instacart[2]?.name, "Dave's Killer Bread");

    const amazon = parseImportText(AMAZON_CSV);
    assert.equal(amazon[0]?.quantity, 2);
    assert.match(amazon[0]?.name || "", /OREO/i);
    assert.match(amazon[1]?.name || "", /Diet Coke/i);
    assert.match(amazon[1]?.size || "", /12/);

    const walmart = parseImportText(WALMART_CSV);
    assert.equal(walmart[0]?.quantity, 2);
    assert.match(walmart[0]?.name || "", /Whole Milk/i);
    assert.equal(walmart[1]?.name, "Bananas");
    assert.equal(JSON.stringify(walmart).includes("3.17"), false);
  });

  it("reads a spoken sentence, a recipe line, and a UPC", () => {
    const spoken = parseImportText(
      "two gallons of milk, the good bread, some chicken thighs, Oreos, and Diet Coke, 12 packs"
    );
    assert.equal(spoken[0]?.name.toLowerCase(), "milk");
    assert.equal(spoken[0]?.quantity, 2);
    assert.match(spoken[0]?.size || "", /gallon/i);
    assert.match(spoken[1]?.name || "", /bread/i);
    assert.match(spoken[2]?.name || "", /chicken thighs/i);
    assert.equal(spoken[2]?.quantity, 1);
    assert.match(spoken[3]?.name || "", /oreo/i);
    assert.match(spoken[4]?.name || "", /diet coke/i);
    assert.match(spoken[4]?.size || "", /12 pack/i);

    const recipe = parseImportText("2 cups of milk\n1 dozen eggs");
    assert.equal(recipe[0]?.name.toLowerCase(), "milk");
    assert.equal(recipe[0]?.quantity, 1);
    assert.equal(recipe[0]?.size, undefined);
    assert.match(recipe[1]?.name || "", /eggs/i);

    const upc = parseImportText("Whole Milk 0099991000011");
    assert.equal(upc[0]?.upc, "0099991000011");
    assert.match(upc[0]?.name || "", /milk/i);
  });

  it("keeps cinnamon and cherry pop-tarts as two items", () => {
    const spoken = parseImportText("I need cinnamon pop-tarts and cherry pop-tarts");
    assert.equal(spoken.length, 2);
    assert.match(spoken[0]?.name || "", /cinnamon pop-tarts/i);
    assert.match(spoken[1]?.name || "", /cherry pop-tarts/i);
    assert.equal(spoken[0]?.name.toLowerCase().includes("i need"), false);

    const shared = parseImportText("cinnamon and cherry pop-tarts");
    assert.equal(shared.length, 2);
    assert.match(shared[0]?.name || "", /cinnamon pop-tarts/i);
    assert.match(shared[1]?.name || "", /cherry pop-tarts/i);

    const milk = parseImportText("milk and cherry pop-tarts");
    assert.match(milk[0]?.name || "", /^milk$/i);
    assert.match(milk[1]?.name || "", /cherry pop-tarts/i);
  });

  it("combines duplicates and skips same-as-last-time", () => {
    const items = parseImportText("bananas\nbananas\nsame as last time\nthe usual");
    assert.equal(items.length, 1);
    assert.equal(items[0]?.quantity, 2);
  });
});
