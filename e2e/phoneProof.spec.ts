import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

async function unlock(page: Page) {
  await page.goto("/");
  await page.locator("#beta-code").first().fill("Brandon-50y4");
  await page.locator("#beta-gate-form button[type=submit]").first().click();
  await expect(page.locator("#beta-gate")).toBeHidden();
}

const plan = {
  total: 5.19,
  partial: false,
  pendingStores: [],
  pricingByStore: [
    { storeName: "Kroger", check: "ok" },
    { storeName: "Walmart", check: "ok" },
  ],
  stores: [
    {
      storeName: "Kroger",
      subtotal: 5.19,
      items: [
        { lineId: "milk", name: "Milk", title: "Milk", department: "Dairy & Eggs", price: 3, quantity: 1, itemTotal: 3, storeName: "Kroger" },
        { lineId: "apples", name: "Apples", title: "Apples", department: "Produce", price: 2.19, quantity: 1, itemTotal: 2.19, storeName: "Kroger" },
      ],
    },
  ],
};

test("Open cart is a popup, and the Kroger walk has department headings", async ({ page }) => {
  await page.route("**/api/optimize-list", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(plan) });
  });
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem(
      "gg-list",
      JSON.stringify([
        { id: "milk", itemId: "milk", name: "Milk", quantity: 1 },
        { id: "apples", itemId: "apples", name: "Apples", quantity: 1 },
      ])
    );
  });
  await unlock(page);
  await page.locator('[data-flow="plan"]').click();
  await expect(page.locator("[data-cart-popup='Kroger']")).toBeVisible();
  const fold = page.locator("[data-store='Kroger'] details.store-fold");
  await expect(fold).not.toHaveAttribute("open", "");
  await page.locator("[data-cart-popup='Kroger']").click();
  await expect(page.locator("#cart-popup")).toBeVisible();
  await expect(page.locator("#cart-popup")).toContainText("Milk");
  await expect(fold).not.toHaveAttribute("open", "");
  await page.locator("#cart-popup").getByRole("button", { name: "Close" }).click();
  await page.locator('[data-flow="shop"]').click();
  await expect(page.locator(".shop-aisle", { hasText: "Dairy & Eggs" })).toBeVisible();
  await expect(page.locator(".shop-aisle", { hasText: "Produce" })).toBeVisible();
});

test("feedback stores a screenshot and a tapped rating for the reviewer", async ({ page }) => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
  });
  await unlock(page);
  await page.locator("#menu-open").click();
  await page.locator("#help-title").click();
  await page.locator("#help-feedback").click();
  await page.locator(".beta-rating", { hasText: "5" }).click();
  await expect(page.locator("#beta-feedback-form input[value='5']")).toBeChecked();
  await page.locator("#beta-feedback-shots").setInputFiles({ name: "cart.png", mimeType: "image/png", buffer: png });
  await expect(page.locator("#beta-feedback-shots-preview img")).toBeVisible();
  await expect(page.locator("#beta-feedback-shots-note")).toContainText("will be sent");
  await page.locator("#beta-feedback-text").fill("The cart popup.");
  await page.locator("#beta-feedback-form").getByRole("button", { name: "Send" }).click();
  await expect(page.locator("#beta-feedback-status")).toHaveText("Sent. Thank you.");
  const listed = await page.request.get("/api/admin/beta/feedback", {
    headers: { authorization: "Bearer e2e-feedback-admin" },
  });
  expect(listed.ok()).toBeTruthy();
  const body = (await listed.json()) as { feedback: Array<{ id: string; message: string; shots: Array<{ byteLength: number }> }> };
  const note = body.feedback.find((row) => row.message === "The cart popup.");
  expect(note?.shots[0]?.byteLength).toBe(png.length);
  const image = await page.request.get(`/api/admin/beta/feedback/${note?.id}/shots/0`, {
    headers: { authorization: "Bearer e2e-feedback-admin" },
  });
  expect(image.ok()).toBeTruthy();
  expect(Buffer.from(await image.body()).equals(png)).toBe(true);
});

