import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_LIST_ITEMS,
  applyItemWrites,
  clampWrittenAt,
  cleanDisplayName,
  createRateLimiter,
  hashSecret,
  isShareToken,
  newSecretToken,
  parseItemWrite,
  pollBody,
  secretMatches,
  toPublicList,
  type SharedItem,
} from "./sharedList";

const NOW = Date.parse("2026-10-16T12:00:00.000Z");

function write(overrides: Record<string, unknown> = {}) {
  return parseItemWrite(
    {
      itemId: "upc:100",
      catalogId: "upc:100",
      name: "Whole Milk",
      brand: "Dairy Pure",
      quantity: 1,
      checked: false,
      writtenAt: NOW,
      ...overrides,
    },
    NOW
  );
}

function mustWrite(overrides: Record<string, unknown> = {}) {
  const parsed = write(overrides);
  if ("error" in parsed) {
    throw new Error(parsed.error);
  }
  return parsed;
}

describe("shared list tokens", () => {
  it("creates unguessable tokens and stores only a hash comparison", () => {
    const first = newSecretToken();
    const second = newSecretToken();
    assert.notEqual(first, second);
    assert.equal(isShareToken(first), true);
    assert.equal(isShareToken("short"), false);
    assert.equal(isShareToken("../other"), false);
    const hash = hashSecret(first);
    assert.notEqual(hash, first);
    assert.equal(secretMatches(first, hash), true);
    assert.equal(secretMatches(second, hash), false);
    assert.equal(secretMatches("nope", hash), false);
  });
});

