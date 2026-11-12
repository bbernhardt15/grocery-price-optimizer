import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

async function unlock(page: Page) {
  await page.goto("/");
  const invite = page.locator("#beta-code").first();
  if (await invite.isVisible().catch(() => false)) {
    await invite.fill("Brandon-50y4");
    await page.locator("#beta-gate-form button[type=submit]").first().tap();
    await expect(page.locator("#beta-gate")).toBeHidden();
  }
}

async function openReceipt(page: Page) {
  const start = page.getByRole("button", { name: "Get started" });
  if (await start.isVisible().catch(() => false)) await start.tap();
  await page.locator("#profile-zip").pressSequentially("45103");
  await expect(page.locator("#profile-store-list input, #profile-store-list button").first()).toBeVisible();
  await page.locator("#profile-zip-done").tap();
  await page.locator("#profile-next").tap();
  if ((await page.locator("#profile-title").textContent()) === "Connect a store?") {
    await page.locator("#store-connect-later").tap();
  }
  await page.getByText("Paste order text instead").tap();
  await page.locator("#profile-receipt-paste").fill("Dave's Killer Bread\n1.0 x $6.99");
}

const sizes = [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
] as const;

for (const size of sizes) {
  test(`Nov 12 receipt, brands, and a background price check at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await unlock(page);
    await expect.poll(async () => page.locator("#app-version").textContent()).toContain("v89");
    await openReceipt(page);
    await page.route("**/api/import/receipt", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.continue();
    });
    await page.route("**/api/catalog/browse**", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "busy" }) })
    );
    await page.getByRole("button", { name: "Read my receipts" }).tap();
    const bar = page.locator(".read-smooth").first();
    await expect(bar).toBeVisible();
    const samples: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      samples.push(Number((await bar.getAttribute("aria-valuenow")) || 0));
      await page.waitForTimeout(250);
    }
    expect(samples[samples.length - 1]).toBeGreaterThan(samples[0]);
    await expect(page.getByRole("heading", { name: "Here's what we learned" })).toBeVisible();
    await page.locator("[data-learned-change]").first().tap();
    await expect(page.getByRole("button", { name: "Load brands again" })).toBeVisible();
    const leaveMeat = page.getByRole("button", { name: "Leave Meat & Seafood off" });
    await expect(leaveMeat).toBeVisible();
    await leaveMeat.tap();
    await expect(page.getByText("Meat & Seafood left off.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Leave Meat & Seafood off" })).toHaveCount(0);
    const meatMode = await page.evaluate(() => {
      const profile = JSON.parse(localStorage.getItem("gg-profile") || "{}");
      return profile.categoryPreferences?.meat?.mode || "";
    });
    expect(meatMode).toBe("never");
    await page.unroute("**/api/catalog/browse**");
    await page.locator("#profile-next").tap();
    await expect(page.locator("#learned-add-trip")).toBeVisible();
    await page.getByRole("checkbox", { name: "Dave's Killer Bread" }).tap();
    await expect(page.locator("#learned-add-trip")).toBeEnabled();
    let planned = 0;
    await page.route("**/api/optimize-list", async (route) => {
      planned += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total: 6.99,
          stores: [
            {
              storeName: "Kroger",
              subtotal: 6.99,
              items: [{ lineId: "bread", name: "Dave's Killer Bread", price: 6.99, quantity: 1, itemTotal: 6.99 }],
            },
          ],
          unavailable: [],
        }),
      });
    });
    await page.locator("#learned-add-trip").tap();
    await expect.poll(() => planned).toBeGreaterThan(0);
    await expect(page.locator("body")).toHaveAttribute("data-step", "add");
    await expect(page.locator("#trip")).toBeHidden();
  });

  test(`Review coupons, I finished, and Still shopping at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
      localStorage.setItem(
        "gg-list",
        JSON.stringify([{ id: "custom:bread", itemId: "custom:bread", name: "Dave's Killer Bread", quantity: 1 }])
      );
    });
    await page.route("**/api/optimize-list", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total: 6.99,
          stores: [
            {
              storeName: "Kroger",
              subtotal: 6.99,
              items: [
                {
                  lineId: "bread",
                  name: "Dave's Killer Bread",
                  price: 6.99,
                  quantity: 1,
                  itemTotal: 6.99,
                  storeName: "Kroger",
                },
              ],
            },
          ],
          unavailable: [],
        }),
      });
    });
    await page.context().route("https://www.kroger.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<p>Kroger coupons</p>" })
    );
    await unlock(page);
    await page.locator('#bottom-dock [data-flow="plan"]').tap();
    await expect(page.locator("body")).toHaveAttribute("data-step", "plan");
    const coupons = page.getByRole("link", { name: "Open Kroger digital coupons" });
    await expect(coupons).toBeVisible();
    const popup = page.waitForEvent("popup");
    await coupons.tap();
    const opened = await popup;
    await opened.waitForURL(/kroger\.com/);
    expect(opened.url()).not.toContain("handoff.html");
    expect(opened.url()).not.toBe("about:blank");
    await opened.close();

    await page.evaluate(() => {
      const dialog = document.getElementById("store-return");
      if (dialog instanceof HTMLDialogElement) {
        dialog.dataset.store = "Kroger";
        dialog.showModal();
      }
    });
    await page.locator("#store-return-no").tap();
    await expect(page.locator("#store-return")).toBeHidden();
    await page.locator('#bottom-dock [data-flow="shop"]').tap();
    await expect(page.locator("body")).toHaveAttribute("data-step", "shop");
    await page.locator('#bottom-dock [data-flow="add"]').tap();
    await expect(page.locator("body")).toHaveAttribute("data-step", "add");

    await page.evaluate(() => {
      const dialog = document.getElementById("store-return");
      if (dialog instanceof HTMLDialogElement) {
        dialog.dataset.store = "Kroger";
        dialog.showModal();
      }
    });
    await page.locator("#store-return-yes").tap();
    await expect(page.locator("#store-return")).toBeHidden();
    await page.locator('#bottom-dock [data-flow="plan"]').tap();
    await expect(page.locator("body")).toHaveAttribute("data-step", "plan");
    await page.locator('#bottom-dock [data-flow="add"]').tap();
    await expect(page.locator("body")).toHaveAttribute("data-step", "add");
  });
}
