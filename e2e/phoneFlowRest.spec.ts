import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const receipt = path.join(process.cwd(), "e2e/fixtures/sample-order.pdf");

test.use({ viewport: { width: 390, height: 844 } });

async function unlock(page: Page) {
  await page.goto("/");
  await page.locator("#beta-code").first().fill("Brandon-50y4");
  await page.locator("#beta-gate-form button[type=submit]").first().click();
  await expect(page.locator("#beta-gate")).toBeHidden();
}

async function reachStores(page: Page) {
  await page.getByRole("button", { name: "Get started" }).click();
  await page.locator("#profile-zip").pressSequentially("45103");
  await expect(page.locator("#profile-store-list input, #profile-store-list button").first()).toBeVisible();
  await page.locator("#profile-zip-done").click();
}

test("priced completion saves an estimate, not a $0 savings claim, and reuse restores the lines", async ({ page }) => {
  await page.route("**/api/optimize-list", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        total: 0,
        partial: false,
        pendingStores: [],
        pricingByStore: [
          { storeName: "Kroger", check: "ok" },
          { storeName: "Walmart", check: "ok" },
        ],
        stores: [
          {
            storeName: "Kroger",
            items: [
              { lineId: "milk", name: "Milk", price: 3.2, quantity: 1, itemTotal: 3.2, storeName: "Kroger" },
              { lineId: "eggs", name: "Eggs", price: 2.5, quantity: 2, itemTotal: 5, storeName: "Kroger" },
            ],
          },
        ],
      }),
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    if (navigator.serviceWorker) {
      navigator.serviceWorker.register = () => Promise.resolve({} as ServiceWorkerRegistration);
    }
    localStorage.setItem(
      "gg-list",
      JSON.stringify([
        { id: "custom:milk", itemId: "custom:milk", name: "Milk", quantity: 1 },
        { id: "custom:eggs", itemId: "custom:eggs", name: "Eggs", quantity: 2 },
      ])
    );
  });
  await unlock(page);
  await page.locator('[data-flow="plan"]').click();
  await expect(page.locator("body")).toHaveAttribute("data-step", "plan");
  await expect(page.locator("#trip")).toContainText("Milk");
  await expect(page.locator("#trip")).toContainText("Eggs");
  await page.locator("[data-complete-trip]").first().evaluate((button) => (button as HTMLButtonElement).click());
  await expect(page.locator("#gitter-guide")).toBeVisible();
  await expect(page.locator("#gitter-guide")).not.toContainText("$0.00");
  await expect(page.locator("#gitter-guide")).toContainText(/Estimated \$8\.20|Trip saved/);
  await expect(page.getByText(/I found \d+ items/)).toHaveCount(0);
  await page.locator("#gitter-guide [data-guide-off]").click();
  await expect(page.locator("#import-dialog")).toBeHidden();
  await expect(page.getByText("Hey. What are we picking up this week?")).toHaveCount(0);
  await page.locator("#menu-open").click();
  await page.locator("#menu-past").click();
  await expect(page.locator("[data-trip-total]")).toHaveText("$8.20");
  await expect(page.locator(".receipt-saved")).toHaveCount(0);
  await expect(page.locator(".receipt-items li")).toHaveCount(2);
  await page.locator("[data-reuse-trip]").click();
  await expect(page.locator("#bar-count")).toContainText(/2|3/);
});

test("internal Back during a delayed receipt read stays on upload", async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/import/pdf**", async (route) => {
    await held;
    await route.continue();
  });
  await unlock(page);
  await reachStores(page);
  await page.locator("#profile-next").click();
  await page.locator("#profile-receipt-input").setInputFiles(receipt);
  await page.getByRole("button", { name: "Read my receipts" }).click();
  await expect(page.locator("[data-reading-screen], .read-live").first()).toBeVisible();
  await page.locator("#profile-back").click();
  await expect(page.getByRole("heading", { name: "Here's what we learned" })).toHaveCount(0);
  release();
  await page.waitForTimeout(1000);
  await expect(page.getByRole("heading", { name: "Here's what we learned" })).toHaveCount(0);
});

