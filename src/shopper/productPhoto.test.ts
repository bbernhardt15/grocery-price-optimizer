import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { productPhotoHtml } from "../../public/shopper/productPhoto.js";

const files = [
  "public/app.js",
  "public/shopper/myProductsUi.js",
  "public/shopper/import.js",
  "public/shopper/listRowChrome.js",
  "public/shopper/themedListsUi.js",
];

describe("product photo fallback", () => {
  it("renders a placeholder when the url is missing and a photo that can fail over", () => {
    assert.match(productPhotoHtml(""), /class="product-placeholder"/);
    assert.doesNotMatch(productPhotoHtml(""), /<img/);
    const photo = productPhotoHtml("https://cdn.example/milk.jpg", { className: "hero", rest: ["https://cdn.example/next.jpg"] });
    assert.match(photo, /data-photo="product"/);
    assert.match(photo, /class="hero"/);
    assert.match(photo, /data-rest="https:\/\/cdn\.example\/next\.jpg"/);
    assert.match(photo, /src="https:\/\/cdn\.example\/milk\.jpg"/);
  });

  it("does not leave a product image without the shared fallback", () => {
    const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
    assert.match(app, /productPhotoHtml\(image/);
    assert.match(app, /productPhotoHtml\(item\.imageUrl/);
    assert.match(app, /productPhotoHtml\(product\.imageUrls/);
    assert.doesNotMatch(app, /<img class="hero"/);
    for (const file of files) {
      const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
      assert.match(source, /productPhotoHtml|data-photo="product"/);
      assert.doesNotMatch(source, /<img(?![^>]*data-photo="product")[^>]*class="hero"/);
    }
  });
});
