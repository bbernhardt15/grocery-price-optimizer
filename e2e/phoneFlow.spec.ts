import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

async function unlock(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.locator("#beta-code").first().fill("Brandon-50y4");
  await page.locator("#beta-gate-form button[type=submit]").first().click();
  await expect(page.locator("#beta-gate")).toBeHidden();
}

test("menu drag does not scroll the page, and the drawer can scroll", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
  });
  await unlock(page);
  await page.evaluate(() => {
    const filler = document.createElement("div");
    filler.id = "scroll-filler";
    filler.style.height = "1600px";
    document.body.appendChild(filler);
    window.scrollTo(0, 480);
  });
  await page.locator("#menu-open").click();
  await expect(page.locator("body")).toHaveAttribute("data-drawer", "open");
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.move(80, 500);
  await page.mouse.down();
  await page.mouse.move(80, 220, { steps: 8 });
  await page.mouse.up();
  const after = await page.evaluate(() => window.scrollY);
  expect(Math.abs(after - before)).toBeLessThan(2);
  const moved = await page.evaluate(() => {
    const drawer = document.getElementById("app-drawer");
    if (!drawer) return 0;
    const start = drawer.scrollTop;
    drawer.scrollTop = start + 180;
    return drawer.scrollTop - start;
  });
  expect(moved).toBeGreaterThan(0);
});

test("Add items from In-store closes back on In-store", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem("gg-step", "shop");
    localStorage.setItem(
      "gg-list",
      JSON.stringify([{ id: "custom:milk", itemId: "custom:milk", name: "Milk", quantity: 1 }])
    );
  });
  await unlock(page);
  await page.evaluate(() => {
    document.body.dataset.step = "shop";
  });
  await page.locator('[data-flow="shop"]').click();
  await expect(page.locator("body")).toHaveAttribute("data-step", "shop");
  await page.locator("#add-items").click();
  await expect(page.locator("#import-dialog")).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-step", "shop");
  const field = page.locator("#import-paste");
  await field.focus();
  const ring = await field.evaluate((el) => {
    const style = getComputedStyle(el);
    return { outline: style.outlineStyle, border: style.borderTopWidth, shrink: style.flexShrink };
  });
  expect(ring.outline).toBe("none");
  expect(Number.parseFloat(ring.border)).toBeGreaterThanOrEqual(2);
  expect(ring.shrink).toBe("0");
  await page.locator("#import-close").click();
  await expect(page.locator("#import-dialog")).toBeHidden();
  await expect(page.locator("body")).toHaveAttribute("data-step", "shop");
});

test("Refresh keeps the Review list and scroll until the new prices arrive", async ({ page }) => {
  let release = () => {};
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const plan = (count: number) => ({
    total: count * 2,
    partial: false,
    pendingStores: [],
    pricingByStore: [
      { storeName: "Kroger", check: "ok" },
      { storeName: "Walmart", check: "ok" },
    ],
    stores: [
      {
        storeName: "Kroger",
        subtotal: count * 2,
        items: Array.from({ length: count }, (_, index) => ({
          lineId: `line-${index}`,
          name: `Review line ${index + 1}`,
          price: 2,
          quantity: 1,
          itemTotal: 2,
          storeName: "Kroger",
          department: "Pantry",
        })),
      },
    ],
  });
  await page.route("**/sw.js", (route) => route.abort());
  await page.route("**/api/optimize-list", async (route) => {
    calls += 1;
    if (calls === 1) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(plan(80)) });
      return;
    }
    await held;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(plan(12)) });
  });
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem(
      "gg-list",
      JSON.stringify(
        Array.from({ length: 80 }, (_, index) => ({
          id: `custom:line-${index}`,
          itemId: `custom:line-${index}`,
          name: `Review line ${index + 1}`,
          quantity: 1,
        }))
      )
    );
  });
  await unlock(page);
  await page.locator('[data-flow="plan"]').click();
  const lines = page.locator("#trip [data-plan-panel='spread'] .review-lines li");
  await expect(lines).toHaveCount(80);
  const fold = page.locator("#trip details.store-fold");
  await fold.evaluate((node) => {
    (node as HTMLDetailsElement).open = true;
  });
  const anchor = page.locator("#trip [data-review-line='line-8']");
  const placed = await anchor.evaluate((node) => {
    const top = node.getBoundingClientRect().top + window.scrollY - 180;
    window.scrollTo(0, Math.max(0, top));
    return { scrollY: window.scrollY, lineTop: node.getBoundingClientRect().top };
  });
  expect(placed.scrollY).toBeGreaterThan(200);
  await page.locator("#plan-refresh").evaluate((button) => (button as HTMLButtonElement).click());
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.scrollY)).toBe(placed.scrollY);
  await expect(lines).toHaveCount(80);
  await expect(page.locator("[data-review-refresh]")).toBeVisible();
  const heldLine = await anchor.evaluate((node) => node.getBoundingClientRect().top);
  expect(Math.abs(heldLine - placed.lineTop)).toBeLessThan(2);
  release();
  await expect(lines).toHaveCount(12);
  await expect(fold).toHaveJSProperty("open", true);
  const landed = await anchor.evaluate((node) => ({
    scrollY: window.scrollY,
    lineTop: node.getBoundingClientRect().top,
  }));
  expect(Math.abs(landed.scrollY - placed.scrollY)).toBeLessThan(24);
  expect(Math.abs(landed.lineTop - placed.lineTop)).toBeLessThan(24);
  expect(await page.evaluate(() => document.getElementById("trip")?.style.minHeight || "")).toBe("");

  await fold.evaluate((node) => {
    (node as HTMLDetailsElement).open = false;
  });
  const closed = await page.evaluate(() => {
    const trip = document.getElementById("trip");
    const children = [...(trip?.children || [])].reduce((sum, child) => sum + child.getBoundingClientRect().height, 0);
    return {
      min: trip?.style.minHeight || "",
      children,
      scrollHeight: document.documentElement.scrollHeight,
    };
  });
  expect(closed.min).toBe("");
  expect(closed.scrollHeight).toBeLessThan(closed.children + 1400);

  await page.locator("#plan-refresh").evaluate((button) => (button as HTMLButtonElement).click());
  await expect(lines).toHaveCount(12);
  expect(await page.evaluate(() => document.getElementById("trip")?.style.minHeight || "")).toBe("");

  await page.locator("#step-bar [data-flow='shop']").click();
  await expect(page.locator("body")).toHaveAttribute("data-step", "shop");
  await page.locator("#step-bar [data-flow='plan']").click();
  await expect(page.locator("body")).toHaveAttribute("data-step", "plan");
  await expect(lines).toHaveCount(12);
  const returned = await page.evaluate(() => {
    const trip = document.getElementById("trip");
    const children = [...(trip?.children || [])].reduce((sum, child) => sum + child.getBoundingClientRect().height, 0);
    return {
      min: trip?.style.minHeight || "",
      y: window.scrollY,
      children,
      scrollHeight: document.documentElement.scrollHeight,
    };
  });
  expect(returned.min).toBe("");
  expect(returned.y).toBeLessThan(40);
  expect(returned.scrollHeight).toBeLessThan(returned.children + 1400);
});

