import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFeedbackShots } from "./feedbackShots";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

describe("feedback screenshot storage", () => {
  it("keeps a real PNG and rejects a renamed text file", () => {
    const saved = parseFeedbackShots([{ name: "cart.png", mimeType: "image/png", data: PNG.toString("base64") }]);
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.shots[0].name, "cart.png");
    assert.equal(saved.shots[0].mimeType, "image/png");
    assert.equal(saved.shots[0].data.equals(PNG), true);
    const fake = parseFeedbackShots([{ name: "note.png", mimeType: "image/png", data: Buffer.from("not-a-real-image").toString("base64") }]);
    assert.equal(fake.ok, false);
  });

  it("rejects more than three shots and a missing image", () => {
    const tooMany = parseFeedbackShots([1, 2, 3, 4].map(() => ({ name: "a.png", mimeType: "image/png", data: PNG.toString("base64") })));
    assert.equal(tooMany.ok, false);
    assert.equal(parseFeedbackShots(undefined).ok, true);
  });
});
