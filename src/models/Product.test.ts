import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Product } from "./Product";

describe("Product schema", () => {
  it("automatically maintains updatedAt on every document", () => {
    assert.deepEqual(Product.schema.get("timestamps"), {
      createdAt: false,
      updatedAt: true,
    });
    assert.equal(Product.schema.pathType("updatedAt"), "real");
  });

  it("indexes name and updatedAt together for cache lookups", () => {
    const indexes = Product.schema.indexes();
    const cacheIndex = indexes.find(
      ([fields]) => fields.name === 1 && fields.updatedAt === -1
    );
    assert.ok(cacheIndex, "expected a compound index on { name: 1, updatedAt: -1 }");
  });

  it("stores live vs seed priceSource so demo rows are not treated as live cache", () => {
    const path = Product.schema.path("priceSource");
    assert.ok(path);
    const options = (path as { options?: { enum?: string[]; default?: string } }).options;
    assert.deepEqual(options?.enum, ["live", "seed"]);
    assert.equal(options?.default, "seed");
  });
});
