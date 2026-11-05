import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const digital = path.join(process.cwd(), "e2e/fixtures/digital-order.png");
const paper = path.join(process.cwd(), "e2e/fixtures/paper-receipt.png");
const unreadable = path.join(process.cwd(), "e2e/fixtures/vision-fail.png");

async function unlock(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Enter your invite code" })).toBeVisible();
  await page.locator("#beta-code").first().fill("Brandon-50y4");
  await page.locator("#beta-gate-form button[type=submit]").first().click();
  await expect(page.locator("#beta-gate")).toBeHidden();
}

test("photo import reads an order, flags a paper receipt, and explains a failure", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await unlock(page);
  await page.locator("#browse-toggle").click();
  await page.locator("#ask-import").click();
  await expect(page.locator("#import-photo")).toBeVisible();
  await expect(page.locator("#import-photo-note")).toBeHidden();

  await page.locator("#import-photo-input").setInputFiles(digital);
  await expect(page.locator("#import-review")).toContainText(/milk/i);
  await expect(page.locator("#import-review")).toContainText(/eggs/i);
  await expect(page.locator("[data-paper-note]")).toHaveCount(0);
  await expect(page.locator("#import-status")).not.toContainText("isn't switched on");

  await page.locator("#import-back").click();
  await page.locator("#import-photo-input").setInputFiles(paper);
  await expect(page.locator("[data-paper-note]")).toContainText(/shortened/);
  await expect(page.locator("#import-review")).toContainText(/milk/i);
  await expect(page.locator("#import-status")).not.toContainText("isn't switched on");

  await page.locator("#import-back").click();
  await page.locator("#import-photo-input").setInputFiles(unreadable);
  await expect(page.locator("#import-status")).toContainText(/didn't answer/i);
  await expect(page.locator("#import-status")).not.toContainText("isn't switched on");
  expect(errors).toEqual([]);
});

test.describe("price alerts on a wide screen", () => {
  test.use({ viewport: { width: 1200, height: 800 }, isMobile: false, hasTouch: false });

  test("the price alert toggle subscribes this device and a test push is sent", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.context().grantPermissions(["notifications"]);
  await page.addInitScript(() => {
    const subscription = {
      endpoint: "https://push.example/this-browser",
      toJSON() {
        return { endpoint: this.endpoint, keys: { p256dh: "e2e-p256", auth: "e2e-auth" } };
      },
    };
    const registration = {
      pushManager: {
        subscribe: async () => subscription,
        getSubscription: async () => null,
      },
      update: () => Promise.resolve(),
    };
    const fake = {
      ready: Promise.resolve(registration),
      controller: {},
      register: async () => registration,
      getRegistration: async () => registration,
      addEventListener() {},
    };
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, get: () => fake });
    if (typeof Notification !== "undefined") {
      Object.defineProperty(Notification, "permission", { configurable: true, get: () => "granted" });
      Notification.requestPermission = async () => "granted";
    }
  });
  await unlock(page);
  const dismiss = page.getByRole("button", { name: "Dismiss guide" });
  if (await dismiss.isVisible()) await dismiss.click();
  await expect(page.locator("#list-alert-block")).toBeVisible();
  await expect(page.locator("#list-alerts")).toBeEnabled();
  const subscribed = page.waitForResponse(
    (response) => response.url().includes("/api/price-alerts/push") && response.request().method() === "POST",
    { timeout: 20_000 }
  );
  await page.locator("#list-alerts").check();
  expect((await subscribed).status()).toBe(200);
  await expect(page.locator("#list-alerts")).toBeChecked();

  const result = await page.evaluate(async () => {
    const sent = await fetch("/api/e2e/push-test", { method: "POST" });
    const body = (await sent.json()) as { sent?: number; error?: string };
    const log = await fetch("/api/e2e/push-log");
    const recorded = (await log.json()) as { sent?: Array<{ title?: string }> };
    return { ok: sent.ok, body, recorded };
  });
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  expect(result.body.sent).toBe(1);
  expect(result.recorded.sent?.map((row) => row.title)).toEqual(["Price drop: Test item"]);
  expect(JSON.stringify(result)).not.toContain("test-private");
  expect(errors).toEqual([]);
  });
});
