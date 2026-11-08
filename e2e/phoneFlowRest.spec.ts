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
  await expect(page.getByRole("button", { name: "Read my receipts" })).toBeVisible();
  release();
  await page.waitForTimeout(1000);
  await expect(page.getByRole("heading", { name: "Here's what we learned" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Read my receipts" })).toBeVisible();
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
  const find = await page.evaluate(() => {
    const dialog = document.getElementById("import-dialog");
    const button = document.getElementById("import-find");
    if (!dialog || !button) return { inside: false };
    const frame = dialog.getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    return { inside: rect.top >= frame.top - 1 && rect.bottom <= frame.bottom + 1 && rect.height >= 40 };
  });
  expect(find.inside).toBe(true);
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
  const priced = await page.locator("label:has(#filter-priced)").boundingBox();
  expect(priced).toBeTruthy();
  expect(priced!.y + priced!.height).toBeLessThan(430);
});

test("favorites is its own screen and a flavor survives reload", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
  });
  await unlock(page);
  await page.locator("#tab-favorites").click();
  await expect(page.locator("#favorites-screen")).toBeVisible();
  await expect(page.locator("#grid")).toBeHidden();
  const next = page.locator("#fav-next");
  for (let step = 0; step < 40; step += 1) {
    if ((await page.locator("#favorites-prefs h3").innerText()) === "Mac and cheese") break;
    await next.click();
  }
  const field = page.locator("#favorites-prefs input");
  await field.fill("Kraft Original");
  await field.blur();
  await page.screenshot({ path: "/opt/cursor/artifacts/favorites-flavor.png", fullPage: false });
  await page.reload();
  await page.locator("#tab-favorites").click();
  for (let step = 0; step < 40; step += 1) {
    if ((await page.locator("#favorites-prefs h3").innerText()) === "Mac and cheese") break;
    await page.locator("#fav-next").click();
  }
  await expect(page.locator("#favorites-prefs input")).toHaveValue("Kraft Original");
  await page.locator("#favorites-close").click();
  await expect(page.locator("#favorites-screen")).toBeHidden();
});

test("themed Add keeps every slot on the list when the shelf misses", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
  });
  await page.route("**/api/catalog/browse**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) })
  );
  await unlock(page);
  await page.locator("[data-lists-open]").click();
  const cookout = page.locator("[data-list-open='cookout']");
  if (!(await cookout.isVisible().catch(() => false))) await page.locator("[data-lists-all]").click();
  await cookout.click();
  await page.locator("[data-sheet-add='cookout']").click();
  await expect(page.locator("#bar-count")).not.toHaveText("0 items");
  const names = await page.evaluate(() => (JSON.parse(localStorage.getItem("gg-list") || "[]") as Array<{ name?: string }>).map((row) => row.name || ""));
  expect(names.length).toBeGreaterThanOrEqual(4);
  expect(names.join(" ").toLowerCase()).toMatch(/bun|chip|soda|beef|ketchup/);
  await page.screenshot({ path: "/opt/cursor/artifacts/themed-add-included.png", fullPage: false });
});

test("past trips can be selected and added without opening Review", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem(
      "gg-past-trips",
      JSON.stringify([
        { id: "trip-a", at: Date.now(), totalCents: 500, savedCents: 0, stores: [{ storeName: "Kroger", totalCents: 500, items: [{ name: "Milk", quantity: 1 }, { name: "Eggs", quantity: 1 }] }] },
        { id: "trip-b", at: Date.now() - 1000, totalCents: 300, savedCents: 0, stores: [{ storeName: "Walmart", totalCents: 300, items: [{ name: "Bread", quantity: 1 }] }] },
      ])
    );
  });
  await unlock(page);
  await page.locator("#menu-open").click();
  await page.locator("#menu-past").click();
  await page.locator("[data-trip-select]").nth(0).check();
  await page.locator("[data-trip-select]").nth(1).check();
  await page.locator("#past-add-selected").click();
  await expect(page.locator("#bar-count")).toContainText("3");
  await expect.poll(() => page.evaluate(() => document.body.dataset.step)).toBe("add");
});

