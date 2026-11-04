import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { SHELL_CACHE, feedbackBody, feedbackContext, rememberInvite, readInvite } from "../../public/shopper/betaContext.js";
import { errorToastModel, installClientErrors, inviteScreenHtml, feedbackSheetHtml, reportClientFailure } from "../../public/shopper/beta.js";
import { reviewScreen } from "../../public/shopper/freshJourney.js";

const root = path.resolve(__dirname, "../..");

function memory() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.has(key) ? values.get(key)! : null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

describe("beta client", () => {
  it("bumps the shell cache and keeps the feedback context free of list contents", () => {
    const sw = fs.readFileSync(path.join(root, "public/sw.js"), "utf8");
    assert.match(sw, new RegExp(`grocery-gitter-shell-${SHELL_CACHE}`));
    const storage = memory();
    storage.setItem("gg-list", JSON.stringify([{ name: "Secret whole milk", brand: "Private" }]));
    storage.setItem(
      "gg-last-trip",
      JSON.stringify({ payload: { stores: [{ storeName: "Kroger", items: [{ name: "Secret whole milk" }] }] } })
    );
    const context = feedbackContext({
      storage,
      userAgent: "Beta",
      pathname: "/",
      tab: "plan",
      now: new Date("2026-11-04T01:02:03.000Z"),
    });
    const packed = JSON.stringify(context);
    assert.equal(packed.includes("Secret"), false);
    assert.equal(context.tripItemCount, 1);
    assert.equal(context.storeCount, 1);
    assert.equal(context.shellCache, SHELL_CACHE);
    assert.equal(context.tab, "plan");
    assert.equal(context.timestamp, "2026-11-04T01:02:03.000Z");
    const body = feedbackBody({ rating: 4, message: "Nice", screen: "Review", context, deviceId: "device-beta-01" });
    assert.equal(JSON.stringify(body).includes("Secret"), false);
  });

  it("shows a retry and send-feedback toast from window.onerror and unhandledrejection", () => {
    const toasts: Array<{ text: string; actions: string[] }> = [];
    const posts: Array<{ url: string; payload: { message?: string } }> = [];
    const state = { hits: [] as number[], seen: new Map<string, number>(), toastOpen: false };
    let captured = 0;
    const listeners = new Map<string, (event: { reason?: unknown }) => void>();
    const rootWindow = {
      onerror: null as
        | ((message: string, source: string, line: number, col: number, error: Error) => boolean)
        | null,
      addEventListener(type: string, fn: (event: { reason?: unknown }) => void) {
        listeners.set(type, fn);
      },
    };
    installClientErrors(rootWindow, {
      state,
      now: () => 50_000,
      showToast: (model: { text: string; actions: string[] }) => toasts.push(model),
      capture: () => {
        captured += 1;
      },
      fetch: (url: string, payload: { message?: string }) => {
        posts.push({ url, payload });
        return Promise.resolve({ ok: true });
      },
      url: "/api/beta/client-errors",
    });
    assert.equal(errorToastModel().text, "Something went wrong");
    rootWindow.onerror?.("fail", "app.js", 1, 1, new Error("fail"));
    assert.equal(toasts.length, 1);
    assert.equal(toasts[0].text, "Something went wrong");
    assert.deepEqual(toasts[0].actions, ["Retry", "Send feedback"]);
    assert.equal(posts[0].url, "/api/beta/client-errors");
    assert.match(posts[0].payload.message || "", /fail/);
    assert.equal(captured, 1);

    const quiet = reportClientFailure(new Error("fail"), {
      state,
      now: () => 55_000,
      showToast: () => toasts.push(errorToastModel()),
      fetch: () => posts.push({ url: "again", payload: {} }),
    });
    assert.equal(quiet.throttled, true);
    assert.equal(posts.length, 1);

    listeners.get("unhandledrejection")?.({ reason: new Error("rejected promise") });
    assert.equal(posts.length, 2);
    assert.match(posts[1].payload.message || "", /rejected promise/);
  });

  it("is a no-op for Sentry when no capture client is installed", () => {
    const state = { hits: [] as number[], seen: new Map<string, number>(), toastOpen: false };
    const outcome = reportClientFailure(new Error("offline"), {
      state,
      now: () => 10_000,
      showToast: () => undefined,
    });
    assert.equal(outcome.reported, true);
    assert.equal(outcome.toast, true);
  });

  it("offers Send feedback, the invite screen, and draft legal links", () => {
    const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
    const beta = fs.readFileSync(path.join(root, "public/shopper/beta.js"), "utf8");
    const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
    const privacy = fs.readFileSync(path.join(root, "public/privacy.html"), "utf8");
    const terms = fs.readFileSync(path.join(root, "public/terms.html"), "utf8");
    assert.match(html, /id="menu-feedback"[^>]*>Send feedback/);
    assert.match(html, /id="help-feedback"[^>]*>Send feedback/);
    assert.match(html, /id="onboard-legal"[\s\S]*href="\/privacy"[\s\S]*href="\/terms"/);
    assert.match(html, /id="delete-account-btn"[^>]*>Delete my account and data/);
    assert.match(beta, /window\.onerror|root\.onerror/);
    assert.match(beta, /unhandledrejection/);
    assert.match(beta, /delete-data-btn/);
    assert.match(app, /apiUrl\("\/api\/me\/data"\)/);
    assert.match(app, /betaEvent\("plan_built"\)/);
    assert.match(app, /betaEvent\("kroger_cart_sent"\)/);
    assert.match(app, /betaEvent\("walmart_opened"\)/);
    assert.match(app, /betaEvent\("trip_completed"\)/);
    assert.match(app, /betaEvent\("receipt_imported"\)/);
    const onboarding = fs.readFileSync(path.join(root, "public/shopper/onboardingUi.js"), "utf8");
    assert.match(onboarding, /onboarding_completed/);
    assert.match(inviteScreenHtml(), /Enter your invite code/);
    assert.match(feedbackSheetHtml(), /What screen were you on/);
    assert.match(feedbackSheetHtml(), /name="rating"/);
    for (const page of [privacy, terms]) {
      assert.match(page, /DRAFT/);
      assert.match(page, /attorney/i);
      assert.match(page, /ZIP code/);
      assert.match(page, /Receipts parsed down to item names/);
      assert.match(page, /Kroger sign-in \(OAuth\)/);
      assert.match(page, /do not store retailer passwords/i);
      assert.match(page, /do not sell your data/i);
      assert.match(page, /Delete my account and data/);
    }
    const storage = memory();
    rememberInvite(storage, " friend ");
    assert.equal(readInvite(storage), "friend");
  });

  it("renders a review screen only when the plan has priced lines", () => {
    const empty = reviewScreen({ stores: [] });
    assert.equal(empty.empty, true);
    assert.match(empty.html, /empty-state/);
    const filled = reviewScreen({
      stores: [{ storeName: "Kroger", items: [{ name: "Gallon of Milk", price: 2.89 }] }],
    });
    assert.equal(filled.empty, false);
    assert.equal(filled.html.includes("empty-state"), false);
    assert.match(filled.html, /Gallon of Milk/);
    assert.match(filled.html, /\$2\.89/);
  });
});
