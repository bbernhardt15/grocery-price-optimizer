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
  const leave = page.getByRole("button", { name: "Leave Meat & Seafood off" });
  await expect(leave).toBeVisible();
  await leave.tap();
  await expect(page.locator("#profile-stage")).toContainText("Meat & Seafood left off.");
  await expect(page.getByText("Not on this receipt")).toHaveCount(0);
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
    await expect(page.locator("#app-version")).toHaveText(/v92 · [0-9a-f]{7}/i);
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
