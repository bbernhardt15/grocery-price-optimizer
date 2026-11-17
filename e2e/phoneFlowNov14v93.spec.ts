import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

async function unlock(page: Page) {
  await page.goto("/");
  const invite = page.locator("#beta-code").first();
  if (await invite.isVisible().catch(() => false)) {
    await invite.fill("Brandon-50y4");
    await page.locator("#beta-gate-form button[type=submit]").first().tap();
    await expect(page.locator("#beta-gate")).toBeHidden();
  }
}

test("v93 favorites, refine, voice button, menu, and alerts at 390x844", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem(
      "gg-usuals",
      JSON.stringify([
        { name: "Whole Milk", brand: "Kroger", catalogId: "milk", starred: true, quantity: 1, times: 1, lastAt: 1 },
        { name: "Paper Towels", brand: "", catalogId: "towels", starred: true, quantity: 1, times: 1, lastAt: 2 },
      ])
    );
    navigator.serviceWorker.register = () => Promise.resolve({} as ServiceWorkerRegistration);
  });
  await page.route("**/sw.js", (route) => route.abort());
  await unlock(page);
  await expect(page.locator("#app-version")).toContainText("v94");

  await page.locator("#menu-open").tap();
  await expect(page.locator("#app-drawer")).toHaveClass(/is-open/);
  await page.locator("#menu-favorites").tap();
  await expect(page.getByRole("heading", { name: "Your favorites" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Remembered items" })).toHaveCount(0);
  await expect(page.locator("#starter-lists")).toBeHidden();
  await expect(page.locator("#past-trips-home")).toBeHidden();
  const back = page.locator("#favorites-close");
  await expect(back).toHaveText("Back to Build");
  await expect(back).toHaveClass(/primary/);
  const add = page.locator("#favorites-usuals button", { hasText: "Add" }).first();
  const other = page.locator("#favorites-usuals .list-section-title", { hasText: /Other/i });
  if (await other.count()) {
    const addBox = await add.boundingBox();
    const otherBox = await other.boundingBox();
    expect(addBox && otherBox && Math.abs(addBox.y - otherBox.y) > 20).toBeTruthy();
  }
  await back.tap();

  await page.locator("#browse-toggle").tap();
  await page.locator("#filters-open").tap();
  await expect(page.locator("#filter-priced")).toHaveCount(0);
  const columns = await page.locator(".refine-checks").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
  expect(columns).toBe(2);

  await page.locator("#filters-close").tap();
  await page.locator("#ask-import").tap();
  const find = page.locator("#import-find");
  await expect(find).toBeVisible();
  await expect(find).toBeDisabled();
  await page.locator("#import-paste").fill("Milk");
  await expect(find).toBeEnabled();
  await page.locator("#import-close").tap();

  await page.locator("#menu-open").tap();
  await page.locator("#alerts-toggle").tap();
  const dialog = page.locator("#alerts-dialog");
  await expect(dialog).toBeVisible();
  const place = await dialog.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const bar = document.querySelector(".topbar")?.getBoundingClientRect();
    const style = getComputedStyle(node);
    return { top: rect.top, barBottom: bar?.bottom || 0, z: style.zIndex };
  });
  expect(place.top).toBeGreaterThanOrEqual(place.barBottom - 1);
});

test("v93 paste import shows Vanilla Coke and Review Edit opens stores at 390x844", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem("gg-list", JSON.stringify([{ id: "milk", itemId: "milk", name: "Whole Milk", quantity: 1 }]));
    navigator.serviceWorker.register = () => Promise.resolve({} as ServiceWorkerRegistration);
  });
  await page.route("**/sw.js", (route) => route.abort());
  await page.route("**/api/import/text", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        found: 1,
        total: 1,
        items: [
          {
            key: "coke",
            raw: "Vanilla Coke",
            name: "Vanilla Coke",
            status: "found",
            accepted: true,
            selectedId: "vanilla",
            choices: [
              {
                product: {
                  id: "vanilla",
                  name: "Coca-Cola",
                  familyName: "Coke",
                  brand: "Coca-Cola",
                  flavorLabel: "Vanilla",
                  sizeLabel: "12 pk",
                },
              },
            ],
          },
        ],
      }),
    });
  });
  await page.route("**/api/optimize-list", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        partial: false,
        pendingStores: [],
        pricingByStore: [
          { storeName: "Kroger", check: "ok" },
          { storeName: "Walmart", check: "ok" },
        ],
        total: 3.29,
        stores: [
          {
            storeName: "Kroger",
            subtotal: 3.29,
            items: [{ lineId: "milk", name: "Whole Milk", title: "Whole Milk", price: 3.29, quantity: 1, itemTotal: 3.29, storeName: "Kroger" }],
          },
        ],
      }),
    });
  });
  await page.route("**/api/catalog/browse**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "vanilla",
            name: "Coca-Cola",
            familyName: "Coke",
            brand: "Coca-Cola",
            flavorLabel: "Vanilla",
            sizeLabel: "12 pk",
            offers: [{ storeName: "Kroger", price: 6.48 }],
          },
        ],
      }),
    });
  });
  await unlock(page);
  await page.locator("#add-items").tap();
  await page.locator("#import-paste").fill("Vanilla Coke");
  await page.locator("#import-find").tap();
  await expect(page.locator("#import-review h3").first()).toContainText(/Vanilla Coke/);
  await page.locator("#import-close").tap();

  await page.locator("#step-bar [data-flow='plan']").tap();
  await page.locator("#review-edit-stores").tap();
  await expect(page.locator("#store-picker")).toBeVisible();
  await expect(page.getByText("Stores to shop")).toBeVisible();
  await page.locator("#drawer-close").tap();

  await page.locator("#step-bar [data-flow='add']").tap();
  await page.locator("#browse-toggle").tap();
  await page.locator("#search").fill("Vanilla Coke");
  await page.locator("#search").press("Enter");
  const star = page.locator("#grid .fav-star").first();
  await expect(star).toBeVisible();
  const off = await star.evaluate((node) => getComputedStyle(node).backgroundColor);
  await star.tap();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await expect(star).toHaveAttribute("aria-label", /Unfavorite/);
  const on = await star.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(on).not.toBe(off);
});
