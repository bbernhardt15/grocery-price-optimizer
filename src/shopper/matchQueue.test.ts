import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createBrowseQueue } from "../../public/shopper/browseQueue.js";
import { matchBusyView, requestMatchBrowse } from "../../public/shopper/matchSheet.js";

describe("match sheet browse queue", () => {
  it("keeps the rows on screen when a match search is busy", () => {
    const busy = matchBusyView([{ id: "milk", label: "Milk" }]);
    assert.equal(busy.retry, true);
    assert.deepEqual(busy.rows, [{ id: "milk", label: "Milk" }]);
    assert.match(busy.status, /still here/);
    const empty = matchBusyView([]);
    assert.deepEqual(empty.rows, []);
    assert.equal(empty.retry, true);
    assert.match(empty.status, /Try this search again/);
  });

  it("concurrent match searches stay inside the shared cap and dedupe a URL", async () => {
    const queue = createBrowseQueue(2);
    let active = 0;
    let peak = 0;
    let calls = 0;
    const fetchBrowse = (url: string) =>
      queue.enqueue(url, () => {
        calls += 1;
        active += 1;
        peak = Math.max(peak, active);
        return new Promise((resolve) => {
          setTimeout(() => {
            active -= 1;
            resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
          }, 40);
        });
      });
    await Promise.all([
      requestMatchBrowse("/api/catalog/browse?q=milk", fetchBrowse),
      requestMatchBrowse("/api/catalog/browse?q=milk", fetchBrowse),
      requestMatchBrowse("/api/catalog/browse?q=bread", fetchBrowse),
      requestMatchBrowse("/api/catalog/browse?q=eggs", fetchBrowse),
      requestMatchBrowse("/api/catalog/browse?q=butter", fetchBrowse),
    ]);
    assert.ok(peak <= 2, `peak ${peak}`);
    assert.equal(calls, 4);
  });

  it("the mounted match sheet and catalog suggest use that queue", () => {
    const sheet = readFileSync(new URL("../../public/shopper/matchSheet.js", import.meta.url), "utf8");
    const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
    const importer = readFileSync(new URL("../../public/shopper/import.js", import.meta.url), "utf8");
    assert.match(sheet, /requestMatchBrowse\(apiUrl\(priced\), deps\.fetchBrowse\)/);
    assert.doesNotMatch(sheet, /await fetch\(/);
    const mount = app.slice(app.indexOf("matchSheet = mountMatchSheet"), app.indexOf("importer = mountImport"));
    assert.match(mount, /fetchBrowse/);
    assert.match(app, /fetchBrowse,/);
    assert.match(importer, /deps\.fetchBrowse\(apiUrl\(priced\)\)/);
    assert.match(app, /await fetchBrowse\(priced, \{ signal: controller\.signal \}\)/);
  });
});
