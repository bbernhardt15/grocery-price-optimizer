import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { preferServerSpeech, recorderMime, releaseMicrophone } from "../../public/shopper/speechListen.js";
import { addedLabel, addedUnits, acceptLabel } from "../../public/shopper/import.js";
import { dedupeReviewItems } from "../../public/shopper/importDedupe.js";

describe("voice capture on iOS Safari", () => {
  it("uses the server recording path on iPhone and iPad, and keeps desktop speech", () => {
    assert.equal(preferServerSpeech({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }), true);
    assert.equal(preferServerSpeech({ userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)" }), true);
    assert.equal(preferServerSpeech({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit", maxTouchPoints: 5 }), true);
    assert.equal(preferServerSpeech({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome", maxTouchPoints: 0 }), false);
  });

  it("stops the recorder and every track", () => {
    const stopped: string[] = [];
    const capture = {
      mediaRecorder: {
        state: "recording",
        stop() {
          this.state = "inactive";
          stopped.push("recorder");
        },
      },
      stream: {
        getTracks() {
          return [{ stop() { stopped.push("track"); } }, { stop() { stopped.push("track"); } }];
        },
      },
    };
    assert.equal(releaseMicrophone(capture), 2);
    assert.deepEqual(stopped, ["recorder", "track", "track"]);
    assert.equal(releaseMicrophone(null), 0);
    const importJs = require("node:fs").readFileSync(new URL("../../public/shopper/import.js", import.meta.url), "utf8");
    assert.match(importJs, /releaseMicrophone/);
    assert.match(importJs, /visibilitychange/);
    assert.match(importJs, /pagehide/);
  });

  it("asks iOS for mp4 before webm", () => {
    const mime = recorderMime((type: string) => type === "audio/mp4" || type === "audio/webm");
    assert.equal(mime, "audio/mp4");
    assert.equal(recorderMime(() => false), "");
  });
});

describe("upload review duplicates", () => {
  it("merges the same item across photos and inside one photo", () => {
    const milk = {
      key: "item-1",
      raw: "Milk",
      name: "Milk",
      quantity: 1,
      status: "matched",
      accepted: true,
      selectedId: "milk-1",
      upc: "0001111041700",
      choices: [{ product: { id: "milk-1", upc: "0001111041700" } }],
    };
    const again = { ...milk, key: "item-2", quantity: 2, raw: "milk" };
    const eggs = { ...milk, key: "item-3", name: "Eggs", raw: "Eggs", upc: "0001111040101", selectedId: "eggs", quantity: 1 };
    const merged = dedupeReviewItems([milk, again, eggs, { ...again, key: "item-4" }]);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].name, "Milk");
    assert.equal(merged[0].quantity, 1 + 2 + 2);
    assert.equal(merged[1].name, "Eggs");
    const flavors = dedupeReviewItems([
      { ...milk, key: "c1", name: "Cinnamon Pop-Tarts", raw: "cinnamon pop-tarts", upc: "0001111041999", selectedId: "cin" },
      { ...milk, key: "c2", name: "Cherry Pop-Tarts", raw: "cherry pop-tarts", upc: "0001111041999", selectedId: "che" },
    ]);
    assert.equal(flavors.length, 2);
    assert.equal(addedUnits([{ productId: "cin", quantity: 1 }, { productId: "cin", quantity: 1 }]), 1);
    assert.equal(addedUnits([{ productId: "cin", quantity: 1 }, { productId: "che", quantity: 1 }]), 2);
    assert.equal(acceptLabel(1), "Add 1 item to my trip");
    assert.equal(addedLabel(1), "Added 1 item.");
    assert.equal(addedLabel(2), "Added 2 items.");
  });
});
