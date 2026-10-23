import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { krogerAdvance, krogerStartParam, nextKrogerStart, pickBrandSplits, sanitizeKrogerParam } from "./krogerTerms";
import { groceryLeaves, recordsFromWalmartPage, walmartNextCursor, walmartPagePath } from "./walmartWalk";

describe("walmart catalog walk", () => {
  it("keeps grocery leaves and skips other departments", () => {
    const leaves = groceryLeaves({
      categories: [
        {
          id: "food",
          name: "Food",
          path: "Food",
          children: [
            {
              id: "milk",
              name: "Milk",
              path: "Food/Dairy/Milk",
              children: [],
            },
          ],
        },
        {
          id: "elec",
          name: "Electronics",
          path: "Electronics",
          children: [{ id: "tv", name: "TVs", path: "Electronics/TVs", children: [] }],
        },
      ],
    });
    assert.deepEqual(
      leaves.map((leaf) => leaf.id),
      ["milk"]
    );
    assert.equal(leaves[0]?.departmentId, "dairy-eggs");
  });

  it("keeps the walked ancestry when Walmart repeats the root path on every node", () => {
    const leaves = groceryLeaves({
      categories: [
        {
          id: "food",
          name: "Food",
          path: "Food",
          children: [
            {
              id: "breakfast",
              name: "Breakfast Foods",
              path: "Food",
              children: [{ id: "cereal", name: "Cereal", path: "Food", children: [] }],
            },
          ],
        },
      ],
    });
    assert.equal(leaves[0]?.path, "Food/Breakfast Foods/Cereal");
    assert.equal(leaves[0]?.departmentId, "breakfast");
  });

  it("keeps diapers and cleaning supplies and skips strollers and clothes", () => {
    const leaves = groceryLeaves({
      categories: [
        {
          id: "baby",
          name: "Baby",
          path: "Baby",
          children: [
            { id: "diapers", name: "Diapers", path: "Baby", children: [] },
            { id: "strollers", name: "Strollers", path: "Baby", children: [] },
            { id: "bodysuits", name: "Bodysuits", path: "Baby", children: [] },
          ],
        },
        {
          id: "home",
          name: "Household Essentials",
          path: "Household Essentials",
          children: [
            { id: "clean", name: "Cleaning Supplies", path: "Household Essentials", children: [] },
            { id: "paper", name: "Paper Goods", path: "Household Essentials", children: [] },
          ],
        },
      ],
    });
    const ids = leaves.map((leaf) => leaf.id).sort();
    assert.deepEqual(ids, ["clean", "diapers", "paper"]);
    assert.equal(leaves.find((leaf) => leaf.id === "diapers")?.departmentId, "baby");
    assert.equal(leaves.find((leaf) => leaf.id === "clean")?.departmentId, "household");
    assert.equal(leaves.find((leaf) => leaf.id === "paper")?.departmentId, "household");
    assert.equal(leaves.find((leaf) => leaf.id === "diapers")?.path, "Baby/Diapers");
  });

  it("does not crawl nursery, travel, activities, resale, or brand-shop leaves", () => {
    const leaves = groceryLeaves({
      categories: [
        {
          id: "baby",
          name: "Baby",
          path: "Baby",
          children: [
            { id: "food", name: "Baby Food", path: "Baby", children: [] },
            { id: "formula", name: "Formula", path: "Baby", children: [] },
            { id: "feeding", name: "Bottle Feeding", path: "Baby", children: [] },
            { id: "activities", name: "Baby Activities", path: "Baby", children: [] },
            { id: "nursery", name: "Nursery", path: "Baby", children: [] },
            { id: "travel", name: "Travel Gear", path: "Baby", children: [] },
            { id: "resold", name: "Resold Baby", path: "Baby", children: [] },
            { id: "brand", name: "Shop by Baby Brand", path: "Baby", children: [] },
          ],
        },
      ],
    });
    assert.deepEqual(
      leaves.map((leaf) => leaf.id).sort(),
      ["food", "formula"]
    );
    assert.equal(leaves.find((leaf) => leaf.id === "formula")?.departmentId, "baby");
  });

  it("crawls grocery misses and skips general-merchandise roots", () => {
    const leaves = groceryLeaves({
      categories: [
        {
          id: "food",
          name: "Food",
          path: "Food",
          children: [
            { id: "condiments", name: "Condiments", path: "Food", children: [] },
            { id: "spices", name: "Spices & Seasonings", path: "Food", children: [] },
            { id: "gifts", name: "Food Gifts", path: "Food", children: [] },
            { id: "mixers", name: "Mixers", path: "Food", children: [] },
            { id: "tea", name: "Tea", path: "Food", children: [] },
          ],
        },
        {
          id: "health",
          name: "Health and Medicine",
          path: "Health and Medicine",
          children: [
            { id: "vitamins", name: "Vitamins and Supplements", path: "Health and Medicine", children: [] },
            { id: "letters", name: "Letter Vitamins", path: "Health and Medicine", children: [] },
            { id: "bcomplex", name: "Vitamin B Complex", path: "Health and Medicine", children: [] },
            { id: "organizers", name: "Pill Organizers", path: "Health and Medicine", children: [] },
            { id: "massage", name: "Massage", path: "Health and Medicine", children: [] },
            { id: "purifier", name: "Air Purifiers", path: "Health and Medicine", children: [] },
          ],
        },
        {
          id: "baby",
          name: "Baby",
          path: "Baby",
          children: [
            { id: "pants", name: "Training Pants", path: "Baby", children: [] },
            { id: "bassinet", name: "Bassinets", path: "Baby", children: [] },
          ],
        },
        {
          id: "pets",
          name: "Pets",
          path: "Pets",
          children: [
            { id: "dog-food", name: "Dog Food", path: "Pets", children: [] },
            { id: "dog-toys", name: "Dog Toys", path: "Pets", children: [] },
          ],
        },
        {
          id: "industrial",
          name: "Industrial & Scientific",
          path: "Industrial & Scientific",
          children: [
            { id: "janitorial", name: "Janitorial", path: "Industrial & Scientific", children: [] },
            { id: "strainers", name: "Drain Strainers", path: "Industrial & Scientific", children: [] },
          ],
        },
        { id: "jewelry", name: "Jewelry", path: "Jewelry", children: [{ id: "rings", name: "Rings", path: "Jewelry", children: [] }] },
        {
          id: "clothing",
          name: "Clothing",
          path: "Clothing",
          children: [{ id: "cloth-pants", name: "Training Pants", path: "Clothing", children: [] }],
        },
        {
          id: "toys",
          name: "Toys",
          path: "Toys",
          children: [
            { id: "toy-food", name: "Dog Food", path: "Toys", children: [] },
            { id: "toy-toys", name: "Dog Toys", path: "Toys", children: [] },
          ],
        },
        {
          id: "office",
          name: "Office Supplies",
          path: "Office Supplies",
          children: [{ id: "shredders", name: "Paper Shredders", path: "Office Supplies", children: [] }],
        },
        {
          id: "home",
          name: "Home Improvement",
          path: "Home Improvement",
          children: [{ id: "gloves", name: "Work Gloves", path: "Home Improvement", children: [] }],
        },
      ],
    });
    const ids = leaves.map((leaf) => leaf.id).sort();
    assert.deepEqual(ids, ["bcomplex", "cloth-pants", "condiments", "dog-food", "gifts", "janitorial", "letters", "mixers", "pants", "spices", "tea", "toy-food", "vitamins"]);
    assert.equal(leaves.find((leaf) => leaf.id === "cloth-pants")?.departmentId, "baby");
    assert.equal(leaves.find((leaf) => leaf.id === "toy-food")?.departmentId, "pet");
    assert.equal(leaves.find((leaf) => leaf.id === "vitamins")?.departmentId, "personal-care");
    assert.equal(leaves.find((leaf) => leaf.id === "letters")?.departmentId, "personal-care");
    assert.equal(leaves.find((leaf) => leaf.id === "bcomplex")?.departmentId, "personal-care");
    assert.equal(leaves.find((leaf) => leaf.id === "pants")?.departmentId, "baby");
    assert.equal(leaves.find((leaf) => leaf.id === "janitorial")?.departmentId, "household");
    assert.equal(leaves.find((leaf) => leaf.id === "dog-food")?.departmentId, "pet");
    assert.equal(leaves.find((leaf) => leaf.id === "gifts")?.departmentId, "pantry");
  });

  it("follows a nextPage URL, path, or cursor without dropping the category", () => {
    assert.equal(walmartPagePath("milk", null), "/paginated/items?category=milk&count=25");
    assert.equal(
      walmartPagePath(
        "milk",
        "https://developer.api.walmart.com/api-proxy/service/affil/product/v2/paginated/items?category=milk&nextPage=abc"
      ),
      "/paginated/items?category=milk&nextPage=abc"
    );
    assert.equal(walmartPagePath("milk", "cursor 2"), "/paginated/items?category=milk&count=25&nextPage=cursor%202");
    assert.equal(walmartNextCursor({ items: [], nextPage: "abc", nextPageExist: true }), "abc");
    assert.equal(walmartNextCursor({ items: [], nextPage: "abc", nextPageExist: false }), null);
  });

  it("maps a paginated item onto the shared record, including item id and sale", () => {
    const [record] = recordsFromWalmartPage(
      {
        items: [
          {
            itemId: 12345,
            name: "Whole Milk",
            brandName: "Dairy Pure",
            salePrice: 3.18,
            msrp: 3.98,
            upc: "00012345678905",
            size: "1 gal",
            largeImage: "https://example.test/milk.jpg",
            categoryPath: "Food/Dairy/Milk",
            stock: "Available",
            productUrl: "https://walmart.com/ip/12345",
          },
        ],
      },
      { id: "milk", name: "Milk", path: "Food/Dairy/Milk", departmentId: "dairy-eggs" }
    );
    assert.equal(record?.retailerItemId, "12345");
    assert.equal(record?.upc, "00012345678905");
    assert.equal(record?.onSale, true);
    assert.equal(record?.availability, "in_stock");
    assert.equal(record?.productUrl, "https://walmart.com/ip/12345");
    assert.equal(record?.departmentId, "dairy-eggs");
  });

  it("reads a numeric upc or a gtin so Walmart can share a Kroger master", () => {
    const [fromNumber] = recordsFromWalmartPage({
      items: [{ itemId: 1, name: "Whole Milk", salePrice: 3, upc: 123456789012 }],
    });
    assert.equal(fromNumber?.upc, "123456789012");
    const [fromGtin] = recordsFromWalmartPage({
      items: [{ itemId: 2, name: "Whole Milk", salePrice: 3, gtin: "00012345678905" }],
    });
    assert.equal(fromGtin?.upc, "00012345678905");
    const [missing] = recordsFromWalmartPage({
      items: [{ itemId: 3, name: "Whole Milk", salePrice: 3 }],
    });
    assert.equal(missing?.upc, undefined);
  });
});

