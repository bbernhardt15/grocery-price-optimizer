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

async function readTripItems(page: Page) {
  return page.evaluate(async () => {
    const open = indexedDB.open("grocery-gitter");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onerror = () => reject(open.error);
      open.onsuccess = () => resolve(open.result);
    });
    if (!db.objectStoreNames.contains("trip")) {
      db.close();
      return [] as Array<{ name?: string; quantity?: number }>;
    }
    const items = await new Promise<Array<{ name?: string; quantity?: number }>>((resolve) => {
      const tx = db.transaction("trip", "readonly");
      const request = tx.objectStore("trip").get("active");
      request.onsuccess = () => resolve(Array.isArray(request.result?.items) ? request.result.items : []);
      request.onerror = () => resolve([]);
    });
    db.close();
    return items;
  });
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
    await detail.locator("#dialog-back").click();
    await expect(detail).toBeHidden();
  });

  test(`G, Home, and More stay tappable with the detail sheet open at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.route("**/api/catalog/browse**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [milk], total: 1, facets: { brands: [] } }) });
    });
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
    });
    await unlock(page);
    await page.locator("#browse-toggle").click();
    await page.locator("button.card-open").first().click();
    const detail = page.locator("#product-dialog");
    await expect(detail).toBeVisible();
    await expect(page.locator("#chip-hint")).toBeHidden();
    await expect(page.locator(".dept-chips")).toBeVisible();
    await page.locator("#brand-home").click();
    await expect(detail).toBeHidden();
    await page.locator("button.card-open").first().click();
    await expect(detail).toBeVisible();
    await page.locator("#menu-open").click();
    await page.locator("#menu-home").click();
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
    await expect.poll(async () => {
      const items = await readTripItems(page);
      return items.some((row) => /milk/i.test(String(row.name || "")) && Number(row.quantity) === 2);
    }).toBe(true);
    await page.locator("#menu-open").click();
    await page.locator("#menu-new-trip").click();
    await expect(page.locator("#clear-trip")).toBeVisible();
    await page.locator("#clear-trip-yes").click();
    await expect.poll(async () => page.evaluate(() => localStorage.getItem("gg-list"))).toBe("[]");
    await expect.poll(async () => readTripItems(page)).toEqual([]);
    await page.reload();
    await expect.poll(async () => page.evaluate(() => localStorage.getItem("gg-list"))).toBe("[]");
    await expect.poll(async () => readTripItems(page)).toEqual([]);
    await expect(page.locator("#bar-count")).not.toContainText("2 units");
    await expect(page.locator("#bar-count")).not.toContainText("1 lines");
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
    await page.locator("#profile-receipt-paste").fill("Dave's Killer Bread\nCooked Perfect® Homestyle Frozen Meatballs\n1.0 x $6.99");
    await page.getByRole("button", { name: "Read my receipts" }).click();
    await expect(page.getByRole("heading", { name: "Here's what we learned" })).toBeVisible();
    await expect(page.locator("#profile-stage")).not.toContainText("Dave's Killer Bread Cooked Perfect");
    await expect(page.locator("#profile-stage")).not.toContainText("®");
    await expect(page.getByRole("heading", { name: /Bread/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Meatballs/ })).toBeVisible();
    await page.locator("#profile-next").click();
    await expect(page.locator("#learned-add-trip")).toBeVisible();
    await expect(page.locator("#learned-empty-trip")).toBeVisible();
    await expect(page.locator("#learned-add-trip-top")).toHaveCount(0);
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
    await expect(page.locator("#app-version")).toContainText("v87");
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
    await expect(page.locator("#chip-hint")).toBeHidden();
    await expect(page.locator("#filter-department")).toBeAttached();
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

  test(`partial savings show for 30 items while Walmart is still out at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    const items = Array.from({ length: 30 }, (_, index) => ({
      id: `custom:item-${index}`,
      itemId: `custom:item-${index}`,
      name: `Pantry ${index + 1}`,
      quantity: 1,
    }));
    items[0] = { id: "custom:milk", itemId: "custom:milk", name: "Milk", quantity: 1 };
    items[1] = { id: "custom:bread", itemId: "custom:bread", name: "Bread", quantity: 1 };
    await page.addInitScript((rows) => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
      localStorage.setItem("gg-list", JSON.stringify(rows));
    }, items);
    await page.route("**/api/optimize-list", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total: 5,
          partial: true,
          pendingStores: ["Walmart"],
          pricingByStore: [
            { storeName: "Kroger", check: "ok" },
            { storeName: "Walmart", check: "timeout" },
          ],
          stores: [
            {
              storeName: "Kroger",
              subtotal: 5,
              items: [
                { lineId: "milk", name: "Milk", price: 2, quantity: 1, itemTotal: 2, storeName: "Kroger", offers: [{ storeName: "Kroger", price: 2 }, { storeName: "Walmart", price: 5 }] },
                { lineId: "bread", name: "Bread", price: 3, quantity: 1, itemTotal: 3, storeName: "Kroger", offers: [{ storeName: "Kroger", price: 6 }, { storeName: "Walmart", price: 3 }] },
              ],
            },
          ],
        }),
      });
    });
    await unlock(page);
    const started = Date.now();
    await page.locator("[data-flow='plan']").click();
    await expect(page.locator(".savings-callout")).toContainText("You saved", { timeout: 8000 });
    expect(Date.now() - started).toBeLessThan(8000);
    await expect(page.locator("#trip")).toContainText(/not in this savings|Walmart/i);
  });

  test(`coupon handoff returns to the saved tab at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    for (const step of ["add", "plan"] as const) {
      await page.addInitScript((saved) => {
        localStorage.setItem("gg-onboarding-done", "1");
        localStorage.setItem("gg-zip", "45103");
        localStorage.setItem("gg-step", saved);
        localStorage.setItem("gg-list", JSON.stringify([{ id: "custom:milk", itemId: "custom:milk", name: "Milk", quantity: 1 }]));
        localStorage.setItem(
          "gg-handoff-trip",
          JSON.stringify({ items: [{ id: "custom:milk", name: "Milk", quantity: 1 }], step: saved, savedAt: Date.now(), store: "Kroger", kind: "coupons" })
        );
      }, step);
      await page.goto(`/handoff.html?store=Kroger&kind=coupons`);
      await page.locator("#back").click();
      await expect(page.locator("body")).toHaveAttribute("data-step", step);
      await page.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await expect(page.locator("body")).toHaveAttribute("data-step", step);
    }
  });

  test(`one Back leaves the mocked Kroger connect on the connect screen at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.route("**/api/kroger/auth-status", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ oauthConfigured: true, connected: false }) });
    });
    await page.route("**/api/kroger/connect", async (route) => {
      const next = encodeURIComponent("/?kroger=connected&message=Kroger%20connected.");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ authorizeUrl: `/oauth-sim.html?next=${next}`, status: "needs_shopper_login" }),
      });
    });
    await unlock(page);
    await page.getByRole("button", { name: "Get started" }).click();
    await page.locator("#profile-zip").pressSequentially("45103");
    await expect(page.locator("#profile-store-list input, #profile-store-list button").first()).toBeVisible();
    await page.locator("#profile-zip-done").click();
    await page.locator("#profile-next").click();
    await expect(page.locator("#profile-title")).toHaveText("Connect a store?");
    await page.locator("#store-connect-now").evaluate((node) => (node as HTMLButtonElement).click());
    await page.waitForURL(/kroger=connected/);
    await expect(page.locator("body")).not.toHaveAttribute("data-step", "plan");
    await page.goBack();
    await expect(page.locator("#profile-title")).toHaveText("Connect a store?");
  });

  test(`No thanks dismisses the suggestion at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
      localStorage.setItem("gg-list", JSON.stringify([{ id: "custom:eggs", itemId: "custom:eggs", name: "Eggs", quantity: 1 }]));
    });
    await page.route("**/api/optimize-list", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total: 3.2,
          pendingStores: [],
          pricingByStore: [
            { storeName: "Kroger", check: "ok" },
            { storeName: "Walmart", check: "ok" },
          ],
          unavailable: ["Eggs"],
          stores: [
            {
              storeName: "Kroger",
              subtotal: 3.2,
              items: [{ lineId: "milk", name: "Milk", price: 3.2, quantity: 1, itemTotal: 3.2, storeName: "Kroger" }],
            },
          ],
        }),
      });
    });
    await unlock(page);
    await page.locator("[data-flow='plan']").click();
    const prompt = page.locator("#gitter-guide");
    await expect(prompt.getByRole("button", { name: "No thanks" })).toBeVisible();
    await expect(prompt).toContainText("Needs a look");
    await expect(prompt.getByRole("button", { name: "Dismiss guide" })).toBeVisible();
    await prompt.getByRole("button", { name: "No thanks" }).click();
    await expect(prompt).toBeHidden();
  });

  test(`import review uses the plain remember sentence at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
    });
    await unlock(page);
    await page.locator("#browse-toggle").evaluate((node) => (node as HTMLButtonElement).click());
    await page.locator("#ask-import").click();
    await page.locator("#import-paste").fill("Whole Milk");
    await page.locator("#import-find").click();
    await expect(page.getByText("Remember these for my next trip")).toBeVisible();
  });

  test(`a marked name still finds the product at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
    });
    await unlock(page);
    await page.locator("#browse-toggle").evaluate((node) => (node as HTMLButtonElement).click());
    await page.locator("#search").fill("Kroger® Parmesan");
    await page.locator("#search").press("Enter");
    await expect(page.locator("#grid").getByText(/Parmesan/i).first()).toBeVisible();
    await expect(page.locator("#grid")).not.toContainText("®");
  });

  test(`Dairy & Eggs paints a full first page quickly at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
    });
    await unlock(page);
    await page.locator("#browse-toggle").evaluate((node) => (node as HTMLButtonElement).click());
    const started = Date.now();
    await page.locator("[data-dept='dairy-eggs']").first().evaluate((node) => (node as HTMLButtonElement).click());
    await expect(page.locator("#grid .card").nth(7)).toBeVisible();
    expect(Date.now() - started).toBeLessThan(4000);
  });

  test(`Coke is one family with Diet and a 12-pack at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
    });
    await unlock(page);
    await page.locator("#browse-toggle").click();
    await page.locator("#search").fill("coke 12");
    await page.locator("#search").press("Enter");
    const card = page.locator("#grid .card").filter({ has: page.locator("[data-flavor='diet']") }).first();
    await expect(card).toBeVisible();
    await expect(card.locator("[data-size-id][aria-checked='true']")).toContainText(/12\s*pk/i);
    const diet = card.getByRole("radio", { name: "Diet" });
    await diet.click();
    await expect(diet).toHaveAttribute("aria-checked", "true");
    await expect(card.locator("[data-size-id][aria-checked='true']")).toContainText(/12\s*pk/i);
  });

  test(`the menu shows the shell version and commit at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
    });
    await unlock(page);
    await page.locator("#menu-open").click();
    await expect(page.locator("#app-version")).toHaveText(/^v87 · [0-9a-f]{7}$/i);
  });

  test(`the receipt cart moves as reading progresses at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.route("**/api/import/receipt", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1800));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [{ name: "Whole Milk", quantity: 1 }] }),
      });
    });
    await unlock(page);
    await page.getByRole("button", { name: "Get started" }).click();
    await page.locator("#profile-zip").pressSequentially("45103");
    await page.locator("#profile-zip-done").click();
    await page.locator("#profile-next").click();
    if ((await page.locator("#profile-title").textContent()) === "Connect a store?") {
      await page.locator("#store-connect-later").click();
    }
    await page.getByText("Paste order text instead").click();
    await page.locator("#profile-receipt-paste").fill("Whole Milk");
    await page.getByRole("button", { name: "Read my receipts" }).click();
    const track = page.locator(".read-smooth");
    await expect(track).toBeVisible();
    const first = await track.locator("span").evaluate((node) => Number.parseFloat(node.style.width) || 0);
    await expect.poll(async () => track.locator("span").evaluate((node) => Number.parseFloat(node.style.width) || 0)).toBeGreaterThan(first);
  });

  test(`needs input can pick a store match and skips the couldn't-find prompt at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
      localStorage.setItem("gg-list", JSON.stringify([{ id: "custom:mystery", itemId: "custom:mystery", name: "Mystery Sauce", quantity: 1, needsInput: true }]));
    });
    await page.route("**/api/catalog/browse**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [{ id: "sauce-1", name: "Kroger Marinara", familyName: "Kroger Marinara", brand: "Kroger", offers: [{ storeName: "Kroger", price: 2.4 }] }],
        }),
      });
    });
    await page.route("**/api/optimize-list", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total: 2.4,
          pendingStores: [],
          pricingByStore: [
            { storeName: "Kroger", check: "ok" },
            { storeName: "Walmart", check: "ok" },
          ],
          unavailable: ["Mystery Sauce"],
          stores: [
            {
              storeName: "Kroger",
              subtotal: 2.4,
              items: [{ lineId: "sauce-1", name: "Kroger Marinara", price: 2.4, quantity: 1, itemTotal: 2.4, storeName: "Kroger" }],
            },
          ],
        }),
      });
    });
    await unlock(page);
    await page.locator("[data-flow='plan']").click();
    const sheet = page.locator("#needs-input");
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Search at Kroger" }).click();
    await sheet.getByRole("button", { name: /Kroger Marinara at Kroger/ }).click();
    await expect(page.locator("body")).toHaveAttribute("data-step", "plan");
    await expect(page.locator("#gitter-guide")).not.toContainText(/couldn't find Mystery Sauce/i);
  });

  test(`sheets use a lighter surface than the page at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
    });
    await unlock(page);
    const colors = await page.evaluate(() => {
      const panel = document.querySelector(".list-panel");
      panel?.classList.add("open");
      const pageBg = getComputedStyle(document.body).backgroundColor;
      const sheet = panel ? getComputedStyle(panel).backgroundColor : "";
      const shadow = panel ? getComputedStyle(panel).boxShadow : "none";
      return { pageBg, sheet, shadow };
    });
    expect(colors.sheet).not.toBe(colors.pageBg);
    expect(colors.shadow).not.toBe("none");
  });
}
