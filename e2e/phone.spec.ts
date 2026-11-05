import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const receipt = path.join(process.cwd(), "e2e/fixtures/sample-order.pdf");

function watch(page: Page) {
  const errors: string[] = [];
  const failed: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/favicon|sentry|ResizeObserver|Failed to load resource/i.test(text)) return;
    errors.push(text);
  });
  page.on("response", (response) => {
    const url = response.url();
    if (!url.includes("/api/")) return;
    if (response.status() < 400) return;
    if (response.status() === 401 && url.includes("/api/beta/invite")) return;
    failed.push(`${response.status()} ${url}`);
  });
  return {
    assertClean() {
      expect(failed, failed.join("\n")).toEqual([]);
      expect(errors, errors.join("\n")).toEqual([]);
    },
  };
}

async function unlock(page: Page, code = "Brandon-50y4") {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Enter your invite code" })).toBeVisible();
  await page.locator("#beta-code").first().fill(code);
  await page.locator("#beta-gate-form button[type=submit]").first().click();
  await expect(page.locator("#beta-gate")).toBeHidden();
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-artifacts/${name}.png`, fullPage: false });
}

test("invite gate rejects a wrong code, accepts mixed case, and stays in after reload", async ({ page }) => {
  const net = watch(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Enter your invite code" })).toBeVisible();
  await shot(page, "01-invite");
  await page.locator("#beta-code").first().fill("not-a-code");
  await page.locator("#beta-gate-form button[type=submit]").first().click();
  await expect(page.locator("#beta-gate-error").first()).toBeVisible();
  await page.locator("#beta-code").first().fill("Brandon-50y4");
  await page.locator("#beta-gate-form button[type=submit]").first().click();
  await expect(page.getByRole("button", { name: "Get started" })).toBeVisible();
  await page.reload();
  await expect(page.locator("#beta-gate")).toBeHidden();
  await expect(page.getByRole("button", { name: "Get started" })).toBeVisible();
  net.assertClean();
});

test("onboarding, prices, review, in-store, share, and import", async ({ page }) => {
  const net = watch(page);
  await unlock(page);
  await page.getByRole("button", { name: "Get started" }).click();
  const zipScrollBefore = await page.evaluate(() => window.scrollY);
  await page.locator("#profile-zip").pressSequentially("45202");
  await expect(page.locator("#profile-store-list input, #profile-store-list button").first()).toBeVisible();
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - zipScrollBefore)).toBeLessThan(2);
  await page.locator("#profile-zip-done").click();
  await shot(page, "02-stores");
  await page.locator("#profile-next").click();
  await expect(page.getByText("Teach Gitter your usual groceries")).toBeVisible();
  await page.locator("#profile-receipt-input").setInputFiles(receipt);
  await page.getByRole("button", { name: "Read my receipts" }).click();
  await expect(page.getByRole("heading", { name: "Here's what we learned" })).toBeVisible();
  await expect(page.locator(".learned-row").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reading your orders" })).toHaveCount(0);
  await shot(page, "03-learned");

  const stage = page.locator("#profile-stage");
  const sheet = page.locator("#profile-onboard");
  await page.locator("[data-learned-change]").first().click();
  await expect(page.locator(".rule-choice", { hasText: "Store brand" })).toBeVisible();
  const ruleButton = page.locator(".rule-choice", { hasText: "Store brand" });
  const beforeRule = await sheet.boundingBox();
  const ruleBoxBefore = await ruleButton.boundingBox();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const stageBefore = await stage.evaluate((el) => el.scrollTop);
  await ruleButton.evaluate((el) => (el as HTMLButtonElement).click());
  await expect(ruleButton).toHaveAttribute("aria-pressed", "true");
  await expect(ruleButton.locator("[data-rule-saved]")).toHaveText("Saved");
  const ruleBoxAfter = await ruleButton.boundingBox();
  expect(Math.abs((ruleBoxAfter?.y || 0) - (ruleBoxBefore?.y || 0))).toBeLessThan(8);
  await expect(page.getByRole("button", { name: "Confirm" })).toHaveCount(0);
  const afterRule = await sheet.boundingBox();
  const scrollAfter = await page.evaluate(() => window.scrollY);
  const stageAfter = await stage.evaluate((el) => el.scrollTop);
  expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThan(2);
  expect(Math.abs(stageAfter - stageBefore)).toBeLessThan(2);
  expect(Math.abs((afterRule?.y || 0) - (beforeRule?.y || 0))).toBeLessThan(2);

  await page.locator("#profile-next").click();
  await page.getByRole("button", { name: "Select all" }).click();
  await expect(page.locator("#learned-add-trip").first()).toBeEnabled();
  await page.locator("#learned-add-trip").first().click();
  await expect(page.locator("#list-panel")).not.toHaveClass(/open/);
  await page.locator("#list-toggle").evaluate((el) => (el as HTMLButtonElement).click());
  await expect(page.locator("#list-panel")).toHaveClass(/open/);
  await expect(page.locator(".list-section-title").first()).toBeVisible();
  await expect(page.locator(".list-row").first()).toBeVisible();
  const firstQty = page.locator(".list-row").first().locator("output");
  const qtyBefore = Number(await firstQty.innerText());
  await page.locator(".list-row").first().locator("[data-list-inc]").click();
  await expect(firstQty).toHaveText(String(qtyBefore + 1));
  const rows = page.locator(".list-row");
  const count = await rows.count();
  if (count > 1) {
    await rows.last().locator("[data-list-remove], .list-remove").click();
    await expect(rows).toHaveCount(count - 1);
  }

  const panelBefore = await page.locator("#list-panel").boundingBox();
  const panelScroll = await page.locator("#list-panel").evaluate((el) => el.scrollTop);
  const pageScroll = await page.evaluate(() => window.scrollY);
  await page.locator("#allow-subs").evaluate((el) => (el as HTMLInputElement).click());
  const panelAfter = await page.locator("#list-panel").boundingBox();
  expect(Math.abs((panelAfter?.y || 0) - (panelBefore?.y || 0))).toBeLessThan(2);
  expect(await page.locator("#list-panel").evaluate((el) => el.scrollTop)).toBe(panelScroll);
  expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll);

  await expect(page.locator("#list-alerts")).toBeHidden();
  await page.locator("#share-btn").evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.locator("#share-btn").click();
  await expect(page.locator("#share-confirm")).toBeVisible();
  await expect(page.locator("#share-confirm-note")).toContainText("item names and quantities");
  await expect(page.locator("#share-link")).toContainText("/list/");
  await page.locator("#share-copy").click();
  await expect(page.locator("#share-viewonly")).toBeVisible();
  await page.locator("#share-viewonly").click();
  await expect(page.locator("#share-confirm-note")).toContainText("Only you can change it");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#share-revoke").click();
  await expect(page.locator("#share-status")).toContainText(/off|new one/i);
  await shot(page, "06-share");

  await page.locator("#plan-btn").click();
  await expect(page.locator("#trip")).toContainText(/\$[1-9]\d*\.\d{2}/);
  await expect(page.locator("#estimate-total")).not.toHaveText("$0.00");
  await shot(page, "04-review");
  const money = async () => {
    const text = await page.locator("#trip").innerText();
    const match = text.match(/\$\d+\.\d{2}/);
    return match?.[0] || "";
  };
  const first = await money();
  expect(first).not.toBe("");
  await page.locator('[data-flow="plan"]').click();
  await expect.poll(money).toBe(first);
  await page.locator('[data-flow="plan"]').click();
  await expect.poll(money).toBe(first);
  await page.reload();
  await expect(page.locator("#beta-gate")).toBeHidden();
  await page.locator('[data-flow="plan"]').click();
  await expect.poll(money).toBe(first);
  await expect(page.locator("#trip")).toContainText("Kroger");
  await expect(page.locator("#trip")).toContainText("Walmart");

  await page.getByRole("button", { name: "In-store" }).click();
  await expect(page.locator(".shop-name").first()).toBeVisible();
  await expect(page.locator(".shop-name").first()).not.toHaveText("");
  await shot(page, "05-instore");

  await page.locator('[data-flow="add"]').click();
  await page.route("**/api/import/photo", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    })
  );
  await page.locator("#browse-toggle").click();
  await page.locator("#ask-import").click();
  await expect(page.locator("#import-photo")).toBeVisible();
  await expect(page.locator("#import-photo-note")).toContainText("isn't set up");
  await expect(page.locator("#import-photo-note")).not.toContainText("isn't switched on yet");
  await page.locator("#import-photo-input").setInputFiles({
    name: "kids.png",
    mimeType: "image/png",
    buffer: Buffer.from("not-a-receipt"),
  });
  await expect(page.locator("#import-status")).toContainText(/No grocery items in that photo/i);
  await page.locator("#import-paste").fill("Whole Milk\nLarge Eggs");
  await page.locator("#import-find").click();
  await expect(page.locator("#import-status")).not.toContainText("isn't switched on");
  await expect(page.locator("#import-status")).toContainText(/Found|item/i);
  await page.locator("#import-close").click();

  await page.locator("#menu-open").click();
  await page.locator("#menu-settings").click();
  const theme = page.locator("#settings-theme");
  const themeBefore = await theme.innerText();
  await theme.click();
  await expect(theme).not.toHaveText(themeBefore);
  await page.locator("#settings-close").click();
  await expect(page.locator("#settings-dialog")).toBeHidden();

  net.assertClean();
});

test("themed lists scroll inside the sheet and do not leak onto Review", async ({ page }) => {
  const net = watch(page);
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
  });
  await unlock(page);
  await page.locator("[data-lists-open]").click();
  await expect(page.getByRole("heading", { name: "Lists", exact: true })).toBeVisible();
  const all = page.locator("[data-lists-all]");
  if (await all.count()) await all.click();
  await page.locator('[data-list-open="thanksgiving"]').click();
  const scroller = page.locator("#list-sheet .theme-checks");
  await expect(scroller).toBeVisible();
  await expect.poll(async () => scroller.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(40);
  const bodyBefore = await page.evaluate(() => document.scrollingElement?.scrollTop || 0);
  await scroller.evaluate((el) => {
    el.scrollTop = 200;
  });
  await expect.poll(async () => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(20);
  expect(await page.evaluate(() => document.scrollingElement?.scrollTop || 0)).toBe(bodyBefore);
  await shot(page, "07-lists");
  await page.locator("[data-sheet-close]").click();
  await expect(page.locator("#list-sheet")).toBeHidden();
  await page.locator('[data-flow="plan"]').click();
  await expect(page.getByRole("heading", { name: "Lists", exact: true })).toHaveCount(0);
  await expect(page.getByText("Thanksgiving")).toHaveCount(0);
  await expect(page.getByText("Football tailgate")).toHaveCount(0);
  net.assertClean();
});
