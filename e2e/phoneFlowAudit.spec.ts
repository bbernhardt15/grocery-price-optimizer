import { expect, test, type Page } from "@playwright/test";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function photo(name: string) {
  return { name, mimeType: "image/png", buffer: png };
}

async function ready(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    navigator.serviceWorker.register = () => Promise.resolve({} as ServiceWorkerRegistration);
  });
  await page.route("**/sw.js", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator("#beta-gate")).toBeHidden();
}

for (const size of [
  { width: 390, height: 844 },
  { width: 375, height: 667 },
]) {
  test(`aisle search for Grader's finds Graeter's at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await ready(page);
    const off = page.locator(".gitter-guide-off");
    if (await off.isVisible().catch(() => false)) await off.click();
    await page.locator("#browse-toggle").click();
    await page.locator("#search").fill("Grader's");
    await page.locator("#search-form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
    await expect(page.locator("#grid")).toContainText(/Graeter/i);
    await expect(page.getByText(/Nothing matched/i)).toHaveCount(0);
  });

  test(`five photos keep the 4-photo notice at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await ready(page);
    await page.locator("#add-items").click();
    await expect(page.locator("#import-photo-input")).toBeAttached();
    await page.locator("#import-photo-input").setInputFiles([photo("1.png"), photo("2.png"), photo("3.png"), photo("4.png"), photo("5.png")]);
    const cap = page.locator("#import-photo-cap");
    await expect(cap).toContainText("Using the first 4 photos");
    await expect(page.locator("#import-status")).toContainText(/isn't switched on|Reading the photo/i);
    await expect(cap).toBeVisible();
    await expect(page.locator("#import-status")).not.toContainText("lot of lists");
    await expect(cap).toContainText("Using the first 4 photos");
  });

  test(`four photos are not treated as too many lists at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await ready(page);
    await page.locator("#add-items").click();
    await page.locator("#import-photo-input").setInputFiles([photo("1.png"), photo("2.png"), photo("3.png"), photo("4.png")]);
    await expect(page.locator("#import-photo-cap")).toBeHidden();
    await expect(page.locator("#import-status")).not.toContainText("lot of lists");
  });

  test(`save-trip toast stays on one line at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.route("**/api/optimize-list", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total: 3.29,
          partial: false,
          pendingStores: [],
          stores: [{ storeName: "Kroger", subtotal: 3.29, items: [{ lineId: "milk", name: "Whole Milk", title: "Whole Milk", price: 3.29, quantity: 1, itemTotal: 3.29, storeName: "Kroger" }] }],
        }),
      });
    });
    await page.addInitScript(() => {
      localStorage.setItem("gg-list", JSON.stringify([{ id: "milk", itemId: "milk", name: "Whole Milk", quantity: 1 }]));
    });
    await ready(page);
    await page.locator('[data-flow="plan"]').click();
    await page.getByRole("button", { name: "Save this trip" }).first().click();
    const toast = page.locator("#toast.show");
    await expect(toast).toContainText("Saved this trip to Past trips.");
    await expect(toast).toContainText("Undo");
    const line = await toast.evaluate((node) => {
      const text = node.querySelector("#toast-text");
      const box = node.getBoundingClientRect();
      const words = text?.getBoundingClientRect();
      return {
        wraps: (text?.scrollHeight || 0) > (text?.clientHeight || 0) + 1,
        overflows: node.scrollWidth > node.clientWidth + 1,
        height: Math.round(box.height),
        textTop: Math.round(words?.top || 0),
        textBottom: Math.round(words?.bottom || 0),
      };
    });
    expect(line.wraps, JSON.stringify(line)).toBe(false);
    expect(line.overflows, JSON.stringify(line)).toBe(false);
    expect(line.height).toBeLessThan(56);
  });
}

test("Connect a store is one heading", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Get started" }).click();
  await page.locator("#profile-zip").pressSequentially("45103");
  await page.locator("#profile-zip-done").click();
  await page.locator("#profile-next").click();
  await expect(page.locator("#profile-title")).toHaveText("Connect a store?");
  await expect(page.getByRole("heading", { name: "Connect a store?" })).toHaveCount(1);
});

test("the learns line stays when smart parsing is off", async ({ page }) => {
  await ready(page);
  await expect(page.locator("#ask-hint")).toContainText("learns what you buy over time");
  await expect(page.locator("#ask-hint")).toContainText("basic matching used");
});

test("In-store opens after the price check finishes", async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/optimize-list", async (route) => {
    await held;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        total: 3.29,
        partial: false,
        pendingStores: [],
        stores: [{ storeName: "Kroger", subtotal: 3.29, items: [{ lineId: "milk", name: "Whole Milk", title: "Whole Milk", price: 3.29, quantity: 1, itemTotal: 3.29, storeName: "Kroger" }] }],
      }),
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem("gg-list", JSON.stringify([{ id: "milk", itemId: "milk", name: "Whole Milk", quantity: 1 }]));
  });
  await ready(page);
  await page.locator('[data-flow="plan"]').click();
  await expect(page.locator("[data-review-progress], .review-loading-status").first()).toBeVisible();
  await page.locator('[data-flow="shop"]').click();
  await expect(page.locator("body")).toHaveAttribute("data-step", "plan");
  release();
  await expect(page.locator("#trip [data-store='Kroger']")).toBeVisible();
  await page.locator('[data-flow="shop"]').click();
  await expect(page.locator("body")).toHaveAttribute("data-step", "shop");
});
