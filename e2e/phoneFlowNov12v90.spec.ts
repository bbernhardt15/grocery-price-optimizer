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

const sizes = [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
] as const;

for (const size of sizes) {
  test(`v90 found-items sheet is a modal at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
      localStorage.setItem("gg-profile", JSON.stringify({ onboarding: { status: "done", step: "summary", updatedAt: 1 } }));
    });
    const lines = ["Milk", "Eggs", "Bread", "Bananas", "Cheddar", "Yogurt", "Butter", "Rice", "Pasta", "Beans", "Oats", "Honey"].map((name) => ({
      name,
      quantity: 1,
    }));
    await page.route("**/api/import/receipt", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ lines }),
      });
    });
    await unlock(page);
    await page.evaluate(() => fetch("/api/import/receipt", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    const guide = page.locator("#gitter-guide");
    await expect(guide).toContainText("These were on past receipts but aren't on this list.");
    const box = await guide.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(size.height + 1);
    const chips = guide.locator(".gitter-guide-chips");
    const metrics = await guide.evaluate((el) => {
      const list = el.querySelector(".gitter-guide-chips");
      return {
        scroll: list?.scrollHeight || 0,
        client: list?.clientHeight || 0,
        kids: list?.children.length || 0,
      };
    });
    expect(metrics.kids).toBeGreaterThan(3);
    expect(metrics.scroll).toBeGreaterThan(metrics.client + 4);
    await chips.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    expect(await chips.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    const pick = guide.locator("[data-guide-name='Butter']");
    await pick.tap();
    await expect(pick).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".shell")).toHaveAttribute("inert", "");
    await guide.getByRole("button", { name: "Skip" }).tap();
    await expect(guide).toBeHidden();
    await expect(page.locator(".shell")).not.toHaveAttribute("inert", "");
    await page.locator("#menu-open").tap();
    await expect(page.locator("#app-drawer")).toHaveClass(/is-open|open/);
  });

  test(`v90 review, favorites, and menu at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
      localStorage.setItem("gg-profile", JSON.stringify({ onboarding: { status: "done", step: "summary", updatedAt: 1 } }));
      localStorage.setItem("gg-list", JSON.stringify([{ id: "custom:beef", itemId: "custom:beef", name: "Ground Beef", quantity: 1 }]));
      localStorage.setItem(
        "gg-usuals",
        JSON.stringify([{ name: "Whole Milk", starred: true, times: 2, lastAt: 1, catalogId: "milk", quantity: 1 }])
      );
    });
    await page.route("**/api/optimize-list", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total: 5.49,
          stores: [
            {
              storeName: "Kroger",
              subtotal: 5.49,
              items: [{ lineId: "beef", name: "Ground Beef", title: "Ground Beef", price: 5.49, quantity: 1, itemTotal: 5.49, storeName: "Kroger" }],
            },
          ],
          unavailable: [],
        }),
      });
    });
    await page.route("**/api/catalog/browse**", async (route) => {
      const url = new URL(route.request().url());
      if ((url.searchParams.get("q") || "").toLowerCase().includes("publix")) {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], total: 0 }) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              id: "milk",
              name: "Simple Truth Organic Milk",
              familyName: "Simple Truth Organic Milk",
              brand: "Simple Truth",
              imageUrls: ["/no-such-product-photo.jpg"],
              offers: [{ storeName: "Kroger", price: 4.29, availability: "in_stock" }],
              bestOffer: { storeName: "Kroger", price: 4.29 },
            },
            {
              id: "cheddar",
              name: "Shredded Cheddar Cheese",
              familyName: "Shredded Cheddar Cheese",
              brand: "Kroger",
              imageUrls: [],
              offers: [{ storeName: "Kroger", price: 2.49, availability: "in_stock" }],
              bestOffer: { storeName: "Kroger", price: 2.49 },
            },
          ],
          total: 1,
        }),
      });
    });
    await unlock(page);
    await expect(page.locator("#tab-favorites")).toHaveCount(0);
    await expect(page.locator("#usuals-toggle")).toBeVisible();
    await page.locator('[data-flow="plan"]').tap();
    await expect(page.locator("body")).toHaveAttribute("data-step", "plan");
    const math = page.locator("#plan-math");
    await expect(math).toContainText("We'll handle the math.");
    const mathBox = await math.boundingBox();
    expect(mathBox && mathBox.y).toBeLessThan(220);
    await expect(page.locator("[data-kroger-banner]")).toHaveCount(0);
    await expect(page.locator("[data-store='Kroger']")).toHaveCount(1);
    await page.locator("details.store-fold summary").first().tap();
    const star = page.locator(".review-line .fav-star").first();
    await star.tap();
    await expect(star).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("body")).toHaveAttribute("data-step", "plan");
    await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem("gg-usuals") || "[]") as Array<{ starred?: boolean }>).some((row) => row.starred))).toBe(true);

    await page.locator('[data-flow="add"]').tap();
    await page.locator("#browse-toggle").tap();
    const cardStar = page.locator(".card .fav-star").first();
    await expect(cardStar).toBeVisible();
    const starBox = await cardStar.boundingBox();
    expect(starBox && starBox.width).toBeGreaterThanOrEqual(44);
    expect(starBox && starBox.height).toBeGreaterThanOrEqual(44);
    await cardStar.tap();
    await expect(page.locator("#product-dialog")).not.toHaveAttribute("open", "");
    await expect(page.locator("#grid .card").nth(1).locator(".product-placeholder")).toBeVisible();
    await expect(page.locator("#grid .card").first().locator(".product-placeholder")).toBeVisible();

    await page.locator("#menu-open").tap();
    const version = page.locator("#app-version");
    const help = page.locator("#help-terms");
    const order = await page.evaluate(() => {
      const version = document.getElementById("app-version");
      const help = document.getElementById("help-terms");
      if (!version || !help) return false;
      return Boolean(help.compareDocumentPosition(version) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(order).toBe(true);
    await expect(version).toContainText("v90");
  });

  test(`v90 change search stays on Kroger and Walmart at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
      localStorage.setItem("gg-profile", JSON.stringify({ onboarding: { status: "done", step: "summary", updatedAt: 1 } }));
    });
    await unlock(page);
    await page.locator("[data-lists-open]").tap();
    const tailgate = page.locator("[data-list-open='tailgate']");
    if (!(await tailgate.isVisible().catch(() => false))) await page.locator("[data-lists-all]").tap();
    await tailgate.tap();
    const pending = page.waitForResponse(
      (response) => response.url().includes("/api/catalog/browse") && /ground/i.test(decodeURIComponent(response.url())) && response.ok()
    );
    await page.locator("[data-slot-change='ground-beef']").tap();
    const body = await (await pending).json();
    const stores = (body.items || []).flatMap((item: { offers?: Array<{ storeName?: string }>; variants?: Array<{ offers?: Array<{ storeName?: string }> }> }) => [
      ...(item.offers || []),
      ...(item.variants || []).flatMap((variant) => variant.offers || []),
    ]);
    expect(stores.length).toBeGreaterThan(0);
    expect(stores.every((offer) => /kroger|walmart/i.test(String(offer.storeName || "")))).toBe(true);
    expect(stores.some((offer) => /publix|target|aldi/i.test(String(offer.storeName || "")))).toBe(false);
    await expect(page.locator("#pick-results")).toBeVisible();
    await expect(page.locator("#pick-results")).not.toContainText(/Publix|Target|Aldi/);
  });

  test(`v90 trip buttons scroll with the list at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await unlock(page);
    const start = page.getByRole("button", { name: "Get started" });
    await expect(start).toBeVisible();
    await start.tap();
    await page.locator("#profile-zip").pressSequentially("45103");
    await expect(page.locator("#profile-store-list input, #profile-store-list button").first()).toBeVisible();
    await page.locator("#profile-zip-done").tap();
    await page.locator("#profile-next").tap();
    if ((await page.locator("#profile-title").textContent()) === "Connect a store?") {
      await page.locator("#store-connect-later").tap();
    }
    await page.getByText("Paste order text instead").tap();
    await page.locator("#profile-receipt-paste").fill("Dave's Killer Bread\n1.0 x $6.99");
    await page.route("**/api/catalog/browse**", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "busy" }) })
    );
    await page.getByRole("button", { name: "Read my receipts" }).tap();
    await expect(page.getByRole("heading", { name: "Here's what we learned" })).toBeVisible();
    await page.locator("#profile-next").tap();
    const top = page.locator("#learned-add-trip-top");
    const bottom = page.locator("#learned-add-trip");
    await expect(top).toBeVisible();
    await expect(bottom).toBeAttached();
    const layout = await page.evaluate(() => {
      const topBar = document.getElementById("trip-action-bar");
      const end = document.getElementById("trip-add-end");
      const topButton = document.getElementById("learned-add-trip-top");
      const bottomButton = document.getElementById("learned-add-trip");
      const stage = document.getElementById("profile-stage");
      if (!topBar || !end || !topButton || !bottomButton || !stage) return null;
      stage.scrollTop = stage.scrollHeight;
      return {
        topPosition: getComputedStyle(topBar).position,
        endPosition: getComputedStyle(end).position,
        order: (topButton.compareDocumentPosition(bottomButton) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        scrolled: stage.scrollTop,
      };
    });
    expect(layout?.topPosition).toBe("static");
    expect(layout?.endPosition).toBe("static");
    expect(layout?.order).toBe(true);
  });
}
