import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { publicListUrl, readSharedLink } from "./linkFetch";
import { setImportRuntime } from "./runtime";

describe("shared list links", () => {
  it("allows only https pages on known stores", () => {
    assert.equal(publicListUrl("https://www.walmart.com/lists/1")?.hostname, "www.walmart.com");
    assert.equal(publicListUrl("https://www.instacart.com/store/s")?.hostname, "www.instacart.com");
    assert.equal(publicListUrl("http://www.walmart.com/lists/1"), null);
    assert.equal(publicListUrl("https://user:pass@www.walmart.com/lists/1"), null);
    assert.equal(publicListUrl("https://evil.example/list"), null);
    assert.equal(publicListUrl("https://127.0.0.1/list"), null);
    assert.equal(publicListUrl("https://walmart.com.evil.example/list"), null);
  });

  it("does not fetch a public name that points at a private address", async () => {
    let called = false;
    setImportRuntime({
      lookup: async () => ["127.0.0.1"],
      fetchImpl: async () => {
        called = true;
        throw new Error("should not fetch");
      },
    });
    const result = await readSharedLink("https://www.walmart.com/lists/secret");
    assert.deepEqual(result, { ok: false, code: "unread" });
    assert.equal(called, false);
    setImportRuntime(null);
  });

  it("stops when a redirect leaves the store", async () => {
    const fetched: string[] = [];
    setImportRuntime({
      lookup: async () => ["8.8.8.8"],
      fetchImpl: async (input) => {
        const url = String(input);
        fetched.push(url);
        return new Response("", { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
      },
    });
    const result = await readSharedLink("https://www.amazon.com/hz/wishlist/x");
    assert.equal(result.ok, false);
    assert.deepEqual(fetched, ["https://www.amazon.com/hz/wishlist/x"]);
    setImportRuntime(null);
  });

  it("reads a public page and recognizes a sign-in wall", async () => {
    setImportRuntime({
      lookup: async () => ["8.8.8.8"],
      fetchImpl: async () =>
        new Response("<html><body><ul><li>2 Organic Whole Milk</li><li>Bananas</li></ul></body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    });
    const open = await readSharedLink("https://www.target.com/lists/1");
    assert.equal(open.ok, true);
    if (open.ok) assert.match(open.text, /Organic Whole Milk/);

    setImportRuntime({
      lookup: async () => ["8.8.8.8"],
      fetchImpl: async () =>
        new Response('<html><form><input type="password" /></form><p>Sign in to view this list</p></html>', {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    });
    const closed = await readSharedLink("https://www.kroger.com/list/1");
    assert.deepEqual(closed, { ok: false, code: "signin" });
    setImportRuntime(null);
  });
});
