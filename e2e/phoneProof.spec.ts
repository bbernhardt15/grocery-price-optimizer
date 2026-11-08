import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

async function unlock(page: Page) {
  await page.goto("/");
  await page.locator("#beta-code").first().fill("Brandon-50y4");
  await page.locator("#beta-gate-form button[type=submit]").first().click();
  await expect(page.locator("#beta-gate")).toBeHidden();
}

const plan = {
  total: 5.19,
  partial: false,
  pendingStores: [],
  pricingByStore: [
    { storeName: "Kroger", check: "ok" },
    { storeName: "Walmart", check: "ok" },
  ],
  stores: [
    {
      storeName: "Kroger",
      subtotal: 5.19,
      items: [
        { lineId: "milk", name: "Milk", title: "Milk", department: "Dairy & Eggs", price: 3, quantity: 1, itemTotal: 3, storeName: "Kroger" },
        { lineId: "apples", name: "Apples", title: "Apples", department: "Produce", price: 2.19, quantity: 1, itemTotal: 2.19, storeName: "Kroger" },
      ],
    },
  ],
};

test("Open cart is a popup, and the Kroger walk has department headings", async ({ page }) => {
  await page.route("**/api/optimize-list", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(plan) });
  });
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem(
      "gg-list",
      JSON.stringify([
        { id: "milk", itemId: "milk", name: "Milk", quantity: 1 },
        { id: "apples", itemId: "apples", name: "Apples", quantity: 1 },
      ])
    );
  });
  await unlock(page);
  await page.locator('[data-flow="plan"]').click();
  await expect(page.locator("[data-cart-popup='Kroger']")).toBeVisible();
  const fold = page.locator("[data-store='Kroger'] details.store-fold");
  await expect(fold).not.toHaveAttribute("open", "");
  await page.locator("[data-cart-popup='Kroger']").click();
  await expect(page.locator("#cart-popup")).toBeVisible();
  await expect(page.locator("#cart-popup")).toContainText("Milk");
  await expect(fold).not.toHaveAttribute("open", "");
  await page.locator("#cart-popup").getByRole("button", { name: "Close" }).click();
  await page.locator('[data-flow="shop"]').click();
  await expect(page.locator(".shop-aisle", { hasText: "Dairy & Eggs" })).toBeVisible();
  await expect(page.locator(".shop-aisle", { hasText: "Produce" })).toBeVisible();
});

test("feedback stores a screenshot and a tapped rating for the reviewer", async ({ page }) => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
  });
  await unlock(page);
  await page.locator("#menu-open").click();
  await page.locator("#help-title").click();
  await page.locator("#help-feedback").click();
  await page.locator(".beta-rating", { hasText: "5" }).click();
  await expect(page.locator("#beta-feedback-form input[value='5']")).toBeChecked();
  await page.locator("#beta-feedback-shots").setInputFiles({ name: "cart.png", mimeType: "image/png", buffer: png });
  await expect(page.locator("#beta-feedback-shots-preview img")).toBeVisible();
  await expect(page.locator("#beta-feedback-shots-note")).toContainText("will be sent");
  await page.locator("#beta-feedback-text").fill("The cart popup.");
  await page.locator("#beta-feedback-form").getByRole("button", { name: "Send" }).click();
  await expect(page.locator("#beta-feedback-status")).toHaveText("Sent. Thank you.");
  const listed = await page.request.get("/api/admin/beta/feedback", {
    headers: { authorization: "Bearer e2e-feedback-admin" },
  });
  expect(listed.ok()).toBeTruthy();
  const body = (await listed.json()) as { feedback: Array<{ id: string; message: string; shots: Array<{ byteLength: number }> }> };
  const note = body.feedback.find((row) => row.message === "The cart popup.");
  expect(note?.shots[0]?.byteLength).toBe(png.length);
  const image = await page.request.get(`/api/admin/beta/feedback/${note?.id}/shots/0`, {
    headers: { authorization: "Bearer e2e-feedback-admin" },
  });
  expect(image.ok()).toBeTruthy();
  expect(Buffer.from(await image.body()).equals(png)).toBe(true);
});

test("a hung aisle shows a retry instead of staying on Loading this aisle", async ({ page }) => {
  await page.route("**/api/catalog/browse**", async () => new Promise(() => {}));
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
  });
  await unlock(page);
  await page.locator("#browse-toggle").click();
  await expect(page.getByRole("heading", { name: "This aisle is taking a while" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Try this aisle again" })).toBeVisible();
});

test("skip rest leaves the product wizard and does not ask for another receipt", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem(
      "gg-profile",
      JSON.stringify({
        version: 1,
        updatedAt: Date.now(),
        onboarding: { status: "done", step: "summary", updatedAt: Date.now() },
        shopStores: ["Kroger"],
        categoryPreferences: {},
      })
    );
  });
  await unlock(page);
  await page.locator("#menu-open").click();
  await page.locator("#app-drawer summary", { hasText: "Preferences" }).click();
  await page.locator("#menu-brands").click();
  await expect(page.locator("#profile-onboard")).toBeVisible();
  await page.locator("#profile-next").click();
  await page.getByRole("button", { name: "Store brand" }).first().click();
  await expect(page.locator(".chosen-mode")).toContainText("Saved on this phone.");
  await page.locator("#profile-skip-rest").click();
  await expect(page.getByRole("heading", { name: "Teach Gitter your usual groceries" })).toHaveCount(0);
  await expect(page.locator("#profile-title")).toHaveText("Here's what we'll shop for");
});
