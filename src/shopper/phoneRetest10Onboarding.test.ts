import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { chainSlug } from "../../public/shopper/intakePresent.js";
import { CHAIN_COLORS, colorDistance, contrastRatio, installChainColors } from "../../public/shopper/chainColors.js";
import { learnedRulePillHtml } from "../../public/shopper/learnedRule.js";
import { LIST_ALERT_BENEFIT, listAlertStateLabel, listThumbHtml } from "../../public/shopper/listRowChrome.js";
import { milesBetween, pointForZip } from "../../public/shopper/nearbyStores.js";
import { READ_BEAT_MS, readBeatHeadline, readBeatHtml } from "../../public/shopper/receiptBeat.js";
import { learnedSummaryHtml, receiptUploadHtml } from "../../public/shopper/receiptCopy.js";
import { knownStoreNames } from "../../public/shopper/tripPlan.js";
import { buildTripAddList, EMPTY_TRIP_TOTAL, jumpHidden, tripAddHtml } from "../../public/shopper/tripAdd.js";
import { fieldZip, ZIP_PLACEHOLDER } from "../../public/shopper/zipField.js";
import { nearbyZipChoices, NEARBY_ZIP_MILES } from "../../public/shopper/zipNearby.js";
import { suggestZipChoices } from "../../public/shopper/zipSuggest.js";