test("internal Back from the trip list returns to the parsed review", async ({ page }) => {
  await unlock(page);
  await reachStores(page);
  await page.locator("#profile-next").click();
  await page.locator("#profile-receipt-input").setInputFiles(receipt);
  await page.getByRole("button", { name: "Read my receipts" }).click();
  await expect(page.getByRole("heading", { name: "Here's what we learned" })).toBeVisible();
  const learned = await page.locator(".learned-row").count();
  expect(learned).toBeGreaterThan(0);
  await page.locator("#profile-next").click();
  await expect(page.getByRole("heading", { name: "Add them to this trip?" })).toBeVisible();
  await page.locator("#profile-back").click();
  await expect(page.getByRole("heading", { name: "Here's what we learned" })).toBeVisible();
  await expect(page.locator(".learned-row")).toHaveCount(learned);
});

test("store connect can be skipped without leaving the ZIP", async ({ page }) => {
  await page.addInitScript(() => {
    if (navigator.serviceWorker) {
      navigator.serviceWorker.register = () => Promise.resolve({} as ServiceWorkerRegistration);
    }
  });
  await page.route("**/api/kroger/auth-status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ oauthConfigured: true, connected: false }),
    });
  });
  await unlock(page);
  await reachStores(page);
  await expect(page.locator("#store-connect-now")).toBeVisible();
  await expect(page.locator("#store-connect input[type=password]")).toHaveCount(0);
  await page.locator("#store-connect-later").click();
  await expect(page.locator("#store-connect")).toContainText(/at checkout/i);
  await expect(page.locator("#profile-zip")).toHaveValue(/45103/);
  await expect(page.locator("#profile-store-list input:checked, #profile-store-list input").first()).toBeVisible();
});

test("a cancelled Kroger sign-in returns to onboarding", async ({ page }) => {
  await page.addInitScript(() => {
    if (navigator.serviceWorker) {
      navigator.serviceWorker.register = () => Promise.resolve({} as ServiceWorkerRegistration);
    }
  });
  await page.route("**/api/kroger/auth-status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ oauthConfigured: true, connected: false }),
    });
  });
  await page.route("**/api/kroger/connect", async (route) => {
    const here = new URL(page.url());
    here.search = "?kroger=error&message=Cancelled";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ authorizeUrl: here.toString() }),
    });
  });
  await unlock(page);
  await reachStores(page);
  await page.locator("#store-connect-now").click();
  await expect(page.locator("#profile-onboard")).toBeVisible();
  await expect(page.locator("#profile-zip")).toHaveValue(/45103/);
  await expect(page.locator("#handoff-return")).toBeHidden();
  await expect(page.locator("#cart-ready")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Teach Gitter your usual groceries" })).toHaveCount(0);
  await expect(page.locator("#profile-onboard input[type=password]")).toHaveCount(0);
});

test("a connected Kroger return opens receipts and keeps the ZIP", async ({ page }) => {
  await page.addInitScript(() => {
    if (navigator.serviceWorker) {
      navigator.serviceWorker.register = () => Promise.resolve({} as ServiceWorkerRegistration);
    }
  });
  await page.route("**/api/kroger/auth-status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ oauthConfigured: true, connected: false }),
    });
  });
  await page.route("**/api/kroger/connect", async (route) => {
    const here = new URL(page.url());
    here.search = "?kroger=connected&message=Kroger%20connected.";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ authorizeUrl: here.toString() }),
    });
  });
  await unlock(page);
  const status = page.waitForResponse((response) => response.url().includes("/api/kroger/auth-status"));
  await reachStores(page);
  await status;
  await page.locator("#store-connect-now").click();
  await expect(page.getByRole("heading", { name: "Teach Gitter your usual groceries" })).toBeVisible();
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("gg-zip"))).toMatch(/45103/);
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("gg-profile") || "{}").onboarding?.step)).toBe("receipts");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Teach Gitter your usual groceries" })).toBeVisible();
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("gg-zip"))).toMatch(/45103/);
  await expect(page.locator("#profile-onboard input[type=password]")).toHaveCount(0);
});

