import assert from "node:assert/strict";
import { createReadStream, existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { once } from "node:events";
import { describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { nextTrapTarget, swipeClosesDrawer } from "../../public/shopper/drawer.js";
import { zipPlaceLabel } from "../../public/shopper/zipPlace.js";

const root = path.resolve(__dirname, "../..");
const publicDir = path.join(root, "public");

function chromeExecutable(): string {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "/usr/local/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
  ].filter((value): value is string => Boolean(value));
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("Chrome is required for the phone chrome layout test");
  return found;
}

describe("menu drawer and ZIP place", () => {
  it("names a known ZIP and leaves an unknown one as digits", () => {
    assert.equal(zipPlaceLabel("45103"), "Cincinnati 45103");
    assert.equal(zipPlaceLabel("45202"), "Cincinnati 45202");
    assert.equal(zipPlaceLabel("10001-1234"), "New York 10001");
    assert.equal(zipPlaceLabel("99999"), "99999");
    assert.equal(zipPlaceLabel("451"), "");
  });

  it("traps focus and treats a left swipe as close", () => {
    const ids = ["drawer-close", "zip", "help-terms"];
    assert.equal(nextTrapTarget(ids, "help-terms", false), "drawer-close");
    assert.equal(nextTrapTarget(ids, "drawer-close", true), "help-terms");
    assert.equal(nextTrapTarget(ids, "zip", false), null);
    assert.equal(nextTrapTarget([], "zip", false), null);
    assert.equal(swipeClosesDrawer(180, 100), true);
    assert.equal(swipeClosesDrawer(180, 160), false);
    assert.equal(swipeClosesDrawer(40, 120), false);
  });
});

/** tsx rewrites nested functions with a `__name` helper that does not exist in the page. */
function inPage<T>(page: Page, body: string): Promise<T> {
  return page.evaluate(new Function(body) as () => T);
}

const SEED_PAGE = `
  localStorage.setItem("gg-onboarding-done", "1");
  localStorage.setItem("gg-theme", "dark");
  localStorage.setItem("gg-zip", "45103");
  localStorage.setItem("gg-step", "add");
  document.documentElement.style.setProperty("--safe-area-inset-top", "47px");
  document.documentElement.style.setProperty("--safe-area-inset-bottom", "34px");
`;

const MEASURE_CHROME = `
  const shown = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return false;
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
  };
  const shopBtn = document.querySelector('.step-bar [data-flow="shop"]');
  const shopBox = shopBtn ? shopBtn.getBoundingClientRect() : null;
  const labels = Array.from(document.querySelectorAll(".step-bar button")).map((button) => ({
    text: button.textContent ? button.textContent.trim() : "",
    height: Math.round(button.getBoundingClientRect().height),
    wrap: getComputedStyle(button).whiteSpace,
  }));
  const headerButtons = ["#zip", "#theme-btn", "#settings-open", "#alerts-toggle"].map((selector) => {
    const node = document.querySelector(selector);
    const box = node ? node.getBoundingClientRect() : null;
    return { selector, top: box ? Math.round(box.top) : null, left: box ? Math.round(box.left) : null };
  });
  const topbar = document.querySelector(".topbar");
  return {
    step: document.body.dataset.step,
    chrome: document.body.dataset.chrome,
    title: document.getElementById("brand-title") ? document.getElementById("brand-title").textContent : "",
    steps: shown("#step-bar"),
    summary: shown("#list-bar"),
    shop: shown("#shop-bar"),
    menu: shown("#menu-open"),
    shopRight: shopBox ? Math.round(shopBox.right) : 0,
    inner: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
    labels,
    headerButtons,
    place: document.getElementById("zip-place") ? document.getElementById("zip-place").textContent : "",
    headerPad: topbar ? Math.round(parseFloat(getComputedStyle(topbar).paddingTop)) : 0,
  };
`;

describe("one bottom bar per step", { timeout: 60_000 }, () => {
  let server: http.Server;
  let origin: string;
  let browser: Browser;
  let page: Page;

  it("shows the step dock on Add and Plan, and only the in-store bar on Shop", async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const file = path.normalize(path.join(publicDir, rel));
      if (!file.startsWith(publicDir)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const stream = createReadStream(file);
      stream.on("error", () => {
        res.writeHead(404);
        res.end();
      });
      const type = file.endsWith(".css") ? "text/css" : file.endsWith(".js") ? "text/javascript" : "text/html";
      res.setHeader("Content-Type", type);
      stream.pipe(res);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    browser = await puppeteer.launch({
      executablePath: chromeExecutable(),
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    try {
      page = await browser.newPage();
      await page.setViewport({ width: 393, height: 852, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
      await page.evaluateOnNewDocument(new Function(SEED_PAGE) as () => void);
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#bottom-dock");
      await inPage(page, `
        document.documentElement.style.setProperty("--safe-area-inset-top", "47px");
        document.documentElement.style.setProperty("--safe-area-inset-bottom", "34px");
      `);
      await page.waitForFunction(
        new Function('return document.getElementById("zip-place") && document.getElementById("zip-place").textContent.includes("45103")') as () => boolean
      );

      const add = await inPage<any>(page, MEASURE_CHROME);
      assert.equal(add.title, "Add items");
      assert.equal(add.steps, true);
      assert.equal(add.summary, true);
      assert.equal(add.shop, false);
      assert.equal(add.menu, true);
      assert.ok(add.shopRight <= add.inner, "Shop stays inside the screen");
      assert.ok(add.scroll <= add.inner + 1);
      assert.deepEqual(
        add.labels.map((label: { text: string }) => label.text),
        ["Add", "Plan", "Shop"]
      );
      for (const label of add.labels) {
        assert.ok(label.height >= 44, `${label.text} is at least 44px`);
        assert.equal(label.wrap, "nowrap");
      }
      for (const control of add.headerButtons) {
        assert.ok((control.left ?? 0) < 0, `${control.selector} stays in the closed drawer`);
      }
      assert.equal(add.place, "Cincinnati 45103");
      assert.ok(add.headerPad >= 47, "header keeps the top safe area");

      await inPage(page, `
        document.body.dataset.step = "plan";
        const title = document.getElementById("brand-title");
        if (title) title.textContent = "Your plan";
      `);
      const plan = await inPage<any>(page, MEASURE_CHROME);
      assert.equal(plan.steps, true);
      assert.equal(plan.summary, true);
      assert.equal(plan.shop, false);

      await inPage(page, `
        document.body.dataset.step = "shop";
        const title = document.getElementById("brand-title");
        if (title) title.textContent = "In the store";
      `);
      const shop = await inPage<any>(page, MEASURE_CHROME);
      assert.equal(shop.steps, false);
      assert.equal(shop.summary, false);
      assert.equal(shop.shop, true);
      assert.equal(shop.title, "In the store");

      await page.click("#menu-open");
      await page.waitForSelector("#app-drawer.is-open");
      await page.waitForFunction(
        new Function(`
          const zip = document.getElementById("zip");
          return zip && zip.getBoundingClientRect().left >= 0;
        `) as () => boolean
      );
      const drawer = await inPage<any>(page, `
        const zip = document.getElementById("zip").getBoundingClientRect();
        const scrim = document.getElementById("drawer-scrim");
        const scrimStyle = scrim ? getComputedStyle(scrim).display : "none";
        const refresh = document.getElementById("refresh-prices").getBoundingClientRect();
        return {
          zipLeft: Math.round(zip.left),
          zipHeight: Math.round(zip.height),
          scrim: scrimStyle !== "none",
          expanded: document.getElementById("menu-open").getAttribute("aria-expanded"),
          refreshTop: Math.round(refresh.top),
          refreshHeight: Math.round(refresh.height),
        };
      `);
      assert.ok(drawer.zipLeft >= 0);
      assert.ok(drawer.zipHeight >= 44);
      assert.equal(drawer.scrim, true);
      assert.equal(drawer.expanded, "true");
      assert.ok(drawer.refreshHeight >= 44, "Refresh prices is a 44px target");
      assert.ok(drawer.refreshTop < 700, "Refresh prices is reachable in the drawer");

      await page.keyboard.press("Escape");
      await page.waitForFunction(
        new Function('return !document.getElementById("app-drawer").classList.contains("is-open")') as () => boolean
      );

      await inPage(page, 'document.documentElement.style.setProperty("--keyboard", "280px")');
      const lifted = await inPage<{ bottom: number }>(page, `
        const dock = document.getElementById("bottom-dock").getBoundingClientRect();
        return { bottom: Math.round(window.innerHeight - dock.bottom) };
      `);
      assert.ok(lifted.bottom >= 280, "the dock sits above the keyboard inset");
    } finally {
      await page?.close().catch(() => {});
      await browser.close().catch(() => {});
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});

describe("phone taps after Kroger", { timeout: 60_000 }, () => {
  it("keeps Done, Send to Kroger cart, and Refresh prices tappable at iPhone sizes", async () => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const file = path.normalize(path.join(publicDir, rel));
      if (!file.startsWith(publicDir)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const stream = createReadStream(file);
      stream.on("error", () => {
        res.writeHead(404);
        res.end();
      });
      res.setHeader("Content-Type", file.endsWith(".css") ? "text/css" : file.endsWith(".js") ? "text/javascript" : "text/html");
      stream.pipe(res);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const browser = await puppeteer.launch({
      executablePath: chromeExecutable(),
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    try {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument(new Function(SEED_PAGE) as () => void);
      for (const size of [
        { width: 375, height: 667 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewport({ ...size, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
        await page.goto(origin, { waitUntil: "domcontentloaded" });
        await page.waitForSelector("#shop-done");
        await inPage(page, `
          document.documentElement.style.setProperty("--safe-area-inset-top", "47px");
          document.documentElement.style.setProperty("--safe-area-inset-bottom", "34px");
        `);
        const hits = await inPage<any>(page, `
          document.documentElement.style.setProperty("--safe-area-inset-top", "47px");
          document.documentElement.style.setProperty("--safe-area-inset-bottom", "34px");
          document.body.dataset.step = "shop";
          const done = document.getElementById("shop-done");
          done.disabled = false;
          done.textContent = "Done";
          const shop = document.getElementById("shop");
          shop.hidden = false;
          shop.innerHTML = '<div class="shop-actions"><button class="handoff-btn" id="send-probe" type="button">Send to Kroger cart</button></div>';
          document.getElementById("grid").hidden = true;
          document.getElementById("trip").hidden = true;
          document.getElementById("start-here").hidden = true;
          const probe = document.getElementById("send-probe");
          probe.scrollIntoView({ block: "center" });
          const hit = (id) => {
            const el = document.getElementById(id);
            const box = el.getBoundingClientRect();
            const x = Math.min(window.innerWidth - 2, Math.max(2, Math.round(box.left + Math.min(box.width / 2, 80))));
            const y = Math.round(box.top + box.height / 2);
            const top = document.elementFromPoint(x, y);
            const covered = !(top === el || el.contains(top));
            return {
              id,
              covered,
              top: top ? (top.id || top.className || top.tagName) : "",
              height: Math.round(box.height),
              topEdge: Math.round(box.top),
              bottom: Math.round(box.bottom),
              inner: window.innerHeight,
              disabled: "disabled" in el ? el.disabled : false,
            };
          };
          return { done: hit("shop-done"), send: hit("send-probe"), count: hit("shop-status") };
        `);
        assert.equal(hits.done.covered, false, `${size.width} Done is covered by ${hits.done.top}`);
        assert.equal(hits.done.disabled, false);
        assert.ok(hits.done.height >= 44, `${size.width} Done is at least 44px`);
        assert.ok(hits.done.bottom <= size.height, `${size.width} Done stays inside the screen`);
        assert.ok(hits.done.topEdge >= 0);
        assert.equal(hits.count.covered, false, `${size.width} N left is covered by ${hits.count.top}`);
        assert.equal(hits.send.covered, false, `${size.width} Send to Kroger cart is covered by ${hits.send.top}`);
        assert.ok(hits.send.height >= 44);

        await page.click("#menu-open");
        await page.waitForSelector("#app-drawer.is-open");
        await page.waitForFunction(
          new Function(`
            const el = document.getElementById("refresh-prices");
            const box = el.getBoundingClientRect();
            return box.left >= 0 && box.height >= 44 && box.bottom <= window.innerHeight;
          `) as () => boolean
        );
        const refresh = await inPage<any>(page, `
          const el = document.getElementById("refresh-prices");
          el.scrollIntoView({ block: "center" });
          const box = el.getBoundingClientRect();
          const x = Math.round(box.left + box.width / 2);
          const y = Math.round(box.top + box.height / 2);
          const top = document.elementFromPoint(x, y);
          return {
            covered: !(top === el || el.contains(top)),
            top: top ? (top.id || top.className || top.tagName) : "",
            height: Math.round(box.height),
            bottom: Math.round(box.bottom),
          };
        `);
        assert.equal(refresh.covered, false, `${size.width} Refresh prices is covered by ${refresh.top}`);
        assert.ok(refresh.height >= 44);
        assert.ok(refresh.bottom <= size.height);
        await page.keyboard.press("Escape");
      }

      await page.goto(origin, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#settings-dialog");
      const returned = await inPage<any>(page, `
        document.getElementById("settings-dialog").showModal();
        document.body.style.overflow = "hidden";
        document.getElementById("app-drawer").classList.add("is-open");
        document.getElementById("drawer-scrim").hidden = false;
        history.pushState({}, "", "/?kroger=connected&step=plan&message=Kroger%20connected.");
        window.dispatchEvent(new PopStateEvent("popstate"));
        const card = document.getElementById("kroger-card");
        const dialog = document.getElementById("settings-dialog");
        return {
          step: document.body.dataset.step,
          title: document.getElementById("brand-title").textContent,
          dialog: dialog.open,
          cardHidden: card.hidden,
          cardText: card.textContent || "",
          scrimHidden: document.getElementById("drawer-scrim").hidden,
          drawerOpen: document.getElementById("app-drawer").classList.contains("is-open"),
          overflow: document.body.style.overflow,
          connected: localStorage.getItem("gg-kroger-connected"),
        };
      `);
      assert.equal(returned.step, "plan");
      assert.equal(returned.title, "Your plan");
      assert.equal(returned.dialog, false);
      assert.equal(returned.cardHidden, false);
      assert.match(returned.cardText, /Kroger connected/);
      assert.match(returned.cardText, /Send to Kroger cart/);
      assert.match(returned.cardText, /Open Kroger cart/);
      assert.equal(returned.scrimHidden, true);
      assert.equal(returned.drawerOpen, false);
      assert.equal(returned.overflow, "");
      assert.equal(returned.connected, "1");
    } finally {
      await browser.close().catch(() => {});
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