test("a hung aisle shows a retry instead of staying on Loading this aisle", async ({ page }) => {
  await page.route("**/api/catalog/browse**", async () => new Promise(() => {}));
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
  });
  await unlock(page);
  await page.locator("#browse-toggle").click();
  await expect(page.getByRole("heading", { name: "This aisle is taking a while" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Try this aisle again" })).toBeVisible();
});

test("skip rest leaves the product wizard and does not ask for another receipt", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem(
      "gg-profile",
      JSON.stringify({
        version: 1,
        updatedAt: Date.now(),
        onboarding: { status: "done", step: "summary", updatedAt: Date.now() },
        shopStores: ["Kroger"],
        categoryPreferences: {},
      })
    );
  });
  await unlock(page);
  await page.locator("#menu-open").click();
  await page.locator("#app-drawer summary", { hasText: "Preferences" }).click();
  await page.locator("#menu-brands").click();
  await expect(page.locator("#profile-onboard")).toBeVisible();
  await page.locator("#profile-next").click();
  await page.getByRole("button", { name: "Store brand" }).first().click();
  await expect(page.locator(".chosen-mode")).toContainText("Saved on this phone.");
  await page.locator("#profile-skip-rest").click();
  await expect(page.getByRole("heading", { name: "Teach Gitter your usual groceries" })).toHaveCount(0);
  await expect(page.locator("#profile-title")).toHaveText("Here's what we'll shop for");
});

test("the reading cart moves right and the status does not cycle backward", async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/import/receipt", async (route) => {
    await held;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [{ name: "Whole Milk", quantity: 1 }, { name: "Bananas", quantity: 1 }],
        lines: [{ name: "Whole Milk", quantity: 1 }, { name: "Bananas", quantity: 1 }],
        learned: [
          { family: "milk", label: "Milk", mode: "brand", brand: "Dairy Pure", confidence: "high" },
          { family: "bananas", label: "Bananas", mode: "cheapest", confidence: "high" },
        ],
      }),
    });
  });
  await unlock(page);
  const continueGap = () =>
    page.evaluate(() => {
      const dialog = document.querySelector("dialog.profile-onboard");
      const next = document.querySelector("#profile-next");
      if (!dialog || !next) return 999;
      return Math.round(dialog.getBoundingClientRect().bottom - next.getBoundingClientRect().bottom);
    });
  const stageOverflow = () => page.locator("#profile-stage").evaluate((el) => el.scrollHeight - el.clientHeight);
  await expect(page.getByRole("button", { name: "Get started" })).toBeVisible();
  expect(await continueGap()).toBeLessThanOrEqual(48);
  await page.screenshot({ path: "/opt/cursor/artifacts/onboarding-welcome.png" });
  await page.getByRole("button", { name: "Get started" }).click();
  await page.locator("#profile-zip").pressSequentially("45202");
  await page.locator("#profile-zip-done").click();
  await expect(page.locator("[data-place-store]").first()).toBeVisible();
  expect(await stageOverflow()).toBeLessThanOrEqual(8);
  expect(await continueGap()).toBeLessThanOrEqual(48);
  await page.screenshot({ path: "/opt/cursor/artifacts/onboarding-zip.png" });
  await page.locator("#profile-next").click();
  if ((await page.locator("#profile-title").textContent()) === "Connect a store?") {
    await page.locator("#profile-next").click();
  }
  const nextBox = await page.locator("#profile-next").boundingBox();
  const stageBox = await page.locator("#profile-stage").boundingBox();
  expect(nextBox && stageBox && nextBox.y >= stageBox.y + stageBox.height - 4).toBeTruthy();
  expect(await stageOverflow()).toBeLessThanOrEqual(8);
  expect(await continueGap()).toBeLessThanOrEqual(48);
  await page.screenshot({ path: "/opt/cursor/artifacts/onboarding-receipts.png" });
  await page.getByText("Paste order text instead").click();
  await page.locator("#profile-receipt-paste").fill("Whole Milk");
  await page.getByRole("button", { name: "Read my receipts" }).click();
  const cart = page.locator(".read-cart");
  await expect(cart).toBeVisible();
  const phase = page.locator("[data-read-phase]");
  await expect(phase).toBeVisible();
  const left = () => cart.evaluate((el) => Number.parseFloat(getComputedStyle(el).left) || 0);
  const firstLeft = await left();
  const firstPhase = (await phase.innerText()).toLowerCase();
  const samples = [firstLeft];
  await expect
    .poll(
      async () => {
        const value = await left();
        if (value > samples[samples.length - 1] + 4) samples.push(value);
        return samples.length;
      },
      { timeout: 6000 }
    )
    .toBeGreaterThanOrEqual(3);
  const trackEnd = await cart.evaluate((el) => (el.parentElement ? el.parentElement.clientWidth - 36 : 0));
  expect(samples[samples.length - 1]).toBeLessThan(trackEnd - 8);
  await expect.poll(async () => (await phase.innerText()).toLowerCase(), { timeout: 5000 }).not.toBe(firstPhase);
  const secondPhase = (await phase.innerText()).toLowerCase();
  expect(firstPhase.includes("still reading")).toBe(false);
  expect(secondPhase.includes("still reading")).toBe(false);
  const order = ["looking for item names", "working through the receipt", "almost through the receipt"];
  const rank = (text: string) => order.findIndex((row) => text.includes(row));
  expect(rank(firstPhase)).toBeGreaterThanOrEqual(0);
  expect(rank(secondPhase)).toBeGreaterThanOrEqual(rank(firstPhase));
  await page.screenshot({ path: "/opt/cursor/artifacts/reading-cart.png" });
  release();
  await expect(page.locator("#profile-title")).toHaveText("Here's what we learned");
  await page.locator("[data-learned-change='milk']").click();
  await expect(page.locator("[data-learned-mode='storeBrand']").first()).toBeVisible();
  await page.locator("[data-learned-mode='cheapest']").first().click();
  await expect(page.locator("[data-learned-mode='cheapest']").first()).toHaveAttribute("aria-pressed", "true");
  const missing = page.locator("[data-missing-dept]").first();
  await expect(missing).toBeVisible();
  await missing.click();
  await expect(missing).toHaveAttribute("aria-pressed", "true");
  const stage = page.locator("#profile-stage");
  await stage.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const learnedFit = await page.evaluate(() => {
    const scroller = document.querySelector("#profile-stage");
    const next = document.querySelector("#profile-next");
    const last = document.querySelector(".missing-depts [data-missing-dept]:last-of-type");
    if (!scroller || !next || !last) return null;
    const frame = scroller.getBoundingClientRect();
    const nextBox = next.getBoundingClientRect();
    const lastBox = last.getBoundingClientRect();
    const intersects = lastBox.bottom > nextBox.top + 1 && lastBox.top < nextBox.bottom && lastBox.right > nextBox.left && lastBox.left < nextBox.right;
    return {
      intersects,
      lastVisible: lastBox.top >= frame.top - 1 && lastBox.bottom <= frame.bottom + 1,
      lastAboveButton: lastBox.bottom <= nextBox.top + 1,
    };
  });
  expect(learnedFit).not.toBeNull();
  expect(learnedFit?.intersects).toBe(false);
  expect(learnedFit?.lastVisible).toBe(true);
  expect(learnedFit?.lastAboveButton).toBe(true);
  await page.screenshot({ path: "/opt/cursor/artifacts/onboarding-learned.png" });
});

