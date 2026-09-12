import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { GroceryScraperError } from "./errors";
import { scrapeGrocerySearch } from "./scrapeGrocerySearch";
import type { GrocerySiteConfig } from "./types";

const homepageHtml = `<!DOCTYPE html>
<html lang="en">
  <head><title>Corner Grocery</title></head>
  <body>
    <form action="/search" method="get">
      <input id="search-bar" name="q" type="search" placeholder="Search groceries" />
      <button type="submit">Search</button>
    </form>
  </body>
</html>`;

const resultsHtml = `<!DOCTYPE html>
<html lang="en">
  <head><title>Search – Corner Grocery</title></head>
  <body>
    <ul>
      <li class="product-card">
        <a class="product-link" href="/p/almond-milk">
          <h2 class="product-title">Organic Unsweetened Almond Milk</h2>
        </a>
        <p class="product-brand">Pacific Foods</p>
        <p class="product-price">$4.39</p>
      </li>
      <li class="product-card">
        <a class="product-link" href="/p/oat-milk">
          <h2 class="product-title">Barista Oat Milk</h2>
        </a>
        <p class="product-brand">Oatly</p>
        <p class="product-price">Regular Price $5.29 Sale price $4.79</p>
      </li>
      <li class="product-card">
        <h2 class="product-title">Mystery Item With No Price</h2>
      </li>
    </ul>
  </body>
</html>`;

const emptyHtml = `<!DOCTYPE html>
<html lang="en">
  <head><title>Search – Corner Grocery</title></head>
  <body><p>No products found.</p></body>
</html>`;

function startStore(): Promise<{ server: http.Server; origin: string }> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(homepageHtml);
      return;
    }

    if (url.pathname === "/search") {
      const query = url.searchParams.get("q") ?? "";
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(query.toLowerCase().includes("empty") ? emptyHtml : resultsHtml);
      return;
    }

    if (url.pathname === "/broken") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html><body><p>No search box here.</p></body></html>");
      return;
    }

    res.writeHead(404);
    res.end("not found");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

function siteFor(origin: string, homepagePath = "/"): GrocerySiteConfig {
  return {
    name: "Corner Grocery",
    homepageUrl: `${origin}${homepagePath}`,
    currency: "USD",
    searchInput: "#search-bar",
    searchSubmit: 'button[type="submit"]',
    resultItem: ".product-card",
    title: ".product-title",
    price: ".product-price",
    brand: ".product-brand",
    link: ".product-link",
  };
}

describe("scrapeGrocerySearch", () => {
  let server: http.Server;
  let origin: string;

  before(async () => {
    ({ server, origin } = await startStore());
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("types a keyword and returns structured title/price objects", async () => {
    const products = await scrapeGrocerySearch("almond milk", {
      site: siteFor(origin),
      navigationTimeoutMs: 10_000,
      selectorTimeoutMs: 10_000,
    });

    assert.equal(products.length, 2);
    assert.deepEqual(products[0], {
      title: "Organic Unsweetened Almond Milk",
      price: 4.39,
      brand: "Pacific Foods",
      storeName: "Corner Grocery",
      url: `${origin}/p/almond-milk`,
      currency: "USD",
    });
    assert.equal(products[1].price, 4.79);
    assert.equal(products[1].title, "Barista Oat Milk");
  });

  it("returns an empty array when the results list is missing", async () => {
    const products = await scrapeGrocerySearch("empty", {
      site: siteFor(origin),
      selectorTimeoutMs: 3_000,
    });
    assert.deepEqual(products, []);
  });

  it("throws MISSING_ELEMENT when the search bar is not on the page", async () => {
    await assert.rejects(
      () =>
        scrapeGrocerySearch("milk", {
          site: siteFor(origin, "/broken"),
          selectorTimeoutMs: 2_000,
        }),
      (error: unknown) => {
        assert.ok(error instanceof GroceryScraperError);
        assert.equal(error.code, "MISSING_ELEMENT");
        return true;
      }
    );
  });

  it("throws INVALID_KEYWORD for a blank query", async () => {
    await assert.rejects(
      () => scrapeGrocerySearch("   "),
      (error: unknown) => {
        assert.ok(error instanceof GroceryScraperError);
        assert.equal(error.code, "INVALID_KEYWORD");
        return true;
      }
    );
  });
});
