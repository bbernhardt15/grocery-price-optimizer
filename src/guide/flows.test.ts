import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { SHELL_CACHE } from "../../public/shopper/betaContext.js";
import {
  createGuideSession,
  decideGuide,
  emptyGuideSettings,
  momentStillFits,
  noteReceipt,
  noteShown,
  presentGuide,
  receiptLine,
  receiptLinesFromPayload,
  runningLowSuggestions,
  type GuideSession,
  type GuideView,
  type Prompt,
} from "./rules";

const css = readFileSync(new URL("../../public/guide.css", import.meta.url), "utf8");
const guide = readFileSync(new URL("../../public/guide.js", import.meta.url), "utf8");
const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

const settings = emptyGuideSettings();

function view(extra: GuideView = {}): GuideView {
  return { step: "add", itemCount: 0, listNames: [], usuals: [], unfound: [], ...extra };
}

/** Dialog open while the read finishes, then the sheet closes onto Build. */
function afterSheet(session: GuideSession, seen: GuideView, current: Prompt | null = null) {
  const covered = presentGuide({ settings, session, view: seen, current, dialogOpen: true });
  return presentGuide({
    settings,
    session: covered.session,
    view: seen,
    current: covered.current,
    dialogOpen: false,
  });
}

describe("Gitter guide moments on the real flows", () => {
  it("after a receipt import and Confirm, offers the items bought most", () => {
    const lines = [
      { name: "Whole Milk", quantity: 1 },
      { name: "Large Eggs", quantity: 1 },
    ];
    for (let i = 0; i < 57; i += 1) lines.push({ name: `Item ${i}`, quantity: 1 });
    const payload = { items: lines.map((line) => ({ name: line.name })), receipt: { lines } };
    assert.equal(receiptLinesFromPayload(payload).length, 59);
    const session = noteReceipt(createGuideSession(), payload);
    const seen = view({
      itemCount: 0,
      listNames: [],
      usuals: [
        { name: "Whole Milk", times: 9 },
        { name: "Large Eggs", times: 4 },
      ],
    });
    const shown = afterSheet(session, seen);
    assert.equal(shown.current?.moment, "receipt");
    assert.equal(shown.current?.line, receiptLine(6, 59));
    assert.equal(shown.current?.chips.at(-1)?.label, "No thanks");
    assert.ok(shown.current?.chips.some((chip) => chip.label === "Add selected"));
    assert.equal(shown.current?.chips.some((chip) => chip.action === "show-rest"), true);
    const already = view({ itemCount: 59, listNames: lines.map((line) => line.name) });
    assert.notEqual(afterSheet(session, already).current?.moment, "receipt");
    const again = presentGuide({ settings, session: shown.session, view: seen, current: shown.current });
    assert.equal(again.current?.moment, "receipt");
    assert.equal(again.session, shown.session);
  });

  it("after the Add items sheet closes, does not invent staples without a purchase", () => {
    const seen = view({ itemCount: 2, listNames: ["Bananas", "Coffee"], usuals: [] });
    const shown = afterSheet(createGuideSession(), seen);
    assert.equal(shown.current?.moment, "before-review");
    assert.deepEqual(runningLowSuggestions([], seen.listNames), []);
  });

  it("after voice dictate adds items, suggests only bought usuals that are off the list", () => {
    const seen = view({
      itemCount: 1,
      listNames: ["Yogurt"],
      usuals: [
        { name: "Yogurt", times: 2 },
        { name: "Eggs", times: 3 },
      ],
    });
    const shown = afterSheet(createGuideSession(), seen);
    assert.equal(shown.current?.moment, "running-low");
    assert.equal(shown.current?.line, "Looks like you might be low on Eggs. Want me to add Eggs?");
    const kept = presentGuide({ settings, session: shown.session, view: seen, current: shown.current });
    assert.equal(kept.current?.moment, "running-low");
    assert.equal(decideGuide({ ...seen, settings, session: kept.session })?.moment, "before-review");
  });

  it("does not ask to start with usuals right after the teaching receipt", () => {
    const lines = [
      { name: "Bananas", quantity: 1 },
      { name: "Chicken", quantity: 1 },
    ];
    const session = noteReceipt(createGuideSession(), { lines, prompt: false });
    const seen = view({ itemCount: 2, listNames: ["Bananas", "Chicken"] });
    const shown = afterSheet(session, seen);
    assert.notEqual(shown.current?.moment, "receipt");
    assert.doesNotMatch(shown.current?.line || "", /buy most/);
  });

  it("after Select all and Add to trip, shows one moment and does not stack the next", () => {
    const lines = [
      { name: "Bananas", quantity: 1 },
      { name: "Chicken", quantity: 1 },
    ];
    let session = noteReceipt(createGuideSession(), { lines });
    const seen = view({ itemCount: 2, listNames: ["Bananas", "Chicken"] });
    const first = afterSheet(session, seen);
    assert.notEqual(first.current?.moment, "receipt");
    assert.equal(first.current?.moment, "before-review");
    session = first.session;
    const dismissed = presentGuide({ settings, session, view: seen, current: null });
    assert.equal(dismissed.current, null);
    const declined = presentGuide({
      settings,
      session: { ...session, declined: { "before-review": true }, shown: { ...session.shown, "before-review": true } },
      view: seen,
      current: null,
    });
    assert.equal(declined.current?.moment, "keep-building");
    assert.equal(declined.current?.chips.find((chip) => chip.action === "review")?.label, "Check store prices");
  });

  it("shows Review only after the running-low card is done, and each moment once", () => {
    const seen = view({ itemCount: 3, listNames: ["Milk", "Eggs", "Bread"] });
    const lowSkipped = noteShown(createGuideSession(), "running-low");
    const review = presentGuide({ settings, session: lowSkipped, view: seen, current: null });
    assert.equal(review.current?.moment, "before-review");
    assert.equal(review.current?.line, "Want me to check which stores are cheaper?");
    assert.deepEqual(
      review.current?.chips.map((chip) => chip.label),
      ["Check prices", "Keep building"]
    );
    const again = presentGuide({ settings, session: review.session, view: seen, current: review.current });
    assert.equal(again.current?.moment, "before-review");
    assert.equal(momentStillFits({ ...seen, settings, session: again.session }, "before-review"), true);
    const spent = presentGuide({ settings, session: again.session, view: seen, current: null });
    assert.equal(spent.current, null);
  });

  it("keeps the card readable at phone widths without covering the tab bar", () => {
    assert.match(css, /position:\s*fixed/);
    assert.match(css, /bottom:\s*calc\(var\(--bar-h\)/);
    assert.match(css, /max-height:\s*calc\(100svh - var\(--bar-h\)/);
    assert.match(css, /padding:\s*16px 14px 14px/);
    assert.match(css, /flex-wrap:\s*wrap/);
    assert.match(css, /@media \(max-width:\s*390px\)/);
    assert.match(css, /@media \(max-width:\s*375px\)/);
    assert.match(css, /align-self:\s*start/);
    assert.match(css, /:root\[data-resolved="dark"\] \.gitter-guide-chip/);
    assert.match(css, /body:has\(#gitter-guide:not\(\[hidden\]\)\) \.body/);
    assert.match(guide, /receiptLinesFromImportBody/);
    assert.match(sw, new RegExp(`grocery-gitter-shell-${SHELL_CACHE}`));
  });
});
