import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { vapidConfig, webPushConfigured } from "./vapid";

describe("VAPID configuration", () => {
  it("stays off unless both keys are set", () => {
    assert.equal(vapidConfig({}), null);
    assert.equal(webPushConfigured({}), false);
    assert.equal(vapidConfig({ VAPID_PUBLIC_KEY: "pub" }), null);
    assert.equal(vapidConfig({ VAPID_PRIVATE_KEY: "priv" }), null);
    assert.equal(vapidConfig({ VAPID_PUBLIC_KEY: "  ", VAPID_PRIVATE_KEY: " priv " }), null);
    assert.equal(vapidConfig({ VAPID_SUBJECT: "mailto:alerts@example.com" }), null);
  });

  it("reads both keys and an optional mailto or https subject", () => {
    assert.deepEqual(
      vapidConfig({
        VAPID_PUBLIC_KEY: " pub ",
        VAPID_PRIVATE_KEY: " priv ",
        VAPID_SUBJECT: " mailto:alerts@example.com ",
      }),
      {
        publicKey: "pub",
        privateKey: "priv",
        subject: "mailto:alerts@example.com",
      }
    );
    assert.equal(
      vapidConfig({
        VAPID_PUBLIC_KEY: "pub",
        VAPID_PRIVATE_KEY: "priv",
        VAPID_SUBJECT: "https://grocerygitter.app/privacy",
      })?.subject,
      "https://grocerygitter.app/privacy"
    );
    assert.equal(webPushConfigured({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" }), true);
  });

  it("falls back to the default mailto subject when VAPID_SUBJECT is unset or unusable", () => {
    const fallback = "mailto:price-alerts@grocerygitter.app";
    assert.equal(vapidConfig({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" })?.subject, fallback);
    assert.equal(
      vapidConfig({
        VAPID_PUBLIC_KEY: "pub",
        VAPID_PRIVATE_KEY: "priv",
        VAPID_SUBJECT: "alerts@example.com",
      })?.subject,
      fallback
    );
    assert.equal(
      vapidConfig({
        VAPID_PUBLIC_KEY: "pub",
        VAPID_PRIVATE_KEY: "priv",
        VAPID_SUBJECT: "   ",
      })?.subject,
      fallback
    );
  });
});
