import { expect, test, type Page } from "@playwright/test";

/**
 * The independent v61 audit on 2bf9831. Before the anchor fix, WebKit recorded:
 * pointer 160 during 160 after 0; pointer 260 during 260 after 0;
 * wheel 160 during 160 after 0; wheel 260 during 260 after 0.
 * A non-gesture scroll during the guard stayed at 400.
 * Match open/close stayed at 2200. After the egg pick the page max scroll was 2081.
 */

test.use({ viewport: { width: 390, height: 844 } });

const eggs = [
  { id: "egg-k", name: "Kroger Large Eggs", familyName: "Kroger Large Eggs", brand: "Kroger", offers: [{ storeName: "Kroger", price: 2.19 }] },
  { id: "gv-eggs", name: "Large Eggs", familyName: "Large Eggs", brand: "Great Value", offers: [{ storeName: "Walmart", price: 1.98 }] },
];

function fillers() {
  return Array.from({ length: 16 }, (_, index) => ({
    lineId: `w-${index}`,
    name: `Pantry ${index + 1}`,
    title: `Pantry ${index + 1}`,
    price: 1,
    quantity: 1,
    itemTotal: 1,
    storeName: "Walmart",
  }));
}

function plan() {
  return {
    total: 8,
    partial: false,
    pendingStores: [],
    unavailable: ["Eggs", "Bloom soda"],
    stores: [
      {
        storeName: "Kroger",
        subtotal: 6.4,
        items: [{ lineId: "milk", name: "Milk", title: "Milk", price: 3.2, quantity: 2, itemTotal: 6.4, storeName: "Kroger" }],
      },
      {
        storeName: "Walmart",
        subtotal: 19,
        items: [{ lineId: "b", name: "Bread", title: "Bread", price: 3, quantity: 1, itemTotal: 3, storeName: "Walmart" }, ...fillers()],
      },
    ],
  };
}

async function unlock(page: Page) {
  await page.goto("/");
  const invite = page.locator("#beta-code").first();
  if (await invite.isVisible().catch(() => false)) {
    await invite.fill("Brandon-50y4");
    await page.locator("#beta-gate-form button[type=submit]").first().click();
    await expect(page.locator("#beta-gate")).toBeHidden();
  }
}