test("receipt choices stay selected after the guide repaints", async ({ page }) => {
  await page.route("**/api/import/receipt", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        lines: [
          { name: "Milk", quantity: 2 },
          { name: "Whole Milk", quantity: 2 },
          { name: "Eggs", quantity: 1 },
        ],
      }),
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    navigator.serviceWorker.register = () => Promise.resolve({} as ServiceWorkerRegistration);
  });
  await unlock(page);
  await page.evaluate(() =>
    fetch("/api/import/receipt", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
  );
  const guide = page.locator("#gitter-guide");
  await expect(guide).toContainText("I found 3 items that are not on your list yet.");
  await guide.locator("[data-guide-name='Whole Milk']").click();
  await page.waitForTimeout(450);
  await expect(guide.locator("[data-guide-name='Whole Milk']")).toHaveAttribute("aria-pressed", "true");
  await guide.getByRole("button", { name: "Add selected" }).click();
  await expect(page.locator("#bar-count")).toContainText("1");
});

test("a long aisle and in-store list keep a scroll target while work is in flight", async ({ page, browserName }) => {
  const products = (department: string, count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `${department}-${index}`,
      name: `${department} item ${index + 1}`,
      familyName: `${department} item ${index + 1}`,
      brand: "Test",
      imageUrls: [],
      variants: [],
    }));
  let releaseDairy = () => {};
  const dairyHeld = new Promise<void>((resolve) => {
    releaseDairy = resolve;
  });
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
    const department = new URL(route.request().url()).searchParams.get("department") || "produce";
    if (department === "dairy") await dairyHeld;
    const count = department === "dairy" ? 30 : 58;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: products(department, count), total: count, nextCursor: null }),
    });
  });
  await page.route("**/api/optimize-list", async (route) => {
    const items = Array.from({ length: 58 }, (_, index) => ({
      lineId: `walk-${index}`,
      name: index % 2 ? `Dairy yogurt d${index}` : `Produce kale p${index}`,
      price: 1.5,
      quantity: 1,
      itemTotal: 1.5,
      storeName: index % 2 ? "Walmart" : "Kroger",
      department: index % 2 ? "Dairy & Eggs" : "Produce",
    }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        total: 87,
        partial: false,
        pendingStores: [],
        pricingByStore: [
          { storeName: "Kroger", check: "ok" },
          { storeName: "Walmart", check: "ok" },
        ],
        stores: [
          { storeName: "Kroger", subtotal: 45, items: items.filter((item) => item.storeName === "Kroger") },
          { storeName: "Walmart", subtotal: 42, items: items.filter((item) => item.storeName === "Walmart") },
        ],
      }),
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    if (navigator.serviceWorker) {
      navigator.serviceWorker.register = () => Promise.resolve({} as ServiceWorkerRegistration);
    }
    localStorage.setItem(
      "gg-list",
      JSON.stringify(
        Array.from({ length: 58 }, (_, index) => ({
          id: `custom:walk-${index}`,
          itemId: `custom:walk-${index}`,
          name: index % 2 ? `Dairy yogurt d${index}` : `Produce kale p${index}`,
          quantity: 1,
        }))
      )
    );
  });
  await unlock(page);
  await page.locator("#browse-toggle").click();
  await expect(page.locator("#grid .card").nth(10)).toBeVisible();
  const shelfTall = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(shelfTall).toBeGreaterThan(600);
  const aisleScroll = await page.evaluate(() => {
    window.scrollTo(0, 900);
    return window.scrollY;
  });
  expect(aisleScroll).toBeGreaterThan(700);
  await page.locator(".chip[data-dept='dairy']").evaluate((button) => (button as HTMLButtonElement).click());
  await expect(page.locator(".shelf-loading")).toBeVisible();
  const heldScroll = await page.evaluate(() => window.scrollY);
  expect(Math.abs(heldScroll - aisleScroll)).toBeLessThan(8);
  releaseDairy();
  await expect(page.locator("#grid")).toContainText("dairy item 1");
  await expect(page.locator("#grid .card")).toHaveCount(30);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - aisleScroll)).toBeLessThan(24);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(async () => page.evaluate(() => document.getElementById("grid")?.style.minHeight || "")).toBe("");
  const natural = await page.evaluate(() => {
    const grid = document.getElementById("grid");
    return {
      box: grid?.getBoundingClientRect().height || 0,
      scrollHeight: document.documentElement.scrollHeight,
    };
  });
  expect(natural.box).toBeGreaterThan(400);
  expect(natural.scrollHeight - natural.box).toBeLessThan(2500);
  expect(natural.scrollHeight).toBeGreaterThan(natural.box);

  await page.locator("#step-bar [data-flow='plan']").click();
  await page.locator("#step-bar [data-flow='add']").click();
  await expect(page.locator("body")).toHaveAttribute("data-step", "add");
  expect(await page.evaluate(() => document.getElementById("grid")?.style.minHeight || "")).toBe("");
  const revisited = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(revisited - natural.box).toBeLessThan(2500);

  await page.locator("#step-bar [data-flow='plan']").click();
  await expect(page.locator("#trip")).toContainText("Produce kale p0");
  await page.locator("#step-bar [data-flow='shop']").click();
  await expect(page.locator("body")).toHaveAttribute("data-step", "shop");
  await expect(page.getByRole("heading", { name: "Kroger" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Walmart" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Produce" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dairy & Eggs" })).toBeVisible();
  await expect(page.locator(".shop-row")).toHaveCount(58);
  const range = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(range).toBeGreaterThan(600);
  const walked = await page.evaluate(() => {
    const before = window.scrollY;
    window.scrollTo(0, before + 480);
    return { before, after: window.scrollY };
  });
  expect(walked.after - walked.before).toBeGreaterThan(300);
  const tapped = await page.evaluate(() => {
    const row = [...document.querySelectorAll(".shop-row")].find((node) => {
      const box = node.getBoundingClientRect();
      return box.top > 120 && box.bottom < window.innerHeight - 40;
    });
    if (!(row instanceof HTMLElement)) return { ok: false, delta: 999 };
    const before = window.scrollY;
    row.querySelector(".shop-name")?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return { ok: true, delta: Math.abs(window.scrollY - before) };
  });
  expect(tapped.ok).toBe(true);
  expect(tapped.delta).toBeLessThan(80);
  if (browserName === "chromium") {
    const box = await page.locator(".shop-row").nth(12).boundingBox();
    expect(box).toBeTruthy();
    const client = await page.context().newCDPSession(page);
    const x = Math.round((box?.x || 40) + 24);
    const y = Math.round((box?.y || 400) + 16);
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - 220 }] });
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const touched = await page.evaluate(() => window.scrollY);
    expect(Math.abs(touched - walked.after)).toBeGreaterThan(40);
  }
});

