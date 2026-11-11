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

const sizes = [
  { width: 390, height: 844 },
  { width: 375, height: 667 },
] as const;

for (const size of sizes) {
  test(`walkthrough shell stays consistent at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      localStorage.setItem("gg-onboarding-done", "1");
      localStorage.setItem("gg-zip", "45103");
    });
    await unlock(page);
    await page.locator("#menu-open").click();
    await expect(page.locator("#app-version")).toContainText("v85");
    await page.locator("#drawer-close").click();

    const tiles = page.locator("#usuals-toggle, [data-lists-open], #past-trips-open");
    await expect(tiles).toHaveCount(3);
    const heights = await tiles.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)));
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(8);

    await page.locator("#browse-toggle").click();
    await expect(page.locator("#chip-hint")).toBeHidden();
    await expect(page.locator(".dept-chips")).toBeVisible();
    await page.locator("#filters-open").click();
    await expect(page.locator("#filters")).toHaveClass(/open/);
    await expect(page.locator("#filter-department")).toBeVisible();
    const layered = await page.evaluate(() => {
      const refine = document.querySelector("#filters") as HTMLElement;
      const chips = document.querySelector(".dept-scroller") as HTMLElement;
      const refineZ = Number(getComputedStyle(refine).zIndex) || 0;
      const chipZ = Number(getComputedStyle(chips).zIndex) || 0;
      return refineZ > chipZ;
    });
    expect(layered).toBe(true);
    await page.locator("#filters-close").click();

    await page.locator("#tab-favorites").click();
    await expect(page.locator("#favorites-screen")).toBeVisible();
    await expect(page.locator("#favorites-screen")).toContainText("Star items to see them here");
    await expect(page.locator("#favorites-screen")).not.toContainText("Aisle 1");
    await page.locator("#favorites-close").click();

    await page.locator('[data-flow="plan"]').click();
    await expect(page.locator("body")).toHaveAttribute("data-step", "plan");
    await expect(page.locator("#browse")).toBeHidden();
    await page.locator('[data-flow="add"]').click();
    await expect(page.locator("body")).toHaveAttribute("data-step", "add");
    const scrolled = await page.evaluate(() => window.scrollY);
    expect(scrolled).toBeLessThan(8);

    await page.locator("#menu-open").click();
    await expect(page.locator("#app-drawer")).toBeVisible();
    const menuAbove = await page.evaluate(() => {
      const drawer = document.querySelector("#app-drawer") as HTMLElement;
      return (Number(getComputedStyle(drawer).zIndex) || 0) >= 80;
    });
    expect(menuAbove).toBe(true);
    await page.locator("#drawer-close").click();
    await page.locator("#brand-home").click();
    await expect(page.locator("body")).toHaveAttribute("data-step", "add");
  });
}