test("auditor held refresh keeps a pointer or wheel scroll when the plan arrives", async ({ page }) => {
  let release = () => {};
  let hold = false;
  await page.route("**/sw.js", (route) => route.abort());
  await page.route("**/api/catalog/browse**", (route) => {
    const url = new URL(route.request().url());
    const query = (url.searchParams.get("q") || "").toLowerCase();
    const store = (url.searchParams.get("store") || "").toLowerCase();
    if (query.includes("egg")) {
      const items = eggs.filter((item) => !store || item.offers.some((offer) => offer.storeName.toLowerCase() === store));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], total: 0 }) });
  });
  await page.route("**/api/optimize-list", async (route) => {
    if (hold) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(plan()) });
  });
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    navigator.serviceWorker.register = () => Promise.resolve({} as ServiceWorkerRegistration);
    localStorage.setItem(
      "gg-list",
      JSON.stringify([
        { id: "milk", itemId: "milk", name: "Milk", quantity: 2 },
        { id: "custom:eggs", itemId: "custom:eggs", name: "Eggs", quantity: 1 },
      ])
    );
  });
  await unlock(page);
  await page.locator("#step-bar [data-flow='plan']").click();
  await page.locator("[data-store='Kroger']").waitFor();
  await page.locator("#trip details.store-fold").evaluateAll((nodes) => {
    for (const node of nodes) (node as HTMLDetailsElement).open = true;
  });
  await page.evaluate(() => window.scrollTo(0, 2200));
  const deep = await page.evaluate(() => window.scrollY);
  expect(deep).toBeGreaterThan(1400);
  for (let pass = 0; pass < 2; pass += 1) {
    const before = await page.evaluate(() => window.scrollY);
    await page.locator("[data-match-search='Eggs'][data-match-store='Walmart']").evaluate((node) => (node as HTMLElement).click());
    await page.waitForTimeout(200);
    const open = await page.evaluate(() => window.scrollY);
    await page.locator("#match-close").click();
    await page.waitForTimeout(150);
    const closed = await page.evaluate(() => window.scrollY);
    expect(before).toBe(deep);
    expect(open).toBe(deep);
    expect(closed).toBe(deep);
  }
  await page.locator("[data-match-search='Eggs'][data-match-store='Walmart']").evaluate((node) => (node as HTMLElement).click());
  await page.getByRole("button", { name: /Great Value/ }).click();
  await page.waitForTimeout(700);
  const picked = await page.evaluate(() => ({
    y: window.scrollY,
    max: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
  }));
  expect(picked.max).toBeLessThan(deep);
  expect(picked.y).toBe(picked.max);

  for (const [kind, target] of [
    ["pointer", 160],
    ["pointer", 260],
    ["wheel", 160],
    ["wheel", 260],
  ] as const) {
    hold = true;
    await page.evaluate(() => window.scrollTo(0, 400));
    const before = await page.evaluate(() => window.scrollY);
    await page.locator("#plan-refresh").evaluate((node) => (node as HTMLButtonElement).click());
    await page.waitForTimeout(120);
    await page.evaluate(() => window.scrollTo(0, 90));
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 1500 }).toBe(400);
    const snapped = await page.evaluate(() => window.scrollY);
    await page.evaluate(
      ([mode, y]) => {
        if (mode === "wheel") document.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 80 }));
        else document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, clientX: 30, clientY: 300 }));
        window.scrollTo(0, y);
      },
      [kind, target] as const
    );
    await page.waitForTimeout(280);
    const during = await page.evaluate(() => window.scrollY);
    release();
    hold = false;
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => window.scrollY);
    expect(before).toBe(400);
    expect(snapped).toBe(400);
    expect(during).toBe(target);
    expect(after).toBe(target);
  }
});

test("a picked match shows in that cart before the price check returns", async ({ page }) => {
  let release = () => {};
  let started = () => {};
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route("**/sw.js", (route) => route.abort());
  await page.route("**/api/catalog/browse**", (route) => {
    const url = new URL(route.request().url());
    const query = (url.searchParams.get("q") || "").toLowerCase();
    const store = (url.searchParams.get("store") || "").toLowerCase();
    if (query.includes("egg")) {
      const items = eggs.filter((item) => !store || item.offers.some((offer) => offer.storeName.toLowerCase() === store));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], total: 0 }) });
  });
  let heldPlans = 0;
  await page.route("**/api/optimize-list", async (route) => {
    heldPlans += 1;
    if (heldPlans === 1) {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    } else {
      await new Promise<void>(() => {});
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(plan()) });
  });
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    navigator.serviceWorker.register = () => Promise.resolve({} as ServiceWorkerRegistration);
    localStorage.setItem(
      "gg-list",
      JSON.stringify([
        { id: "milk", itemId: "milk", name: "Milk", quantity: 2 },
        { id: "custom:eggs", itemId: "custom:eggs", name: "Eggs", quantity: 1 },
      ])
    );
  });
  await unlock(page);
  await page.locator("#step-bar [data-flow='plan']").click();
  await ready;
  release();
  await page.locator("[data-store='Walmart'] .review-lines").waitFor({ state: "attached" });
  const before = await page.evaluate(() => window.scrollY);
  await page.locator("[data-match-search='Eggs'][data-match-store='Walmart']").evaluate((node) => (node as HTMLElement).click());
  await page.getByRole("button", { name: /Great Value/ }).click();
  await expect(page.locator("[data-store='Walmart'] [data-picked-line]")).toContainText("Large Eggs");
  await expect(page.locator("[data-unfound]")).not.toContainText("Eggs");
  const after = await page.evaluate(() => window.scrollY);
  expect(Math.abs(after - before)).toBeLessThan(8);
});