test("an intentional scroll during refresh is kept, including when the request fails", async ({ page }) => {
  let releaseHold = () => {};
  let releaseError = () => {};
  let releaseAgain = () => {};
  let releaseTab = () => {};
  const hold = new Promise<void>((resolve) => {
    releaseHold = resolve;
  });
  const errorGate = new Promise<void>((resolve) => {
    releaseError = resolve;
  });
  const again = new Promise<void>((resolve) => {
    releaseAgain = resolve;
  });
  const tabGate = new Promise<void>((resolve) => {
    releaseTab = resolve;
  });
  let calls = 0;
  let mode: "hold" | "error" | "again" | "tab" = "hold";
  const plan = {
    total: 80,
    partial: false,
    pendingStores: [],
    pricingByStore: [
      { storeName: "Kroger", check: "ok" },
      { storeName: "Walmart", check: "ok" },
    ],
    stores: [
      {
        storeName: "Kroger",
        subtotal: 80,
        items: Array.from({ length: 40 }, (_, index) => ({
          lineId: `line-${index}`,
          name: `Review line ${index + 1}`,
          price: 2,
          quantity: 1,
          itemTotal: 2,
          storeName: "Kroger",
          department: "Pantry",
        })),
      },
    ],
  };
  await page.route("**/sw.js", (route) => route.abort());
  await page.route("**/api/optimize-list", async (route) => {
    calls += 1;
    if (calls === 1) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(plan) });
      return;
    }
    if (mode === "error") {
      await errorGate;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "nope" }) });
      return;
    }
    if (mode === "again") await again;
    else if (mode === "tab") await tabGate;
    else await hold;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(plan) });
  });
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    localStorage.setItem(
      "gg-list",
      JSON.stringify(
        Array.from({ length: 40 }, (_, index) => ({
          id: `custom:line-${index}`,
          itemId: `custom:line-${index}`,
          name: `Review line ${index + 1}`,
          quantity: 1,
        }))
      )
    );
  });
  await unlock(page);
  await page.locator("#step-bar [data-flow='plan']").click();
  const fold = page.locator("#trip details.store-fold");
  await fold.evaluate((node) => {
    (node as HTMLDetailsElement).open = true;
  });
  const start = await page.locator("#trip [data-review-line='line-4']").evaluate((node) => {
    const top = node.getBoundingClientRect().top + window.scrollY - 160;
    window.scrollTo(0, Math.max(0, top));
    return window.scrollY;
  });
  expect(start).toBeGreaterThan(80);

  const jumped = await page.evaluate(() => {
    document.getElementById("plan-refresh")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    window.scrollTo(0, 0);
    return window.scrollY;
  });
  expect(jumped).toBe(0);
  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBe(start);

  const moved = await page.evaluate((from) => {
    window.dispatchEvent(new WheelEvent("wheel", { deltaY: 240, bubbles: true, cancelable: true }));
    const next = from + 320;
    window.scrollTo(0, next);
    return window.scrollY;
  }, start);
  expect(moved).toBeGreaterThan(start + 200);
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => window.scrollY)).toBe(moved);
  const seen = await page.evaluate(() => {
    const line = [...document.querySelectorAll("[data-review-line]")].find((node) => {
      const top = node.getBoundingClientRect().top;
      return top >= 48 && top < window.innerHeight * 0.72;
    });
    return { id: line?.getAttribute("data-review-line") || "", top: line?.getBoundingClientRect().top || 0 };
  });
  expect(seen.id).not.toBe("");
  releaseHold();
  await expect(page.locator(`[data-review-line='${seen.id}']`)).toBeAttached();
  await expect.poll(async () => page.evaluate((target) => Math.abs(window.scrollY - target), moved)).toBeLessThan(48);
  const landed = await page.evaluate((id) => {
    const line = document.querySelector(`[data-review-line="${id}"]`);
    return { y: window.scrollY, top: line?.getBoundingClientRect().top || 0, min: document.getElementById("trip")?.style.minHeight || "" };
  }, seen.id);
  expect(Math.abs(landed.y - moved)).toBeLessThan(48);
  expect(Math.abs(landed.top - seen.top)).toBeLessThan(48);
  expect(landed.min).toBe("");

  mode = "error";
  const beforeError = await page.evaluate(() => window.scrollY);
  const duringError = await page.evaluate((from) => {
    document.getElementById("plan-refresh")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    window.scrollTo(0, from + 160);
    return window.scrollY;
  }, beforeError);
  expect(duringError).toBeGreaterThan(beforeError + 80);
  releaseError();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.scrollY)).toBe(duringError);
  expect(await page.evaluate(() => document.getElementById("trip")?.style.minHeight || "")).toBe("");

  mode = "again";
  const duringAgain = await page.evaluate((from) => {
    document.getElementById("plan-refresh")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.documentElement.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    window.scrollTo(0, from + 120);
    document.getElementById("plan-refresh")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return window.scrollY;
  }, duringError);
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => window.scrollY)).toBe(duringAgain);
  releaseAgain();
  await page.waitForTimeout(300);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - duringAgain)).toBeLessThan(48);

  mode = "tab";
  await page.evaluate(() => {
    document.getElementById("plan-refresh")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await page.locator("#step-bar [data-flow='shop']").click();
  await expect(page.locator("body")).toHaveAttribute("data-step", "shop");
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(40);
  releaseTab();
});

