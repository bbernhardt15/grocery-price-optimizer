import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

async function unlock(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.locator("#beta-code").first().fill("Brandon-50y4");
  await page.locator("#beta-gate-form button[type=submit]").first().click();
  await expect(page.locator("#beta-gate")).toBeHidden();
}

test("menu drag does not scroll the page, and the drawer can scroll", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
  });
  await unlock(page);
  await page.evaluate(() => {
    const filler = document.createElement("div");
    filler.id = "scroll-filler";
    filler.style.height = "1600px";
    document.body.appendChild(filler);
    window.scrollTo(0, 480);
  });
  await page.locator("#menu-open").click();
  await expect(page.locator("body")).toHaveAttribute("data-drawer", "open");
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.move(80, 500);
  await page.mouse.down();
  await page.mouse.move(80, 220, { steps: 8 });
  await page.mouse.up();
  const after = await page.evaluate(() => window.scrollY);
  expect(Math.abs(after - before)).toBeLessThan(2);
  const moved = await page.evaluate(() => {
    const drawer = document.getElementById("app-drawer");
    if (!drawer) return 0;
    const start = drawer.scrollTop;
    drawer.scrollTop = start + 180;
    return drawer.scrollTop - start;
  });
  expect(moved).toBeGreaterThan(0);
});

test("Add items from In-store closes back on In-store", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem("gg-step", "shop");
    localStorage.setItem(
      "gg-list",
      JSON.stringify([{ id: "custom:milk", itemId: "custom:milk", name: "Milk", quantity: 1 }])
    );
  });
  await unlock(page);
  await page.evaluate(() => {
    document.body.dataset.step = "shop";
  });
  await page.locator('[data-flow="shop"]').click();
  await expect(page.locator("body")).toHaveAttribute("data-step", "shop");
  await page.locator("#add-items").click();
  await expect(page.locator("#import-dialog")).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-step", "shop");
  const field = page.locator("#import-paste");
  await field.focus();
  const ring = await field.evaluate((el) => {
    const style = getComputedStyle(el);
    return { outline: style.outlineStyle, border: style.borderTopWidth, shrink: style.flexShrink };
  });
  expect(ring.outline).toBe("none");
  expect(Number.parseFloat(ring.border)).toBeGreaterThanOrEqual(2);
  expect(ring.shrink).toBe("0");
  await page.locator("#import-close").click();
  await expect(page.locator("#import-dialog")).toBeHidden();
  await expect(page.locator("body")).toHaveAttribute("data-step", "shop");
});

test("Refresh keeps the Review list and scroll until the new prices arrive", async ({ page }) => {
  let release = () => {};
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const plan = (count: number) => ({
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
          department: "Pantry",
        })),
      },
    ],
  });
  await page.route("**/sw.js", (route) => route.abort());
  await page.route("**/api/optimize-list", async (route) => {
    calls += 1;
    if (calls === 1) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(plan(80)) });
      return;
    }
    await held;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(plan(4)) });
  });
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem(
      "gg-list",
      JSON.stringify(
        Array.from({ length: 80 }, (_, index) => ({
          id: `custom:line-${index}`,
          itemId: `custom:line-${index}`,
          name: `Review line ${index + 1}`,
          quantity: 1,
        }))
      )
    );
  });
  await unlock(page);
  await page.locator('[data-flow="plan"]').click();
  const lines = page.locator("#trip [data-plan-panel='spread'] .review-lines li");
  await expect(lines).toHaveCount(80);
  const scrolled = await page.evaluate(() => {
    window.scrollTo(0, 720);
    return window.scrollY;
  });
  expect(scrolled).toBeGreaterThan(400);
  await page.locator("#plan-refresh").evaluate((button) => (button as HTMLButtonElement).click());
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
  await expect(lines).toHaveCount(80);
  await expect(page.locator("[data-review-refresh]")).toBeVisible();
  release();
  await expect(lines).toHaveCount(4);
});

test("a late aisle response cannot change the next page cursor", async ({ page }) => {
  let releaseProduce = () => {};
  const produceHeld = new Promise<void>((resolve) => {
    releaseProduce = resolve;
  });
  const seen: Array<{ department: string; cursor: string }> = [];
  await page.route("**/api/catalog/departments**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        departments: [
          { id: "produce", name: "Produce" },
          { id: "dairy", name: "Dairy" },
        ],
      }),
    });
  });
  await page.route("**/api/catalog/browse**", async (route) => {
    const url = new URL(route.request().url());
    const department = url.searchParams.get("department") || "all";
    const cursor = url.searchParams.get("cursor") || "";
    seen.push({ department, cursor });
    if (department === "produce") {
      await produceHeld;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [{ id: "produce-1", name: "PRODUCE ONLY", familyName: "PRODUCE ONLY", brand: "Test", imageUrls: [], variants: [] }],
          total: 1,
          nextCursor: "cursor-produce",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [{ id: "dairy-1", name: "DAIRY ONLY", familyName: "DAIRY ONLY", brand: "Test", imageUrls: [], variants: [] }],
        total: 1,
        nextCursor: department === "dairy" ? "cursor-dairy" : null,
      }),
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    if (navigator.serviceWorker) {
      navigator.serviceWorker.register = () => Promise.resolve({} as ServiceWorkerRegistration);
    }
  });
  await unlock(page);
  await page.locator("#browse-toggle").click();
  await page.locator(".chip[data-dept='produce']").click();
  await page.locator(".chip[data-dept='dairy']").click();
  await expect(page.locator("#grid")).toContainText("DAIRY ONLY");
  releaseProduce();
  await page.waitForTimeout(500);
  await expect(page.locator("#grid")).toContainText("DAIRY ONLY");
  await expect(page.locator("#grid")).not.toContainText("PRODUCE ONLY");
  await page.locator("#show-more").click();
  await expect.poll(() => seen.some((row) => row.cursor === "cursor-dairy")).toBe(true);
  expect(seen.some((row) => row.cursor === "cursor-produce")).toBe(false);
});

test("Refine opens without focusing the sort menu", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
  });
  await unlock(page);
  await page.locator("#browse-toggle").click();
  await page.locator("#filters-open").click();
  await expect(page.locator("#filters")).toHaveClass(/open/);
  await expect(page.locator("#sort")).not.toBeFocused();
  const box = await page.locator("#filters").boundingBox();
  expect(box && box.height).toBeGreaterThan(120);
});
