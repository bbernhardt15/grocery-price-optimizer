import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

const sizes = [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
] as const;

async function unlock(page: Page) {
  await page.goto("/");
  const invite = page.locator("#beta-code").first();
  if (await invite.isVisible().catch(() => false)) {
    await invite.fill("Brandon-50y4");
    await page.locator("#beta-gate-form button[type=submit]").first().tap();
    await expect(page.locator("#beta-gate")).toBeHidden();
  }
}

test("v92 receipt can leave meat off at 390x844", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.clear();
  });
  await unlock(page);
  const start = page.getByRole("button", { name: "Get started" });
  const zip = page.locator("#profile-zip");
  await expect(async () => {
    if (await start.isVisible().catch(() => false)) await start.tap();
    await expect(zip).toBeVisible();
  }).toPass();
  await zip.pressSequentially("45103");
  await page.locator("#profile-zip-done").tap();
  await page.locator("#profile-next").tap();
  if (/Connect a store\?|Kroger connected/.test((await page.locator("#profile-title").textContent()) || "")) {
    await page.locator("#store-connect-later").tap();
  }
  await page.getByText("Paste order text instead").tap();
  await page.locator("#profile-receipt-paste").fill("Ground Beef\n1.0 x $5.99");
  await page.getByRole("button", { name: "Read my receipts" }).tap();
  await expect(page.getByText("This receipt includes meat")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Leave Meat & Seafood off" })).toHaveCount(0);
  await expect(page.getByText("Not on this receipt")).toHaveCount(0);
  const promise = page.locator(".basket-promise strong");
  await expect(promise).toHaveText("We'll find it for less.");
  await expect.poll(async () => promise.evaluate((node) => node.getClientRects().length)).toBe(1);
});

test("v92 shows the next task prompt after the visible one is declined at 390x844", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem("gg-profile", JSON.stringify({ onboarding: { status: "done", step: "summary", updatedAt: 1 } }));
    localStorage.setItem(
      "gg-list",
      JSON.stringify([
        { id: "milk", itemId: "milk", name: "Whole Milk", quantity: 1 },
        { id: "custom:mystery", itemId: "custom:mystery", name: "Mystery Sauce", quantity: 1 },
      ])
    );
  });
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
        unavailable: ["Mystery Sauce"],
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
  await unlock(page);
  await page.locator('[data-flow="plan"]').click();
  const guide = page.locator("#gitter-guide");
  await expect(guide).toHaveAttribute("data-moment", "review-next");
  await expect(guide.getByRole("button", { name: "No thanks" })).toBeVisible();
  await page.waitForTimeout(4200);
  await page.evaluate(() => {
    const guideApi = (document as Document & { __gitterGuide?: { noteTrip?: (trip: object) => void } }).__gitterGuide;
    guideApi?.noteTrip?.({
      saved: 0,
      total: 3.2,
      items: [{ name: "Whole Milk", quantity: 1 }],
    });
  });
  await expect(guide).toHaveAttribute("data-moment", "review-next");
  await expect(guide.getByRole("button", { name: "Not this time" })).toHaveCount(0);
  await guide.getByRole("button", { name: "Dismiss guide" }).tap();
  await expect(guide).toHaveAttribute("data-moment", "trip-saved");
  await expect(guide.getByRole("button", { name: "Not this time" })).toBeVisible();
  await expect(guide).not.toContainText(/couldn't find/i);
});

test("v92 one tap on receipt Skip leaves the queued card at 390x844", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem("gg-profile", JSON.stringify({ onboarding: { status: "done", step: "summary", updatedAt: 1 } }));
    localStorage.setItem("gg-list", JSON.stringify([{ id: "milk", itemId: "milk", name: "Whole Milk", quantity: 1 }]));
  });
  await page.route("**/api/optimize-list", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        partial: false,
        pendingStores: [],
        pricingByStore: [{ storeName: "Kroger", check: "ok" }],
        total: 1,
        stores: [{ storeName: "Kroger", subtotal: 1, items: [{ lineId: "milk", name: "Whole Milk", price: 1, quantity: 1, itemTotal: 1, storeName: "Kroger" }] }],
      }),
    });
  });
  await unlock(page);
  const guide = page.locator("#gitter-guide");
  await page.evaluate(() => {
    const guideApi = (document as Document & { __gitterGuide?: { noteReceipt?: (payload: object) => void } }).__gitterGuide;
    guideApi?.noteReceipt?.({ lines: [{ name: "Paper Towels", quantity: 1 }] });
  });
  await page.locator("#step-bar [data-flow='plan']").click();
  await expect(guide).toHaveAttribute("data-moment", "receipt");
  await expect(guide.getByRole("button", { name: "Skip" })).toBeVisible();
  await page.waitForTimeout(4200);
  await page.evaluate(() => {
    const guideApi = (document as Document & { __gitterGuide?: { noteTrip?: (trip: object) => void } }).__gitterGuide;
    guideApi?.noteTrip?.({ saved: 0, total: 4, items: [{ name: "Whole Milk", quantity: 1 }] });
  });
  await expect(guide).toHaveAttribute("data-moment", "receipt");
  await guide.getByRole("button", { name: "Skip" }).tap();
  await expect(guide).toHaveAttribute("data-moment", "trip-saved");
  await expect(guide.getByRole("button", { name: "Not this time" })).toBeVisible();
});

for (const size of sizes) {
  test(`v92 welcome covers a fresh load at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      localStorage.clear();
    });
    await unlock(page);
    await expect(page.getByRole("heading", { name: /usually buy/i })).toBeVisible();
    await expect(page.locator("#profile-onboard")).toHaveAttribute("open", "");
    await expect(page.locator(".missing-depts")).toHaveCount(0);
  });

  test(`v92 menu version and equal flavor chips at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
      localStorage.setItem("gg-profile", JSON.stringify({ onboarding: { status: "done", step: "summary", updatedAt: 1 } }));
    });
    await unlock(page);
    await page.locator("#menu-open").tap();
    await expect(page.locator("#app-version")).toHaveText(/v93 · [0-9a-f]{7}/i);
    await page.evaluate(() => {
      const row = document.createElement("div");
      row.className = "choice-row";
      row.innerHTML = `<button class="choice-chip" type="button">Proactive Strawberry Prebiotic Probiotic</button><button class="choice-chip" type="button">Plain</button>`;
      document.body.appendChild(row);
    });
    const widths = await page.locator(".choice-row .choice-chip").evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().width)));
    expect(widths[0]).toBe(widths[1]);
  });
}
