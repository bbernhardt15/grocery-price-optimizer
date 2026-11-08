import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const receipt = path.join(process.cwd(), "e2e/fixtures/sample-order.pdf");

async function unlock(page: Page, code = "Brandon-50y4") {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Enter your invite code" })).toBeVisible();
  await page.locator("#beta-code").first().fill(code);
  await page.locator("#beta-gate-form button[type=submit]").first().click();
  await expect(page.locator("#beta-gate")).toBeHidden();
}

test("teaching receipt keeps Name brand tappable, hides store-brand name chips, and skips the buy-most prompt", async ({ page }) => {
  await unlock(page);
  await page.getByRole("button", { name: "Get started" }).click();
  await page.locator("#profile-zip").pressSequentially("45103");
  await expect(page.locator("#profile-store-list input, #profile-store-list button").first()).toBeVisible();
  await page.locator("#profile-zip-done").click();
  await page.locator("#profile-next").click();
  await expect(page.locator("#profile-title")).toHaveText(/Connect a store\?|Teach Gitter your usual groceries/);
  if ((await page.locator("#profile-title").textContent()) === "Connect a store?") {
    await page.locator("#profile-next").click();
  }
  await expect(page.getByText("Teach Gitter your usual groceries")).toBeVisible();
  await page.locator("#profile-receipt-input").setInputFiles(receipt);
  await page.getByRole("button", { name: "Read my receipts" }).click();
  await expect(page.getByRole("heading", { name: "Here's what we learned" })).toBeVisible();
  await expect(page.getByText("This teaches the brands you already buy")).toHaveCount(1);
  await expect(page.getByText("Your trip stays empty until you add them")).toHaveCount(0);

  await page.locator("[data-learned-change]").first().click();
  const storeBrand = page.locator(".rule-choice", { hasText: "Store brand" }).first();
  await storeBrand.click();
  await expect(storeBrand).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".brand-pick")).toHaveCount(0);
  await expect(page.getByText("Store brand only")).toBeVisible();

  const nameBrand = page.locator(".rule-choice", { hasText: "Name brand" }).first();
  await nameBrand.click();
  await expect(nameBrand).toHaveAttribute("aria-pressed", "true");
  await expect(nameBrand.locator("[data-rule-saved]")).toHaveText("Saved");
  await storeBrand.click();
  await nameBrand.click();
  await expect(nameBrand).toHaveAttribute("aria-pressed", "true");

  await page.locator("#profile-next").click();
  await page.getByRole("button", { name: "Select all" }).click();
  await page.locator("#learned-add-trip").first().click();
  await expect(page.getByText(/Want me to start with the ones you buy most/)).toHaveCount(0);
  await expect(page.getByText("Want me to check which stores are cheaper?")).toHaveCount(0);
});

test("Review paints a priced partial, chat import is full screen, and Not here is gone", async ({ page }) => {
  const calls: string[] = [];
  await page.route("**/api/optimize-list", async (route) => {
    calls.push(route.request().url());
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        partial: true,
        pendingStores: ["Walmart"],
        total: 5.7,
        zipCode: "45103",
        pricingByStore: [
          { storeName: "Kroger", check: "ok" },
          { storeName: "Walmart", check: "timeout" },
        ],
        unavailable: ["Eggs"],
        stores: [
          {
            storeName: "Kroger",
            subtotal: 5.7,
            items: [
              {
                lineId: "milk",
                name: "Milk",
                price: 3.2,
                quantity: 1,
                itemTotal: 3.2,
                storeName: "Kroger",
                offers: [
                  { storeName: "Kroger", price: 3.2 },
                  { storeName: "Walmart", price: 4.1 },
                ],
              },
              {
                lineId: "jam",
                name: "Kool-Aid Jammers",
                price: 2.5,
                quantity: 1,
                itemTotal: 2.5,
                storeName: "Kroger",
                offers: [
                  { storeName: "Kroger", price: 2.5 },
                  { storeName: "Walmart", price: 3.4 },
                ],
              },
            ],
          },
        ],
      }),
    });
  });

  await page.addInitScript(() => {
    const items = ["Milk", "Eggs", "Bread", "Kool-Aid Jammers"].map((name) => ({
      id: `custom:${name}`,
      itemId: `custom:${name}`,
      name,
      quantity: 1,
    }));
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem("gg-list", JSON.stringify(items));
  });
  await unlock(page);
  const headerBox = await (async () => {
    await page.locator("#add-items").click();
    const sheet = page.locator("#import-dialog");
    await expect(sheet).toBeVisible();
    const box = await sheet.boundingBox();
    await page.locator("#import-close").click();
    await expect(sheet).toBeHidden();
    await expect(page.locator("body")).toHaveAttribute("data-step", "add");
    return box;
  })();
  const guide = page.locator("#gitter-guide");
  const notYet = guide.getByRole("button", { name: "Keep building" });
  const addItem = guide.getByRole("button", { name: "Add an item" });
  await expect(notYet.or(addItem)).toBeVisible();
  if (await notYet.isVisible()) await notYet.click();
  await expect(addItem).toBeVisible();
  await addItem.click();
  await expect(page.locator("#import-dialog")).toBeHidden();
  await expect(page.locator("#search")).toBeFocused();
  expect(headerBox && headerBox.height).toBeGreaterThan(400);

  await page.locator("#step-bar [data-flow='plan']").click();
  await expect(page.locator("#trip")).toContainText("$5.70");
  await expect(page.locator(".savings-card")).not.toContainText("$0.00");
  await expect(page.locator("[data-flow='plan']")).not.toHaveAttribute("aria-busy", "true");
  await expect(page.locator("[data-review-stable='loading']")).toHaveCount(0);
  const kroger = page.locator("[data-store='Kroger'] .review-store-head");
  await expect(kroger).toContainText("Kroger");
  await expect(kroger).toContainText("2 lines");
  await expect(kroger).toContainText("$5.70");
  await expect(page.locator("#trip")).toContainText("You save");
  await expect(page.getByText("Shop in store")).toBeVisible();
  const retry = page.getByRole("button", { name: "Retry" });
  await expect(retry).toBeVisible();
  const before = calls.length;
  await retry.click();
  await expect.poll(() => calls.length).toBeGreaterThan(before);
  await expect(page.locator("[data-flow='plan']")).not.toHaveAttribute("aria-busy", "true");

  await page.getByRole("button", { name: "In-store" }).click();
  await expect(page.locator(".shop-name").first()).toBeVisible();
  await expect(page.locator("[data-not-here]")).toHaveCount(0);
});
