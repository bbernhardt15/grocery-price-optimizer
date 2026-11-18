import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { krogerCommodityBinds, krogerTermBinds } from "./krogerBind";

describe("krogerTermBinds", () => {
  it("binds the real unmatched dairy names only when the brand and name are the same", () => {
    const rows = [
      { brand: "4C", name: "4C Parmesan Grated Cheese", upc: "0004138761190" },
      { brand: "Breakstone's", name: "Breakstone's All Natural Sour Cream", upc: "0002100030165" },
      {
        brand: "Cabot Creamery",
        name: "Cabot Creamery Extra Sharp Cheddar Cheese Block Refrigerated",
        upc: "0007835470318",
      },
      { brand: "Borden", name: "Borden Milk", upc: "0081547301038" },
      { brand: "BelGioioso", name: "BelGioioso Freshly Grated Parmesan Cheese", upc: "0003114235892" },
    ];
    for (const row of rows) {
      assert.equal(krogerTermBinds(row, { brand: row.brand, name: `${row.name}.` }), true, row.upc);
    }
    assert.equal(
      krogerTermBinds(
        { brand: "4C", name: "4C Parmesan Grated Cheese" },
        { brand: "4C", name: "4C Homestyle Parmesan Grated Cheese" }
      ),
      false
    );
    assert.equal(
      krogerTermBinds(
        { brand: "Cabot Creamery", name: "Cabot Creamery Extra Sharp Cheddar Cheese Block Refrigerated" },
        { brand: "Cabot Creamery", name: "Cabot Creamery Seriously Sharp Cheddar Cheese Block Refrigerated" }
      ),
      false
    );
    assert.equal(
      krogerTermBinds({ brand: "Borden", name: "Borden Milk" }, { brand: "Borden", name: "Borden 2% Reduced Fat Milk" }),
      false
    );
    assert.equal(
      krogerTermBinds(
        { brand: "Breakstone's", name: "Breakstone's All Natural Sour Cream" },
        { brand: "Daisy", name: "Breakstone's All Natural Sour Cream" }
      ),
      false
    );
  });

  it("binds produce, meat, and bakery on the commodity name", () => {
    assert.equal(
      krogerTermBinds(
        { name: "Bananas", brand: "Fresh", departmentId: "produce" },
        { name: "Bananas", brand: "Kroger" }
      ),
      true
    );
    assert.equal(krogerCommodityBinds("Gala Apples", "Granny Smith Apples"), false);
    assert.equal(krogerCommodityBinds("Bananas", "Banana Bread"), false);
    assert.equal(
      krogerTermBinds(
        { name: "Boneless Skinless Chicken Breast", departmentId: "meat-seafood" },
        { name: "Chicken Breast", brand: "Kroger" }
      ),
      false
    );
    assert.equal(
      krogerTermBinds(
        { name: "Chicken Breast", departmentId: "meat-seafood" },
        { name: "Boneless Skinless Chicken Breast", brand: "Simple Truth" }
      ),
      true
    );
    assert.equal(
      krogerTermBinds({ name: "French Bread", departmentId: "bakery" }, { name: "French Bread Loaf", brand: "Kroger" }),
      true
    );
  });
});