test("the import field stays inside the sheet for a keyboard inset", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
  });
  await unlock(page);
  await page.locator("#add-items").click();
  const field = page.locator("#import-paste");
  await field.click();
  const contained = () =>
    page.evaluate(() => {
      const dialog = document.getElementById("import-dialog");
      const input = document.getElementById("import-paste");
      if (!dialog || !input) return { inside: false, dialog: null, field: null };
      const frame = dialog.getBoundingClientRect();
      const rect = input.getBoundingClientRect();
      return {
        inside: rect.top >= frame.top - 1 && rect.bottom <= frame.bottom + 1 && rect.height > 40,
        dialogBottom: frame.bottom,
        fieldBottom: rect.bottom,
      };
    });
  expect((await contained()).inside).toBe(true);
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--keyboard", "320px");
    document.documentElement.style.setProperty("--vv-height", "524px");
  });
  await field.focus();
  const open = await contained();
  expect(open.inside).toBe(true);
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--keyboard", "0px");
    document.documentElement.style.removeProperty("--vv-height");
  });
  expect((await contained()).inside).toBe(true);
});

test("Refine budget stays reachable when the viewport is short", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
  });
  await unlock(page);
  await page.setViewportSize({ width: 390, height: 420 });
  await page.locator("#browse-toggle").click();
  await page.locator("#filters-open").click();
  const filters = page.locator("#filters");
  await filters.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const budget = await page.locator("label:has(#filter-budget)").boundingBox();
  expect(budget).toBeTruthy();
  expect(budget!.y).toBeGreaterThan(0);
  expect(budget!.y + budget!.height).toBeLessThan(430);
});
