import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { browseCatalog, setDepartmentFeedDelayForTests } from "./service";

describe("cold department first page", () => {
  after(() => setDepartmentFeedDelayForTests(0));

  it("paints a full Dairy & Eggs page without waiting on a slow live feed", async () => {
    setDepartmentFeedDelayForTests(800);
    const started = Date.now();
    const page = await browseCatalog({ departmentId: "dairy-eggs", limit: 24, zipCode: "45103" });
    const elapsed = Date.now() - started;
    setDepartmentFeedDelayForTests(0);
    assert.ok(elapsed < 400, `dairy page took ${elapsed}ms`);
    assert.ok(page.items.length >= 8, `dairy page had ${page.items.length} tiles`);
    assert.ok(page.total >= page.items.length);
    assert.match(page.warnings.join(" "), /saved aisle page/i);
  });
});
