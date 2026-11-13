import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dequeuePrompt, resolveQueuedPrompt } from "../../public/guide.js";

describe("guide prompt queue", () => {
  it("shows one prompt, replaces quiet cards, and waits behind a task card", () => {
    const welcome = { moment: "welcome", line: "Hey. What are we picking up this week?" };
    const building = { moment: "before-review", line: "Want me to check which stores are cheaper?" };
    const saved = { moment: "trip-saved", line: "Saved this trip." };
    const review = { moment: "review-next", line: "Needs a look." };

    const dropped = resolveQueuedPrompt([], null, welcome, { midTask: true });
    assert.equal(dropped.show, null);
    assert.deepEqual(dropped.queue, []);

    const first = resolveQueuedPrompt([], null, welcome, { midTask: false });
    assert.equal(first.show?.moment, "welcome");

    const replaced = resolveQueuedPrompt([], welcome, building);
    assert.equal(replaced.show?.moment, "before-review");
    assert.deepEqual(replaced.queue, []);

    const waiting = resolveQueuedPrompt([], saved, review);
    assert.equal(waiting.show, null);
    assert.equal(waiting.queue[0]?.moment, "review-next");
    const again = resolveQueuedPrompt(waiting.queue, saved, review);
    assert.equal(again.queue.length, 1);

    const next = dequeuePrompt(again.queue);
    assert.equal(next.show?.line, "Needs a look.");
    assert.deepEqual(next.queue, []);
  });
});
