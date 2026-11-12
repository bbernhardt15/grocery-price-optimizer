import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

async function unlock(page: Page) {
  await page.goto("/");
  const invite = page.locator("#beta-code").first();
  if (await invite.isVisible().catch(() => false)) {
    await invite.fill("Brandon-50y4");
    await page.locator("#beta-gate-form button[type=submit]").first().click();
    await expect(page.locator("#beta-gate")).toBeHidden();
  }
}

async function startReceipt(page: Page) {
  await page.getByRole("button", { name: "Get started" }).click();
  await page.locator("#profile-zip").pressSequentially("45103");
  await expect(page.locator("#profile-store-list input, #profile-store-list button").first()).toBeVisible();
  await page.locator("#profile-zip-done").click();
  await page.locator("#profile-next").click();
  if ((await page.locator("#profile-title").textContent()) === "Connect a store?") {
    await page.locator("#store-connect-later").click();
  }
  await page.getByText("Paste order text instead").click();
  await page.locator("#profile-receipt-paste").fill("Dave's Killer Bread\n1.0 x $6.99");
}

const sizes = [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
] as const;

for (const size of sizes) {
  test(`Nov 12 receipt and trip actions at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await unlock(page);
    await page.locator("#menu-open").click();
    await expect(page.locator("#app-version")).toContainText("v89");
    await page.locator("#drawer-close").click();
    await startReceipt(page);
    await page.route("**/api/import/receipt", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 900));
      await route.continue();
    });
    await page.getByRole("button", { name: "Read my receipts" }).click();
    const bar = page.locator(".read-smooth").first();
    await expect(bar).toBeVisible();
    await expect.poll(async () => {
      const now = await bar.getAttribute("aria-valuenow");
      return Number(now || 0);
    }).toBeGreaterThan(8);
    await expect(page.getByRole("heading", { name: "Here's what we learned" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Use the lowest Meat & Seafood price/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Leave Meat & Seafood off" })).toBeVisible();
    await page.getByRole("button", { name: "Leave Meat & Seafood off" }).click();
    await expect(page.locator("#profile-stage")).toContainText("Meat & Seafood left off");
    await page.locator("#profile-next").click();
    await expect(page.locator("#learned-add-trip-top")).toBeVisible();
    await expect(page.locator("#learned-empty-trip-top")).toBeVisible();
    await expect(page.locator("#learned-add-trip")).toBeVisible();
    await expect(page.locator("#learned-empty-trip")).toBeVisible();
    const positions = await page.evaluate(() => {
      const top = document.querySelector("#learned-add-trip-top")?.getBoundingClientRect().top ?? 0;
      const row = document.querySelector(".trip-add-row")?.getBoundingClientRect().top ?? 0;
      const bottom = document.querySelector("#learned-add-trip")?.getBoundingClientRect().top ?? 0;
      return { top, row, bottom };
    });
    expect(positions.top).toBeLessThan(positions.row);
    expect(positions.bottom).toBeGreaterThan(positions.row);
    await page.locator("#learned-add-trip").click();
    await expect.poll(async () => page.evaluate(() => document.body.dataset.step)).toBe("add");
  });

  test(`coupon handoff and I finished at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
    });
    await unlock(page);
    await page.evaluate(() => {
      const dialog = document.getElementById("store-return");
      if (!(dialog instanceof HTMLDialogElement)) return;
      dialog.dataset.store = "Kroger";
      dialog.showModal();
    });
    await page.locator("#store-return-yes").click();
    await expect(page.locator("#store-return")).toBeHidden();
    await page.locator('[data-flow="plan"]').click();
    await expect(page.locator("body")).toHaveAttribute("data-step", "plan");
    await page.locator('[data-flow="add"]').click();
    await expect(page.locator("body")).toHaveAttribute("data-step", "add");
    await page.context().route("https://www.kroger.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<p>Kroger coupons</p>" })
    );
    await page.evaluate(() => {
      const link = document.createElement("a");
      link.href = "https://www.kroger.com/savings/cl/coupons/";
      link.textContent = "Kroger digital coupons";
      link.dataset.couponLink = link.href;
      link.dataset.storeLeave = "Kroger";
      link.dataset.leaveKind = "coupons";
      document.body.appendChild(link);
    });
    const popup = page.waitForEvent("popup");
    await page.getByRole("link", { name: "Kroger digital coupons" }).click();
    const opened = await popup;
    await opened.waitForURL(/kroger\.com/);
    expect(opened.url()).not.toContain("handoff.html");
    expect(opened.url()).not.toBe("about:blank");
    await opened.close();
  });
}
