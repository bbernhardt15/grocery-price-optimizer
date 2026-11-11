import { expect, test, type Page } from "@playwright/test";

const priced = {
  total: 3.29,
  partial: false,
  pendingStores: [],
  pricingByStore: [{ storeName: "Kroger", check: "ok" }, { storeName: "Walmart", check: "ok" }],
  stores: [
    {
      storeName: "Kroger",
      subtotal: 3.29,
      items: [{ lineId: "milk", name: "Whole Milk", title: "Whole Milk", price: 3.29, quantity: 1, itemTotal: 3.29, storeName: "Kroger" }],
    },
  ],
};

async function ready(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem("gg-list", JSON.stringify([{ id: "milk", itemId: "milk", name: "Whole Milk", quantity: 1 }]));
    navigator.serviceWorker.register = () => Promise.resolve({} as ServiceWorkerRegistration);
  });
  await page.route("**/sw.js", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator("#beta-gate")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Enter your invite code" })).toBeHidden();
}

for (const size of [
  { width: 390, height: 844 },
  { width: 375, height: 667 },
]) {
  test(`Nov 9 review progress, cart, and save trip at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    let release: (() => void) | null = null;
    await page.route("**/api/optimize-list", async (route) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(priced) });
    });
    await ready(page);
    await page.locator('[data-flow="plan"]').click();
    await expect(page.locator("[data-review-progress], .review-loading-status").first()).toBeVisible();
    await expect(page.locator(".review-loading-note")).toContainText("retry");
    await page.locator('[data-flow="shop"]').click();
    await expect(page.locator("#toast")).toContainText("Still checking store prices");
    await expect(page.locator("body")).toHaveAttribute("data-step", "plan");
    release?.();
    await expect(page.getByRole("button", { name: "Save this trip" }).first()).toBeVisible({ timeout: 20000 });
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem("gg-list") || "[]").length);
    expect(before).toBeGreaterThan(0);
    await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("gg-list") || "[]").length)).toBe(before);
    await page.getByRole("button", { name: "Save this trip" }).first().click();
    await expect(page.locator("body")).toHaveAttribute("data-step", "add");
    await expect(page.locator("#toast")).toContainText("Saved this trip to Past trips.");
  });

  test(`Nov 9 favorites eggs and menu at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.route("**/api/optimize-list", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(priced) });
    });
    await ready(page);
    await page.locator("#menu-open").click();
    await expect(page.locator("#refresh-prices")).toHaveCount(1);
    await expect(page.locator("#app-drawer details, #app-drawer summary")).toHaveCount(0);
    await expect(page.locator(".menu-row").first()).toBeVisible();
    await expect(page.locator("#app-drawer")).toContainText("Where you shop");
    await page.locator("#aisle-setup").click();
    await expect(page.locator("#favorites-prefs")).toContainText("Type and size");
    await expect(page.locator("#favorites-prefs")).toContainText("Kroger");
    await expect(page.locator("#favorites-prefs")).toContainText("Simple Truth");
    await expect(page.locator("#favorites-prefs input")).toHaveAttribute("placeholder", /Eggland/);
    await expect(page.locator("#favorites-prefs")).toContainText("only for Eggs");
    await page.locator("#favorites-prefs input").fill("Eggland's Best large");
    await page.getByRole("button", { name: "Find this product" }).click();
    await expect(page.locator("#toast")).toContainText("Eggland's Best large");
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("gg-profile") || "{}"));
    expect(saved.categoryPreferences?.eggs?.variant || "").toMatch(/Eggland/);
  });
}