test("a coupon screenshot review applies only the eligible discount", async ({ page }) => {
  await page.route("**/api/optimize-list", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        total: 3.18,
        partial: false,
        pendingStores: [],
        pricingByStore: [{ storeName: "Walmart", check: "ok" }],
        stores: [
          {
            storeName: "Walmart",
            subtotal: 3.18,
            items: [
              {
                lineId: "milk",
                name: "Whole Milk",
                title: "Whole Milk",
                department: "Dairy & Eggs",
                price: 3.18,
                quantity: 1,
                itemTotal: 3.18,
                storeName: "Walmart",
                offers: [
                  { storeName: "Walmart", price: 3.18 },
                  { storeName: "Kroger", price: 3.29 },
                ],
              },
            ],
          },
        ],
      }),
    });
  });
  let shots = 0;
  await page.route("**/api/import/coupon", async (route) => {
    shots += 1;
    const walmart = shots > 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        source: "screenshot",
        coupon: {
          storeName: walmart ? "Walmart" : "Kroger",
          itemName: "Whole Milk",
          kind: "dollars",
          amount: 1,
          expiresOn: "2026-12-01",
          minQuantity: null,
          minSpend: null,
          conditions: "",
          gaps: [],
        },
      }),
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem("gg-list", JSON.stringify([{ id: "milk", itemId: "milk", name: "Whole Milk", quantity: 1 }]));
  });
  await unlock(page);
  await page.locator('[data-flow="plan"]').click();
  await page.getByText("Check Walmart coupons before you shop").click();
  await page.getByRole("button", { name: "Add a coupon" }).click();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  await page.locator("[data-coupon-shot]").setInputFiles({ name: "kroger.png", mimeType: "image/png", buffer: png });
  await expect(page.locator("[data-coupon-shot-note]")).toContainText("not applied here");
  await page.locator("[data-coupon-shot]").setInputFiles({ name: "coupon.png", mimeType: "image/png", buffer: png });
  await expect(page.locator("[data-coupon-shot-note]")).toContainText("Read from the screenshot");
  await expect(page.locator("[data-coupon-amount]")).toHaveValue("1");
  await expect(page.locator("[data-coupon-expires]")).toHaveValue("2026-12-01");
  await expect(page.locator("[data-coupon-line]")).toHaveValue("milk");
  await page.getByRole("button", { name: "Add coupon" }).click();
  await expect(page.locator(".store-coupon-total")).toContainText("$2.18");
  await expect(page.locator(".trip-coupon-total")).toContainText("$2.18");
});

