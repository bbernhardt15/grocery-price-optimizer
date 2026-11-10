import { expect, test, type Page } from "@playwright/test";

/**
 * Cold Review used to stay on "Checking store prices" after the 22s cap.
 * These two tests wait out that cap. The eight held-refresh gesture checks
 * stay in phoneFlowHeld.spec.ts and are not retimed here.
 */

test.use({ viewport: { width: 390, height: 844 } });

const priced = {
  total: 25.4,
  partial: false,
  pendingStores: [],
  pricingByStore: [
    { storeName: "Kroger", check: "ok", source: "seed" },
    { storeName: "Walmart", check: "ok", source: "seed" },
  ],
  stores: [
    {
      storeName: "Kroger",
      subtotal: 6.4,
      items: [{ lineId: "milk", name: "Milk", title: "Milk", price: 3.2, quantity: 2, itemTotal: 6.4, storeName: "Kroger" }],
    },
    {
      storeName: "Walmart",
      subtotal: 19,
      items: [
        { lineId: "bread", name: "Bread", title: "Bread", price: 3, quantity: 1, itemTotal: 3, storeName: "Walmart" },
        ...Array.from({ length: 16 }, (_, index) => ({
          lineId: `w-${index}`,
          name: `Pantry ${index + 1}`,
          title: `Pantry ${index + 1}`,
          price: 1,
          quantity: 1,
          itemTotal: 1,
          storeName: "Walmart",
        })),
      ],
    },
  ],
};

async function unlock(page: Page) {
  await page.goto("/");
  const invite = page.locator("#beta-code").first();
  if (await invite.isVisible().catch(() => false)) {
    await invite.fill("Brandon-50y4");
    await page.locator("#beta-gate-form button[type=submit]").first().click();
    await expect(page.locator("#beta-gate")).toBeHidden();
  }
}

test("a cold review stops after the timeout and a retry can price it", async ({ page }) => {
  let mode: "hang" | "price" = "hang";
  const waiting: Array<() => void> = [];
  await page.route("**/sw.js", (route) => route.abort());
  await page.route("**/api/optimize-list", async (route) => {
    if (mode === "hang") await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(priced) });
    } catch {
      /* the aborted cold request */
    }
  });
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    navigator.serviceWorker.register = () => Promise.resolve({} as ServiceWorkerRegistration);
    localStorage.setItem("gg-list", JSON.stringify([{ id: "milk", itemId: "milk", name: "Milk", quantity: 1 }]));
  });
  await unlock(page);
  await page.locator("#step-bar [data-flow='plan']").click();
  await expect(page.getByText("Checking store prices")).toBeVisible();
  await expect(page.getByText("This check stopped after 22 seconds.")).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Checking store prices")).toHaveCount(0);
  await expect(page.locator(".savings-callout")).toHaveCount(0);
  await expect(page.locator("[data-store]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try this check again" })).toBeVisible();
  await expect(page.locator(".review-gave-up-list")).toContainText("Milk");
  mode = "price";
  waiting.splice(0).forEach((release) => release());
  await page.getByRole("button", { name: "Try this check again" }).click();
  await expect(page.locator("[data-store='Kroger']")).toContainText("$6.40");
  await expect(page.getByText("No store price came back")).toHaveCount(0);
});

test("a failed price check can be tried again", async ({ page }) => {
  let mode: "fail" | "price" = "fail";
  await page.route("**/sw.js", (route) => route.abort());
  await page.route("**/api/optimize-list", async (route) => {
    if (mode === "fail") {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "nope" }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(priced) });
  });
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    navigator.serviceWorker.register = () => Promise.resolve({} as ServiceWorkerRegistration);
    localStorage.setItem("gg-list", JSON.stringify([{ id: "milk", itemId: "milk", name: "Milk", quantity: 1 }]));
  });
  await unlock(page);
  await page.locator("#step-bar [data-flow='plan']").click();
  await expect(page.getByText("The price check didn't finish.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try this check again" })).toBeVisible();
  mode = "price";
  await page.getByRole("button", { name: "Try this check again" }).click();
  await expect(page.locator("[data-store='Kroger']")).toContainText("$6.40");
});

test("a priced review stays put when a refresh is held past the timeout", async ({ page }) => {
  let hang = false;
  const waiting: Array<() => void> = [];
  await page.route("**/sw.js", (route) => route.abort());
  await page.route("**/api/optimize-list", async (route) => {
    if (hang) await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(priced) });
    } catch {
      /* aborted refresh */
    }
  });
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    navigator.serviceWorker.register = () => Promise.resolve({} as ServiceWorkerRegistration);
    localStorage.setItem(
      "gg-list",
      JSON.stringify([
        { id: "milk", itemId: "milk", name: "Milk", quantity: 2 },
        { id: "bread", itemId: "bread", name: "Bread", quantity: 1 },
      ])
    );
  });
  await unlock(page);
  await page.locator("#step-bar [data-flow='plan']").click();
  await expect(page.locator("[data-store='Kroger']")).toContainText("$6.40");
  await page.evaluate(() => window.scrollTo(0, 400));
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBe(400);
  hang = true;
  await page.locator("#plan-refresh").evaluate((node) => (node as HTMLButtonElement).click());
  await expect(page.locator("[data-review-refresh]")).toContainText("Checking store prices");
  await expect(page.locator("[data-review-refresh]")).toContainText("stopped after 22 seconds", { timeout: 30000 });
  await expect(page.locator("[data-store='Kroger']")).toContainText("$6.40");
  await expect(page.locator("[data-store='Walmart']")).toContainText("Bread");
  expect(await page.evaluate(() => window.scrollY)).toBe(400);
  waiting.splice(0).forEach((release) => release());
});