describe("shared list edits", () => {
  it("keeps a display name optional and strips control characters", () => {
    assert.equal(cleanDisplayName("  Sam\n"), "Sam");
    assert.equal(cleanDisplayName("   "), undefined);
    assert.equal(cleanDisplayName(12), undefined);
    assert.equal(cleanDisplayName("x".repeat(80))?.length, 40);
  });

  it("clamps a client clock that is far ahead", () => {
    assert.equal(clampWrittenAt(NOW + 60 * 60 * 1000, NOW), NOW + 2 * 60 * 1000);
    assert.equal(clampWrittenAt("nope", NOW), NOW);
  });

  it("lets the later edit win for one item and leaves the other item alone", () => {
    const first = applyItemWrites([], [mustWrite({ writtenAt: NOW, quantity: 1 })], "Sam", NOW);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const milk = first.items[0];
    assert.equal(milk?.addedBy, "Sam");
    assert.equal(milk?.checkedBy, undefined);

    const second = applyItemWrites(
      first.items,
      [mustWrite({ itemId: "upc:200", catalogId: "upc:200", name: "Bread", writtenAt: NOW + 1000 })],
      "Alex",
      NOW + 1000
    );
    assert.equal(second.ok, true);
    if (!second.ok) return;

    const olderMilk = applyItemWrites(
      second.items,
      [mustWrite({ quantity: 9, writtenAt: NOW - 50 })],
      "Jordan",
      NOW + 2000
    );
    assert.equal(olderMilk.ok, true);
    if (!olderMilk.ok) return;
    const milkAfter = olderMilk.items.find((item) => item.itemId === "upc:100");
    const bread = olderMilk.items.find((item) => item.itemId === "upc:200");
    assert.equal(milkAfter?.quantity, 1);
    assert.equal(milkAfter?.addedBy, "Sam");
    assert.equal(bread?.addedBy, "Alex");
    assert.equal(olderMilk.changed, false);

    const newerMilk = applyItemWrites(
      olderMilk.items,
      [mustWrite({ quantity: 2, checked: true, writtenAt: NOW + 5000 })],
      "Alex",
      NOW + 5000
    );
    assert.equal(newerMilk.ok, true);
    if (!newerMilk.ok) return;
    const checked = newerMilk.items.find((item) => item.itemId === "upc:100");
    assert.equal(checked?.quantity, 2);
    assert.equal(checked?.checked, true);
    assert.equal(checked?.checkedBy, "Alex");
    assert.equal(checked?.addedBy, "Sam");
    assert.equal(newerMilk.items.find((item) => item.itemId === "upc:200")?.quantity, 1);
  });

  it("keeps the stored item when the timestamp is the same", () => {
    const created = applyItemWrites([], [mustWrite({ quantity: 1, writtenAt: NOW })], "Sam", NOW);
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const tied = applyItemWrites(created.items, [mustWrite({ quantity: 4, writtenAt: NOW })], "Alex", NOW + 10);
    assert.equal(tied.ok, true);
    if (!tied.ok) return;
    assert.equal(tied.changed, false);
    assert.equal(tied.items[0]?.quantity, 1);
    assert.equal(tied.items[0]?.addedBy, "Sam");
  });

  it("uses a newer delete as a tombstone so an older add cannot revive the item", () => {
    const removed = applyItemWrites(
      [],
      [mustWrite({ deleted: true, writtenAt: NOW + 1000 })],
      undefined,
      NOW + 1000
    );
    assert.equal(removed.ok, true);
    if (!removed.ok) return;
    const lateAdd = applyItemWrites(removed.items, [mustWrite({ quantity: 3, writtenAt: NOW })], "Sam", NOW + 2000);
    assert.equal(lateAdd.ok, true);
    if (!lateAdd.ok) return;
    assert.equal(lateAdd.items[0]?.deleted, true);
    assert.equal(lateAdd.changed, false);

    const readded = applyItemWrites(
      lateAdd.items,
      [mustWrite({ quantity: 2, writtenAt: NOW + 3000 })],
      "Alex",
      NOW + 3000
    );
    assert.equal(readded.ok, true);
    if (!readded.ok) return;
    assert.equal(readded.items.find((item) => !item.deleted)?.addedBy, "Alex");
  });

  it("does not invent a name when nobody set a display name", () => {
    const created = applyItemWrites([], [mustWrite()], undefined, NOW);
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.items[0]?.addedBy, undefined);
    const checked = applyItemWrites(
      created.items,
      [mustWrite({ checked: true, writtenAt: NOW + 1 })],
      undefined,
      NOW + 1
    );
    assert.equal(checked.ok, true);
    if (!checked.ok) return;
    assert.equal(checked.items[0]?.checked, true);
    assert.equal(checked.items[0]?.checkedBy, undefined);
  });

  it("refuses a list past the item cap and still allows an edit at the cap", () => {
    const seeded: SharedItem[] = Array.from({ length: MAX_LIST_ITEMS }, (_, index) => ({
      itemId: `upc:${index}`,
      name: `Item ${index}`,
      quantity: 1,
      checked: false,
      writtenAt: NOW,
      updatedAt: new Date(NOW).toISOString(),
      deleted: false,
    }));
    const overflow = applyItemWrites(
      seeded,
      [mustWrite({ itemId: "upc:new", name: "One more", writtenAt: NOW + 1 })],
      "Sam",
      NOW + 1
    );
    assert.equal(overflow.ok, false);
    if (overflow.ok) return;
    assert.match(overflow.error, /100/);

    const edited = applyItemWrites(
      seeded,
      [mustWrite({ itemId: "upc:0", name: "Item 0", quantity: 3, writtenAt: NOW + 1 })],
      "Sam",
      NOW + 1
    );
    assert.equal(edited.ok, true);
    if (!edited.ok) return;
    assert.equal(edited.items.filter((item) => !item.deleted).length, MAX_LIST_ITEMS);
    assert.equal(edited.items.find((item) => item.itemId === "upc:0")?.quantity, 3);
  });

  it("hides owner secrets and other lists from the public payload", () => {
    const created = applyItemWrites([], [mustWrite({ checked: true, writtenAt: NOW })], "Sam", NOW);
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const removed = applyItemWrites(created.items, [mustWrite({ deleted: true, writtenAt: NOW + 5 })], "Sam", NOW + 5);
    assert.equal(removed.ok, true);
    if (!removed.ok) return;
    const payload = toPublicList({
      shareToken: "a".repeat(43),
      title: "Shopping list",
      mode: "view",
      role: "guest",
      seq: 2,
      updatedAt: new Date(NOW).toISOString(),
      items: removed.items,
    });
    const serialized = JSON.stringify(payload);
    assert.equal(payload.canEdit, false);
    assert.equal(serialized.includes("ownerToken"), false);
    assert.equal(payload.items[0]?.deleted, true);
    assert.equal(payload.items[0]?.name, undefined);
    const owner = toPublicList({ ...payload, role: "owner", items: removed.items, updatedAt: payload.updatedAt });
    assert.equal(owner.canEdit, true);
    const quiet = pollBody(owner, 2);
    assert.equal(quiet.changed, false);
    assert.equal("items" in quiet, false);
  });
});

describe("list edit rate limit", () => {
  it("stops accepting edits after the cap inside the window", () => {
    let clock = 1_000;
    const limiter = createRateLimiter({ windowMs: 60_000, now: () => clock });
    assert.equal(limiter.allow("list-a", 2), true);
    assert.equal(limiter.allow("list-a", 2), true);
    assert.equal(limiter.allow("list-a", 2), false);
    assert.equal(limiter.allow("list-b", 2), true);
    clock += 60_001;
    assert.equal(limiter.allow("list-a", 2), true);
  });
});