test("store editor saves and stays with an 85 item trip", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem(
      "gg-list",
      JSON.stringify(Array.from({ length: 85 }, (_, index) => ({ id: `custom:trip-${index}`, itemId: `custom:trip-${index}`, name: `Trip item ${index + 1}`, quantity: 1 })))
    );
    localStorage.setItem(
      "gg-profile",
      JSON.stringify({
        version: 1,
        updatedAt: Date.now(),
        onboarding: { status: "done", step: "summary", updatedAt: Date.now() },
        shopStores: ["Kroger", "Walmart"],
        categoryPreferences: {},
      })
    );
  });
  await unlock(page);
  await expect(page.locator("#bar-count")).toContainText("85");
  await page.locator("#menu-open").click();
  await page.locator("#drawer-profile").click();
  const stores = page.locator("#profile-onboard section", { hasText: "Stores" });
  await expect(stores).toContainText(/Kroger|All nearby stores/);
  await expect(stores).not.toContainText("Not set yet");
  await stores.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("heading", { name: "Get started" })).toHaveCount(0);
  await expect(page.locator("#profile-store-list input").first()).toBeVisible();
  const walmart = page.locator("[data-place-store='Walmart']");
  await expect(walmart).toBeVisible();
  if (await walmart.isChecked()) await walmart.uncheck();
  await page.screenshot({ path: "/opt/cursor/artifacts/profile-stores-edit.png", fullPage: false });
  await page.locator("#profile-next").click();
  await expect(stores).toContainText("Kroger");
  await expect(stores).not.toContainText("Walmart");
  await page.locator("#profile-back").click();
  await expect(page.locator("#profile-onboard")).toBeHidden();
  await page.reload();
  await expect(page.locator("#bar-count")).toContainText("85");
  await page.locator("#menu-open").click();
  await page.locator("#drawer-profile").click();
  await expect(page.locator("#profile-onboard section", { hasText: "Stores" })).toContainText(/Kroger/);
});

test("Build keeps the count and hides Review your trip", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem(
      "gg-list",
      JSON.stringify(Array.from({ length: 85 }, (_, index) => ({ id: `custom:trip-${index}`, itemId: `custom:trip-${index}`, name: `Trip item ${index + 1}`, quantity: index === 0 ? 8 : 1 })))
    );
  });
  await unlock(page);
  await expect(page.locator("#bar-count")).toContainText("92 units · 85 lines");
  await expect(page.locator("#bar-primary")).toBeHidden();
  await expect(page.locator("#step-bar [data-flow='plan']")).toBeVisible();
});

test("a Walmart match stays in that cart through save, reload, and a new plan", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    navigator.serviceWorker.register = () => Promise.resolve({} as ServiceWorkerRegistration);
    if (!localStorage.getItem("gg-list")) {
      localStorage.setItem(
        "gg-list",
        JSON.stringify([
          { id: "milk", itemId: "milk", name: "Milk", quantity: 2 },
          { id: "custom:eggs", itemId: "custom:eggs", name: "Eggs", quantity: 1 },
        ])
      );
    }
  });
  const plan = {
    total: 6.4,
    partial: false,
    pendingStores: [],
    unavailable: ["Eggs"],
    stores: [
      { storeName: "Kroger", items: [{ lineId: "milk", name: "Milk", title: "Milk", price: 3.2, quantity: 2, itemTotal: 6.4, storeName: "Kroger" }] },
      { storeName: "Walmart", items: [{ lineId: "milk-w", name: "Milk", title: "Milk", price: 3.4, quantity: 2, itemTotal: 6.8, storeName: "Walmart" }] },
    ],
  };
  await page.route("**/api/optimize-list", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(plan) });
  });
  await page.route("**/api/catalog/browse**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "gv-eggs",
            name: "Large Eggs",
            familyName: "Large Eggs",
            brand: "Great Value",
            offers: [
              { storeName: "Walmart", price: 1.98 },
              { storeName: "Kroger", price: 2.19 },
            ],
          },
        ],
      }),
    });
  });
  await unlock(page);
  await page.locator("#step-bar [data-flow='plan']").click();
  await expect(page.locator("[data-match-search='Eggs'][data-match-store='Walmart']")).toBeVisible();
  await page.evaluate(() => {
    const pad = document.createElement("div");
    pad.id = "scroll-pad";
    pad.style.height = "1400px";
    document.body.append(pad);
    window.scrollTo(0, 640);
  });
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(400);
  await page.locator("[data-match-search='Eggs'][data-match-store='Walmart']").evaluate((node) => (node as HTMLButtonElement).click());
  await expect(page.locator("#match-sheet")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(before + 80);
  await expect.poll(() => page.evaluate(() => Math.abs(window.scrollY - 640) < 80)).toBe(true);
  await page.locator("#match-close").click();
  await expect.poll(() => page.evaluate(() => Math.abs(window.scrollY - 640) < 80)).toBe(true);
  await page.locator("[data-match-search='Eggs'][data-match-store='Walmart']").evaluate((node) => (node as HTMLButtonElement).click());
  await page.getByRole("button", { name: /Great Value/ }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("gg-list") || "[]").some((row: { preferredStore?: string }) => row.preferredStore === "Walmart"))).toBe(true);
  await page.reload();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("gg-list") || "[]").some((row: { preferredStore?: string }) => row.preferredStore === "Walmart"))).toBe(true);
  await page.locator("#step-bar [data-flow='plan']").click();
  const walmart = page.locator("#trip [data-store='Walmart']");
  await expect(walmart).toContainText(/Great Value|Large Eggs/);
  await expect(walmart).toContainText("1.98");
  await expect(page.locator("#trip [data-store='Kroger']")).not.toContainText("Great Value");
  await expect(page.locator("[data-unfound]")).toHaveCount(0);
  await page.screenshot({ path: "/opt/cursor/artifacts/walmart-egg-cart.png", fullPage: false });
});

