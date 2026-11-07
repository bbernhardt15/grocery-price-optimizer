import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { SHELL_CACHE } from "../../public/shopper/betaContext.js";
import { genuineUnfound, pricesUpdatedLabel } from "../../public/shopper/planCache.js";
import { savingsNudge } from "../../public/shopper/savingsNudge.js";
import { FINISH_TRIP_UNDO_MS, completeTripAction } from "../../public/shopper/tripActions.js";
import { unfoundSearchLinks } from "../../public/shopper/unfoundItems.js";
import {
  DISMISS_LIMIT,
  GUIDE_KEY,
  GUIDE_LABEL,
  createGuideSession,
  decideGuide,
  dismissGuide,
  emptyGuideSettings,
  formatDollars,
  guideIsOff,
  importReceiptUrl,
  linesFromImportBody,
  linesFromReceipt,
  namesMatch,
  clearTripNote,
  noteDeclined,
  noteReceipt,
  noteShown,
  noteTrip,
  presentGuide,
  readGuideSettings,
  receiptLine,
  receiptLinesFromImportBody,
  receiptLinesFromPayload,
  receiptPicks,
  runningLowLine,
  runningLowSuggestions,
  runningLowUsuals,
  setGuideEnabled,
  tripLine,
  typeFrames,
  writeGuideSettings,
  type GuideSession,
  type GuideSettings,
  type GuideView,
  type Prompt,
} from "./rules";
import { guideCardHtml } from "../../public/guide.js";

const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../../public/guide.css", import.meta.url), "utf8");
const guide = readFileSync(new URL("../../public/guide.js", import.meta.url), "utf8");
const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

function memory() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.has(key) ? values.get(key)! : null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

function view(extra: GuideView = {}): GuideView {
  return { step: "add", itemCount: 0, listNames: [], usuals: [], savings: null, unfound: [], ...extra };
}

function show(session: GuideSession, settings: GuideSettings, seen: GuideView, current: Prompt | null = null) {
  return presentGuide({ settings, session, view: seen, current });
}

