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

const TRIP_ITEMS = ["Milk", "Eggs", "Bread", "Bananas", "Cheddar", "Yogurt", "Butter"];

function importBody() {
  const items = TRIP_ITEMS.map((name) => ({
    key: name.toLowerCase(),
    raw: name,
    name,
    status: "found",
    accepted: true,
    selectedId: `prod-${name.toLowerCase()}`,
    choices: [{ product: { id: `prod-${name.toLowerCase()}`, name, familyName: name, brand: "Kroger", offers: [{ storeName: "Kroger", price: 1.5 }] } }],
  }));
  return {
    items,
    found: items.length,
    total: items.length,
    receipt: {
      lines: [...TRIP_ITEMS, "U by Kotex Tampons", "Paper Towels", "Rice", "Pasta", "Oats", "Honey"].map((name) => ({ name, quantity: 1 })),
    },
  };
}

async function tripNames(page: Page) {
  return page.evaluate(() =>
    (JSON.parse(localStorage.getItem("gg-list") || "[]") as Array<{ name?: string; product?: { name?: string } }>).map(
      (row) => row.name || row.product?.name || ""
    )
  );
}

async function openImportWithExtras(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem("gg-profile", JSON.stringify({ onboarding: { status: "done", step: "summary", updatedAt: 1 } }));
  });
  await page.route("**/api/import/text", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(importBody()) });
  });
  await unlock(page);
  await page.locator("#add-items").tap();
  await expect(page.locator("#import-dialog")).toHaveAttribute("open", "");
  await page.locator("#import-paste").fill(TRIP_ITEMS.join("\n"));
  await page.locator("#import-find").tap();
  await expect(page.getByRole("button", { name: "Add 7 items to my trip" })).toBeVisible();
}

for (const size of sizes) {
  test(`v90 found-items sheet sits over the open import at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await openImportWithExtras(page);
    await page.getByRole("button", { name: "Add 7 items to my trip" }).tap();
    const sheet = page.locator("#gitter-receipt-sheet");
    const importer = page.locator("#import-dialog");
    await expect(sheet).toBeVisible();
    await expect(importer).toHaveAttribute("open", "");
    await expect(sheet).toContainText("These were on past receipts but aren't on this list.");
    const box = await sheet.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(size.height + 1);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 1);
    const metrics = await sheet.evaluate((el) => {
      const list = el.querySelector(".gitter-guide-chips");
      return { scroll: list?.scrollHeight || 0, client: list?.clientHeight || 0, kids: list?.children.length || 0 };
    });
    expect(metrics.kids).toBeGreaterThan(2);
    expect(metrics.scroll).toBeGreaterThan(metrics.client + 4);
    await sheet.locator(".gitter-guide-chips").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    expect(await sheet.locator(".gitter-guide-chips").evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    const pick = sheet.locator("[data-guide-name='Paper Towels']");
    await pick.tap();
    await expect(pick).toHaveAttribute("aria-pressed", "true");
    const covered = await page.evaluate(() => {
      const close = document.getElementById("import-close");
      const dialog = document.getElementById("import-dialog");
      if (!(close instanceof HTMLElement) || !(dialog instanceof HTMLElement)) return { inert: false, blocked: false };
      const box = close.getBoundingClientRect();
      const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { inert: dialog.inert === true, blocked: top !== close && !close.contains(top) };
    });
    expect(covered.inert).toBe(true);
    expect(covered.blocked).toBe(true);
    await sheet.getByRole("button", { name: "Add selected" }).tap();
    await expect(sheet).toBeHidden();
    const names = await tripNames(page);
    expect(names).toEqual(expect.arrayContaining(["Milk", "Eggs", "Bread", "Bananas", "Cheddar", "Yogurt", "Butter", "Paper Towels"]));
    expect(names).toHaveLength(8);
  });

  test(`v90 skip closes only the found-items sheet at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await openImportWithExtras(page);
    const star = page.locator("#import-review .fav-star").first();
    await star.tap();
    await expect(star).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#import-dialog")).toHaveAttribute("open", "");
    await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem("gg-usuals") || "[]") as Array<{ starred?: boolean; name?: string }>).some((row) => row.starred && /Milk/i.test(row.name || "")))).toBe(true);
    await page.getByRole("button", { name: "Add 7 items to my trip" }).tap();
    const sheet = page.locator("#gitter-receipt-sheet");
    await expect(sheet).toBeVisible();
    await sheet.locator("[data-guide-action='later']").tap();
    await expect(sheet).toBeHidden();
    await expect(page.locator("#import-dialog")).toHaveAttribute("open", "");
    await expect(page.locator("#gitter-guide")).toBeHidden();
    const names = await tripNames(page);
    expect(names.filter((name) => ["Milk", "Eggs", "Bread", "Bananas", "Cheddar", "Yogurt", "Butter"].includes(name))).toHaveLength(7);
    expect(names).not.toContain("Paper Towels");
    expect(names).not.toContain("U by Kotex Tampons");
    await page.locator("#import-close").tap();
    await page.locator("#menu-open").tap();
    await expect(page.locator("#settings-open")).toBeVisible();
    await page.locator("#settings-open").tap();
    await expect(page.locator("#settings-dialog")).toHaveAttribute("open", "");
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
          capabilities: { krogerCart: true },
          stores: [
            {
              storeName: "Kroger",
              subtotal: 5.49,
              items: [
                {
                  lineId: "beef",
                  name: "Ground Beef",
                  title: "Ground Beef",
                  price: 5.49,
                  quantity: 1,
                  itemTotal: 5.49,
                  storeName: "Kroger",
                  productId: "0001111062204",
                  upc: "0001111062204",
                },
              ],
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
    await page.locator("#usuals-toggle").tap();
    await expect(page.locator("#favorites-screen")).toBeVisible();
    await page.locator("#favorites-close").tap();
    await page.locator('[data-flow="plan"]').tap();
    await expect(page.locator("body")).toHaveAttribute("data-step", "plan");
    const math = page.locator("#plan-math");
    await expect(math).toContainText("We'll handle the math.");
    const mathBox = await math.boundingBox();
    expect(mathBox && mathBox.y).toBeLessThan(220);
    await expect(page.locator("[data-kroger-banner]")).toHaveCount(0);
    await expect(page.locator("[data-store='Kroger']")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Send to Kroger cart" })).toHaveCount(1);
    await expect(page.locator("#trip a[data-coupon-link], #trip a.coupon-link, #trip a.cart-coupon-link")).toHaveCount(1);
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
    await expect(version).toHaveText(/v92 · [0-9a-f]{7}/i);
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
    if (/Connect a store\?|Kroger connected/.test((await page.locator("#profile-title").textContent()) || "")) {
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