test("a saved soda flavor replaces the themed default and an empty shelf", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    navigator.serviceWorker.register = () => Promise.resolve({} as ServiceWorkerRegistration);
    localStorage.setItem(
      "gg-profile",
      JSON.stringify({
        version: 1,
        updatedAt: Date.now(),
        onboarding: { status: "done", step: "summary", updatedAt: Date.now() },
        shopStores: ["Kroger"],
        categoryPreferences: { soda: { family: "soda", mode: "brand", brand: "Coca-Cola", variant: "Cherry Coke", source: "manual", updatedAt: Date.now() } },
      })
    );
  });
  await page.route("**/api/catalog/browse**", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q") || "";
    const cherry = /cherry/i.test(query);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: /soda|coke|cola|cherry/i.test(query)
          ? [
              cherry
                ? { id: "cherry-coke", name: "Coca-Cola Cherry", brand: "Coca-Cola", familyName: "Coca-Cola Cherry", catalogName: "Coca-Cola Cherry", departmentId: "beverages", subcategory: "Soda", offers: [{ storeName: "Kroger", price: 6.48 }] }
                : { id: "classic-coke", name: "Coca-Cola Classic 12 Pack", brand: "Coca-Cola", familyName: "Coca-Cola Classic", catalogName: "Coca-Cola Classic", departmentId: "beverages", subcategory: "Soda", offers: [{ storeName: "Kroger", price: 7.28 }] },
            ]
          : [],
      }),
    });
  });
  await unlock(page);
  await page.locator("#tab-favorites").click();
  await expect(page.locator("#favorites-screen")).toContainText("Aisle 1 of");
  await page.screenshot({ path: "/opt/cursor/artifacts/favorites-wizard.png", fullPage: false });
  await page.locator("#favorites-close").click();
  await page.locator("[data-lists-open]").click();
  const tailgate = page.locator("[data-list-open='tailgate']");
  if (!(await tailgate.isVisible().catch(() => false))) await page.locator("[data-lists-all]").click();
  await tailgate.click();
  await expect(page.locator("#list-sheet")).toContainText("Cherry Coke");
  await page.locator("[data-sheet-add='tailgate']").click();
  await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem("gg-list") || "[]") as Array<{ name?: string }>).map((row) => row.name || "").join(" | "))).toMatch(/cherry/i);
  const names = await page.evaluate(() => (JSON.parse(localStorage.getItem("gg-list") || "[]") as Array<{ name?: string }>).map((row) => row.name || ""));
  expect(names.join(" ")).not.toMatch(/Coca-Cola Classic/);
});