test("a split of catalog prices shows a savings callout versus one store", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem(
      "gg-profile",
      JSON.stringify({ shopStores: ["Aldi", "Walmart", "Kroger", "Target"], updatedAt: 1 })
    );
    localStorage.setItem(
      "gg-list",
      JSON.stringify([
        { id: "bananas", itemId: "bananas", name: "Bananas", quantity: 1 },
        { id: "butter", itemId: "butter", name: "Salted Butter", quantity: 1 },
      ])
    );
  });
  await unlock(page);
  await page.locator('[data-flow="plan"]').click();
  const callout = page.locator(".savings-callout");
  await expect(callout).toContainText("You save $0.08 versus Kroger");
  await expect(page.locator(".savings-card h2")).toHaveText("One store or this plan");
  const savingsBox = await page.locator(".savings-card").evaluate((el) => ({
    height: el.getBoundingClientRect().height,
    minHeight: getComputedStyle(el).minHeight,
  }));
  expect(savingsBox.minHeight).toBe("0px");
  expect(savingsBox.height).toBeGreaterThan(80);
  await expect(page.locator(".savings-lines")).toContainText("Everything at Kroger");
  await expect(page.locator(".savings-lines")).toContainText("$4.91");
  await expect(page.locator(".savings-lines")).toContainText("$4.83");
  await page.screenshot({ path: "/opt/cursor/artifacts/savings-callout.png" });
});

test("remembered favorites are grouped by department", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem(
      "gg-usuals",
      JSON.stringify([
        { name: "Large Eggs", brand: "Eggland's Best", quantity: 1, times: 2, lastAt: 2 },
        { name: "Whole Milk", brand: "Dairy Pure", quantity: 1, times: 2, lastAt: 2 },
        { name: "Bananas", brand: "Fresh", quantity: 1, times: 1, lastAt: 1 },
      ])
    );
  });
  await unlock(page);
  await page.locator("#tab-favorites").click();
  await expect(page.locator("#favorites-usuals .list-section-title", { hasText: "Dairy & Eggs" })).toBeVisible();
  await expect(page.locator("#favorites-usuals .list-section-title", { hasText: "Produce" })).toBeVisible();
});

test("a tailgate bun brand is kept and adds the catalog bun", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
  });
  await unlock(page);
  await page.locator("[data-lists-open]").click();
  await page.locator("[data-list-open='tailgate']").click();
  const brand = page.locator("[data-theme-brand='burger-buns']");
  await expect(page.locator("[data-theme-brand='soda']")).toBeVisible();
  await page.screenshot({ path: "/opt/cursor/artifacts/tailgate-brand.png" });
  await brand.fill("Pepperidge Farm");
  await page.reload();
  await page.locator("[data-lists-open]").click();
  await page.locator("[data-list-open='tailgate']").click();
  await expect(page.locator("[data-theme-brand='burger-buns']")).toHaveValue("Pepperidge Farm");
  await page.locator("[data-theme-brand='burger-buns']").fill("Martin's");
  await page.locator("[data-sheet-add='tailgate']").click();
  await expect(page.locator("#bar-count")).toContainText("5 items");
  const dismiss = page.getByRole("button", { name: "Dismiss guide" });
  await dismiss.waitFor({ state: "visible", timeout: 4000 }).catch(() => undefined);
  if (await dismiss.isVisible()) await dismiss.click();
  await page.locator("#list-bar-btn").click();
  const summary = page.locator("#trip-summary");
  await expect(summary).toContainText("Sesame Burger Buns");
  await expect(summary).not.toContainText("Hot Dog Buns");
  const bun = await page.evaluate(() => {
    const rows = JSON.parse(localStorage.getItem("gg-list") || "[]") as Array<{ id?: string; name?: string; brand?: string }>;
    return rows.find((row) => /sesame burger buns/i.test(row.name || "")) || null;
  });
  expect(bun?.name).toBe("Sesame Burger Buns");
  expect(bun?.brand).toBe("Martin's");
  expect(bun?.id).toBe("upc:99999600116");
  await page.screenshot({ path: "/opt/cursor/artifacts/tailgate-buns.png" });
});

