import { expect, test } from "@playwright/test";

test("retest keeps the latest aisle, a scrollable Refine sheet, and department groups", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem(
      "gg-list",
      JSON.stringify([
        { id: "custom:milk", itemId: "custom:milk", name: "Milk", quantity: 1 },
        { id: "custom:eggs", itemId: "custom:eggs", name: "Eggs", quantity: 1 },
        { id: "custom:bread", itemId: "custom:bread", name: "Bread", quantity: 1 },
      ])
    );
  });
  let generation = 0;
  await page.route("**/api/catalog/browse**", async (route) => {
    const dept = new URL(route.request().url()).searchParams.get("department") || "all";
    const mine = ++generation;
    await new Promise((resolve) => setTimeout(resolve, dept.endsWith("produce") ? 350 : 40));
    if (mine !== generation) {
      await route.abort();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: `live-${dept}`,
            name: `Shown ${dept}`,
            familyName: `Shown ${dept}`,
            brand: "Test",
            imageUrls: [],
            variants: [],
          },
          {
            id: "dead",
            name: "***Discontinued***GHS***CORNED BEEF POINTS",
            familyName: "***Discontinued***GHS***CORNED BEEF POINTS",
            brand: "GHS",
            imageUrls: [],
            variants: [],
          },
        ],
        total: 1,
      }),
    });
  });
  await page.route("**/api/optimize-list", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        total: 6,
        partial: false,
        pendingStores: [],
        pricingByStore: [
          { storeName: "Kroger", check: "ok" },
          { storeName: "Walmart", check: "ok" },
        ],
        stores: [
          {
            storeName: "Kroger",
            subtotal: 6,
            items: [
              { lineId: "pasta", name: "Pasta", price: 2, quantity: 1, itemTotal: 2, department: "Pantry", storeName: "Kroger" },
              { lineId: "soap", name: "Soap", price: 4, quantity: 1, itemTotal: 4, department: "Personal Care", storeName: "Kroger" },
            ],
          },
        ],
      }),
    });
  });

  await page.goto("/");
  await page.locator("#beta-code").first().fill("Brandon-50y4");
  await page.locator("#beta-gate-form button[type=submit]").first().click();
  await expect(page.locator("#beta-gate")).toBeHidden();

  const guide = page.locator("#gitter-guide");
  await expect(guide).toBeVisible();
  await expect(guide).not.toContainText(/low on Milk/i);
  if (await guide.getByRole("button", { name: "Not yet" }).count()) {
    await guide.getByRole("button", { name: "Not yet" }).click();
  }
  if (await guide.getByRole("button", { name: "Add an item" }).count()) {
    await guide.getByRole("button", { name: "Add an item" }).click();
    await expect(page.locator("#import-dialog")).toBeHidden();
    await expect(page.locator("#search")).toBeFocused();
  }

  await page.locator("#browse-toggle").click();
  const chips = page.locator("#dept-chips button");
  await expect(chips.nth(2)).toBeVisible();
  await chips.nth(1).click();
  await chips.nth(2).click();
  const label = (await chips.nth(2).innerText()).trim();
  await expect(page.locator("#result-count")).toContainText(label);
  await expect(page.locator("#catalog")).not.toContainText("Discontinued");

  await page.locator("#filters-open").click();
  const refine = await page.locator("#filters").evaluate((el) => ({
    overflow: getComputedStyle(el).overflowY,
    overscroll: getComputedStyle(el).overscrollBehaviorY,
    flag: document.body.dataset.refine || "",
  }));
  expect(refine.overflow).toBe("auto");
  expect(refine.overscroll).toBe("contain");
  expect(refine.flag).toBe("1");
  await page.locator("#filters-close").click();

  await page.locator("#step-bar [data-flow='plan']").click();
  await expect(page.locator("#trip")).toContainText("Pasta");
  await expect(page.locator("#trip")).toContainText("$6.00");
  await expect(page.locator(".savings-card")).not.toContainText("$0.00");
  await page.locator("#step-bar [data-flow='shop']").click();
  await expect(page.getByRole("heading", { name: "Pantry" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Personal Care" })).toBeVisible();
  await expect(page.getByText("Center store")).toHaveCount(0);
});
