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

const sizes = [
  { width: 390, height: 844 },
  { width: 375, height: 667 },
] as const;

for (const size of sizes) {
  test(`walkthrough shell stays consistent at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
    });
    await unlock(page);
    await page.locator("#menu-open").click();
    await expect(page.locator("#app-version")).toContainText("v89");
    await page.locator("#drawer-close").click();

    const tiles = page.locator("#usuals-toggle, [data-lists-open], #past-trips-open, #browse-toggle");
    await expect(tiles).toHaveCount(4);
    const sizes = await tiles.evaluateAll((nodes) =>
      nodes.map((node) => {
        const icon = node.querySelector(".feature-icon");
        const box = node.getBoundingClientRect();
        const iconBox = icon?.getBoundingClientRect();
        return {
          height: Math.round(box.height),
          icon: iconBox ? Math.round(iconBox.width) : 0,
        };
      })
    );
    const heights = sizes.map((row) => row.height);
    const icons = sizes.map((row) => row.icon);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2);
    expect(Math.max(...icons) - Math.min(...icons)).toBeLessThanOrEqual(1);

    await page.locator("#browse-toggle").click();
    await expect(page.locator("#chip-hint")).toBeHidden();
    await expect(page.locator(".dept-chips")).toBeVisible();
    await page.locator("#filters-open").click();
    await expect(page.locator("#filters")).toHaveClass(/open/);
    await expect(page.locator("#filter-department")).toBeVisible();
    const layered = await page.evaluate(() => {
      const refine = document.querySelector("#filters") as HTMLElement;
      const chips = document.querySelector(".dept-scroller") as HTMLElement;
      const refineZ = Number(getComputedStyle(refine).zIndex) || 0;
      const chipZ = Number(getComputedStyle(chips).zIndex) || 0;
      return refineZ > chipZ;
    });
    expect(layered).toBe(true);
    await page.locator("#filters-close").click();

    await page.locator("#tab-favorites").click();
    await expect(page.locator("#favorites-screen")).toBeVisible();
    await expect(page.locator("#favorites-screen")).toContainText("Star items to see them here");
    await expect(page.locator("#favorites-screen")).not.toContainText("Aisle 1");
    await page.locator("#favorites-close").click();

    await page.locator('[data-flow="plan"]').click();
    await expect(page.locator("body")).toHaveAttribute("data-step", "plan");
    await expect(page.locator("#browse")).toBeHidden();
    await page.locator('[data-flow="add"]').click();
    await expect(page.locator("body")).toHaveAttribute("data-step", "add");
    const scrolled = await page.evaluate(() => window.scrollY);
    expect(scrolled).toBeLessThan(8);

    await page.locator("#menu-open").click();
    await expect(page.locator("#app-drawer")).toBeVisible();
    const menuAbove = await page.evaluate(() => {
      const drawer = document.querySelector("#app-drawer") as HTMLElement;
      return (Number(getComputedStyle(drawer).zIndex) || 0) >= 80;
    });
    expect(menuAbove).toBe(true);
    await page.locator("#drawer-close").click();
    await page.locator("#brand-home").click();
    await expect(page.locator("body")).toHaveAttribute("data-step", "add");
  });

  test(`walks the receipt, review, and tabs at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      localStorage.setItem("gg-zip", "45103");
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
    await page.locator("#profile-receipt-paste").fill(
      ["Whole Milk", "Large Eggs", "Bananas", "Tide", "Bread", "Butter", "Cereal", "Yogurt", "Cheddar", "Chicken", "Pasta", "Coffee"].join("\n")
    );
    await page.getByRole("button", { name: "Read my receipts" }).click();
    await expect(page.getByRole("heading", { name: "Here's what we learned" })).toBeVisible();
    const learned = await page.evaluate(() => {
      const stage = document.querySelector("#profile-stage");
      const next = document.querySelector("#profile-next");
      const actions = document.querySelector(".profile-actions");
      if (!(stage instanceof HTMLElement) || !(next instanceof HTMLElement) || !(actions instanceof HTMLElement)) return null;
      stage.scrollTop = 0;
      const frame = stage.getBoundingClientRect();
      const button = next.getBoundingClientRect();
      const last = stage.querySelector("[data-learned-row]:last-of-type");
      const lastBox = last instanceof HTMLElement ? last.getBoundingClientRect() : null;
      return {
        inside: stage.contains(next),
        position: getComputedStyle(actions).position,
        below: button.top >= frame.bottom - 4,
        afterLast: lastBox ? button.top >= lastBox.bottom - 1 : false,
      };
    });
    expect(learned?.inside).toBe(true);
    expect(learned?.position).toBe("static");
    expect(learned?.below).toBe(true);
    expect(learned?.afterLast).toBe(true);
    await page.locator("#profile-stage").evaluate((node) => {
      (node as HTMLElement).scrollTop = (node as HTMLElement).scrollHeight;
    });
    await expect(page.locator("#profile-next")).toBeVisible();
    await page.locator("#profile-next").click();
    await expect(page.getByRole("heading", { name: "Add them to this trip?" })).toBeVisible();
    await page.getByRole("button", { name: "Select all" }).click();
    const trip = await page.evaluate(() => {
      const stage = document.querySelector("#profile-stage");
      const add = document.querySelector("#learned-add-trip");
      const empty = document.querySelector("#learned-empty-trip");
      if (!(stage instanceof HTMLElement) || !(add instanceof HTMLElement) || !(empty instanceof HTMLElement)) return null;
      stage.scrollTop = 0;
      const addBox = add.getBoundingClientRect();
      const last = stage.querySelector(".trip-add-row:last-of-type");
      const lastBox = last instanceof HTMLElement ? last.getBoundingClientRect() : null;
      return {
        inEnd: Boolean(document.querySelector("#trip-add-end")?.contains(add)),
        emptyInEnd: Boolean(document.querySelector("#trip-add-end")?.contains(empty)),
        position: getComputedStyle(add).position,
        afterLast: lastBox ? addBox.top >= lastBox.bottom - 1 : false,
      };
    });
    expect(trip?.inEnd).toBe(true);
    expect(trip?.emptyInEnd).toBe(true);
    expect(trip?.position).toBe("static");
    expect(trip?.afterLast).toBe(true);
    await page.locator("#profile-stage").evaluate((node) => {
      (node as HTMLElement).scrollTop = (node as HTMLElement).scrollHeight;
    });
    await page.locator("#learned-add-trip").click();
    await expect(page.locator("#toast")).toContainText(/Added/);
    const toastClear = await page.evaluate(() => {
      const toast = document.querySelector("#toast");
      const link = document.querySelector(".site-footer a");
      if (!(toast instanceof HTMLElement) || !(link instanceof HTMLElement) || !toast.classList.contains("show")) return true;
      const left = toast.getBoundingClientRect();
      const right = link.getBoundingClientRect();
      if (right.height < 2 || right.bottom < 0 || right.top > window.innerHeight) return true;
      return !(left.bottom > right.top + 1 && left.top < right.bottom - 1 && left.right > right.left && left.left < right.right);
    });
    expect(toastClear).toBe(true);
    await expect(page.locator("body")).toHaveAttribute("data-step", "add");
    const tileMeasure = await page.locator("#usuals-toggle, [data-lists-open], #past-trips-open, #browse-toggle").evaluateAll((nodes) =>
      nodes
        .filter((node) => node.getBoundingClientRect().height > 8)
        .map((node) => {
          const icon = node.querySelector(".feature-icon")?.getBoundingClientRect();
          return { height: Math.round(node.getBoundingClientRect().height), icon: icon ? Math.round(icon.width) : 0 };
        })
    );
    expect(tileMeasure.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...tileMeasure.map((row) => row.height)) - Math.min(...tileMeasure.map((row) => row.height))).toBeLessThanOrEqual(2);
    expect(Math.max(...tileMeasure.map((row) => row.icon)) - Math.min(...tileMeasure.map((row) => row.icon))).toBeLessThanOrEqual(1);

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
          unavailable: ["U by Kotex"],
          stores: [
            {
              storeName: "Kroger",
              subtotal: 3.2,
              items: [{ lineId: "milk", name: "Whole Milk", title: "Whole Milk", price: 3.2, quantity: 1, itemTotal: 3.2, storeName: "Kroger" }],
            },
          ],
        }),
      });
    });
    await page.route("**/api/catalog/browse**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [{ id: "kotex", name: "U by Kotex", brand: "U by Kotex", familyName: "U by Kotex", offers: [{ storeName: "Kroger", price: 4.5 }] }],
          total: 1,
        }),
      });
    });
    await page.route("**/api/import/coupon", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          source: "screenshot",
          coupon: { storeName: "Kroger", itemName: "Whole Milk", kind: "dollars", amount: 1, expiresOn: "2026-12-01", gaps: [] },
        }),
      });
    });
    await page.locator('[data-flow="plan"]').click();
    const prompt = page.locator("#gitter-guide");
    await expect(prompt).toContainText("Needs a look");
    await expect(prompt.getByRole("button", { name: "Search at Kroger" })).toBeVisible();
    await prompt.getByRole("button", { name: "Dismiss guide" }).click();
    await expect(prompt).toBeHidden();
    await page.getByRole("button", { name: /Search at Kroger/ }).click();
    await expect(page.locator("#match-sheet")).toBeVisible();
    await page.locator("#match-close").click();
    await expect(page.locator("#match-sheet")).toBeHidden();
    await page.getByRole("button", { name: "Add a coupon screenshot" }).click();
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    await page.locator("[data-coupon-shot]").setInputFiles({ name: "coupon.png", mimeType: "image/png", buffer: png });
    await expect(page.locator("[data-coupon-amount]")).toBeVisible();
    await page.locator("[data-coupon-amount]").evaluate((node) => node.scrollIntoView({ block: "center" }));
    const formFits = await page.evaluate(() => {
      const field = document.querySelector("[data-coupon-amount]");
      const dock = document.querySelector("#bottom-dock");
      if (!(field instanceof HTMLElement) || !(dock instanceof HTMLElement)) return false;
      const box = field.getBoundingClientRect();
      const dockBox = dock.getBoundingClientRect();
      return box.width > 0 && box.right <= window.innerWidth + 1 && box.bottom <= dockBox.top + 1 && box.top >= 0;
    });
    expect(formFits).toBe(true);
    await page.locator('#step-bar [data-flow="shop"]').click();
    await expect(page.locator("body")).toHaveAttribute("data-step", "shop");
    await expect(page.locator("#gitter-guide")).toBeHidden();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await page.locator('#step-bar [data-flow="plan"]').click();
    await expect(page.locator("#gitter-guide")).toBeHidden();
    await expect(page.locator("#browse")).toBeHidden();
    await page.locator('#step-bar [data-flow="add"]').click();
    await expect(page.locator("body")).toHaveAttribute("data-step", "add");
    await expect(page.locator("#gitter-guide")).toBeHidden();
    await expect(page.locator(".filters.open, dialog[open]")).toHaveCount(0);
    await page.locator("#brand-home").click();
    await expect(page.locator("body")).toHaveAttribute("data-step", "add");
    await page.locator("#menu-open").click();
    await expect(page.locator("#app-version")).toHaveText(/v89 · [0-9a-f]{7}/i);
    const versionSeen = await page.evaluate(() => {
      const drawer = document.querySelector("#app-drawer");
      const node = document.querySelector("#app-version");
      if (!(drawer instanceof HTMLElement) || !(node instanceof HTMLElement)) return null;
      drawer.scrollTop = 0;
      const box = node.getBoundingClientRect();
      const frame = drawer.getBoundingClientRect();
      return { scroll: drawer.scrollTop, top: box.top, bottom: box.bottom, view: window.innerHeight, height: box.height, frameBottom: frame.bottom };
    });
    expect(versionSeen?.scroll).toBe(0);
    expect(versionSeen && versionSeen.height).toBeGreaterThan(8);
    expect(versionSeen && versionSeen.bottom).toBeLessThanOrEqual((versionSeen?.view || 0) + 1);
    expect(versionSeen && versionSeen.top).toBeGreaterThan(40);
  });
}