test("a second guide does not replace the one already on screen", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
  });
  await unlock(page);
  const line = page.locator(".gitter-guide-line");
  await expect(line).toBeVisible();
  const first = (await line.innerText()).trim();
  expect(first.length).toBeGreaterThan(0);
  await page.locator("#browse-toggle").click();
  await page.locator("#search").fill("milk");
  await page.locator("#search").blur();
  await page.waitForTimeout(1500);
  await expect(line).toHaveText(first);
});

test("a Walmart coupon is not applied on the Kroger form", async ({ page }) => {
  await page.route("**/api/optimize-list", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        total: 3.29,
        partial: false,
        pendingStores: [],
        pricingByStore: [
          { storeName: "Kroger", check: "ok", source: "seed" },
          { storeName: "Walmart", check: "ok", source: "seed" },
        ],
        stores: [
          {
            storeName: "Kroger",
            subtotal: 3.29,
            items: [
              {
                lineId: "milk",
                name: "Whole Milk",
                title: "Whole Milk",
                price: 3.29,
                quantity: 1,
                itemTotal: 3.29,
                storeName: "Kroger",
                offers: [{ storeName: "Kroger", price: 3.29 }],
              },
            ],
          },
        ],
      }),
    });
  });
  await page.route("**/api/import/coupon", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        source: "screenshot",
        coupon: {
          storeName: "Walmart",
          itemName: "Whole Milk",
          kind: "dollars",
          amount: 1,
          expiresOn: "2026-12-01",
          gaps: [],
        },
      }),
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem("gg-list", JSON.stringify([{ id: "milk", itemId: "milk", name: "Whole Milk", quantity: 1 }]));
  });
  await unlock(page);
  await page.locator('[data-flow="plan"]').click();
  await page.getByText("Check Kroger coupons before you shop").click();
  await page.getByRole("button", { name: "Add a coupon" }).click();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  await page.locator("[data-coupon-shot]").setInputFiles({ name: "walmart.png", mimeType: "image/png", buffer: png });
  await expect(page.locator("[data-coupon-shot-note]")).toContainText("Read Walmart");
  await expect(page.locator("[data-coupon-shot-note]")).toContainText("not applied here");
  await expect(page.locator("[data-coupon-amount]")).toHaveValue("");
  await page.getByRole("button", { name: "Add coupon" }).click();
  await expect(page.locator("[data-coupon-error]")).toContainText("not applied here");
  await expect(page.locator(".store-coupon-total")).toHaveCount(0);
});

test("removing an imported line can be undone", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
  });
  await unlock(page);
  await page.locator("#add-items").click();
  await page.locator("#import-paste").fill("Whole Milk");
  await page.locator("#import-find").click();
  await expect(page.locator(".import-save")).toBeVisible();
  const overlap = await page.evaluate(() => {
    const remember = document.querySelector(".import-save")?.getBoundingClientRect();
    const actions = document.querySelector(".import-review-actions")?.getBoundingClientRect();
    if (!remember || !actions) return true;
    return remember.y < actions.y + actions.height && remember.y + remember.height > actions.y;
  });
  expect(overlap).toBe(false);
  await page.screenshot({ path: "/opt/cursor/artifacts/import-remember.png" });
  await page.getByRole("button", { name: /Remove/ }).first().click();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".import-review")).toContainText(/Milk/i);
});

