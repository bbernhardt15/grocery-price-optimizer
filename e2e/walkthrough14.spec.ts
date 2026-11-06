import { expect, test, type Page } from "@playwright/test";

const chromeIphone =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1";

test.use({
  viewport: { width: 390, height: 844 },
  userAgent: chromeIphone,
  isMobile: true,
  hasTouch: true,
});

function listSeed() {
  const items = Array.from({ length: 54 }, (_, index) => {
    const name = index === 0 ? "BBQ sauce" : `Grocery item ${index}`;
    return { id: `custom:item-${index}`, itemId: `custom:item-${index}`, name, familyName: name, quantity: 1 };
  });
  return JSON.stringify(items);
}

async function unlock(page: Page) {
  await page.addInitScript((saved) => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem("gg-list", saved);
  }, listSeed());
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Enter your invite code" })).toBeVisible();
  await page.locator("#beta-code").first().fill("brandon-50y4");
  await page.locator("#beta-gate-form button[type=submit]").first().click();
  await expect(page.locator("#beta-gate")).toBeHidden();
  await expect(page.locator("#bar-count")).toContainText("54");
}

test("fourteenth walkthrough keeps Review, In-store, chat, photo, and Build spacing alive", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await unlock(page);

  const spacing = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("#catalog > *")].filter((el) => {
      const style = getComputedStyle(el);
      if (style.display === "none" || (el as HTMLElement).hidden) return false;
      const box = el.getBoundingClientRect();
      return box.height > 1 && box.width > 1;
    });
    let max = 0;
    for (let index = 1; index < nodes.length; index += 1) {
      const prev = nodes[index - 1].getBoundingClientRect();
      const next = nodes[index].getBoundingClientRect();
      max = Math.max(max, next.top - prev.bottom);
    }
    const keyboard = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--keyboard")) || 0;
    return { max, keyboard };
  });
  expect(spacing.max).toBeLessThan(48);
  expect(spacing.keyboard).toBe(0);

  const guide = page.locator("#gitter-guide");
  await expect(guide).toBeVisible();
  const milk = guide.getByRole("button", { name: "Milk", exact: true });
  if (await milk.count()) {
    await milk.click();
    await expect(guide).toContainText(/cheaper/i);
  }
  await guide.getByRole("button", { name: "Not yet" }).click();
  await expect(guide).toContainText(/Add anything else/);
  await expect(guide.getByRole("button", { name: "Check store prices" })).toBeVisible();

  await page.route("**/api/optimize-list", async (route) => {
    const partial = {
      partial: true,
      pendingStores: ["Walmart"],
      total: 18.5,
      zipCode: "45103",
      pricingByStore: [
        { storeName: "Kroger", check: "ok" },
        { storeName: "Walmart", check: "timeout" },
      ],
      stores: [
        {
          storeName: "Kroger",
          subtotal: 18.5,
          items: [
            { lineId: "bbq", name: "BBQ sauce", price: 4.5, quantity: 1, itemTotal: 4.5 },
            { lineId: "milk", name: "Milk", price: 3.2, quantity: 1, itemTotal: 3.2 },
            { lineId: "rest", name: "Grocery item 1", price: 10.8, quantity: 1, itemTotal: 10.8 },
          ],
        },
      ],
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(partial),
    });
  });

  await page.locator("#step-bar [data-flow='plan']").click();
  await expect(page.locator("#trip")).toContainText("BBQ sauce");
  await expect(page.locator("#trip")).toContainText("$18.50");
  await expect(page.locator("[data-review-stable='loading']")).toHaveCount(0);
  await page.locator("#step-bar [data-flow='shop']").click();
  await expect(page.locator(".shop-name").first()).toBeVisible();
  await expect(page.locator(".shop-name").first()).not.toHaveText("");
  await expect(page.getByText("No trip yet")).toHaveCount(0);
  await expect(page.locator(".shop-skel-row")).toHaveCount(0);
  await page.locator("#step-bar [data-flow='plan']").click();
  await expect(page.locator("#trip")).toContainText("$18.50");
  await expect(page.locator("#trip")).toContainText("BBQ sauce");

  await page.unroute("**/api/optimize-list");
  await page.route("**/api/import/photo", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });
  await page.locator('[data-flow="add"]').click();
  await page.locator("#browse-toggle").click();
  await page.locator("#ask-import").click();
  await expect(page.locator("#import-photo")).toBeVisible();
  await page.locator("#import-photo-input").setInputFiles({
    name: "kids.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    ),
  });
  await expect(page.locator("#import-status")).toContainText(/Reading the photo|No grocery items in that photo/i);
  await expect(page.locator("#import-status")).toContainText(/No grocery items in that photo/i);
  expect(errors, errors.join("\n")).toEqual([]);
});