test("four receipt suggestions can be selected and added", async ({ page }) => {
  await page.route("**/api/import/receipt", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        lines: [
          { name: "Whole Milk", quantity: 1 },
          { name: "Sourdough", quantity: 1 },
          { name: "Cherry Coke", quantity: 1 },
          { name: "Sharp Cheddar", quantity: 1 },
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
  await page.evaluate(() => fetch("/api/import/receipt", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
  const guide = page.locator("#gitter-guide");
  await expect(guide).toContainText("I found 4 items that are not on your list yet.");
  for (const name of ["Whole Milk", "Sourdough", "Cherry Coke", "Sharp Cheddar"]) {
    await guide.locator(`[data-guide-name='${name}']`).click();
    await expect(guide.locator(`[data-guide-name='${name}']`)).toHaveAttribute("aria-pressed", "true");
  }
  await guide.getByRole("button", { name: "Add selected" }).click();
  await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem("gg-list") || "[]") as Array<{ name?: string }>).map((row) => row.name))).toEqual(
    expect.arrayContaining(["Whole Milk", "Sourdough", "Cherry Coke", "Sharp Cheddar"])
  );
  await page.reload();
  await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem("gg-list") || "[]") as Array<{ name?: string }>).map((row) => row.name))).toEqual(
    expect.arrayContaining(["Whole Milk", "Sourdough", "Cherry Coke", "Sharp Cheddar"])
  );
  await page.screenshot({ path: "/opt/cursor/artifacts/receipt-four-added.png", fullPage: false });
});

test("an eight item import review can reach the last row and the add button", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.serviceWorker.register = () => Promise.resolve({} as ServiceWorkerRegistration);
  });
  await page.route("**/api/import/text", async (route) => {
    const items = Array.from({ length: 8 }, (_, index) => ({
      key: `row-${index}`,
      raw: `Photo item ${index + 1}`,
      name: `Photo item ${index + 1}`,
      status: "found",
      accepted: true,
      selectedId: `prod-${index}`,
      choices: [{ product: { id: `prod-${index}`, name: `Photo item ${index + 1}`, brand: "Store", offers: [{ storeName: "Kroger", price: 1 + index }] } }],
    }));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, found: 8, total: 8 }) });
  });
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
  });
  await unlock(page);
  await page.locator("#add-items").click();
  await page.locator("#import-paste").fill("milk\nbread\neggs\ncheese\napples\nchips\nsoda\ncoffee");
  await page.locator("#import-find").click();
  await expect(page.locator("#import-dialog")).toContainText("Found 8 of 8");
  const review = page.locator("#import-review");
  const last = page.locator("[data-key='row-7']");
  await review.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(last).toBeVisible();
  const fit = await page.evaluate(() => {
    const dialog = document.getElementById("import-dialog");
    const button = document.getElementById("import-accept");
    const row = document.querySelector("[data-key='row-7']");
    if (!dialog || !button || !row) return { button: false, row: false };
    const frame = dialog.getBoundingClientRect();
    const buttonBox = button.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    return {
      button: buttonBox.top >= frame.top && buttonBox.bottom <= frame.bottom + 1,
      row: rowBox.bottom <= frame.bottom + 1 && rowBox.top >= frame.top,
    };
  });
  expect(fit.button).toBe(true);
  expect(fit.row).toBe(true);
});

test("unresolved rows remove by swipe or button and can be undone", async ({ page, browserName }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    navigator.serviceWorker.register = () => Promise.resolve({} as ServiceWorkerRegistration);
    localStorage.setItem("gg-list", JSON.stringify([{ id: "custom:eggs", itemId: "custom:eggs", name: "Eggs", quantity: 1 }, { id: "milk", itemId: "milk", name: "Milk", quantity: 1 }]));
  });
  await page.route("**/api/optimize-list", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        total: 3.2,
        partial: false,
        pendingStores: [],
        unavailable: ["Eggs"],
        stores: [
          { storeName: "Kroger", items: [{ lineId: "milk", name: "Milk", title: "Milk", price: 3.2, quantity: 1, itemTotal: 3.2, storeName: "Kroger" }] },
          { storeName: "Walmart", items: [{ lineId: "milk-w", name: "Milk", title: "Milk", price: 3.4, quantity: 1, itemTotal: 3.4, storeName: "Walmart" }] },
        ],
      }),
    });
  });
  await unlock(page);
  await page.locator("#step-bar [data-flow='plan']").click();
  const row = page.locator("[data-swipe='1']");
  await expect(row).toContainText("Eggs");
  await page.locator("[data-missing-remove='Eggs']").click();
  await expect(page.locator("[data-unfound]")).toHaveCount(0);
  await page.locator("#toast-action").click();
  await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem("gg-list") || "[]") as Array<{ name?: string }>).some((row) => /egg/i.test(row.name || "")))).toBe(true);
  await expect(page.locator("[data-unfound]")).toContainText("Eggs");
  if (browserName === "webkit") {
    await page.evaluate(() => {
      const target = document.querySelector("[data-swipe='1'] p");
      if (!(target instanceof HTMLElement)) return;
      const rect = target.getBoundingClientRect();
      const startX = rect.left + 24;
      const y = rect.top + 10;
      target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: startX, clientY: y }));
      window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: startX - 140, clientY: y }));
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: startX - 140, clientY: y }));
    });
  } else {
    const box = await row.boundingBox();
    expect(box).toBeTruthy();
    const startX = (box?.x || 0) + 48;
    const y = (box?.y || 0) + 18;
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX - 140, y, { steps: 10 });
    await page.mouse.up();
  }
  await expect(page.locator("[data-unfound]")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem("gg-list") || "[]") as Array<{ name?: string }>).some((row) => /egg/i.test(row.name || "")))).toBe(false);
});