test("coming back from a store opens the return sheet", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem("gg-list", JSON.stringify([{ id: "milk", itemId: "milk", name: "Whole Milk", quantity: 1 }]));
    window.open = () => ({ closed: false, focus() {}, close() {} });
  });
  await page.route("**/*", (route) => {
    const request = route.request();
    const url = request.url();
    if (request.isNavigationRequest() && (url.includes("handoff.html") || url.includes("walmart.com"))) return route.abort();
    return route.continue();
  });
  await unlock(page);
  await page.locator('[data-flow="plan"]').click();
  await page.evaluate(() => {
    window.open = () => window;
  });
  await page.getByRole("link", { name: "Walmart Cash" }).click();
  const armed = await page.evaluate(() => localStorage.getItem("gg-handoff-pending"));
  expect(armed).toBeTruthy();
  const result = await page.evaluate(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
    const original = descriptor && descriptor.get;
    Object.defineProperty(Document.prototype, "visibilityState", {
      configurable: true,
      get() {
        return this.__vis || (original ? original.call(this) : "visible");
      },
    });
    document.__vis = "hidden";
    const hiddenRead = document.visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((resolve) => setTimeout(resolve, 500));
    document.__vis = "visible";
    const visibleRead = document.visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
    const dialog = document.getElementById("store-return");
    return {
      hiddenRead,
      visibleRead,
      open: Boolean(dialog && dialog.open),
      title: dialog?.querySelector("h2")?.textContent || "",
      still: dialog?.querySelector("#store-return-no")?.textContent || "",
    };
  });
  expect(result.open, JSON.stringify(result)).toBe(true);
  expect(result.title).toMatch(/finish/i);
  expect(result.still).toMatch(/Still shopping/);
});

for (const size of [
  { width: 390, height: 844 },
  { width: 375, height: 667 },
]) {
test(`the finished-trip toast stays clear at ${size.width}x${size.height}`, async ({ page }) => {
  await page.setViewportSize(size);
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem("gg-list", JSON.stringify([{ id: "milk", itemId: "milk", name: "Whole Milk", quantity: 1 }]));
  });
  await unlock(page);
  await page.locator('[data-flow="plan"]').click();
  await expect(page.getByRole("button", { name: "Complete trip" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Complete trip" }).first().click();
  await expect(page.locator("#toast")).toContainText("Saved this trip to Past trips.");
  await page.getByRole("button", { name: "Turn off" }).waitFor({ timeout: 3000 }).catch(() => undefined);
  await page.waitForTimeout(300);
  const hit = await page.evaluate(() => {
    const box = (el: Element | null | undefined) => {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return null;
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom };
    };
    const intersects = (left: { x: number; y: number; width: number; height: number } | null, right: ReturnType<typeof box>) =>
      Boolean(left && right && left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y);
    const toast = box(document.querySelector("#toast"));
    const targets = {
      header: box(document.querySelector(".topbar")),
      ask: box(document.querySelector("#ask-hint")),
      favorites: box(document.querySelector("#usuals-toggle")),
      lists: box(document.querySelector("#starter-lists")),
      past: box(document.querySelector("#past-trips-home")),
      aisle: box(document.querySelector("#browse-toggle")),
      guide: box(document.querySelector("#gitter-guide")),
      off: box([...document.querySelectorAll("button")].find((button) => /turn off/i.test(button.textContent || "")) || null),
      dock: box(document.querySelector(".step-bar")),
      count: box(document.querySelector("#list-bar")),
      privacy: box(document.querySelector(".site-footer")),
    };
    const hits = Object.fromEntries(Object.entries(targets).map(([name, rect]) => [name, intersects(toast, rect)]));
    const aisleUnderGuide = intersects(targets.aisle, targets.guide);
    const listsUnderHeader = Boolean(targets.lists && targets.header && targets.lists.top < targets.header.bottom - 1);
    return { hits, aisleUnderGuide, listsUnderHeader, toast, targets, placed: document.querySelector("#toast")?.getAttribute("data-toast-place") || "" };
  });
  const covered = Object.entries(hit.hits).filter(([, value]) => value).map(([name]) => name);
  expect(covered, JSON.stringify(hit)).toEqual([]);
  expect(hit.aisleUnderGuide, JSON.stringify(hit)).toBe(false);
  expect(hit.listsUnderHeader, JSON.stringify(hit)).toBe(false);
  await page.screenshot({ path: `/opt/cursor/artifacts/complete-toast-${size.width}x${size.height}.png` });
  await page.locator("#toast-action").click();
  await expect(page.locator("#toast")).toContainText("Trip restored.");
  await expect(page.locator("#bar-count")).not.toHaveText("0 items");
});
}