describe("Gitter guide rules", () => {
  it("asks what you need on Home or an empty Build tab", () => {
    for (const step of ["add", "home", "build"]) {
      const prompt = decideGuide({ ...view({ step }), settings: emptyGuideSettings(), session: createGuideSession() });
      assert.ok(prompt);
      assert.equal(prompt.moment, "welcome");
      assert.equal(prompt.line, "Hey. What are we picking up this week?");
      assert.deepEqual(
        prompt.chips.map((chip) => chip.label),
        ["Say or type my list", "Use my usuals", "Upload a receipt"]
      );
      assert.deepEqual(
        prompt.chips.map((chip) => chip.action),
        ["focus-ask", "use-usuals", "upload-receipt"]
      );
    }
  });

  it("after a receipt import, offers to start with the items bought most", () => {
    let session = noteReceipt(createGuideSession(), {
      receipt: {
        lines: [
          { name: "Soda", quantity: 6 },
          { name: "Whole Milk", quantity: 1 },
          { name: "Large Eggs", quantity: 2 },
        ],
      },
    });
    for (let i = 0; i < 56; i += 1) session = noteReceipt(session, { lines: [{ name: `Item ${i}`, quantity: 1 }] });
    const prompt = decideGuide({
      ...view(),
      settings: emptyGuideSettings(),
      session,
      usuals: [
        { name: "Large Eggs", times: 2 },
        { name: "Whole Milk", times: 9 },
      ],
    });
    assert.ok(prompt);
    assert.equal(prompt.moment, "receipt");
    assert.equal(prompt.line, "I found 59 items that are not on your list yet. Choose any, then add them.");
    assert.equal(receiptLine(59), prompt.line);
    assert.equal(receiptLine(1), "I found 1 item that is not on your list yet. Choose any, then add them.");
    assert.equal(prompt.chips.at(-1)?.label, "Add selected");
    assert.equal(prompt.chips.at(-1)?.action, "commit-picks");
    assert.ok(prompt.chips.some((chip) => chip.label === "Whole Milk" && chip.action === "toggle-pick"));
    assert.ok(prompt.chips.some((chip) => chip.label === "Large Eggs" && chip.action === "toggle-pick"));
    assert.equal(prompt.chips.some((chip) => chip.action === "pick-receipt"), false);
    assert.deepEqual(
      receiptPicks(
        [
          { name: "Soda", quantity: 4 },
          { name: "Bread", quantity: 1 },
        ],
        []
      ),
      ["Soda", "Bread"]
    );
  });

  it("after items are added, offers usuals that are not on the list yet", () => {
    const prompt = decideGuide({
      ...view({
        itemCount: 1,
        listNames: ["Whole Milk"],
        usuals: [
          { name: "Whole Milk", times: 8 },
          { name: "Eggs", times: 5 },
          { name: "Bread", times: 4 },
          { name: "Bananas", times: 3 },
          { name: "Eggplant", times: 1 },
        ],
      }),
      settings: emptyGuideSettings(),
      session: createGuideSession(),
    });
    assert.ok(prompt);
    assert.equal(prompt.moment, "running-low");
    assert.equal(prompt.line, runningLowLine(["Eggs", "Bread", "Bananas"]));
    assert.equal(prompt.line, "Looks like you might be low on Eggs, Bread, Bananas. Want me to add them?");
    assert.equal(runningLowLine(["Milk"]), "Looks like you might be low on Milk. Want me to add Milk?");
    assert.equal(prompt.chips.length, 4);
    assert.deepEqual(
      prompt.chips.map((chip) => chip.action),
      ["toggle-pick", "toggle-pick", "toggle-pick", "commit-picks"]
    );
    assert.equal(namesMatch("egg", "eggplant"), false);
    assert.equal(namesMatch("milk", "whole milk"), true);
    assert.deepEqual(runningLowUsuals([{ name: "Milk", times: 1 }], ["Whole Milk"]), []);
  });

  it("asks to find the best prices before Review once the list has items", () => {
    const prompt = decideGuide({
      ...view({
        itemCount: 3,
        listNames: ["Milk", "Eggs", "Bread"],
        usuals: [{ name: "Milk", times: 1 }],
      }),
      settings: emptyGuideSettings(),
      session: createGuideSession(),
    });
    assert.ok(prompt);
    assert.equal(prompt.moment, "before-review");
    assert.equal(prompt.line, "Want me to check which stores are cheaper?");
    assert.deepEqual(
      prompt.chips.map((chip) => chip.label),
      ["Review", "Not yet"]
    );
    assert.equal(prompt.chips[0].action, "review");
  });

  it("follows Not yet with another prompt instead of a dead thread", () => {
    const settings = emptyGuideSettings();
    const base = {
      ...view({
        itemCount: 2,
        listNames: ["Milk", "Eggs"],
      }),
      settings,
    };
    const asked = decideGuide({ ...base, session: noteShown(createGuideSession(), "running-low") });
    assert.equal(asked?.moment, "before-review");
    const declined = noteDeclined(createGuideSession(), "before-review");
    const next = decideGuide({ ...base, session: { ...declined, shown: { ...declined.shown, "running-low": true } } });
    assert.equal(next?.moment, "keep-building");
    assert.match(next?.line || "", /Add anything else/);
    assert.ok(next?.chips.some((chip) => chip.action === "review"));
    assert.equal(next?.chips.some((chip) => chip.action === "later"), false);
    const closed = decideGuide({
      ...base,
      session: noteShown(declined, "keep-building"),
    });
    assert.notEqual(closed?.moment, "before-review");
    assert.notEqual(closed?.moment, "keep-building");
  });

  it("on Review, uses the unfound search links and stays quiet while the savings card is up", () => {
    const settings = emptyGuideSettings();
    const session = createGuideSession();
    const now = Date.now();
    const smallPlans = {
      saved: 2.24,
      best: { stops: 2, total: 272.57 },
      baseline: { storeName: "Kroger", total: 274.81, complete: true },
    };
    const nudge = savingsNudge(smallPlans);
    assert.ok(nudge);
    const pricesLabel = pricesUpdatedLabel(now - 60_000, now);
    assert.match(pricesLabel, /Prices updated/);
    const covered = decideGuide({
      ...view({
        step: "plan",
        itemCount: 3,
        savingsCard: true,
        unfound: genuineUnfound(["Oat milk"], [{ check: "ok" }]),
        pricesLabel,
        search: unfoundSearchLinks("Oat milk"),
      }),
      settings,
      session,
    });
    assert.equal(covered, null);

    const timedOut = genuineUnfound(["Oat milk"], [{ check: "timeout" }]);
    assert.deepEqual(timedOut, []);
    assert.equal(
      decideGuide({ ...view({ step: "plan", itemCount: 3, unfound: timedOut, pricesLabel }), settings, session }),
      null
    );
    assert.equal(
      decideGuide({
        ...view({ step: "plan", itemCount: 3, unfound: ["Oat milk"], pricesLabel: "", search: unfoundSearchLinks("Oat milk") }),
        settings,
        session,
      }),
      null
    );

    const names = genuineUnfound(["Oat milk"], [{ storeName: "Kroger", check: "ok" }]);
    const links = unfoundSearchLinks(names[0]);
    const missing = decideGuide({
      ...view({ step: "plan", itemCount: 3, savingsCard: false, unfound: names, pricesLabel, search: links }),
      settings,
      session,
    });
    assert.ok(missing);
    assert.equal(missing.moment, "review-next");
    assert.equal(missing.line, "I couldn't find Oat milk. Want me to look for a similar brand?");
    assert.deepEqual(
      missing.chips.map((chip) => [chip.label, chip.action, chip.url]),
      [
        [links.kroger.label, "open-search", links.kroger.url],
        [links.walmart.label, "open-search", links.walmart.url],
        ["Keep these", "later", undefined],
      ]
    );
    assert.equal(
      decideGuide({
        ...view({ step: "add", itemCount: 3, listNames: ["Milk", "Eggs", "Bread"], unfound: names, pricesLabel }),
        settings,
        session,
      })?.moment,
      "before-review"
    );
  });

  it("after the trip is complete, names the savings from that finish and keeps the 10 second undo", () => {
    const finish = completeTripAction();
    assert.equal(finish.undoMs, FINISH_TRIP_UNDO_MS);
    assert.equal(FINISH_TRIP_UNDO_MS, 10_000);
    const session = noteTrip(createGuideSession(), {
      saved: 12.5,
      savedToPastTrips: true,
      items: [{ name: "Whole Milk", quantity: 1 }],
    });
    assert.equal(session.trip?.savedToPastTrips, true);
    const prompt = decideGuide({
      ...view({ step: "add", itemCount: 0 }),
      settings: emptyGuideSettings(),
      session,
    });
    assert.ok(prompt);
    assert.equal(prompt.moment, "trip-saved");
    assert.equal(prompt.line, tripLine(12.5));
    assert.equal(prompt.line, `Nice, you saved ${formatDollars(12.5)}. Save this Shopping list for next time?`);
    assert.match(prompt.line, /Nice, you saved \$12\.50\. Save this Shopping list for next time\?/);
    assert.equal(prompt.chips[0].label, "Save Shopping list");
    assert.deepEqual(prompt.chips[0].names, ["Whole Milk"]);
    assert.equal(prompt.chips[0].action, "save-list");
    const unmatched = presentGuide({
      settings: emptyGuideSettings(),
      session: createGuideSession(),
      view: view({
        step: "plan",
        itemCount: 3,
        unfound: ["Shirley Temple"],
        pricesLabel: "Prices updated",
        search: unfoundSearchLinks("Shirley Temple"),
      }),
    });
    assert.equal(unmatched.current?.moment, "review-next");
    const kept = presentGuide({
      settings: emptyGuideSettings(),
      session: unmatched.session,
      current: unmatched.current,
      view: view({ step: "plan", itemCount: 3, savingsCard: true, unfound: [], pricesLabel: "Prices updated" }),
    });
    assert.equal(kept.current?.moment, "review-next");
    assert.equal(kept.current?.line, unmatched.current?.line);
    assert.equal(prompt.chips.some((chip) => chip.label === "Undo"), false);
    const undone = clearTripNote(session);
    assert.equal(undone.trip, null);
    assert.equal(decideGuide({ ...view(), settings: emptyGuideSettings(), session: undone })?.moment, "welcome");
  });

  it("shows each moment once per session and keeps the card until that moment no longer fits", () => {
    const settings = emptyGuideSettings();
    const seen = view();
    let session = createGuideSession();
    let current: Prompt | null = null;
    const first = show(session, settings, seen, current);
    assert.equal(first.current?.moment, "welcome");
    assert.equal(first.session.shown.welcome, true);
    session = first.session;
    current = first.current;
    const again = show(session, settings, seen, current);
    assert.equal(again.current?.moment, "welcome");
    assert.equal(again.session, session);
    const closed = show(session, settings, seen, null);
    assert.equal(closed.current, null);

    session = noteShown(createGuideSession(), "welcome");
    const withItems = decideGuide({
      ...view({ itemCount: 3, listNames: ["Milk", "Eggs", "Bread"] }),
      settings,
      session,
    });
    assert.equal(withItems?.moment, "before-review");
    const low = decideGuide({
      ...view({ itemCount: 1, listNames: ["Yogurt"], usuals: [{ name: "Eggs", times: 2 }] }),
      settings,
      session,
    });
    assert.equal(low?.moment, "running-low");
    assert.match(low?.line || "", /Eggs/);
    assert.equal(decideGuide({ ...view({ itemCount: 1, listNames: ["Yogurt"] }), settings, session })?.moment, "before-review");
    const receipt = noteReceipt(session, { lines: [{ name: "Yogurt", quantity: 1 }] });
    assert.equal(decideGuide({ ...view(), settings, session: receipt })?.moment, "receipt");
    assert.equal(decideGuide({ ...view(), settings, session: noteShown(receipt, "receipt") }), null);
  });

  it("stores dismissals in settings and hides the guide after three, until it is turned back on", () => {
    const storage = memory();
    let settings = emptyGuideSettings();
    assert.equal(guideIsOff(settings), false);
    settings = dismissGuide(settings);
    settings = dismissGuide(settings);
    assert.equal(settings.dismissals, 2);
    assert.equal(guideIsOff(settings), false);
    assert.equal(decideGuide({ ...view(), settings, session: createGuideSession() })?.moment, "welcome");
    settings = dismissGuide(settings);
    assert.equal(settings.dismissals, DISMISS_LIMIT);
    assert.equal(settings.enabled, false);
    assert.equal(guideIsOff(settings), true);
    assert.equal(decideGuide({ ...view(), settings, session: createGuideSession() }), null);
    writeGuideSettings(storage, settings);
    assert.equal(guideIsOff(readGuideSettings(storage)), true);
    assert.equal(storage.getItem(GUIDE_KEY)?.includes(`"dismissals":${DISMISS_LIMIT}`), true);
    settings = setGuideEnabled(readGuideSettings(storage), true);
    writeGuideSettings(storage, settings);
    assert.deepEqual(readGuideSettings(storage), { enabled: true, dismissals: 0 });
    assert.equal(decideGuide({ ...view(), settings, session: createGuideSession() })?.moment, "welcome");
    settings = setGuideEnabled(settings, false);
    assert.equal(decideGuide({ ...view(), settings, session: createGuideSession() }), null);
  });

  it("does not swap or spend a prompt while a finger is down, a dialog is open, or a field is focused", () => {
    const settings = emptyGuideSettings();
    const session = createGuideSession();
    const held = presentGuide({
      settings,
      session,
      view: view({ itemCount: 2, listNames: ["Milk"] }),
      current: { moment: "welcome", line: "Hey. What are we picking up this week?", chips: [] },
      holding: true,
    });
    assert.equal(held.defer, true);
    assert.equal(held.hidden, false);
    assert.equal(held.current?.moment, "welcome");
    assert.equal(held.session.shown["before-review"], undefined);

    const covered = presentGuide({ settings, session, view: view(), current: null, dialogOpen: true });
    assert.equal(covered.defer, true);
    assert.equal(covered.hidden, true);
    assert.equal(covered.current, null);
    assert.equal(covered.session.shown.welcome, undefined);

    const typing = presentGuide({
      settings,
      session,
      view: view(),
      current: { moment: "welcome", line: "Hey. What are we picking up this week?", chips: [] },
      fieldFocused: true,
    });
    assert.equal(typing.hidden, true);
    assert.equal(typing.current?.moment, "welcome");
    assert.equal(typing.session.shown.welcome, undefined);
  });

  it("types the line unless reduced motion is on, and reads receipt bodies without calling ask", () => {
    assert.deepEqual(typeFrames("Hi", true), ["Hi"]);
    const frames = typeFrames("Hi", false);
    assert.deepEqual(frames, ["H", "Hi"]);
    assert.equal(importReceiptUrl("/api/import/receipt"), true);
    assert.equal(importReceiptUrl("https://grocery.gitter/api/import/photo"), true);
    assert.equal(importReceiptUrl("/api/import/pdf?progress=1"), true);
    assert.equal(importReceiptUrl("/api/import/text"), true);
    assert.equal(importReceiptUrl("/api/import/file"), true);
    assert.equal(importReceiptUrl("/api/import/ask"), false);
    assert.deepEqual(receiptLinesFromPayload({ items: [{ name: "Milk", quantity: 1 }] }), []);
    assert.deepEqual(receiptLinesFromPayload({ receipt: { lines: [{ name: "Whole Milk", quantity: 1 }] } }), [
      { name: "Whole Milk", quantity: 1 },
    ]);
    assert.equal(receiptLinesFromImportBody("application/json", JSON.stringify({ items: [{ name: "Bread" }] })).length, 0);
    assert.deepEqual(runningLowSuggestions([], ["Whole Milk"]), []);
    const lines = linesFromReceipt({
      receipt: { lines: [{ name: "Milk", quantity: 2 }] },
      items: [{ name: "Other", quantity: 1 }],
    });
    assert.deepEqual(lines, [{ name: "Milk", quantity: 2 }]);
    const streamed = linesFromImportBody(
      "application/x-ndjson",
      `${JSON.stringify({ type: "progress", ratio: 0.2 })}\n${JSON.stringify({ type: "result", analysis: { lines: [{ name: "Bread", quantity: 1 }] } })}\n`
    );
    assert.deepEqual(streamed, [{ name: "Bread", quantity: 1 }]);
    assert.doesNotMatch(guide, /\/api\/import\/ask/);
    assert.match(guide, /receiptLinesFromImportBody/);
    assert.match(guide, /prefers-reduced-motion/);
    assert.match(guide, /pointerdown/);
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
    assert.match(css, /position:\s*fixed/);
    assert.match(css, /z-index:\s*7/);
    assert.match(css, /bottom:\s*calc\(var\(--bar-h\)/);
    assert.match(css, /max-height:\s*calc\(100svh - var\(--bar-h\)/);
    assert.match(css, /var\(--safe-top\)/);
    assert.match(css, /var\(--surface\)/);
    assert.match(css, /var\(--ink\)/);
    assert.match(css, /var\(--line\)/);
  });

  it("hooks the card in from the shell without taking over the page", () => {
    assert.match(html, /guide\.css/);
    assert.match(app, /mountGuide/);
    assert.match(app, /guide\?\.sync\?\.\(\)/);
    assert.match(app, /guide\?\.noteTrip\?\.\(\{/);
    assert.match(app, /savedToPastTrips: true/);
    assert.match(app, /guide\?\.clearTrip\?\.\(\)/);
    assert.match(app, /savingsNudge\(plans\)/);
    assert.match(app, /genuineUnfound\(/);
    assert.match(app, /unfoundSearchLinks\(/);
    assert.match(app, /pricesUpdatedLabel\(/);
    assert.match(guide, /setAttribute\("aria-label", GUIDE_LABEL\)/);
    assert.match(guide, /settings-guide/);
    assert.match(guide, /data-guide-dismiss/);
    assert.match(guide, /data-guide-off/);
    const card = guideCardHtml({
      moment: "welcome",
      line: "Hey. What are we picking up this week?",
      chips: [{ id: "say", label: "Say or type my list", action: "focus-ask" }],
    });
    assert.match(card, new RegExp(`aria-label="${GUIDE_LABEL}"`));
    assert.match(card, /aria-label="Dismiss guide"/);
    assert.match(card, /aria-label="Turn off guide"/);
    assert.match(card, /aria-live="polite"/);
    assert.match(card, /Say or type my list/);
    assert.match(sw, new RegExp(`grocery-gitter-shell-${SHELL_CACHE}`));
    assert.doesNotMatch(`${guide}\n${css}`, /meal plan|recipe ideas|dinner idea/i);
  });
});