test("Refine checkboxes stay clickable while the guide is up", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem("gg-list", JSON.stringify([{ id: "custom:milk", itemId: "custom:milk", name: "Milk", quantity: 1 }]));
  });
  await unlock(page);
  await page.locator("#browse-toggle").click();
  await page.locator("#filters-open").click();
  await expect(page.locator("#gitter-guide")).toBeHidden();
  await page.locator("#filter-mine").check();
  await expect(page.locator("#filter-mine")).toBeChecked();
});

test("saving with no store selected explains the choice", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem(
      "gg-profile",
      JSON.stringify({ version: 1, updatedAt: Date.now(), onboarding: { status: "done", step: "summary", updatedAt: Date.now() }, shopStores: ["Kroger", "Walmart"], categoryPreferences: {} })
    );
  });
  await unlock(page);
  await page.locator("#menu-open").click();
  await page.locator("#drawer-profile").click();
  await page.locator("#profile-onboard section", { hasText: "Stores" }).getByRole("button", { name: "Edit" }).click();
  await expect(page.locator("#profile-store-list input").first()).toBeVisible();
  await page.locator("#profile-store-list input").evaluateAll((boxes) => {
    for (const box of boxes) (box as HTMLInputElement).checked = false;
  });
  await page.locator("#profile-next").click();
  await expect(page.locator("#profile-zip-error")).toContainText("Pick at least one store");
  await expect(page.locator("#profile-zip-error")).not.toContainText("still loading");
  await page.locator("#profile-back").click();
  await expect(page.locator("#profile-onboard")).toContainText("Stores");
});

