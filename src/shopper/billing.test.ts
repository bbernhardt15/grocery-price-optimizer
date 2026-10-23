import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { manageUrl, packageChoices, paywallView, platformOf, sdkKeyFor } from "../../public/shopper/billing.js";

describe("paywall view", () => {
  it("keeps purchases in the native shell and shows the web note everywhere else", () => {
    assert.equal(platformOf({ getPlatform: () => "ios" }), "ios");
    assert.equal(platformOf({ getPlatform: () => "web" }), "web");
    const status = {
      enforced: true,
      pro: false,
      keys: { ios: "appl_test", android: "" },
      manage: { ios: "https://apps.apple.com/account/subscriptions", android: "https://play.google.com/store/account/subscriptions?package=app.grocerygitter" },
      stripe: { enabled: false, note: "Web checkout is not offered. Subscriptions are available in the iOS and Android apps." },
      terms: "/terms",
      privacy: "/privacy",
    };
    const web = paywallView({ status, platform: "web", signedIn: true });
    assert.equal(web.canPurchase, false);
    assert.equal(web.showWebNote, true);
    assert.match(web.webNote, /available in the iOS and Android apps/);
    const ios = paywallView({ status, platform: "ios", signedIn: false });
    assert.equal(ios.needsSignIn, true);
    assert.equal(ios.canPurchase, false);
    assert.equal(paywallView({ status, platform: "ios", signedIn: true }).canPurchase, true);
    assert.equal(sdkKeyFor(status, "android"), "");
    assert.equal(paywallView({ status, platform: "android", signedIn: true }).unconfigured, true);
    assert.equal(manageUrl(status, "ios"), status.manage.ios);
  });

  it("reads RevenueCat packages", () => {
    const choices = packageChoices({
      current: { availablePackages: [{ identifier: "monthly", product: { title: "Pro", priceString: "$4.99" } }] },
    });
    assert.equal(choices[0].id, "monthly");
    assert.equal(choices[0].price, "$4.99");
    assert.deepEqual(packageChoices(null), []);
  });

  it("puts restore, terms, privacy, and manage on the paywall", () => {
    const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
    const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
    assert.match(html, /id="open-paywall"/);
    assert.match(html, /id="paywall-dialog"/);
    assert.match(html, /id="paywall-restore"/);
    assert.match(html, /id="paywall-manage"/);
    assert.match(html, /id="paywall-terms"/);
    assert.match(html, /id="paywall-privacy"/);
    assert.match(app, /\/api\/billing\/status/);
    assert.match(app, /Purchases/);
    assert.match(app, /restorePurchases/);
    assert.match(app, /available in the app|showWebNote|webNote/);
  });
});