describe("kroger page advance", () => {
  it("keeps ordinary terms and drops characters Kroger rejects", () => {
    assert.equal(sanitizeKrogerParam("cheddar cheese", 80), "cheddar cheese");
    assert.equal(sanitizeKrogerParam("Simple Truth", 40), "Simple Truth");
    assert.equal(sanitizeKrogerParam("milk <script>", 80), "milk script");
    assert.equal(sanitizeKrogerParam("   ", 80), null);
  });

  it("advances filter.start while the page is full and under the page cap", () => {
    assert.equal(nextKrogerStart(0, 50, 50, 0, 3), 50);
    assert.equal(nextKrogerStart(50, 50, 12, 1, 3), null);
    assert.equal(nextKrogerStart(100, 50, 50, 2, 3), null);
  });

  it("treats start 0 as the first page and never advances past 250", () => {
    assert.deepEqual(krogerStartParam(0), { action: "omit" });
    assert.deepEqual(krogerStartParam(undefined), { action: "omit" });
    assert.deepEqual(krogerStartParam(1), { action: "send", value: 1 });
    assert.deepEqual(krogerStartParam(250), { action: "send", value: 250 });
    assert.deepEqual(krogerStartParam(300), { action: "too-high" });
    assert.equal(nextKrogerStart(200, 50, 50, 4, 20), 250);
    assert.equal(krogerAdvance(250, 50, 50, 5, 20).kind, "start-ceiling");
    assert.equal(nextKrogerStart(250, 50, 50, 5, 20), null);
    assert.deepEqual(pickBrandSplits(["Chiquita", "Chiquita", "Dole", "Kroger"], ["Kroger"], 6), ["Chiquita", "Dole"]);
  });
});