test("soda flavor chips persist and apply to search and the tailgate list", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    navigator.serviceWorker.register = () => Promise.resolve({} as ServiceWorkerRegistration);
  });
  await page.route("**/api/catalog/browse**", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q") || "";
    const soda = /soda|coke|cola|cherry/i.test(query);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: soda
          ? [
              { id: "classic-coke", name: "Coca-Cola Classic 12 Pack", brand: "Coca-Cola", familyName: "Coca-Cola Classic", catalogName: "Coca-Cola Classic", departmentId: "beverages", subcategory: "Soda", offers: [{ storeName: "Kroger", price: 7.28 }] },
              { id: "cherry-coke", name: "Coca-Cola Cherry", brand: "Coca-Cola", familyName: "Coca-Cola Cherry", catalogName: "Coca-Cola Cherry", departmentId: "beverages", subcategory: "Soda", offers: [{ storeName: "Kroger", price: 6.48 }] },
            ]
          : [],
      }),
    });
  });
  await unlock(page);
  if (await page.locator("#gitter-guide [data-guide-off]").isVisible().catch(() => false)) {
    await page.locator("#gitter-guide [data-guide-off]").evaluate((button) => (button as HTMLButtonElement).click());
  }
  await page.locator("#tab-favorites").evaluate((button) => (button as HTMLButtonElement).click());
  for (let step = 0; step < 45; step += 1) {
    if ((await page.locator("#favorites-prefs h3").innerText()) === "Soda") break;
    await page.locator("#fav-next").evaluate((button) => (button as HTMLButtonElement).click());
  }
  await expect(page.locator("#favorites-prefs h3")).toHaveText("Soda");
  for (const label of ["Classic", "Cherry", "Vanilla", "Diet", "Zero"]) {
    await expect(page.locator(`[data-fav-flavor]` , { hasText: label }).first()).toBeVisible();
  }
  await page.locator("[data-fav-flavor='cherry']").click();
  await expect(page.locator("[data-fav-flavor='cherry']")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#favorites-prefs input")).toHaveValue("Cherry");
  await page.locator("#favorites-prefs input").fill("Cherry Coke");
  await page.locator("#favorites-prefs input").blur();
  await expect(page.locator("#favorites-prefs input")).toHaveValue("Cherry Coke");
  await page.reload();
  await page.locator("#tab-favorites").evaluate((button) => (button as HTMLButtonElement).click());
  for (let step = 0; step < 45; step += 1) {
    if ((await page.locator("#favorites-prefs h3").innerText()) === "Soda") break;
    await page.locator("#fav-next").evaluate((button) => (button as HTMLButtonElement).click());
  }
  await expect(page.locator("[data-fav-flavor='cherry']")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#favorites-prefs input")).toHaveValue("Cherry Coke");
  await page.locator("#favorites-close").evaluate((button) => (button as HTMLButtonElement).click());
  await page.locator("#search").evaluate((input) => {
    const field = input as HTMLInputElement;
    field.value = "soda";
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator("#search-form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
  await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem("gg-list") || "[]") as Array<{ name?: string }>).map((row) => row.name || "").join(" | "))).toMatch(/cherry/i);
  const searched = await page.evaluate(() => (JSON.parse(localStorage.getItem("gg-list") || "[]") as Array<{ name?: string }>).map((row) => row.name || "").join(" "));
  expect(searched).not.toMatch(/Coca-Cola Classic/);
  await page.locator("[data-lists-open]").evaluate((button) => (button as HTMLButtonElement).click());
  if (!(await page.locator("[data-list-open='tailgate']").count())) {
    await page.locator("[data-lists-all]").evaluate((button) => (button as HTMLButtonElement).click());
  }
  await page.locator("[data-list-open='tailgate']").evaluate((button) => (button as HTMLButtonElement).click());
  await expect(page.locator("#list-sheet")).toContainText(/Cherry Coke|Cherry/i);
});

test("undo inside the open list keeps the header clear and expires", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem("gg-list", JSON.stringify([{ id: "custom:milk", itemId: "custom:milk", name: "Milk", quantity: 1 }]));
  });
  await unlock(page);
  if (await page.locator("#gitter-guide [data-guide-off]").isVisible().catch(() => false)) {
    await page.locator("#gitter-guide [data-guide-off]").evaluate((button) => (button as HTMLButtonElement).click());
  }
  await page.locator("#list-toggle").evaluate((button) => (button as HTMLButtonElement).click());
  await expect(page.locator("#list-panel")).toHaveClass(/open/);
  await page.locator("[data-list-remove]").click();
  const toast = page.locator("#toast.show");
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("Removed from list");
  const overlap = await page.evaluate(() => {
    const toastBox = document.getElementById("toast")?.getBoundingClientRect();
    const closeBox = document.getElementById("list-close")?.getBoundingClientRect();
    const titleBox = document.querySelector("#list-panel h2")?.getBoundingClientRect();
    const hits = (a?: DOMRect, b?: DOMRect) => Boolean(a && b && a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right);
    return {
      close: hits(toastBox, closeBox),
      title: hits(toastBox, titleBox),
      place: document.getElementById("toast")?.dataset.place || "",
    };
  });
  expect(overlap.place).toBe("sheet");
  expect(overlap.close).toBe(false);
  expect(overlap.title).toBe(false);
  await page.locator("#toast-action").click();
  await expect(page.locator("#list-items")).toContainText("Milk");
  await page.clock.install();
  await page.locator("[data-list-remove]").click();
  await expect(page.locator("#toast.show")).toBeVisible();
  await page.clock.fastForward(4400);
  await expect(page.locator("#toast.show")).toBeVisible();
  await page.clock.fastForward(200);
  await expect(page.locator("#toast.show")).toHaveCount(0);
});
