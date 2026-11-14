import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function unlock(page: Page) {
  await page.goto("/");
  const invite = page.locator("#beta-code").first();
  if (await invite.isVisible().catch(() => false)) {
    await invite.fill("Brandon-50y4");
    await page.locator("#beta-gate-form button[type=submit]").first().click();
    await expect(page.locator("#beta-gate")).toBeHidden();
  }
}

function longPlan(count: number) {
  return {
    total: count * 2,
    partial: false,
    pendingStores: [],
    pricingByStore: [
      { storeName: "Kroger", check: "ok" },
      { storeName: "Walmart", check: "ok" },
    ],
    stores: [
      {
        storeName: "Kroger",
        subtotal: count * 2,
        items: Array.from({ length: count }, (_, index) => ({
          lineId: `line-${index}`,
          name: `Review line ${index + 1}`,
          price: 2,
          quantity: 1,
          itemTotal: 2,
          storeName: "Kroger",
        })),
      },
    ],
  };
}

for (const size of [
  { width: 390, height: 844 },
  { width: 375, height: 667 },
]) {
  test(`a touch drag during refresh stays at 280 on WebKit ${size.width}x${size.height}`, async ({ page, browserName }) => {
    test.skip(browserName !== "webkit", "WebKit touch drag is the open failure");
    let release = () => {};
    let calls = 0;
    await page.setViewportSize(size);
    await page.route("**/sw.js", (route) => route.abort());
    await page.route("**/api/optimize-list", async (route) => {
      calls += 1;
      if (calls === 1) {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(longPlan(80)) });
        return;
      }
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(longPlan(80)) });
    });
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
      navigator.serviceWorker.register = () => Promise.resolve({} as ServiceWorkerRegistration);
      localStorage.setItem(
        "gg-list",
        JSON.stringify(Array.from({ length: 80 }, (_, index) => ({ id: `custom:line-${index}`, itemId: `custom:line-${index}`, name: `Review line ${index + 1}`, quantity: 1 })))
      );
    });
    await unlock(page);
    await page.locator("#step-bar [data-flow='plan']").click();
    await expect(page.locator("#trip [data-review-line='line-20']")).toBeAttached();
    await page.evaluate(() => window.scrollTo(0, 420));
    expect(await page.evaluate(() => window.scrollY)).toBe(420);
    await page.locator("#plan-refresh").evaluate((node) => (node as HTMLButtonElement).click());
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      document.dispatchEvent(new Event("touchstart", { bubbles: true }));
      window.scrollTo(0, 280);
      document.dispatchEvent(new Event("touchmove", { bubbles: true }));
    });
    await page.waitForTimeout(350);
    expect(await page.evaluate(() => window.scrollY)).toBe(280);
    release();
    await expect(page.locator("[data-review-refresh]")).toHaveCount(0);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.scrollY)).toBe(280);
  });

  test(`a learned Household row sits fully above Continue at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await unlock(page);
    await page.getByRole("button", { name: "Get started" }).click();
    await page.locator("#profile-zip").pressSequentially("45103");
    await expect(page.locator("#profile-store-list input, #profile-store-list button").first()).toBeVisible();
    await page.locator("#profile-zip-done").click();
    await page.locator("#profile-next").click();
    if (/Connect a store\?|Kroger connected/.test((await page.locator("#profile-title").textContent()) || "")) {
      await page.locator("#store-connect-later").click();
    }
    await expect(page.getByRole("heading", { name: "Teach Gitter your usual groceries" })).toBeVisible();
    await page.getByText("Paste order text instead").click();
    await page.locator("#profile-receipt-paste").fill("Whole Milk\n1.0 x $3.49\nTide laundry detergent\n1.0 x $11.99\nBananas\n1.0 x $0.58");
    await page.getByRole("button", { name: "Read my receipts" }).click();
    await expect(page.getByRole("heading", { name: "Here's what we learned" })).toBeVisible();
    const row = page.locator("[data-learned-row='laundry-detergent']");
    await expect(row).toBeVisible();
    await expect(page.locator(".learned-group-title", { hasText: "Household" })).toBeVisible();
    await row.evaluate((node) => node.scrollIntoView({ block: "center" }));
    const boxes = await page.evaluate(() => {
      const item = document.querySelector("[data-learned-row='laundry-detergent']");
      const next = document.querySelector("#profile-next");
      if (!(item instanceof HTMLElement) || !(next instanceof HTMLElement)) return null;
      const rowBox = item.getBoundingClientRect();
      const nextBox = next.getBoundingClientRect();
      return {
        rowTop: rowBox.top,
        rowBottom: rowBox.bottom,
        rowHeight: rowBox.height,
        nextTop: nextBox.top,
      };
    });
    expect(boxes).toBeTruthy();
    expect(boxes!.rowHeight).toBeGreaterThan(24);
    expect(boxes!.rowTop).toBeGreaterThanOrEqual(0);
    expect(boxes!.rowBottom).toBeLessThanOrEqual(boxes!.nextTop + 1);
  });
}

test("a delayed brand shelf shows Loading brands before the pills", async ({ page }) => {
  const waiting = [];
  await page.route("**/api/catalog/browse**", async (route) => {
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          { id: "tide", name: "Tide Liquid Laundry Detergent", brand: "Tide", familyName: "Laundry detergent", departmentId: "household", offers: [{ storeName: "Kroger", price: 11.99 }] },
        ],
      }),
    });
  });
  await unlock(page);
  await page.getByRole("button", { name: "Get started" }).click();
  await page.locator("#profile-zip").pressSequentially("45103");
  await expect(page.locator("#profile-store-list input, #profile-store-list button").first()).toBeVisible();
  await page.locator("#profile-zip-done").click();
  await page.locator("#profile-next").click();
  if (/Connect a store\?|Kroger connected/.test((await page.locator("#profile-title").textContent()) || "")) {
    await page.locator("#store-connect-later").click();
  }
  await expect(page.getByRole("heading", { name: "Teach Gitter your usual groceries" })).toBeVisible();
  await page.getByText("Paste order text instead").click();
  await page.locator("#profile-receipt-paste").fill("Tide laundry detergent");
  await page.getByRole("button", { name: "Read my receipts" }).click();
  await expect(page.getByRole("heading", { name: "Here's what we learned" })).toBeVisible();
  await page.locator("[data-learned-change]").first().click();
  await expect(page.locator(".brand-loading")).toHaveText("Loading brands");
  await expect(page.locator(".brand-pick")).toHaveCount(0);
  for (const resolve of waiting) resolve();
  await expect(page.locator(".brand-pick").first()).toBeVisible();
});

for (const size of [
  { width: 390, height: 844 },
  { width: 375, height: 667 },
]) {
  test(`Not this time dismisses the saved-trip prompt at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.route("**/api/optimize-list", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total: 3.29,
          partial: false,
          pendingStores: [],
          pricingByStore: [{ storeName: "Kroger", check: "ok" }],
          stores: [
            {
              storeName: "Kroger",
              subtotal: 3.29,
              items: [{ lineId: "milk", name: "Whole Milk", price: 3.29, quantity: 1, itemTotal: 3.29, storeName: "Kroger" }],
            },
          ],
        }),
      });
    });
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
      localStorage.setItem("gg-list", JSON.stringify([{ id: "milk", itemId: "milk", name: "Whole Milk", quantity: 1 }]));
    });
    await unlock(page);
    await page.locator('[data-flow="plan"]').click();
    await page.getByRole("button", { name: "Save this trip" }).first().click();
    const guide = page.locator("#gitter-guide");
    await expect(guide).toBeVisible();
    await expect(guide).toHaveAttribute("data-moment", "trip-saved");
    await expect(guide.getByRole("button", { name: "Remember these items" })).toBeVisible();
    await guide.getByRole("button", { name: "Not this time" }).click();
    await expect(guide).toBeHidden();
    await expect(guide).not.toHaveAttribute("data-moment", "trip-saved");
    await expect(guide).not.toContainText("Hey. What are we picking up this week?");
    await expect(guide.getByRole("button", { name: "Remember these items" })).toHaveCount(0);
    await expect(guide.getByRole("button", { name: "Not this time" })).toHaveCount(0);
  });

  test(`Remember these items leaves the welcome line at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.route("**/api/optimize-list", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total: 3.29,
          partial: false,
          pendingStores: [],
          pricingByStore: [{ storeName: "Kroger", check: "ok" }],
          stores: [
            {
              storeName: "Kroger",
              subtotal: 3.29,
              items: [{ lineId: "milk", name: "Whole Milk", price: 3.29, quantity: 1, itemTotal: 3.29, storeName: "Kroger" }],
            },
          ],
        }),
      });
    });
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
      localStorage.setItem("gg-list", JSON.stringify([{ id: "milk", itemId: "milk", name: "Whole Milk", quantity: 1 }]));
    });
    await unlock(page);
    await page.locator('[data-flow="plan"]').click();
    await page.getByRole("button", { name: "Save this trip" }).first().click();
    const guide = page.locator("#gitter-guide");
    await expect(guide).toBeVisible();
    await guide.getByRole("button", { name: "Remember these items" }).click();
    await expect(guide).toBeHidden();
    await expect(guide).not.toContainText("Hey. What are we picking up this week?");
    await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("gg-usuals") || "[]").some((row: { name?: string }) => /milk/i.test(row.name || "")))).toBe(true);
  });
}

test("a coupon photo fills the amount and the note", async ({ page }) => {
  await page.route("**/api/optimize-list", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        total: 3.29,
        partial: false,
        pendingStores: [],
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
  await page.route("**/api/import/coupon", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        source: "screenshot",
        coupon: { storeName: "Kroger", itemName: "Whole Milk", kind: "dollars", amount: 1.5, expiresOn: "2026-12-01", gaps: [] },
      }),
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem("gg-list", JSON.stringify([{ id: "milk", itemId: "milk", name: "Whole Milk", quantity: 1 }]));
  });
  await unlock(page);
  await page.locator('[data-flow="plan"]').click();
  await page.getByRole("button", { name: "Add coupons" }).click();
  await page.locator("[data-coupon-shot]").setInputFiles({ name: "coupon.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText("Amount off")).toHaveCount(0);
  await expect(page.getByText(/Your coupon/)).toBeVisible();
});
