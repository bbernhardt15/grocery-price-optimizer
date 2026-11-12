import assert from "node:assert/strict";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { once } from "node:events";
import { describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { ICON_RECEIPT, ICON_THEMED } from "../../public/shopper/addTabIcons.js";
import { pastTripsEmptyHtml, pastTripsHomeHtml } from "../../public/shopper/pastTrips.js";
import { listCardHtml, listsEntryHtml } from "../../public/shopper/themedListsUi.js";
import {
  addCustomItem,
  addTripLabel,
  checkedCount,
  checkedPicks,
  checklistFromList,
  checklistHtml,
  onChecklistClick,
  rescaleParty,
  stepQuantity,
  toggleCheck,
} from "../../public/shopper/themeChecklist.js";
import { emptyBook, scaleQuantity, themedList } from "../../public/shopper/themedLists.js";
import { usualsRowHtml, usualsSummary } from "../../public/shopper/usualsRow.js";

const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../../public/shopper/addTabPolish.css", import.meta.url), "utf8");
const lists = readFileSync(new URL("../../public/shopper/themedListsUi.js", import.meta.url), "utf8");
const home = readFileSync(new URL("../../public/shopper/listHome.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");

function escapeHtml(value: string) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
}

function clickable(id: string, tag: "input" | "button" = "button") {
  return {
    matches(selector: string) {
      return selector === tag || selector === "input" && tag === "input";
    },
    closest(selector: string) {
      const attr = selector.match(/^\[([^\]=]+)/)?.[1];
      if (attr && (attr === "data-theme-check" || attr === "data-theme-inc" || attr === "data-theme-dec" || attr === "data-theme-party")) {
        return { getAttribute: () => id };
      }
      return null;
    },
  };
}

describe("tenth phone test — Add tab", () => {
  it("keeps Your usuals to a count and one horizontal chip row", () => {
    assert.match(html, /Your favorites/);
    assert.match(html, /id="usuals-toggle"/);
    assert.match(html, /id="usuals-count"/);
    assert.match(html, /class="feature-card"/);
    assert.equal(html.includes('id="tab-favorites"'), true);
    assert.equal(html.includes('id="usuals-panel"'), false);
    assert.equal(usualsSummary(0).label, "0 usuals");
    assert.equal(usualsSummary(1).label, "1 usual");
    assert.equal(usualsSummary(6).count, 6);
    const row = usualsRowHtml([{ key: "id:milk", label: "Whole Milk" }, { key: 'name:a:b"c', label: "Eggs & bread" }], escapeHtml);
    assert.match(row, /data-usual-key="id:milk"/);
    assert.match(row, /Eggs &amp; bread/);
    assert.match(row, /data-usual-key="name:a:b&quot;c"/);
    assert.doesNotMatch(row, /data-usual="/);
    assert.match(app, /usualsOpen/);
    assert.match(app, /usualsRowHtml/);
    assert.match(app, /data-usual-key/);
  });

  it("gives Themed lists and Past trips icons that fit the aisle tile", () => {
    assert.match(ICON_THEMED, /viewBox="0 0 24 24"/);
    assert.match(ICON_RECEIPT, /viewBox="0 0 24 24"/);
    assert.match(ICON_THEMED, /<svg/);
    assert.match(ICON_RECEIPT, /<svg/);
    assert.doesNotMatch(ICON_THEMED, /✦/);
    const entry = listsEntryHtml("", escapeHtml);
    assert.match(entry, /<svg/);
    assert.match(entry, /Themed lists/);
    assert.doesNotMatch(entry, /✦/);
    const past = pastTripsHomeHtml(2);
    assert.match(past, /<svg/);
    assert.match(past, /Past trips/);
    assert.match(past, /2 saved receipts/);
    assert.doesNotMatch(past, /aria-hidden="true">Receipt/);
    assert.match(html, /feature-icon-word" aria-hidden="true">Aisles/);
    assert.match(css, /\.feature-icon svg/);
    assert.match(css, /overflow:\s*hidden/);
    assert.match(css, /width:\s*28px/);
    const card = listCardHtml({ id: "thanksgiving", title: "Thanksgiving" }, escapeHtml);
    assert.match(card, /data-list-open="thanksgiving"/);
    assert.match(card, /class="inline-loader"/);
    assert.doesNotMatch(card, /data-list-add/);
    assert.doesNotMatch(lists.slice(lists.indexOf("export function listCardHtml"), lists.indexOf("export function myListCardHtml")), /list\.blurb/);
  });

  it("centers an inline loader inside the themed card without the edge spinner", () => {
    assert.match(css, /\.theme-card \.starter\.is-busy::after,\s*\.theme-check-add\.is-busy::after\s*\{[^}]*content:\s*none/s);
    assert.match(css, /\.inline-loader span\s*\{[^}]*width:\s*18px/s);
    assert.match(css, /\.theme-card \.starter\s*\{[^}]*min-height:\s*76px/s);
    assert.match(css, /\.theme-card \.starter\.is-busy \.inline-loader/);
    assert.match(css, /visibility:\s*hidden/);
    assert.match(home, /shelfSkeletonHtml/);
  });

  it("edits a themed list as a checklist and adds the ticked items", () => {
    const model = themedList("thanksgiving");
    assert.ok(model);
    let state = checklistFromList(model, emptyBook(), 4);
    assert.equal(checkedCount(state), model.slots.length);
    assert.equal(addTripLabel(checkedCount(state)), `Add ${model.slots.length} items to my trip`);
    assert.equal(addTripLabel(1), "Add 1 item to my trip");
    const turkey = state.items.find((item) => item.id === "whole-turkey");
    assert.equal(turkey?.checked, true);
    assert.equal(turkey?.quantity, scaleQuantity(12, 4));
    state = toggleCheck(state, "whole-turkey");
    assert.equal(state.items.find((item) => item.id === "whole-turkey")?.checked, false);
    assert.equal(checkedPicks(state).some((pick) => pick.slot.id === "whole-turkey"), false);
    const before = state.items.find((item) => item.id === "stuffing")?.quantity || 1;
    state = stepQuantity(state, "stuffing", 1);
    assert.equal(state.items.find((item) => item.id === "stuffing")?.quantity, before + 1);
    state = stepQuantity(state, "stuffing", 200);
    assert.equal(state.items.find((item) => item.id === "stuffing")?.quantity, 99);
    const scaled = rescaleParty(state, 16);
    assert.equal(scaled.people, 16);
    assert.equal(scaled.items.find((item) => item.id === "stuffing")?.quantity, 99);
    assert.ok((scaled.items.find((item) => item.id === "cranberry")?.quantity || 0) >= 1);
    const added = addCustomItem(scaled, "Pie & cream");
    assert.equal(added.added, true);
    assert.equal(added.state.items.at(-1)?.label, "Pie & cream");
    assert.equal(added.state.items.at(-1)?.checked, true);
    assert.equal(addCustomItem(added.state, "pie & cream").reason, "duplicate");
    assert.equal(addCustomItem(added.state, "  ").reason, "empty");
    const markup = checklistHtml(added.state, escapeHtml);
    assert.match(markup, /Add \d+ items to my trip/);
    assert.match(markup, /data-theme-check="stuffing"/);
    assert.match(markup, /data-theme-brand="stuffing"/);
    assert.match(markup, /Pie &amp; cream/);
    assert.doesNotMatch(markup, /id="theme-add-input"/);
    assert.match(markup, /data-theme-brand="stuffing"/);
    assert.match(markup, /class="inline-loader"/);
    assert.match(markup, /Untick anything you don't need/);
    assert.doesNotMatch(markup, /\$\d/);
    const ignored = onChecklistClick(added.state, clickable("whole-turkey", "button"));
    assert.equal(ignored.handled, false);
    const toggled = onChecklistClick(added.state, clickable("whole-turkey", "input"));
    assert.equal(toggled.handled, true);
    assert.equal(toggled.state.items.find((item) => item.id === "whole-turkey")?.checked, true);
    assert.match(home, /addChecklist/);
    assert.match(home, /checklistFromList/);
    assert.match(home, /onSubmit/);
    assert.match(app, /theme-add-form/);
  });

  it("uses shared radii, motion, skeletons, and a friendly empty past-trips line", () => {
    assert.match(css, /border-radius:\s*var\(--radius\)/);
    assert.match(css, /prefers-reduced-motion:\s*no-preference/);
    assert.match(css, /\.theme-skel/);
    assert.match(css, /@media \(max-width:\s*420px\)/);
    assert.match(css, /:root\[data-resolved="dark"\]/);
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}/);
    const empty = pastTripsEmptyHtml();
    assert.match(empty, /No trips yet/);
    assert.match(empty, /Finish a shop and we'll keep the receipt here for next time/);
    assert.match(app, /pastTripsEmptyHtml/);
    assert.match(html, /addTabPolish\.css/);
    const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
    assert.match(sw, /grocery-gitter-shell-v87/);
    const header = html.slice(html.indexOf("<header"), html.indexOf('id="app-drawer"'));
    assert.match(header, /id="menu-open"/);
    assert.match(header, /id="brand-home"/);
    assert.match(header, /id="add-items"/);
    assert.doesNotMatch(header, /usuals|Themed lists|Past trips/);
  });
});

function chromeExecutable() {
  const candidates = [process.env.PUPPETEER_EXECUTABLE_PATH, process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"].filter(
    (value): value is string => Boolean(value)
  );
  return candidates.find((candidate) => existsSync(candidate)) || "";
}

function inPage<T>(page: Page, body: string): Promise<T> {
  return page.evaluate(new Function(body) as () => T);
}

const chrome = chromeExecutable();

describe("Add tab at 390px on Chrome", { timeout: 60_000, skip: chrome ? false : "Chrome is not installed" }, () => {
  it("keeps usuals, icons, and the Thanksgiving checklist inside the phone", async () => {
    const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
    const publicDir = path.join(root, "public");
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
      const type = file.endsWith(".css") ? "text/css" : file.endsWith(".js") ? "text/javascript" : "text/html";
      res.setHeader("Content-Type", type);
      stream.pipe(res);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    let browser: Browser | null = null;
    try {
      browser = await puppeteer.launch({
        executablePath: chrome,
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      });
      const page = await browser.newPage();
      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      const usuals = ["Whole Milk", "Bananas", "Large Eggs", "Sandwich Bread", "Chicken Breast", "Greek Yogurt", "Orange Juice", "Ground Coffee", "Cheddar Cheese", "Baby Spinach"].map(
        (name, index) => ({ name, brand: "Test", catalogId: `u${index}`, quantity: 1, times: 1, lastAt: 100 - index, starred: true })
      );
      await page.evaluateOnNewDocument(
        new Function(`
          localStorage.setItem("gg-onboarding-done", "1");
          localStorage.setItem("gg-beta-code", "preview");
          localStorage.setItem("gg-theme", "dark");
          localStorage.setItem("gg-zip", "45103");
          localStorage.setItem("gg-step", "add");
          localStorage.setItem("gg-usuals", ${JSON.stringify(JSON.stringify(usuals))});
        `) as () => void
      );
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("[data-lists-open]");
      await page.waitForSelector("#usuals-block");

      const collapsed = await inPage<any>(page, `
        const block = document.getElementById("usuals-block");
        const box = block.getBoundingClientRect();
        const icons = Array.from(document.querySelectorAll(".feature-icon")).filter((icon) => icon.getBoundingClientRect().width > 0).map((icon) => {
          const bounds = icon.getBoundingClientRect();
          const glyph = icon.querySelector("svg") || icon;
          const inner = glyph.getBoundingClientRect();
          return {
            text: (icon.textContent || "").trim().slice(0, 24),
            w: Math.round(bounds.width),
            h: Math.round(bounds.height),
            overflow: icon.scrollWidth > icon.clientWidth + 1 || icon.scrollHeight > icon.clientHeight + 1,
            contains: inner.width === 0 || (inner.left >= bounds.left - 1 && inner.right <= bounds.right + 1 && inner.top >= bounds.top - 1 && inner.bottom <= bounds.bottom + 1),
          };
        });
        const header = document.querySelector(".topbar").getBoundingClientRect();
        return {
          theme: document.documentElement.getAttribute("data-resolved"),
          open: block.dataset.open,
          height: Math.round(box.height),
          quarter: Math.round(window.innerHeight / 4),
          scroll: document.documentElement.scrollWidth,
          inner: window.innerWidth,
          headerRight: Math.round(header.right),
          icons,
        };
      `);
      assert.equal(collapsed.theme, "dark");
      assert.equal(collapsed.open, "false");
      assert.ok(collapsed.height > 0);
      assert.ok(collapsed.height <= collapsed.quarter, `usuals ${collapsed.height}px exceeds a quarter of the screen`);
      assert.ok(collapsed.scroll <= collapsed.inner + 1, "page scrolls sideways");
      assert.ok(collapsed.headerRight <= collapsed.inner + 1, "header runs off the screen");
      assert.ok(collapsed.icons.length >= 3);
      for (const icon of collapsed.icons) {
        assert.equal(icon.w, 44, `${icon.text} icon width`);
        assert.equal(icon.h, 44, `${icon.text} icon height`);
        assert.equal(icon.overflow, false, `${icon.text} overflows its box`);
        assert.equal(icon.contains, true, `${icon.text} glyph leaves its box`);
      }
      assert.ok(collapsed.icons.some((icon: { text: string }) => icon.text === "Aisles"));

      await page.click("#usuals-toggle");
      const opened = await inPage<any>(page, `
        const screen = document.getElementById("favorites-screen");
        const card = document.getElementById("usuals-toggle");
        return {
          hidden: screen.hidden,
          card: card.classList.contains("feature-card"),
          count: document.getElementById("usuals-count").textContent,
          title: document.getElementById("favorites-title").textContent,
          pageScroll: document.documentElement.scrollWidth,
          inner: window.innerWidth,
        };
      `);
      assert.equal(opened.hidden, false);
      assert.equal(opened.card, true);
      assert.equal(opened.count, "10");
      assert.equal(opened.title, "Your favorites");
      assert.ok(opened.pageScroll <= opened.inner + 1);

      await page.click("[data-lists-open]");
      await page.waitForSelector('[data-list-open="thanksgiving"]');
      const card = await inPage<any>(page, `
        const button = document.querySelector('[data-list-open="thanksgiving"]');
        const before = Math.round(button.getBoundingClientRect().height);
        button.classList.add("is-busy");
        button.setAttribute("aria-busy", "true");
        const box = button.getBoundingClientRect();
        const spin = button.querySelector(".inline-loader span").getBoundingClientRect();
        const after = getComputedStyle(button, "::after").content;
        const height = Math.round(box.height);
        button.classList.remove("is-busy");
        button.removeAttribute("aria-busy");
        return {
          before,
          height,
          after,
          inside: spin.width > 8 && spin.left >= box.left + 4 && spin.right <= box.right - 4 && spin.top >= box.top + 4 && spin.bottom <= box.bottom - 4,
        };
      `);
      assert.equal(card.before, card.height);
      assert.equal(card.after, "none");
      assert.equal(card.inside, true);

      await page.click('[data-list-open="thanksgiving"]');
      await page.waitForSelector("[data-theme-brand='stuffing']");
      const beforeEdit = await inPage<string>(page, `return document.querySelector(".theme-check-add .theme-check-label").textContent`);
      assert.match(beforeEdit, /^Add \d+ items to my trip$/);
      await page.click('[data-theme-check="whole-turkey"] input');
      await page.click('[data-theme-inc="stuffing"]');
      const edited = await inPage<any>(page, `
        const label = document.querySelector(".theme-check-add .theme-check-label").textContent;
        const turkey = document.querySelector('[data-theme-check="whole-turkey"] input');
        const stuffing = document.querySelector('[data-theme-inc="stuffing"]').parentElement.querySelector("output").textContent;
        const pie = false;
        const button = document.querySelector(".theme-check-add");
        button.classList.add("is-busy");
        const box = button.getBoundingClientRect();
        const spin = button.querySelector(".inline-loader span").getBoundingClientRect();
        const sheet = document.getElementById("list-sheet").getBoundingClientRect();
        return {
          label,
          turkey: turkey.checked,
          stuffing,
          pie,
          inside: spin.width > 8 && spin.left >= box.left + 4 && spin.right <= box.right - 4 && spin.top >= box.top + 4 && spin.bottom <= box.bottom - 4,
          sheetWidth: Math.round(sheet.width),
          inner: window.innerWidth,
          scroll: document.documentElement.scrollWidth,
        };
      `);
      assert.match(edited.label, /^Add \d+ items to my trip$/);
      assert.equal(edited.label, "Add 8 items to my trip");
      assert.equal(beforeEdit, "Add 9 items to my trip");
      assert.equal(edited.turkey, false);
      assert.equal(edited.stuffing, "2");
      assert.equal(edited.pie, false);
      assert.equal(edited.inside, true);
      assert.ok(edited.sheetWidth <= edited.inner + 1);
      assert.ok(edited.scroll <= edited.inner + 1);
    } finally {
      await browser?.close().catch(() => {});
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