const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
const profileUi = readFileSync(new URL("../../public/shopper/profileOnboardingUi.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../../public/shopper/onboardingPolish.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

const CINCINNATI = { lat: 39.0916, lng: -84.1437 };

describe("tenth phone test onboarding", () => {
  it("bumps the shell cache to v66", () => {
    assert.match(sw, /grocery-gitter-shell-v66/);
  });

  it("starts the ZIP field empty unless a saved ZIP exists", () => {
    assert.equal(fieldZip(""), "");
    assert.equal(fieldZip(null), "");
    assert.equal(fieldZip("45"), "");
    assert.equal(fieldZip("45103"), "45103");
    assert.equal(fieldZip("45103-1234"), "45103");
    assert.equal(ZIP_PLACEHOLDER, "5-digit ZIP");
    assert.doesNotMatch(ZIP_PLACEHOLDER, /\d{5}/);
    assert.doesNotMatch(html, /placeholder="45202"/);
    assert.doesNotMatch(html, /value="45202"/);
    assert.doesNotMatch(profileUi, /placeholder="45202"/);
    assert.doesNotMatch(profileUi, /value="45202"/);
    assert.match(profileUi, /fieldZip\(deps\.getZip/);
    assert.match(profileUi, /ZIP_PLACEHOLDER/);
    assert.match(html, /placeholder="5-digit ZIP"/);
  });

  it("offers only nearby ZIPs for Cincinnati coordinates", () => {
    assert.equal(NEARBY_ZIP_MILES, 15);
    const atBatavia = suggestZipChoices({ ...CINCINNATI, zip: "16885", approximate: true });
    assert.equal(atBatavia.zip, "45103");
    assert.equal(atBatavia.choices[0], "45103");
    assert.ok(atBatavia.choices.length >= 2);
    assert.ok(atBatavia.choices.length <= 4);
    assert.equal(atBatavia.choices.includes("16885"), false);
    assert.equal(atBatavia.choices.includes("45202"), false);
    let previous = -1;
    for (const zip of atBatavia.choices) {
      const point = pointForZip(zip);
      assert.ok(point, zip);
      const miles = milesBetween([CINCINNATI.lat, CINCINNATI.lng], point!);
      assert.ok(miles <= 25, `${zip} is ${miles} miles away`);
      assert.ok(miles <= NEARBY_ZIP_MILES + 0.05, `${zip} is ${miles} miles away`);
      assert.ok(miles >= previous);
      previous = miles;
    }
    const one = nearbyZipChoices({
      ...CINCINNATI,
      zip: "16885",
      points: {
        "45103": [39.0916, -84.1437],
        "10001": [40.7506, -73.9973],
      },
    });
    assert.deepEqual(one.choices, ["45103"]);
    const none = nearbyZipChoices({
      lat: 47.6,
      lng: -122.3,
      zip: "16885",
      points: { "45103": [39.0916, -84.1437] },
    });
    assert.deepEqual(none.choices, []);
    assert.equal(none.zip, "");
    assert.match(profileUi, /codes\.length === 0/);
  });

  it("gives every chain a distinct high-contrast color", () => {
    const names = knownStoreNames();
    const seen = new Map<string, string>();
    for (const name of names) {
      const slug = chainSlug(name);
      const pair = CHAIN_COLORS[slug as keyof typeof CHAIN_COLORS];
      assert.ok(pair, name);
      const [background, foreground] = pair;
      assert.ok(contrastRatio(background, foreground) >= 4.5, `${name} contrast`);
      assert.match(css, new RegExp(background, "i"));
      for (const [other, color] of seen) {
        assert.ok(colorDistance(background, color) >= 40, `${name} vs ${other}`);
      }
      seen.set(name, background);
    }
    assert.notEqual(CHAIN_COLORS["sam-s-club"][0], CHAIN_COLORS["whole-foods"][0]);
    assert.ok(colorDistance(CHAIN_COLORS["sam-s-club"][0], CHAIN_COLORS["whole-foods"][0]) >= 40);
    const created: { id: string; textContent: string }[] = [];
    const fake = {
      getElementById(id: string) {
        return created.find((node) => node.id === id) || null;
      },
      createElement() {
        return { id: "", textContent: "" };
      },
      head: {
        appendChild(node: { id: string; textContent: string }) {
          created.push(node);
        },
      },
    };
    installChainColors(fake as unknown as Document);
    installChainColors(fake as unknown as Document);
    assert.equal(created.length, 1);
    assert.match(created[0].textContent, /sam-s-club/);
    assert.match(created[0].textContent, /whole-foods/);
    assert.match(profileUi, /installChainColors/);
  });

  it("opens the Teach Gitter drop sheet as the hero", () => {
    const upload = receiptUploadHtml();
    assert.match(upload, /drop-zone drop-primary drop-hero/);
    assert.match(upload, /Drop PDFs or screenshots/);
    assert.match(css, /data-step="receipts"\] \.sheet-body \{\s*justify-content: flex-start/);
    assert.match(css, /drop-zone\.drop-hero/);
    assert.match(css, /overflow: hidden/);
    assert.match(css, /inset: 0/);
    assert.match(css, /min-height: 96px/);
    assert.match(css, /:root\[data-resolved="dark"\] \.read-beat-count/);
    const styles = readFileSync(new URL("../../public/styles.css", import.meta.url), "utf8");
    assert.match(styles, /data-resolved="dark"\] \.drop-zone\.drop-primary/);
  });

  it("holds the receipt count with a skippable ring", () => {
    assert.equal(READ_BEAT_MS, 2500);
    assert.equal(readBeatHeadline(53), "Read 53 items");
    assert.equal(readBeatHeadline(1), "Read 1 item");
    const beat = readBeatHtml(53);
    assert.match(beat, /Read 53 items/);
    assert.match(beat, /Read 53 items from your receipt/);
    assert.match(beat, /id="read-beat-continue"/);
    assert.match(beat, /id="read-beat-skip"/);
    assert.match(beat, /animation-duration: 2\.5s/);
    assert.match(beat, /read-ring-fill/);
    assert.doesNotMatch(profileUi, /Reading your orders/);
    assert.doesNotMatch(profileUi, /readBeatHtml/);
    assert.match(profileUi, /holdThenLearned/);
  });

  it("shows the chosen brand rule on the card", () => {
    const pill = learnedRulePillHtml({ mode: "cheapestPicks", brand: "Cheerios", brands: ["Cheerios", "Kellogg's"] });
    assert.match(pill, /Cheapest of my picks/);
    assert.match(pill, /rule-pill-check/);
    assert.match(pill, /✓/);
    assert.match(pill, /Cheerios, Kellogg's/);
    assert.match(pill, /data-rule="cheapestPicks"/);
    const summary = learnedSummaryHtml(
      [{ family: "cereal", label: "Cereal", mode: "cheapestPicks", brand: "Cheerios", brands: ["Cheerios", "Kellogg's"] }],
      {}
    );
    assert.match(summary, /class="rule-pill"/);
    assert.match(summary, /Cheapest of my picks/);
    assert.match(summary, /Cheerios, Kellogg's/);
    assert.match(css, /\.rule-pill \{/);
  });

  it("explains the add-to-trip list and can jump to the end", () => {
    assert.equal(EMPTY_TRIP_TOTAL, "Select items to add");
    const rows = buildTripAddList([
      { name: "Milk", brand: "Kroger", quantity: 1, price: 4, family: "milk", label: "Dairy" },
      { name: "Mystery", quantity: 2, price: 3, family: "" },
    ]);
    assert.equal(rows[0].selected, false);
    assert.equal(rows[1].selected, false);
    const markup = tripAddHtml([
      { name: "Milk", quantity: 1, price: 4, family: "milk", label: "Dairy" },
      { name: "Soap", quantity: 1, price: 2, family: "", label: "Other" },
    ]);
    assert.match(markup, /Select all/);
    assert.match(markup, /Clear all/);
    assert.match(markup, /Select items to add/);
    assert.doesNotMatch(markup, /We preselected what you buy most often/);
    assert.match(markup, /id="learned-add-trip"[^>]*disabled/);
    assert.match(markup, /id="trip-add-total"/);
    assert.match(markup, /class="trip-add-total"/);
    assert.match(markup, /id="trip-jump"/);
    assert.match(markup, /id="learned-add-trip"/);
    assert.match(markup, /data-trip-all="all"/);
    assert.match(markup, /data-trip-all="none"/);
    assert.equal(jumpHidden(0, 200, 800), false);
    assert.equal(jumpHidden(620, 200, 800), true);
    assert.equal(jumpHidden(0, 400, 400), true);
    assert.match(profileUi, /resetStageScroll/);
    assert.match(profileUi, /dataset\.tripAll/);
    assert.match(css, /position: sticky/);
  });

  it("drops the empty list square and explains price alerts", () => {
    const escape = (value: string) => value.replace(/"/g, "&quot;");
    assert.equal(listThumbHtml("", escape), "");
    assert.equal(listThumbHtml("   ", escape), "");
    assert.match(listThumbHtml("https://cdn.example/milk.jpg", escape), /src="https:\/\/cdn\.example\/milk\.jpg"/);
    assert.equal(listAlertStateLabel(false), "Off");
    assert.equal(listAlertStateLabel(true), "On");
    assert.equal(LIST_ALERT_BENEFIT, "We'll send a push notification.");
    assert.match(html, /id="list-alert-block"[^>]*hidden/);
    assert.match(html, /id="list-alerts-benefit"/);
    assert.doesNotMatch(html, /class="alert-state"/);
    assert.doesNotMatch(html, /id="list-alerts"[^>]*disabled/);
    assert.match(app, /listThumbHtml/);
    assert.doesNotMatch(app, /<img src="\$\{escapeHtml\(image\)\}" alt="" \/>\s*\n\s*<div class="list-copy">/);
    assert.match(css, /\.list-row:not\(:has\(img\)\)/);
    assert.match(css, /list-alerts-benefit|alert-state\[data-on\]/);
  });
});
