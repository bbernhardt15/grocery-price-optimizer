import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { SHELL_CACHE, feedbackBody, feedbackContext, rememberInvite, readInvite } from "../../public/shopper/betaContext.js";
import {
  dialogAllowedDuringGate,
  errorToastModel,
  fetchInitWithDevice,
  installClientErrors,
  inviteScreenHtml,
  feedbackScreenshotNote,
  feedbackSheetHtml,
  isShopperApi,
  reportClientFailure,
  resolveInviteGate,
} from "../../public/shopper/beta.js";
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
    const sheet = feedbackSheetHtml();
    assert.match(sheet, /id="beta-feedback-shots"/);
    assert.match(sheet, /type="file"/);
    assert.match(sheet, /accept="image\/\*"/);
    assert.match(sheet, /class="beta-rating"/);
    assert.equal(
      feedbackScreenshotNote([
        { name: "cart.png", type: "image/png", size: 12 },
        { name: "list.png", type: "image/png", size: 12 },
      ]),
      "2 screenshots will be sent with this note: cart.png, list.png."
    );
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
    assert.match(inviteScreenHtml(), /<dialog id="beta-gate"/);
    const boot = app.slice(app.indexOf("async function boot"), app.indexOf("async function bootApp"));
    assert.ok(boot.includes("__ggInviteGate"));
    assert.ok(boot.indexOf("__ggInviteGate") < boot.indexOf("profileUi?.open"));
    assert.match(beta, /window\.__ggInviteGate/);
    assert.match(app, /events\?deviceId=/);
    const page = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
    assert.match(page, /beta-gate-hold/);
    assert.match(page, /gg-beta-code/);
    assert.match(beta, /cache: "no-store"/);
    assert.match(beta, /resolveInviteGate/);
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

  it("rechecks a stored invite code before onboarding, including a cached shell", async () => {
    const cleared: string[] = [];
    const removed = await resolveInviteGate({
      remembered: "old-code",
      clearCode: () => cleared.push("old-code"),
      postInvite: async () => ({ response: { ok: false, status: 401 }, body: { error: "That invite code is not recognized." } }),
      fetchGate: async () => ({ response: { ok: true, status: 200 }, body: { required: true } }),
    });
    assert.equal(removed.show, true);
    assert.equal(removed.reason, "invalid");
    assert.deepEqual(cleared, ["old-code"]);

    const limited = await resolveInviteGate({
      remembered: "mom-uqq6",
      clearCode: () => cleared.push("should-not"),
      postInvite: async () => ({ response: { ok: false, status: 429 }, body: {} }),
      fetchGate: async () => {
        throw new Error("unused");
      },
    });
    assert.equal(limited.show, true);
    assert.equal(limited.reason, "limited");
    assert.deepEqual(cleared, ["old-code"]);

    const offlineCode = await resolveInviteGate({
      remembered: "mom-uqq6",
      postInvite: async () => {
        throw new Error("offline");
      },
      fetchGate: async () => {
        throw new Error("unused");
      },
    });
    assert.equal(offlineCode.show, false);
    assert.equal(offlineCode.reason, "offline");

    const fresh = await resolveInviteGate({
      remembered: "",
      fetchGate: async () => ({ response: { ok: true, status: 200 }, body: { required: true } }),
      postInvite: async () => {
        throw new Error("unused");
      },
    });
    assert.equal(fresh.show, true);

    const cachedShell = await resolveInviteGate({
      remembered: "",
      fetchGate: async () => {
        throw new Error("cached shell cannot reach the gate");
      },
      postInvite: async () => {
        throw new Error("unused");
      },
    });
    assert.equal(cachedShell.show, true);
    assert.equal(cachedShell.reason, "offline");

    const open = await resolveInviteGate({
      remembered: "stale",
      clearCode: () => cleared.push("stale"),
      postInvite: async () => ({ response: { ok: true, status: 200 }, body: { ok: true, required: false } }),
      fetchGate: async () => {
        throw new Error("unused");
      },
    });
    assert.equal(open.show, false);
    assert.deepEqual(cleared, ["old-code", "stale"]);

    assert.equal(dialogAllowedDuringGate("profile-onboard", true), false);
    assert.equal(dialogAllowedDuringGate("beta-gate", true), true);
    assert.equal(dialogAllowedDuringGate("profile-onboard", false), true);

    const rootWindow = { location: { href: "https://shop.example/", origin: "https://shop.example" } };
    assert.equal(isShopperApi("/api/shopper/config", rootWindow), true);
    assert.equal(isShopperApi("https://shop.example/api/beta/gate", rootWindow), true);
    assert.equal(isShopperApi("https://example.com/api/shopper/config", rootWindow), false);
    assert.equal(isShopperApi("/privacy", rootWindow), false);
    const headers = fetchInitWithDevice("/api/shopper/config", { headers: { accept: "application/json" } }, "device-beta-01");
    assert.equal(headers.headers.get("x-device-id"), "device-beta-01");
    assert.equal(headers.headers.get("accept"), "application/json");
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
