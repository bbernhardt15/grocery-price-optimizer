import assert from "node:assert/strict";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { once } from "node:events";
import { describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { ALERTS_COMING_SOON, ALERT_CHANNEL_NOTE, alertDeliveryState, PUSH_ALERT_COPY, SHOPPING_LIST_NOTE } from "../../public/shopper/alertDelivery.js";
import { WORDMARK, homeProxyShouldShow, sheetBrandHtml } from "../../public/shopper/homeButton.js";
import { FLOW_STEPS } from "../../public/shopper/flow.js";
import { readCardTitle, READING_RECEIPT } from "../../public/shopper/receiptReading.js";
import { foundLabel } from "../../public/shopper/intakePresent.js";
import { readCardHtml } from "../../public/shopper/intakePresent.js";
import { learnedRulePillHtml } from "../../public/shopper/learnedRule.js";
import { captureRuleScroll, restoreRuleScroll, revealDelta } from "../../public/shopper/ruleScroll.js";
import { buildTripAddList, EMPTY_TRIP_TOTAL, tripAddHtml, tripAddStatus } from "../../public/shopper/tripAdd.js";
import { pullAllowed, releaseAfterLastSheet, releaseScrollLock } from "../../public/shopper/sheetScroll.js";
import { fillPrintRoot, inStoreShareActionsHtml, inStoreShareText, shareInStoreList } from "../../public/shopper/inStoreShare.js";
import { notInCartSection } from "../../public/shopper/unfoundItems.js";
import { completionHook, finishCheckedOut, KROGER_CHECKOUT_NOTE, sentItemsHtml, showSentLabel } from "../../public/shopper/krogerReady.js";
import { cartReadyPageBody, KROGER_CHECKOUT_NOTE as SERVER_NOTE, showSentLabel as serverShow } from "../krogerCartReady";

const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../../public/shopper/phoneRetest11.css", import.meta.url), "utf8");
const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
const importer = readFileSync(new URL("../../public/shopper/import.js", import.meta.url), "utf8");

describe("eleventh phone test", () => {
  it("bumps the shell cache to v39", () => {
    assert.match(sw, /grocery-gitter-shell-v39/);
  });

  it("keeps the Grocery Gitter wordmark in the header flow", () => {
    assert.equal(WORDMARK, "Grocery Gitter");
    assert.equal(homeProxyShouldShow(3), false);
    assert.match(sheetBrandHtml(), /class="sheet-brand"/);
    assert.match(sheetBrandHtml(), /Grocery Gitter/);
    assert.doesNotMatch(sheetBrandHtml(), /position:\s*fixed/);
    assert.match(html, /class="brand-word">Grocery Gitter</);
    assert.match(html, /aria-label="Grocery Gitter home"/);
    assert.doesNotMatch(html, /id="brand-home-proxy"/);
    assert.match(css, /\.sheet-brand \{\s*position: static/);
    assert.match(css, /\.brand-word/);
    assert.match(app, /sheetBrandHtml/);
    assert.match(css, /safe-top/);
  });

  it("labels the bottom tabs Build, Review, and In-store", () => {
    assert.deepEqual(
      FLOW_STEPS.map((step) => step.label),
      ["Build", "Review", "In-store"]
    );
    assert.match(html, /aria-label="Build"/);
    assert.match(html, /<span>Build<\/span>/);
    assert.match(html, /<span>Review<\/span>/);
    assert.match(html, /<span>In-store<\/span>/);
    assert.match(html, /class="tab-icon"/);
    assert.match(css, /\.bottom-dock \{[\s\S]*box-shadow/);
    assert.match(css, /\.step-bar button\[aria-current="step"\]/);
    assert.match(css, /data-resolved="dark"\] \.step-bar button\[aria-current="step"\]/);
    assert.match(css, /data-resolved="dark"\] \.bottom-dock/);
    assert.doesNotMatch(html, /aria-label="Add items">Add</);
  });

  it("names the trip list Shopping list and tells the truth about push alerts", () => {
    assert.equal(SHOPPING_LIST_NOTE, "The list for this trip.");
    assert.match(html, /<h2>Shopping list<\/h2>/);
    assert.match(html, /The list for this trip\./);
    assert.match(html, /id="shopping-list-note"/);
    assert.equal(alertDeliveryState(null).mode, "soon");
    assert.equal(alertDeliveryState({ webPush: { enabled: false } }).copy, ALERTS_COMING_SOON);
    assert.equal(alertDeliveryState({ webPush: { enabled: false } }).disabled, true);
    assert.equal(alertDeliveryState({ webPush: { enabled: true, publicKey: "" } }).mode, "soon");
    const push = alertDeliveryState({ webPush: { enabled: true, publicKey: "vapid-public" } });
    assert.equal(push.mode, "push");
    assert.equal(push.copy, PUSH_ALERT_COPY);
    assert.equal(push.disabled, false);
    assert.match(PUSH_ALERT_COPY, /We'll send a push notification/);
    assert.match(html, /Coming soon/);
    assert.match(html, new RegExp(ALERT_CHANNEL_NOTE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, /does not email price alerts/);
    assert.match(html, /id="list-alerts"[^>]*disabled/);
    assert.match(app, /applyAlertDelivery/);
    assert.match(app, /Notification\.permission/);
    assert.match(app, /enablePush\(\)/);
    assert.doesNotMatch(html, />My list</);
  });

  it("keeps brand rule pills inside the card and preserves scroll", () => {
    const pill = learnedRulePillHtml({ mode: "cheapestPicks", brands: ["Cheerios"] });
    assert.match(pill, /class="rule-pill-label"/);
    assert.match(pill, /Cheapest of my picks/);
    const pills = readFileSync(new URL("../../public/shopper/onboardingPolish.css", import.meta.url), "utf8");
    assert.match(pills, /-webkit-line-clamp: 2/);
    assert.match(css, /overflow: hidden/);
    assert.match(css, /\.learned-row > div:first-child/);
    const saved = captureRuleScroll({ stage: 240, sheet: 80, page: 460.8 });
    assert.deepEqual(saved, { stage: 240, sheet: 80, page: 460 });
    const stage = { scrollTop: 0 };
    const sheet = { scrollTop: 0 };
    const pages: number[] = [];
    restoreRuleScroll({ stage, sheet, scrollTo: (y) => pages.push(y) }, saved);
    assert.equal(stage.scrollTop, 240);
    assert.equal(sheet.scrollTop, 80);
    assert.deepEqual(pages, [460]);
    assert.equal(revealDelta(100, 200, 120, 180, 40), 40);
    assert.equal(revealDelta(100, 200, 340, 400, 40), 272);
    const profile = readFileSync(new URL("../../public/shopper/profileOnboardingUi.js", import.meta.url), "utf8");
    assert.match(profile, /rerenderLearned/);
    assert.match(profile, /revealInside/);
    assert.doesNotMatch(profile, /learned-picker"\)\?\.scrollIntoView/);
    assert.match(profile, /captureRuleScroll/);
  });

  it("starts the add-to-trip list with nothing selected", () => {
    const rows = buildTripAddList(
      [
        { name: "Bananas", quantity: 4, price: 3, family: "bananas", label: "Produce" },
        { name: "Milk", brand: "Kroger", quantity: 1, price: 4, family: "milk", label: "Dairy" },
      ],
      { usualFamilies: ["milk", "bananas"] }
    );
    assert.equal(rows.every((row) => row.selected === false), true);
    assert.equal(tripAddStatus(0, 0).label, EMPTY_TRIP_TOTAL);
    assert.equal(tripAddStatus(0, 0).canAdd, false);
    assert.equal(tripAddStatus(4, 1).canAdd, true);
    assert.match(tripAddStatus(4, 1).label, /About \$4\.00 selected/);
    const markup = tripAddHtml(rows.map((row) => ({ name: row.name, quantity: 1, price: 2, label: row.category })));
    assert.match(markup, /Select all/);
    assert.match(markup, /Select items to add/);
    assert.match(markup, /id="learned-add-trip" disabled/);
    assert.doesNotMatch(markup, /We preselected/);
    assert.doesNotMatch(markup, /checked/);
  });

  it("says Reading your receipt until items are found", () => {
    assert.equal(READING_RECEIPT, "Reading your receipt...");
    assert.equal(readCardTitle({ name: "Receipt.jpg", found: 0, status: "reading", items: [] }, foundLabel), READING_RECEIPT);
    assert.equal(foundLabel("Receipt.jpg", 0), "Receipt, 0 items found");
    assert.match(readCardTitle({ name: "Receipt.jpg", found: 3, status: "reading", items: ["Milk"] }, foundLabel), /3 items found/);
    const waiting = readCardHtml({ index: 0, name: "Receipt.jpg", found: 0, ratio: 0.2, status: "reading", items: [] });
    assert.match(waiting, /Reading your receipt\.\.\./);
    assert.match(waiting, /<progress/);
    assert.doesNotMatch(waiting, /0 items found/);
    const found = readCardHtml({ index: 0, name: "Receipt.jpg", found: 2, ratio: 0.8, status: "reading", items: ["Milk", "Bread"] });
    assert.match(found, /2 items found/);
    assert.match(importer, /releaseAfterLastSheet/);
  });

  it("releases scroll locks when the last sheet closes", () => {
    assert.equal(pullAllowed({ sheetOpen: true, scrollY: 0 }), false);
    assert.equal(pullAllowed({ sheetOpen: false, scrollY: 40 }), false);
    assert.equal(pullAllowed({ sheetOpen: false, scrollY: 0 }), true);
    const scrolled: number[] = [];
    const doc = {
      body: {
        style: { overflow: "hidden", overflowY: "hidden", position: "fixed", top: "-180px", left: "", right: "", width: "100%", height: "", overflowX: "", touchAction: "", pointerEvents: "none" } as Record<string, string>,
        classList: { remove() {} },
        inert: true,
      },
      documentElement: {
        style: { overflow: "hidden", overflowY: "", position: "", top: "", left: "", right: "", width: "", height: "", overflowX: "", touchAction: "", pointerEvents: "" } as Record<string, string>,
        classList: { remove() {} },
        scrollTop: 0,
      },
      defaultView: {
        scrollY: 0,
        scrollTo(_x: number, y: number) {
          scrolled.push(y);
        },
      },
      scrollingElement: { scrollTop: 0 },
      querySelector(selector: string) {
        return selector === "dialog[open]" ? { id: "import-dialog" } : null;
      },
    };
    const held = releaseAfterLastSheet(doc);
    assert.equal(held.released, false);
    doc.querySelector = () => null;
    const released = releaseScrollLock(doc);
    assert.equal(released.released, true);
    assert.equal(released.y, 180);
    assert.equal(doc.body.style.overflow, "");
    assert.equal(doc.body.style.position, "");
    assert.equal(doc.body.style.top, "");
    assert.equal(doc.documentElement.style.overflow, "");
    assert.equal(doc.body.inert, false);
    assert.deepEqual(scrolled, [180]);
    const after = releaseAfterLastSheet(doc);
    assert.equal(after.reason, "released");
    assert.match(app, /releaseAfterLastSheet/);
    assert.match(app, /pullAllowed/);
  });

  it("collapses the Kroger cart list and offers checkout", async () => {
    assert.equal(showSentLabel(38), "Show 38 items");
    assert.equal(showSentLabel(1), "Show 1 item");
    assert.equal(serverShow(38), "Show 38 items");
    assert.equal(KROGER_CHECKOUT_NOTE, SERVER_NOTE);
    const details = sentItemsHtml(["Milk", "Bananas"]);
    assert.match(details, /<details class="cart-sent">/);
    assert.match(details, /Show 2 items/);
    assert.match(details, /<li>Milk<\/li>/);
    assert.doesNotMatch(details, /open/);
    const page = cartReadyPageBody({
      summary: "38 of 38 items sent",
      items: [{ name: "Milk" }, { upc: "000111" }],
      skipped: [],
      backHref: "/?kroger=added",
      checkedOutHref: "/?kroger=added&checkedOut=1",
      cartHref: "https://www.kroger.com/cart",
    });
    assert.match(page, /38 of 38 items sent/);
    assert.match(page, /Show 2 items/);
    assert.match(page, /Open Kroger cart/);
    assert.match(page, /kroger-cart-btn/);
    assert.match(page, /Back to my trip/);
    assert.match(page, /I checked out/);
    assert.match(page, /checkedOut=1/);
    assert.match(page, new RegExp(KROGER_CHECKOUT_NOTE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, /id="cart-ready-open"/);
    assert.match(html, /id="cart-ready-checked"/);
    assert.match(html, /id="cart-ready-note"/);
    assert.match(css, /\.kroger-cart-btn \{[\s\S]*#004f9f/);
    assert.match(app, /markCheckedOut/);
    assert.match(app, /finishCurrentTrip\(\)/);
    const checkedOut = app.slice(app.indexOf("async function markCheckedOut"), app.indexOf("function openCartReady"));
    assert.match(checkedOut, /finishCurrentTrip\(\)/);
    assert.equal((app.match(/id="clear-trip-open"/g) || []).length, 1);
    const trip = () => undefined;
    const other = () => undefined;
    assert.equal(completionHook({ completeTrip: trip, ggCompleteTrip: other }), trip);
    const hooked = await finishCheckedOut(
      {
        completeTrip: async (detail) => {
          assert.equal(detail.store, "Kroger");
          assert.equal(detail.source, "i-checked-out");
        },
      },
      "Kroger"
    );
    assert.equal(hooked, "hook");
    let finished = "";
    const plain = await finishCheckedOut(
      {
        didYouFinish: (store) => {
          finished = store;
        },
      },
      "Kroger"
    );
    assert.equal(plain, "did-you-finish");
    assert.equal(finished, "Kroger");
  });

  it("shares an in-store list and can print it", async () => {
    const text = inStoreShareText([
      {
        storeName: "Kroger",
        groups: [{ label: "Produce", items: [{ name: "Bananas", quantity: 1 }] }, { label: "Dairy", items: [{ name: "Milk", quantity: 2 }] }],
        cart: [{ name: "Bread", quantity: 1 }],
      },
    ]);
    assert.match(text, /Kroger/);
    assert.match(text, /Produce\n\[ \] Bananas/);
    assert.match(text, /Dairy\n\[ \] Milk x2/);
    assert.match(text, /In cart\n\[x\] Bread/);
    const withUnfound = inStoreShareText([
      {
        storeName: "Kroger",
        groups: [{ label: "Produce", items: [{ name: "Bananas", quantity: 1 }] }],
        cart: [],
      },
      notInCartSection(["Eggs", "Soap"]),
    ]);
    assert.match(withUnfound, /Not in a cart\n\[ \] Eggs/);
    assert.match(withUnfound, /\[ \] Soap/);
    assert.doesNotMatch(withUnfound, /Not in a cart\nNot in a cart/);
    const walk = app.slice(app.indexOf("function walkingListText"), app.indexOf("async function shareWalkingList"));
    assert.match(walk, /notInCartSection/);
    const shared: Array<{ title?: string; text?: string }> = [];
    const viaShare = await shareInStoreList(text, {
      share: async (data) => {
        shared.push(data);
      },
    });
    assert.equal(viaShare.method, "share");
    assert.equal(shared[0]?.title, "Shopping list");
    assert.match(shared[0]?.text || "", /\[ \] Bananas/);
    const dismissed = await shareInStoreList(text, {
      share: async () => {
        const error = new Error("cancel");
        error.name = "AbortError";
        throw error;
      },
    });
    assert.equal(dismissed.method, "dismissed");
    let copied = "";
    const fallback = await shareInStoreList("Bananas", {
      writeText: async (value) => {
        copied = value;
      },
    });
    assert.equal(fallback.method, "fallback");
    assert.equal(fallback.copied, true);
    assert.equal(copied, "Bananas");
    assert.match(fallback.sms, /^sms:\?&body=/);
    const root = { hidden: true, innerHTML: "" };
    assert.equal(fillPrintRoot(root, text), true);
    assert.equal(root.hidden, false);
    assert.match(root.innerHTML, /Shopping list/);
    assert.match(root.innerHTML, /\[ \] Bananas/);
    assert.match(inStoreShareActionsHtml(), /data-share-list/);
    assert.match(inStoreShareActionsHtml(), /data-save-pdf/);
    assert.match(inStoreShareActionsHtml(), /Share list/);
    assert.match(inStoreShareActionsHtml(), /Save as PDF/);
    assert.match(css, /@media print/);
    assert.match(app, /shareWalkingList/);
    assert.match(app, /window\.print\(\)/);
  });
});

function chromeExecutable() {
  const candidates = [process.env.PUPPETEER_EXECUTABLE_PATH, process.env.CHROME_PATH, "/usr/local/bin/google-chrome", "/usr/bin/google-chrome"].filter(
    (value): value is string => Boolean(value)
  );
  return candidates.find((candidate) => existsSync(candidate)) || "";
}

const chrome = chromeExecutable();

describe("eleventh phone test at 390px", { timeout: 60_000, skip: chrome ? false : "Chrome is not installed" }, () => {
  it("shows the wordmark, the tab bar, and a pill that stays inside the card", async () => {
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
      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
      await page.evaluateOnNewDocument(() => {
        localStorage.setItem("gg-onboarding-done", "1");
        localStorage.setItem("gg-theme", "light");
      });
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".brand-word");
      const light = await measureChrome(page);
      assert.equal(light.word, "Grocery Gitter");
      assert.equal(light.fixed, false);
      assert.equal(light.proxy, false);
      assert.deepEqual(light.tabs, ["Build", "Review", "In-store"]);
      assert.ok(light.activeIncludesPill, "active tab is a pill");
      assert.ok(light.headerInside, "header stays inside the phone");
      assert.ok(light.wordInside, "wordmark stays inside the header");
      assert.ok(light.noHorizontalScroll, "page does not scroll sideways");
      assert.ok(light.dockElevated, "tab bar is elevated");
      await page.evaluate(() => document.documentElement.setAttribute("data-resolved", "dark"));
      const dark = await measureChrome(page);
      assert.notEqual(dark.activeBg, light.activeBg);
      const pill = learnedRulePillHtml({ mode: "cheapestPicks", brands: ["Cheerios", "Kellogg's"] });
      const fit = await page.evaluate((markup) => {
        const host = document.createElement("section");
        host.className = "summary-row learned-row";
        host.style.width = "320px";
        host.innerHTML = `<div><h3>Cereal</h3>${markup}<p>Cheapest of my picks</p></div><div class="learned-actions"><button type="button">Change</button><button type="button">Remove</button></div>`;
        document.body.append(host);
        const node = host.querySelector(".rule-pill");
        const label = host.querySelector(".rule-pill-label");
        if (!node || !label) return null;
        const box = node.getBoundingClientRect();
        const outer = host.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          overflow: box.right - outer.right,
          pad: parseFloat(style.paddingLeft),
          height: box.height,
        };
      }, pill);
      assert.ok(fit);
      assert.ok(fit.overflow <= 1, "pill stays inside the card");
      assert.ok(fit.pad >= 6);
      assert.ok(fit.height >= 32);
      await page.evaluate(() => {
        const pad = document.createElement("div");
        pad.id = "scroll-pad";
        pad.style.height = "2000px";
        document.body.append(pad);
      });
      await page.click("footer .settings-open");
      await page.waitForSelector("#settings-dialog[open] .sheet-brand");
      const sheet = await page.evaluate(() => {
        const brand = document.querySelector("#settings-dialog .sheet-brand");
        const title = document.getElementById("settings-title");
        if (!brand || !title) return null;
        const brandBox = brand.getBoundingClientRect();
        const titleBox = title.getBoundingClientRect();
        return {
          position: getComputedStyle(brand).position,
          coversTitle: brandBox.bottom > titleBox.top + 2 && brandBox.top < titleBox.bottom && brandBox.left < titleBox.right,
          titleBelow: titleBox.top >= brandBox.bottom - 1,
        };
      });
      assert.ok(sheet);
      assert.equal(sheet.position, "static");
      assert.equal(sheet.titleBelow, true);
      assert.equal(sheet.coversTitle, false);
      await page.evaluate(() => {
        document.body.style.overflow = "hidden";
        document.body.style.position = "fixed";
        document.body.style.top = "-180px";
        document.getElementById("settings-dialog")?.close();
      });
      await page.waitForFunction(() => document.body.style.position !== "fixed" && document.body.style.overflow !== "hidden");
      const y = await page.evaluate(() => window.scrollY);
      assert.ok(y >= 170, `scroll restored near 180, was ${y}`);
    } finally {
      await browser?.close();
      server.close();
    }
  });
});

function measureChrome(page: Page) {
  return page.evaluate(() => {
    const word = document.querySelector(".brand-word");
    const header = document.querySelector(".topbar");
    const wordBox = word?.getBoundingClientRect();
    const headerBox = header?.getBoundingClientRect();
    const active = document.querySelector('.step-bar button[aria-current="step"]');
    const activeStyle = active ? getComputedStyle(active) : null;
    const dock = document.querySelector(".bottom-dock");
    const dockStyle = dock ? getComputedStyle(dock) : null;
    return {
      word: word?.textContent || "",
      fixed: word ? getComputedStyle(word).position === "fixed" : true,
      proxy: Boolean(document.getElementById("brand-home-proxy")),
      tabs: Array.from(document.querySelectorAll(".step-bar button")).map((button) => (button.textContent || "").trim()),
      activeIncludesPill: Boolean(activeStyle && activeStyle.borderRadius !== "0px" && activeStyle.backgroundColor !== "rgba(0, 0, 0, 0)"),
      activeBg: activeStyle?.backgroundColor || "",
      headerInside: Boolean(headerBox && headerBox.right <= window.innerWidth + 1 && headerBox.left >= -1),
      wordInside: Boolean(wordBox && headerBox && wordBox.right <= headerBox.right + 1 && wordBox.left >= headerBox.left - 1),
      noHorizontalScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
      dockElevated: Boolean(dockStyle && dockStyle.boxShadow && dockStyle.boxShadow !== "none"),
    };
  });
}
