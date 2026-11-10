import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, isMobile: false, hasTouch: true });

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
          department: "Pantry",
        })),
      },
    ],
  };
}

test("a real wheel scroll during a held refresh survives the plan redraw", async ({ page }) => {
  let release = () => {};
  let gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route("**/sw.js", (route) => route.abort());
  await page.route("**/api/optimize-list", async (route) => {
    calls += 1;
    if (calls === 1) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(longPlan(80)) });
      return;
    }
    await gate;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(longPlan(80)) });
  });
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    navigator.serviceWorker.register = () => Promise.resolve({} as ServiceWorkerRegistration);
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
  await page.locator("#step-bar [data-flow='plan']").click();
  await expect(page.locator("#trip [data-review-line='line-20']")).toBeAttached();
  await page.locator("#trip details.store-fold").evaluate((node) => {
    (node as HTMLDetailsElement).open = true;
  });
  for (const distance of [160, 260]) {
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.locator("#plan-refresh").evaluate((button) => (button as HTMLButtonElement).click());
    await expect(page.locator("[data-review-refresh]")).toBeVisible();
    await page.waitForTimeout(700);
    await page.mouse.move(180, 520);
    await page.mouse.wheel(0, distance);
    await page.waitForTimeout(200);
    const pending = await page.evaluate(() => window.scrollY);
    expect(pending).toBeGreaterThan(80);
    release();
    await expect(page.locator("[data-review-refresh]")).toHaveCount(0);
    await expect(page.locator("#trip details.store-fold")).toHaveJSProperty("open", true);
    const samples = await page.evaluate(async () => {
      const values: number[] = [];
      const start = performance.now();
      while (performance.now() - start < 800) {
        values.push(window.scrollY);
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      }
      return values;
    });
    expect(Math.min(...samples)).toBeGreaterThan(80);
    expect(Math.abs(samples[samples.length - 1] - pending)).toBeLessThan(48);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(800);
  }
});
