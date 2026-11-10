import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

async function unlock(page: Page) {
  await page.goto("/");
  const invite = page.locator("#beta-code").first();
  if (await invite.isVisible().catch(() => false)) {
    await invite.fill("Brandon-50y4");
    await page.locator("#beta-gate-form button[type=submit]").first().click();
    await expect(page.locator("#beta-gate")).toBeHidden();
  }
}

const milk = {
  id: "milk-1",
  name: "Whole Milk",
  familyName: "Whole Milk",
  brand: "Dairy Pure",
  sizeLabel: "1 gal",
  variantLabel: "1 gal",
  imageUrls: [],
  offers: [{ storeName: "Kroger", price: 3.29 }],
  bestOffer: { storeName: "Kroger", price: 3.29 },
  variants: [
    { id: "milk-12", name: "Whole Milk", variantLabel: "12 ct", sizeLabel: "12 ct" },
    { id: "milk-18", name: "Whole Milk", variantLabel: "18 ct", sizeLabel: "18 ct" },
  ],
};

for (const size of [
  { width: 390, height: 844 },
  { width: 375, height: 667 },
]) {
  test(`product detail can be closed at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.route("**/api/catalog/browse**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [milk], total: 1, facets: { brands: [] } }) });
    });
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
    });
    await unlock(page);
    await page.locator("#browse-toggle").evaluate((node) => (node as HTMLButtonElement).click());
    await expect(page.locator("button.card-open").first()).toBeVisible();
    await page.locator("button.card-open").first().evaluate((node) => (node as HTMLButtonElement).click());
    const detail = page.locator("#product-dialog");
    await expect(detail).toBeVisible();
    await expect(detail.locator("#dialog-back")).toBeVisible();
    await expect(detail.locator("#dialog-close")).toBeVisible();
    await expect(detail.locator("#dialog-qty")).toBeVisible();
    await expect(detail.getByRole("button", { name: "12 ct" })).toBeVisible();
    await expect(detail.getByRole("button", { name: "18 ct" })).toBeVisible();
    await detail.locator("#dialog-back").evaluate((node) => (node as HTMLButtonElement).click());
    await expect(detail).toBeHidden();
  });

  test(`clear trip stays empty after refresh at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
    });
    await unlock(page);
    await page.evaluate(() => {
      localStorage.setItem("gg-list", JSON.stringify([{ id: "custom:milk", itemId: "custom:milk", name: "Whole Milk", quantity: 2 }]));
    });
    await page.reload();
    await expect(page.locator("#bar-count")).not.toHaveText("0 items");
    await page.locator("#menu-open").click();
    await page.locator("#menu-new-trip").click();
    await expect(page.locator("#clear-trip")).toBeVisible();
    await page.locator("#clear-trip-yes").click();
    await expect.poll(async () => page.evaluate(() => localStorage.getItem("gg-list"))).toBe("[]");
    await page.reload();
    await expect.poll(async () => page.evaluate(() => localStorage.getItem("gg-list"))).toBe("[]");
    await expect(page.locator("#bar-count")).not.toContainText("2 units");
  });

  test(`partial savings stay visible when a store times out at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.route("**/api/optimize-list", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total: 5,
          partial: false,
          pendingStores: [],
          pricingByStore: [
            { storeName: "Kroger", check: "ok" },
            { storeName: "Walmart", check: "timeout" },
          ],
          stores: [
            {
              storeName: "Kroger",
              subtotal: 5,
              items: [
                {
                  lineId: "milk",
                  name: "Whole Milk",
                  price: 2,
                  quantity: 1,
                  itemTotal: 2,
                  storeName: "Kroger",
                  offers: [
                    { storeName: "Kroger", price: 2 },
                    { storeName: "Walmart", price: 5 },
                  ],
                },
                {
                  lineId: "bread",
                  name: "Bread",
                  price: 3,
                  quantity: 1,
                  itemTotal: 3,
                  storeName: "Walmart",
                  offers: [
                    { storeName: "Kroger", price: 6 },
                    { storeName: "Walmart", price: 3 },
                  ],
                },
              ],
            },
          ],
        }),
      });
    });
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
      localStorage.setItem("gg-needs-skip", "1");
      sessionStorage.setItem("gg-needs-skip", "1");
      localStorage.setItem("gg-list", JSON.stringify([{ id: "milk", itemId: "milk", name: "Whole Milk", quantity: 1 }]));
    });
    await unlock(page);
    await page.locator('[data-flow="plan"]').click();
    await expect(page.locator(".savings-callout")).toContainText("You saved");
    await expect(page.locator("#trip")).not.toContainText("this total is not savings");
  });

  test(`brand pills fall back when browse stalls at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.route("**/api/catalog/browse**", async (route) => {
      await new Promise(() => undefined);
    });
    await unlock(page);
    await page.getByRole("button", { name: "Get started" }).click();
    await page.locator("#profile-zip").pressSequentially("45103");
    await expect(page.locator("#profile-store-list input, #profile-store-list button").first()).toBeVisible();
    await page.locator("#profile-zip-done").click();
    await page.locator("#profile-next").click();
    if ((await page.locator("#profile-title").textContent()) === "Connect a store?") {
      await page.locator("#store-connect-later").click();
    }
    await page.getByText("Paste order text instead").click();
    await page.locator("#profile-receipt-paste").fill("Tide laundry detergent\n1.0 x $11.99");
    await page.getByRole("button", { name: "Read my receipts" }).click();
    await expect(page.getByRole("heading", { name: "Here's what we learned" })).toBeVisible();
    await page.locator("[data-learned-change]").first().click();
    await expect(page.locator(".brand-loading")).toHaveText("Loading brands");
    await expect(page.locator(".brand-pick").first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator("[data-brand-retry]")).toBeVisible();
  });

  test(`adjacent receipt products stay separate at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await unlock(page);
    await page.getByRole("button", { name: "Get started" }).click();
    await page.locator("#profile-zip").pressSequentially("45103");
    await expect(page.locator("#profile-store-list input, #profile-store-list button").first()).toBeVisible();
    await page.locator("#profile-zip-done").click();
    await page.locator("#profile-next").click();
    if ((await page.locator("#profile-title").textContent()) === "Connect a store?") {
      await page.locator("#store-connect-later").click();
    }
    await expect(page.locator("[data-faq]")).toHaveJSProperty("open", false);
    await page.getByText("Paste order text instead").click();
    await page.locator("#profile-receipt-paste").fill("Dave's Killer Bread\nCooked Perfect Homestyle Frozen Meatballs\n1.0 x $6.99");
    await page.getByRole("button", { name: "Read my receipts" }).click();
    await expect(page.getByRole("heading", { name: "Here's what we learned" })).toBeVisible();
    await expect(page.locator("#profile-stage")).not.toContainText("Dave's Killer Bread Cooked Perfect");
    await expect(page.getByRole("heading", { name: /Bread/ })).toBeVisible();
    await page.locator("#profile-next").click();
    await expect(page.locator("#learned-add-trip-top")).toBeVisible();
    await expect(page.locator("#learned-empty-trip-top")).toBeVisible();
  });

  test(`return from a store stays on the tab that was open at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
      localStorage.setItem(
        "gg-handoff-trip",
        JSON.stringify({ items: [{ id: "milk", name: "Whole Milk", quantity: 1 }], step: "add", savedAt: Date.now(), store: "Kroger", kind: "coupons" })
      );
    });
    await unlock(page);
    await expect(page.locator("body")).toHaveAttribute("data-step", "add");
  });

  test(`favorites tab and starred count at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
      localStorage.setItem(
        "gg-usuals",
        JSON.stringify([
          { name: "Head & Shoulders", starred: false, times: 3 },
          { name: "Whole Milk", starred: true, times: 2 },
        ])
      );
    });
    await unlock(page);
    await expect(page.locator("#tab-favorites")).toBeVisible();
    await expect(page.locator("#usuals-count")).toHaveText("1");
    await expect(page.locator("#app-version")).toContainText("v80");
    await page.locator("#menu-open").click();
    await expect(page.locator("#app-version")).toBeVisible();
  });

  test(`coupon screenshot entry is on Review at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.route("**/api/optimize-list", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total: 3.29,
          partial: false,
          pendingStores: [],
          pricingByStore: [
            { storeName: "Kroger", check: "ok" },
            { storeName: "Walmart", check: "ok" },
          ],
          stores: [
            {
              storeName: "Kroger",
              subtotal: 3.29,
              items: [{ lineId: "milk", name: "Whole Milk", price: 3.29, quantity: 1, itemTotal: 3.29, storeName: "Kroger", offers: [{ storeName: "Kroger", price: 3.29 }, { storeName: "Walmart", price: 3.49 }] }],
            },
          ],
        }),
      });
    });
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
      sessionStorage.setItem("gg-needs-skip", "1");
      localStorage.setItem("gg-list", JSON.stringify([{ id: "milk", itemId: "milk", name: "Whole Milk", quantity: 1 }]));
    });
    await unlock(page);
    await page.locator('[data-flow="plan"]').click();
    await expect(page.locator("[data-coupon-screenshot]").first()).toBeVisible();
  });

  test(`needs input sits between Build and Review at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
      localStorage.setItem("gg-list", JSON.stringify([{ id: "custom:mystery", itemId: "custom:mystery", name: "Mystery Sauce", quantity: 1, needsInput: true }]));
    });
    await unlock(page);
    await page.locator('[data-flow="plan"]').click();
    await expect(page.locator("#needs-input")).toBeVisible();
    await expect(page.locator("#needs-input")).toContainText("Mystery Sauce");
    await expect(page.locator("body")).toHaveAttribute("data-step", "add");
  });

  test(`More opens the department list and refine close does not refetch at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    let browses = 0;
    await page.route("**/api/catalog/browse**", async (route) => {
      browses += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [milk], total: 1, facets: { brands: [] } }) });
    });
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
    });
    await unlock(page);
    await page.locator("#browse-toggle").evaluate((node) => (node as HTMLButtonElement).click());
    await expect(page.locator("#grid .card").first()).toBeVisible();
    const afterOpen = browses;
    await page.locator("#filters-open").evaluate((node) => (node as HTMLButtonElement).click());
    await page.locator("#filters-close").evaluate((node) => (node as HTMLButtonElement).click());
    await page.waitForTimeout(400);
    expect(browses).toBe(afterOpen);
    await page.locator("#chip-hint").evaluate((node) => {
      const button = node as HTMLButtonElement;
      button.hidden = false;
      button.click();
    });
    await expect.poll(async () => page.evaluate(() => document.body.dataset.deptList || "")).toBe("open");
  });

  test(`theme, sticky header, star, and review slot at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
      localStorage.setItem("gg-list", JSON.stringify([{ id: "custom:milk", itemId: "custom:milk", name: "Whole Milk", quantity: 1 }]));
    });
    await page.route("**/api/optimize-list", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total: 3.29,
          pendingStores: [],
          pricingByStore: [
            { storeName: "Kroger", check: "ok" },
            { storeName: "Walmart", check: "ok" },
          ],
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
    await unlock(page);
    const painted = await page.evaluate(() => {
      const bg = getComputedStyle(document.documentElement).backgroundColor;
      const bar = getComputedStyle(document.querySelector(".topbar") as Element).backgroundColor;
      return { bg, bar };
    });
    expect(painted.bg === "rgb(244, 239, 230)" || painted.bg === "rgb(28, 34, 30)").toBe(true);
    expect(painted.bar).not.toBe("rgba(0, 0, 0, 0)");
    await page.locator("#list-toggle").evaluate((node) => (node as HTMLButtonElement).click());
    await expect(page.locator("[data-star-item]")).toBeVisible();
    await page.locator("[data-star-item]").evaluate((node) => (node as HTMLButtonElement).click());
    await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem("gg-usuals") || "[]") as Array<{ starred?: boolean; name?: string }>).some((row) => row.starred && /milk/i.test(row.name || "")))).toBe(true);
    await page.locator("#list-close").click();
    await page.locator("#tab-favorites").click();
    await expect(page.locator("#favorites-usuals")).toContainText(/Milk/);
    await page.locator('[data-flow="plan"]').click();
    const slot = await page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        let rules: CSSRule[] = [];
        try {
          rules = [...sheet.cssRules];
        } catch {
          continue;
        }
        for (const rule of rules) {
          if (rule instanceof CSSStyleRule && rule.selectorText.includes(".review-head-slot") && rule.style.minHeight) return rule.style.minHeight;
        }
      }
      return "";
    });
    expect(slot).toBe("0px");
  });
}
