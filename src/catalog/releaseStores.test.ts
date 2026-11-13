import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BrowseProduct, CatalogOffer } from "./types";
import { isReleaseStore, restrictReleaseProduct, restrictReleaseTile } from "./releaseStores";

function offer(storeName: string, price = 1): CatalogOffer {
  return { storeName, price, onSale: false, availability: "in_stock", priceSource: "live" };
}

function product(id: string, offers: CatalogOffer[]): BrowseProduct {
  return {
    id,
    name: id,
    brand: id,
    imageUrls: [],
    departmentId: "meat-seafood",
    departmentName: "Meat & Seafood",
    storeBrand: false,
    offers,
    bestOffer: offers[0],
  };
}

describe("release store filter", () => {
  it("keeps Kroger-family banners and Walmart only", () => {
    assert.equal(isReleaseStore("Kroger"), true);
    assert.equal(isReleaseStore("Fry's"), true);
    assert.equal(isReleaseStore("Harris Teeter"), true);
    assert.equal(isReleaseStore("Walmart Supercenter"), true);
    assert.equal(isReleaseStore("Publix"), false);
    assert.equal(isReleaseStore("Target"), false);
    assert.equal(isReleaseStore("Aldi"), false);
  });

  it("strips Publix offers and drops a Publix-only product", () => {
    const mixed = restrictReleaseProduct(product("beef", [offer("Publix", 4), offer("Kroger", 5), offer("Walmart", 6)]));
    assert.deepEqual(mixed?.offers.map((row) => row.storeName), ["Kroger", "Walmart"]);
    assert.equal(mixed?.bestOffer.storeName, "Kroger");
    assert.equal(restrictReleaseProduct(product("publix-only", [offer("Publix", 3)])), null);
  });

  it("filters change-search tiles the same way", () => {
    const tile = restrictReleaseTile({
      ...product("ground-beef", [offer("Publix", 4)]),
      variants: [product("kroger-beef", [offer("Kroger", 5)]), product("publix-beef", [offer("Publix", 3)])],
      defaultVariantId: "publix-beef",
    });
    assert.equal(tile?.offers[0]?.storeName, "Kroger");
    assert.deepEqual(tile?.variants?.map((row) => row.id), ["kroger-beef"]);
    assert.equal(tile?.defaultVariantId, "kroger-beef");
  });
});
