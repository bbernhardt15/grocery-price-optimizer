import assert from "node:assert/strict";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { once } from "node:events";
import { describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { SHELL_CACHE } from "../../public/shopper/betaContext.js";
import { importStageHtml, learnedViewReady } from "../../public/shopper/learnedGate.js";
import { learnedSummaryHtml } from "../../public/shopper/receiptCopy.js";
import { learnedActionsHtml } from "../../public/shopper/learnedActions.js";
import { syncZipPlaceholder, ZIP_PLACEHOLDER } from "../../public/shopper/zipEntry.js";
import { tripAddHtml } from "../../public/shopper/tripAdd.js";
import { selectedCountLabel, syncTripAddBar, tripButtonsEnabled } from "../../public/shopper/tripActionBar.js";
import { tripAddStatus } from "../../public/shopper/tripAdd.js";

const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
const profileUi = readFileSync(new URL("../../public/shopper/profileOnboardingUi.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../../public/shopper/phoneRetest12.css", import.meta.url), "utf8");

const SPINNER = `<div class="read-live" data-reading-screen="1"><h2>Reading your orders</h2><p class="read-beat-count">Read 54 items</p></div>`;
const LEARNED = `<div class="learned-summary"><h2>Here's what we learned</h2><section class="learned-row" data-learned-row="bbq-sauce">BBQ sauce</section></div>`;

function chromeExecutable() {
  const candidates = [process.env.PUPPETEER_EXECUTABLE_PATH, process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/local/bin/google-chrome"].filter(
    (value): value is string => Boolean(value)
  );
  return candidates.find((candidate) => existsSync(candidate)) || "";
}

const chrome = chromeExecutable();

describe("twelfth phone test — onboarding and receipt import", () => {
  it("bumps the shell cache to v91", () => {
    assert.equal(SHELL_CACHE, "v91");
    assert.match(sw, new RegExp(`grocery-gitter-shell-${SHELL_CACHE}`));
  });

  it("keeps the ZIP placeholder off the digits unless the field is empty", () => {
    const input = {
      value: "",
      attrs: new Map<string, string>(),
      getAttribute(name: string) {
        return this.attrs.has(name) ? this.attrs.get(name)! : null;
      },
      setAttribute(name: string, value: string) {
        this.attrs.set(name, value);
      },
      removeAttribute(name: string) {
        this.attrs.delete(name);
      },
    };
    syncZipPlaceholder(input as unknown as HTMLInputElement);
    assert.equal(input.getAttribute("placeholder"), ZIP_PLACEHOLDER);
    assert.equal(input.getAttribute("data-filled"), null);
    input.value = "4";
    syncZipPlaceholder(input as unknown as HTMLInputElement);
    assert.equal(input.getAttribute("placeholder"), null);
    assert.equal(input.getAttribute("data-filled"), "1");
    input.value = "";
    syncZipPlaceholder(input as unknown as HTMLInputElement);
    assert.equal(input.getAttribute("placeholder"), "5-digit ZIP");
    assert.match(profileUi, /zipEntryFieldHtml/);
    assert.match(profileUi, /bindZipEntry/);
    assert.match(profileUi, /ZIP_PLACEHOLDER/);
    assert.match(readFileSync(new URL("../../public/shopper/zipEntry.js", import.meta.url), "utf8"), /inputmode="numeric"/);
    assert.match(css, /::-webkit-contacts-auto-fill-button/);
    assert.doesNotMatch(readFileSync(new URL("../../public/shopper/zipEntry.js", import.meta.url), "utf8"), /position:\s*absolute/);
  });

  it("keeps the learned view out of the DOM while parsing or grouping", () => {
    const frames = [
      { parsing: true, grouping: false, revealed: false, spinnerHtml: SPINNER, learnedHtml: LEARNED },
      { parsing: false, grouping: true, revealed: false, spinnerHtml: SPINNER, learnedHtml: LEARNED },
      { parsing: false, grouping: false, revealed: false, spinnerHtml: SPINNER, learnedHtml: LEARNED },
      { parsing: false, grouping: false, revealed: true, spinnerHtml: SPINNER, learnedHtml: LEARNED },
    ];
    assert.equal(learnedViewReady(frames[0]), false);
    assert.equal(learnedViewReady(frames[1]), false);
    assert.equal(learnedViewReady(frames[2]), false);
    assert.equal(learnedViewReady(frames[3]), true);
    const html = frames.map((frame) => importStageHtml(frame));
    for (const frame of html.slice(0, 3)) {
      assert.doesNotMatch(frame, /learned-summary/);
      assert.doesNotMatch(frame, /Here's what we learned/);
      assert.match(frame, /data-reading-screen/);
      assert.match(frame, /Read 54 items/);
    }
    assert.match(html[3], /learned-summary/);
    assert.match(html[3], /Here's what we learned/);
    assert.match(profileUi, /learnedViewReady/);
    assert.match(profileUi, /importStageHtml/);
    assert.match(profileUi, /stage === "grouping"/);
    assert.match(readFileSync(new URL("../../public/shopper/receiptImport.js", import.meta.url), "utf8"), /stage: "grouping"/);
  });

  it("enables both trip add buttons only after a selection", () => {
    assert.equal(tripButtonsEnabled(0), false);
    assert.equal(tripButtonsEnabled(1), true);
    assert.equal(selectedCountLabel(0), "0 selected");
    assert.equal(selectedCountLabel(54), "54 selected");
    const lines = Array.from({ length: 54 }, (_, index) => ({
      name: `Item ${index + 1}`,
      quantity: 1,
      price: 2,
      family: "pantry",
      label: "Pantry",
    }));
    const markup = tripAddHtml(lines);
    assert.match(markup, /id="trip-action-bar"/);
    assert.match(markup, /id="trip-add-count"/);
    assert.match(markup, /0 selected/);
    assert.match(markup, /Select all/);
    assert.match(markup, /id="learned-add-trip-top"/);
    assert.match(markup, /id="learned-empty-trip-top"/);
    assert.match(markup, /id="learned-add-trip" disabled/);
    assert.match(markup, /id="trip-add-body"/);
    assert.match(profileUi, /syncTripAddBar/);
    const buttons = [
      { disabled: true },
      { disabled: true },
    ];
    const root = {
      querySelector(selector: string) {
        if (selector === "#trip-add-total") return { textContent: "" };
        if (selector === "#trip-add-count") return { textContent: "" };
        return null;
      },
      querySelectorAll() {
        return buttons;
      },
    };
    const status = tripAddStatus(8, 2);
    const synced = syncTripAddBar(root as unknown as ParentNode, { ...status, selected: 2 });
    assert.equal(synced.canAdd, true);
    assert.equal(buttons.every((button) => button.disabled === false), true);
    const blocked = syncTripAddBar(root as unknown as ParentNode, { ...tripAddStatus(0, 0), selected: 0 });
    assert.equal(blocked.canAdd, false);
    assert.equal(buttons.every((button) => button.disabled === true), true);
  });

  it("puts Change and Remove on one horizontal ghost row inside the card", () => {
    const actions = learnedActionsHtml("bbq-sauce");
    assert.match(actions, /class="learned-actions"/);
    assert.match(actions, /class="ghost learned-action" data-learned-change="bbq-sauce"/);
    assert.match(actions, /class="ghost learned-action" data-learned-remove="bbq-sauce"/);
    assert.doesNotMatch(actions, /flex-direction:\s*column/);
    const summary = learnedSummaryHtml(
      [{ family: "bbq-sauce", label: "BBQ sauce", mode: "brand", brand: "Sweet Baby Ray's", brands: ["Sweet Baby Ray's"] }],
      {}
    );
    assert.match(summary, /class="rule-pill"/);
    assert.match(summary, /class="learned-actions"/);
    const card = summary.slice(summary.indexOf('data-learned-row="bbq-sauce"'), summary.indexOf("</section>") + 10);
    assert.ok(card.indexOf("rule-pill") < card.indexOf("learned-actions"));
    assert.match(css, /\.learned-actions \{[\s\S]*flex-direction:\s*row/);
    assert.match(css, /\.learned-actions \{[\s\S]*flex-wrap:\s*nowrap/);
    assert.match(css, /min-height:\s*44px/);
    assert.match(profileUi, /commitLearnedCard/);
  });
});

describe("twelfth phone test at 390px", { timeout: 90_000, skip: chrome ? false : "Chrome is not installed" }, () => {
  it("keeps the ZIP placeholder off the digits at 390px", async () => {
    const page = await openPhone();
    try {
      const laidOut = await page.evaluate(async () => {
        const { bindZipEntry, zipEntryFieldHtml } = await import("/shopper/zipEntry.js");
        const host = document.createElement("div");
        host.id = "zip-probe";
        host.style.width = "358px";
        host.innerHTML = zipEntryFieldHtml({ id: "profile-zip", value: "45103" });
        document.body.append(host);
        const input = document.getElementById("profile-zip") as HTMLInputElement;
        bindZipEntry(input);
        return {
          filledPlaceholder: input.getAttribute("placeholder"),
          inputMode: input.inputMode,
          autocomplete: input.autocomplete,
          name: input.getAttribute("name"),
        };
      });
      assert.equal(laidOut.filledPlaceholder, null);
      assert.equal(laidOut.inputMode, "numeric");
      assert.equal(laidOut.autocomplete, "off");
      assert.equal(laidOut.name, "gg-code-entry");
      await page.focus("#profile-zip");
      await page.evaluate(() => (document.getElementById("profile-zip") as HTMLInputElement).select());
      await page.keyboard.press("Backspace");
      await page.keyboard.type("452");
      const typed = await page.evaluate(() => {
        const input = document.getElementById("profile-zip") as HTMLInputElement;
        const label = document.querySelector(".zip-entry-label") as HTMLElement;
        const entry = document.querySelector(".zip-entry") as HTMLElement;
        const inputBox = input.getBoundingClientRect();
        const labelBox = label.getBoundingClientRect();
        const overlays = [...entry.querySelectorAll("*")].filter((node) => {
          if (node === input) return false;
          const style = getComputedStyle(node);
          if (style.position !== "absolute" && style.position !== "fixed") return false;
          const box = node.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && box.top < inputBox.bottom && box.bottom > inputBox.top && box.left < inputBox.right && box.right > inputBox.left;
        });
        return {
          value: input.value,
          placeholder: input.getAttribute("placeholder"),
          filled: input.getAttribute("data-filled"),
          placeholderShown: input.matches(":placeholder-shown"),
          labelOverlaps: labelBox.bottom > inputBox.top + 1 && labelBox.top < inputBox.bottom,
          overlays: overlays.length,
          width: window.innerWidth,
          inputInside: inputBox.right <= window.innerWidth + 1 && inputBox.left >= -1,
        };
      });
      assert.equal(typed.width, 390);
      assert.equal(typed.value, "452");
      assert.equal(typed.placeholder, null);
      assert.equal(typed.filled, "1");
      assert.equal(typed.placeholderShown, false);
      assert.equal(typed.labelOverlaps, false);
      assert.equal(typed.overlays, 0);
      assert.equal(typed.inputInside, true);
      await page.evaluate(() => {
        const input = document.getElementById("profile-zip") as HTMLInputElement;
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const cleared = await page.evaluate(() => (document.getElementById("profile-zip") as HTMLInputElement).getAttribute("placeholder"));
      assert.equal(cleared, "5-digit ZIP");
    } finally {
      await page.browser().close();
    }
  });

  it("does not render an intermediate learned screen while loading", async () => {
    const page = await openPhone();
    try {
      const seen = await page.evaluate(
        async (spinner, learned) => {
          const { paintImportSequence } = await import("/shopper/learnedGate.js");
          const root = document.createElement("div");
          root.id = "import-probe";
          document.body.append(root);
          const frames = [
            { parsing: true, grouping: false, revealed: false, spinnerHtml: spinner, learnedHtml: learned },
            { parsing: false, grouping: true, revealed: false, spinnerHtml: spinner, learnedHtml: learned },
            { parsing: false, grouping: false, revealed: false, spinnerHtml: spinner, learnedHtml: learned },
            { parsing: false, grouping: false, revealed: true, spinnerHtml: spinner, learnedHtml: learned },
          ];
          const painted = paintImportSequence(root, frames);
          const snapshots: string[] = [];
          root.innerHTML = "";
          for (const frame of frames) {
            const { importStageHtml } = await import("/shopper/learnedGate.js");
            root.innerHTML = importStageHtml(frame);
            snapshots.push(root.innerHTML);
            if (!frame.revealed) {
              const node = root.querySelector(".learned-summary");
              if (node) throw new Error("learned view entered the DOM while loading");
            }
          }
          return { painted, leaked: snapshots.slice(0, 3).some((html) => /learned-summary|Here's what we learned/.test(html)) };
        },
        SPINNER,
        LEARNED
      );
      assert.deepEqual(seen.painted, ["reading", "reading", "reading", "learned"]);
      assert.equal(seen.leaked, false);
    } finally {
      await page.browser().close();
    }
  });

  it("keeps scrollTop and the focused card after choosing a rule", async () => {
    const page = await openPhone();
    try {
      const result = await page.evaluate(async () => {
        const { commitLearnedCard } = await import("/shopper/learnedStable.js");
        const viewport = document.createElement("div");
        viewport.id = "viewport";
        viewport.style.cssText = "height:360px;overflow:auto;position:relative;";
        viewport.innerHTML = `
          <div style="height:200px"></div>
          <section class="learned-group"><p>Pantry</p>
            <section class="summary-row learned-row" data-learned-row="bbq-sauce" tabindex="-1">
              <h3>BBQ sauce</h3>
              <div class="learned-picker" style="height:420px">Cheapest of my picks</div>
            </section>
          </section>
          <section class="learned-group"><p>Dairy & eggs</p>
            <section class="summary-row learned-row" data-learned-row="eggs" tabindex="-1"><h3>Eggs</h3></section>
          </section>
          <div style="height:800px"></div>`;
        document.body.append(viewport);
        document.body.style.height = "2400px";
        const card = viewport.querySelector('[data-learned-row="bbq-sauce"]') as HTMLElement;
        viewport.scrollTop = 180;
        card.focus({ preventScroll: true });
        const before = card;
        const saved = commitLearnedCard(card, (node) => {
          node.querySelector(".learned-picker")?.remove();
          node.insertAdjacentHTML("beforeend", `<p class="rule-pill">Cheapest of my picks</p>`);
        }, { scroller: viewport });
        await new Promise((resolve) => setTimeout(resolve, 40));
        const dairy = viewport.querySelector('[data-learned-row="eggs"]') as HTMLElement;
        const viewBox = viewport.getBoundingClientRect();
        const dairyBox = dairy.getBoundingClientRect();
        return {
          sameNode: viewport.querySelector('[data-learned-row="bbq-sauce"]') === before,
          scrollTop: viewport.scrollTop,
          pageTop: document.scrollingElement!.scrollTop,
          savedStage: saved?.stageTop,
          savedPage: saved?.pageTop,
          focused: document.activeElement === before,
          focusedFamily: (document.activeElement as HTMLElement | null)?.getAttribute?.("data-learned-row") || "",
          dairyNearTop: dairyBox.top < viewBox.top + 24 && dairyBox.bottom > viewBox.top,
        };
      });
      assert.equal(result.sameNode, true);
      assert.equal(result.savedStage, 180);
      assert.equal(result.scrollTop, 180);
      assert.equal(result.pageTop, result.savedPage);
      assert.equal(result.focused, true);
      assert.equal(result.focusedFamily, "bbq-sauce");
      assert.equal(result.dairyNearTop, false);
    } finally {
      await page.browser().close();
    }
  });

  it("lays Change and Remove in one row and keeps the trip bar off the list at 390px", async () => {
    const page = await openPhone();
    try {
      const actions = await page.evaluate(async () => {
        const { learnedSummaryHtml } = await import("/shopper/receiptCopy.js");
        const host = document.createElement("div");
        host.style.width = "358px";
        host.innerHTML = learnedSummaryHtml(
          [
            { family: "bbq-sauce", label: "BBQ sauce", mode: "cheapestPicks", brand: "Sweet Baby Ray's", brands: ["Sweet Baby Ray's", "Kraft"] },
            { family: "eggs", label: "Eggs", mode: "storeBrand", brand: "Kroger" },
          ],
          {}
        );
        document.body.append(host);
        const card = host.querySelector('[data-learned-row="bbq-sauce"]') as HTMLElement;
        const buttons = [...card.querySelectorAll(".learned-action")] as HTMLElement[];
        const row = card.querySelector(".learned-actions") as HTMLElement;
        const pill = card.querySelector(".rule-pill") as HTMLElement;
        const cardBox = card.getBoundingClientRect();
        const pillBox = pill.getBoundingClientRect();
        const boxes = buttons.map((button) => button.getBoundingClientRect());
        const rowStyle = getComputedStyle(row);
        return {
          count: buttons.length,
          direction: rowStyle.flexDirection,
          wrap: rowStyle.flexWrap,
          tops: boxes.map((box) => Math.round(box.top)),
          heights: boxes.map((box) => box.height),
          widths: boxes.map((box) => Math.round(box.width)),
          gap: boxes.length === 2 ? Math.round(boxes[1].left - boxes[0].right) : 0,
          rowHeight: row.getBoundingClientRect().height,
          pillInside: pillBox.right <= cardBox.right + 1 && pillBox.left >= cardBox.left - 1,
          buttonsInside: boxes.every((box) => box.right <= cardBox.right + 1 && box.left >= cardBox.left - 1),
          width: window.innerWidth,
        };
      });
      assert.equal(actions.width, 390);
      assert.equal(actions.count, 2);
      assert.equal(actions.direction, "row");
      assert.equal(actions.wrap, "nowrap");
      assert.equal(actions.tops[0], actions.tops[1]);
      assert.ok(actions.heights.every((height) => height >= 44));
      assert.ok(Math.abs(actions.widths[0] - actions.widths[1]) <= 2);
      assert.ok(actions.gap >= 6 && actions.gap <= 16);
      assert.ok(actions.rowHeight < 60, "the action row stays one line");
      assert.equal(actions.pillInside, true);
      assert.equal(actions.buttonsInside, true);

      const trip = await page.evaluate(async () => {
        const { tripAddHtml } = await import("/shopper/tripAdd.js");
        const { syncTripAddBar } = await import("/shopper/tripActionBar.js");
        const { tripAddStatus } = await import("/shopper/tripAdd.js");
        const lines = Array.from({ length: 54 }, (_, index) => ({
          name: `Pantry item ${index + 1}`,
          quantity: 1,
          price: 1.5,
          family: "pantry",
          label: index < 40 ? "Pantry" : "Dairy & eggs",
        }));
        const dialog = document.getElementById("profile-onboard") as HTMLDialogElement;
        dialog.dataset.step = "trip";
        dialog.showModal();
        const stage = document.getElementById("profile-stage") as HTMLElement;
        stage.innerHTML = tripAddHtml(lines);
        const bar = document.getElementById("trip-action-bar") as HTMLElement;
        const body = document.getElementById("trip-add-body") as HTMLElement;
        const before = {
          barBottom: bar.getBoundingClientRect().bottom,
          bodyTop: body.getBoundingClientRect().top,
        };
        body.scrollTop = 480;
        const afterScroll = {
          barTop: bar.getBoundingClientRect().top,
          bodyTop: body.getBoundingClientRect().top,
          barMoved: Math.abs(bar.getBoundingClientRect().top - bar.getBoundingClientRect().top) ,
        };
        const beforeTop = bar.getBoundingClientRect().top;
        stage.scrollTop = 480;
        const afterTop = bar.getBoundingClientRect().top;
        const bottomButton = document.getElementById("learned-add-trip") as HTMLButtonElement;
        const disabledAtRest = bottomButton.disabled;
        const boxes = [...stage.querySelectorAll("[data-trip-pick]")] as HTMLInputElement[];
        boxes[0].checked = true;
        const selected = boxes.filter((box) => box.checked).length;
        const total = boxes.reduce((sum, box) => sum + (box.checked ? Number(box.dataset.estimate) || 0 : 0), 0);
        syncTripAddBar(stage, { ...tripAddStatus(Math.round(total * 100) / 100, selected), selected });
        const firstRow = body.querySelector(".trip-add-row") as HTMLElement;
        const rowBox = firstRow.getBoundingClientRect();
        const barBox = bar.getBoundingClientRect();
        const bodyBox = body.getBoundingClientRect();
        return {
          coversAtRest: before.bodyTop + 1 < before.barBottom,
          bodyStartsBelowBar: bodyBox.top + 1 >= barBox.bottom,
          barStays: Math.abs(afterTop - beforeTop) < 1,
          scrolled: stage.scrollTop,
          disabledAtRest,
          bottomEnabled: !bottomButton.disabled,
          count: document.getElementById("trip-add-count")?.textContent,
          rowVisibleTop: rowBox.top,
          rowClippedByBody: rowBox.top >= bodyBox.top - 1 || rowBox.bottom <= bodyBox.top + 1,
          position: getComputedStyle(bar).position,
        };
      });
      assert.equal(trip.coversAtRest, false);
      assert.equal(trip.bodyStartsBelowBar, true);
      assert.equal(trip.disabledAtRest, true);
      assert.equal(trip.bottomEnabled, true);
      assert.equal(trip.count, "1 selected");
      assert.equal(trip.position, "static");
      if (trip.scrolled > 0) assert.equal(trip.barStays, false);
    } finally {
      await page.browser().close();
    }
  });
});

async function openPhone(): Promise<Page> {
  const server = await startStaticServer();
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(20_000);
  await page.setUserAgent(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.122 Mobile/15E148 Safari/604.1"
  );
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("gg-onboarding-done", "1");
    localStorage.setItem("gg-beta-code", "preview");
    localStorage.setItem("gg-theme", "light");
  });
  await page.goto(server.origin, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#profile-onboard");
  (page as Page & { __server?: http.Server }).__server = server.server;
  const originalClose = browser.close.bind(browser);
  browser.close = async () => {
    server.server.close();
    return originalClose();
  };
  return page;
}

function startStaticServer() {
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
  return once(server, "listening").then(() => ({
    server,
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  }));
}