test("a late aisle response cannot change the next page cursor", async ({ page }) => {
  let releaseProduce = () => {};
  const produceHeld = new Promise<void>((resolve) => {
    releaseProduce = resolve;
  });
  const seen: Array<{ department: string; cursor: string }> = [];
  await page.route("**/api/catalog/departments**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        departments: [
          { id: "produce", name: "Produce" },
          { id: "dairy", name: "Dairy" },
        ],
      }),
    });
  });
  await page.route("**/api/catalog/browse**", async (route) => {
    const url = new URL(route.request().url());
    const department = url.searchParams.get("department") || "all";
    const cursor = url.searchParams.get("cursor") || "";
    seen.push({ department, cursor });
    if (department === "produce") {
      await produceHeld;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [{ id: "produce-1", name: "PRODUCE ONLY", familyName: "PRODUCE ONLY", brand: "Test", imageUrls: [], variants: [] }],
          total: 1,
          nextCursor: "cursor-produce",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [{ id: "dairy-1", name: "DAIRY ONLY", familyName: "DAIRY ONLY", brand: "Test", imageUrls: [], variants: [] }],
        total: 1,
        // Only the first Dairy page continues. A later page that always
        // returns a cursor makes the tall WebKit viewport load forever.
        nextCursor: department === "dairy" && !cursor ? "cursor-dairy" : null,
      }),
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
    if (navigator.serviceWorker) {
      navigator.serviceWorker.register = () => Promise.resolve({} as ServiceWorkerRegistration);
    }
  });
  await unlock(page);
  await page.locator("#browse-toggle").click();
  await page.locator(".chip[data-dept='produce']").click();
  await page.locator(".chip[data-dept='dairy']").click();
  await expect(page.locator("#grid")).toContainText("DAIRY ONLY");
  releaseProduce();
  await page.waitForTimeout(500);
  await expect(page.locator("#grid")).toContainText("DAIRY ONLY");
  await expect(page.locator("#grid")).not.toContainText("PRODUCE ONLY");
  const more = page.locator("#show-more");
  if (await more.isVisible()) await more.evaluate((button) => (button as HTMLButtonElement).click());
  await expect.poll(() => seen.some((row) => row.cursor === "cursor-dairy")).toBe(true);
  expect(seen.some((row) => row.cursor === "cursor-produce")).toBe(false);
});

test("Refine opens without focusing the sort menu", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-zip", "45103");
  });
  await unlock(page);
  await page.locator("#browse-toggle").click();
  await page.locator("#filters-open").click();
  await expect(page.locator("#filters")).toHaveClass(/open/);
  await expect(page.locator("#sort")).not.toBeFocused();
  const box = await page.locator("#filters").boundingBox();
  expect(box && box.height).toBeGreaterThan(120);
});
