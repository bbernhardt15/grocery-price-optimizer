import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  clampStep,
  krogerStepCopy,
  normalizeZipInput,
  ONBOARDING_KEY,
  ONBOARDING_STEPS,
  onboardingDone,
  primaryLabel,
  progressLabel,
  shouldShowOnboarding,
  zipAdvanceError,
} from "../../public/shopper/onboarding.js";

const root = path.resolve(__dirname, "../..");

describe("onboarding steps", () => {
  it("shows once, stays skippable, and can be opened again from settings", () => {
    assert.equal(shouldShowOnboarding(null), true);
    assert.equal(shouldShowOnboarding(""), true);
    assert.equal(shouldShowOnboarding("0"), true);
    assert.equal(onboardingDone("1"), true);
    assert.equal(shouldShowOnboarding("1"), false);
    assert.equal(ONBOARDING_STEPS.length, 5);
    assert.deepEqual(
      ONBOARDING_STEPS.map((step) => step.id),
      ["pick", "split", "carts", "zip", "kroger"]
    );
    assert.equal(progressLabel(0), "1 of 5");
    assert.equal(progressLabel(4), "5 of 5");
    assert.equal(clampStep(-3), 0);
    assert.equal(clampStep(99), 4);
    assert.equal(primaryLabel(ONBOARDING_STEPS[0]), "Next");
    assert.equal(primaryLabel(ONBOARDING_STEPS[3]), "Continue");
    assert.match(ONBOARDING_STEPS[0].body, /list stays on this device/i);
    assert.match(ONBOARDING_STEPS[1].body, /lowest price/i);
    assert.match(ONBOARDING_STEPS[2].body, /cart/i);
  });

  it("accepts a blank ZIP and rejects a partial one", () => {
    assert.equal(zipAdvanceError(""), "");
    assert.equal(zipAdvanceError("   "), "");
    assert.equal(normalizeZipInput("45202"), "45202");
    assert.equal(normalizeZipInput("45202-1234"), "45202-1234");
    assert.equal(normalizeZipInput("452021234"), "45202-1234");
    assert.equal(zipAdvanceError("45202"), "");
    assert.equal(zipAdvanceError("4520"), "Enter a 5-digit ZIP, or leave it blank.");
    assert.equal(zipAdvanceError("abc"), "Enter a 5-digit ZIP, or leave it blank.");
  });

  it("keeps Kroger connect optional", () => {
    assert.equal(krogerStepCopy(null).connect, false);
    assert.equal(krogerStepCopy({ oauthConfigured: false }).connect, false);
    assert.match(krogerStepCopy({ oauthConfigured: false }).body, /isn’t available/i);
    assert.equal(krogerStepCopy({ oauthConfigured: true, connected: true }).connect, false);
    const offer = krogerStepCopy({ oauthConfigured: true, connected: false });
    assert.equal(offer.connect, true);
    assert.equal(offer.action, "Not now");
    assert.match(offer.body, /optional/i);
    assert.match(offer.body, /password/i);
  });

  it("ships a labeled, skippable dialog that settings can reopen", () => {
    const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
    const ui = fs.readFileSync(path.join(root, "public/shopper/onboardingUi.js"), "utf8");
    const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
    assert.match(html, /id="onboarding"/);
    assert.match(html, /id="onboard-title" tabindex="-1"/);
    assert.match(html, /id="onboard-skip"/);
    assert.match(html, />Skip</);
    assert.match(html, /for="onboard-zip"/);
    assert.match(html, /id="onboard-location"[^>]*hidden/);
    assert.match(html, /id="settings-dialog"/);
    assert.match(html, /id="settings-title" tabindex="-1"/);
    assert.match(html, /id="settings-welcome"/);
    assert.match(html, /id="settings-open"/);
    assert.match(html, /aria-controls="settings-dialog"/);
    assert.match(ui, /ONBOARDING_KEY/);
    assert.match(ui, /deps\.isNative\(\)/);
    assert.match(app, /maybeAutoOpen/);
    assert.equal(ONBOARDING_KEY, "gg-onboarding-done");
    const zipLabel = html.indexOf('for="onboard-zip"');
    const zipInput = html.indexOf('id="onboard-zip"');
    const skip = html.indexOf('id="onboard-skip"');
    const next = html.indexOf('id="onboard-next"');
    assert.ok(zipLabel > 0 && zipLabel < zipInput, "ZIP label precedes the field");
    assert.ok(zipInput < skip && skip < next, "ZIP, then Skip, then the primary action");
  });
});
