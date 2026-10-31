import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { imageSize, visionDetail, visionDetailFor } from "./imageDetail";

const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAPwB/AP/Z",
  "base64"
);

describe("vision detail", () => {
  it("uses low detail for a short image and high detail for a tall receipt band", () => {
    assert.deepEqual(imageSize(TINY_JPEG), { width: 1, height: 1 });
    assert.equal(visionDetail(TINY_JPEG), "low");
    assert.equal(visionDetailFor(800, 600), "low");
    assert.equal(visionDetailFor(900, 1500), "high");
    assert.equal(visionDetail(Buffer.from("not-an-image")), "low");
  });
});
