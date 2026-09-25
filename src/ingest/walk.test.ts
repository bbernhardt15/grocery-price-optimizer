import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextKrogerStart, sanitizeKrogerParam } from "./krogerTerms";
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
});
