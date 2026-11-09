import { expect, test, type Page } from "@playwright/test";
import { OUT_OF_AREA_MESSAGE } from "../public/shopper/serviceArea.js";

test.use({ viewport: { width: 390, height: 844 } });

async function unlock(page: Page) {
  await page.goto("/");
  await page.locator("#beta-code").first().fill("Brandon-50y4");
  await page.locator("#beta-gate-form button[type=submit]").first().click();
  await expect(page.locator("#beta-gate")).toBeHidden();
}

function shot(page: Page, name: string) {
  const project = test.info().project.name;
  const file = project === "phone" ? name : `${name}-${project}`;
  return page.screenshot({ path: `/opt/cursor/artifacts/${file}.png`, fullPage: false });
}

test("an in-area ZIP completes the normal path and a plan", async ({ page }) => {
  await unlock(page);
  await page.getByRole("button", { name: "Get started" }).click();
  await expect(page.locator("#profile-title")).toHaveText("Where do you shop?");
  await expect(page.locator("#profile-next")).toBeHidden();
  await page.locator("#profile-zip").pressSequentially("45202");
  await expect(page.locator("#profile-store-list")).toContainText("Kroger");
  await expect(page.locator("#profile-store-list")).toContainText("Walmart");
  await expect(page.locator("#profile-zip-error")).toBeHidden();
  await page.locator("#profile-zip-done").click();
  await expect(page.locator("#profile-next")).toBeVisible();
  await page.locator("#profile-next").click();
  await expect(page.locator("#profile-title")).toHaveText(/Connect a store\?|Teach Gitter your usual groceries/);
  await page.locator("#profile-skip").click();
  await expect(page.locator("#profile-onboard")).toBeHidden();

  await page.locator("#browse-toggle").click();
  const add = page.locator("#grid input[data-check]").first();
  await expect(add).toBeVisible();
  await add.check();
  const preference = page.locator("#profile-onboard");
  const opened = await preference.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
  if (opened) {
    await page.locator("#profile-skip").click();
    await expect(preference).toBeHidden();
  }
  await page.locator('[data-flow="plan"]').click();
  await expect(page.locator("#trip")).toContainText(/\$\d+\.\d{2}/);
  await expect(page.locator("#trip")).not.toContainText(OUT_OF_AREA_MESSAGE);
  await expect(page.locator("#trip")).toContainText(/Kroger|Walmart/);
  await shot(page, "in-area-plan-390");
});

test("an out-of-area ZIP stops onboarding before a plan", async ({ page }) => {
  const plans: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/optimize-list")) plans.push(request.url());
  });
  await unlock(page);
  await page.getByRole("button", { name: "Get started" }).click();
  await expect(page.locator("#profile-next")).toBeHidden();
  await page.locator("#profile-zip").pressSequentially("041");
  await expect(page.locator("#profile-next")).toBeHidden();
  await page.locator("#profile-zip").pressSequentially("01");
  const error = page.locator("#profile-zip-error");
  await expect(error).toBeVisible();
  await expect(error).toHaveText(OUT_OF_AREA_MESSAGE);
  await expect(page.locator("#profile-next")).toBeHidden();
  await expect(page.locator("#profile-store-list input")).toHaveCount(0);
  await error.scrollIntoViewIfNeeded();
  await shot(page, "out-of-area-onboarding-390");
  await page.locator("#profile-form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
  await expect(page.locator("#profile-title")).toHaveText("Where do you shop?");
  expect(plans).toEqual([]);
});

test("a saved out-of-area ZIP shows the same message instead of a plan", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "05401");
    localStorage.setItem(
      "gg-list",
      JSON.stringify([{ id: "custom:milk", itemId: "custom:milk", name: "Milk", quantity: 1 }])
    );
  });
  const plans: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/optimize-list")) plans.push(request.url());
  });
  await unlock(page);
  await page.locator('[data-flow="plan"]').click();
  await expect(page.locator("#trip")).toContainText(OUT_OF_AREA_MESSAGE);
  await expect(page.locator("#trip")).not.toContainText("$");
  await expect(page.locator("#profile-onboard")).toBeHidden();
  expect(plans).toEqual([]);
  await shot(page, "out-of-area-plan-390");

  await page.locator("#menu-open").click();
  await expect(page.locator("#zip")).toHaveValue("05401");
  await expect(page.locator("#zip-status")).toHaveText(OUT_OF_AREA_MESSAGE);
  await page.locator("#zip").fill("45202");
  await page.locator("#zip").dispatchEvent("change");
  await expect(page.locator("#zip-status")).toContainText(/Cincinnati|45202/);
  await page.locator("#zip").fill("04101");
  await page.locator("#zip").dispatchEvent("change");
  await expect(page.locator("#zip-status")).toHaveText(OUT_OF_AREA_MESSAGE);
  await expect(page.locator("#store-picker-list input")).toHaveCount(0);
});

test("the plan screen shows a not-in-service-area response instead of a fallback plan", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45202");
    localStorage.setItem(
      "gg-list",
      JSON.stringify([{ id: "custom:milk", itemId: "custom:milk", name: "Milk", quantity: 1 }])
    );
  });
  await page.route("**/sw.js", (route) => route.abort());
  await page.route("**/api/optimize-list", async (route) => {
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({
        error: OUT_OF_AREA_MESSAGE,
        code: "not_in_service_area",
      }),
    });
  });
  await unlock(page);
  await page.locator('[data-flow="plan"]').click();
  await expect(page.locator("#trip")).toContainText(OUT_OF_AREA_MESSAGE);
  await expect(page.locator("#trip .review-lines")).toHaveCount(0);
  await expect(page.locator("#trip")).not.toContainText("Milk");
});
