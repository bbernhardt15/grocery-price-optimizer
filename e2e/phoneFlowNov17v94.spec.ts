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

test("v94 search stays visible, the logo clears it, and the price note is inline at 390x844", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem(
      "gg-profile",
      JSON.stringify({ onboarding: { status: "done" }, shopStores: ["Kroger", "Walmart"] })
    );
    navigator.serviceWorker.register = () => Promise.resolve({} as ServiceWorkerRegistration);
  });
  await page.route("**/sw.js", (route) => route.abort());
  await page.route("**/api/catalog/browse**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "cherry",
            name: "Cherry Coke",
            brand: "Coca-Cola",
            familyName: "Coke",
            flavorLabel: "Cherry",
            flavorKey: "cherry",
            departmentId: "beverages",
            departmentName: "Beverages",
            sizeLabel: "12 pk",
            imageUrls: [],
            offers: [{ storeName: "Kroger", price: 6.48 }],
            bestOffer: { storeName: "Kroger", price: 6.48 },
            variants: [{ id: "cherry", name: "Cherry Coke", flavorKey: "cherry", flavorLabel: "Cherry", label: "12 pk", price: 6.48 }],
            defaultVariantId: "cherry",
          },
        ],
        total: 1,
        nextCursor: null,
        partial: false,
        facets: { stores: [], brands: [] },
        coverage: [],
        warnings: [],
      }),
    })
  );
  await unlock(page);
  await page.locator("#menu-open").tap();
  await expect(page.locator("#app-version")).toContainText("v94");
  await page.locator("#drawer-close").tap();

  await page.locator("#browse-toggle").tap();
  const search = page.locator("#search");
  await search.tap();
  await search.fill("Cherry coke");
  const boxes = await page.evaluate(() => {
    const field = document.getElementById("search")?.getBoundingClientRect();
    const bar = document.querySelector(".topbar")?.getBoundingClientRect();
    const toggle = document.getElementById("browse-toggle")?.getBoundingClientRect();
    const note = document.createElement("p");
    note.className = "shop-checking-banner";
    document.body.appendChild(note);
    const position = getComputedStyle(note).position;
    note.remove();
    const star = document.createElement("button");
    star.className = "fav-star match-star";
    const card = document.createElement("article");
    card.className = "match-card";
    card.append(star);
    document.body.appendChild(card);
    const starPosition = getComputedStyle(star).position;
    card.remove();
    return {
      fieldTop: field?.top ?? -1,
      barBottom: bar?.bottom ?? 0,
      toggleBottom: toggle?.bottom ?? 0,
      fieldHeight: field?.height ?? 0,
      position,
      starPosition,
    };
  });
  expect(boxes.fieldTop).toBeGreaterThanOrEqual(boxes.barBottom - 1);
  expect(boxes.fieldTop + boxes.fieldHeight).toBeLessThanOrEqual(844);
  expect(boxes.position).toBe("static");
  expect(boxes.starPosition).toBe("static");
  expect(boxes.fieldTop).toBeGreaterThanOrEqual(boxes.toggleBottom - 1);

  await page.locator("#brand-home").tap();
  await expect(search).toHaveValue("");
  await expect(page.locator("#browse-label")).toHaveText("Browse the catalog by aisle");
});
