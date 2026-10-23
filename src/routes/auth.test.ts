import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app";
import { PriceAlert, PriceWatch, PushSubscription } from "../alerts/models";
import { setAuthMailer, type AuthMail } from "../auth/email";
import { Account, AuthIdentity, AuthSession, SavedList } from "../auth/models";
import { KROGER_SHOPPER_COOKIE, sealShopperToken } from "../krogerCartAuth";
import { SharedList } from "../models/SharedList";

const DEVICE = "device-auth-01";
const OTHER = "device-auth-02";

describe("accounts and sync", { concurrency: false }, () => {
  let memory: MongoMemoryServer;
  let server: http.Server;
  let origin: string;
  const sent: AuthMail[] = [];
  const previous = {
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_ALLOW_TEST_TOKENS: process.env.AUTH_ALLOW_TEST_TOKENS,
    APPLE_CLIENT_ID: process.env.APPLE_CLIENT_ID,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    AUTH_EMAIL_FROM: process.env.AUTH_EMAIL_FROM,
    KROGER_CLIENT_ID: process.env.KROGER_CLIENT_ID,
    KROGER_CLIENT_SECRET: process.env.KROGER_CLIENT_SECRET,
    KROGER_REDIRECT_URI: process.env.KROGER_REDIRECT_URI,
  };

  before(async () => {
    process.env.AUTH_SECRET = "test-secret-test-secret-test-secret";
    process.env.AUTH_ALLOW_TEST_TOKENS = "1";
    process.env.APPLE_CLIENT_ID = "app.grocerygitter.service";
    process.env.GOOGLE_CLIENT_ID = "google-web.apps.googleusercontent.com";
    delete process.env.GOOGLE_CLIENT_SECRET;
    process.env.RESEND_API_KEY = "re_test";
    process.env.AUTH_EMAIL_FROM = "Grocery Gitter <sign-in@grocerygitter.app>";
    setAuthMailer(async (message) => {
      sent.push(message);
    });
    memory = await MongoMemoryServer.create();
    await mongoose.connect(memory.getUri());
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    setAuthMailer(null);
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await mongoose.disconnect();
    await memory.stop();
  });

  async function reset(): Promise<void> {
    sent.length = 0;
    await Promise.all([
      Account.deleteMany({}),
      AuthIdentity.deleteMany({}),
      AuthSession.deleteMany({}),
      SavedList.deleteMany({}),
      PriceWatch.deleteMany({}),
      PriceAlert.deleteMany({}),
      PushSubscription.deleteMany({}),
      SharedList.deleteMany({}),
    ]);
  }

  async function createList(): Promise<{ shareToken: string; ownerToken: string }> {
    const response = await fetch(`${origin}/api/lists`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Saturday",
        deviceId: DEVICE,
        items: [{ itemId: "upc:111", name: "Whole Milk", quantity: 1, checked: false, writtenAt: 1_000 }],
      }),
    });
    assert.equal(response.status, 201);
    return (await response.json()) as { shareToken: string; ownerToken: string };
  }

  function listBody(id: string, name: string, writtenAt: number) {
    return {
      listId: "list-auth-01",
      listName: "My list",
      zip: "45202",
      alertsEnabled: true,
      items: [{ id, name, quantity: 1, writtenAt }],
    };
  }

  it("rejects sign-in when the provider is not configured and keeps guests working", async () => {
    await reset();
    delete process.env.APPLE_CLIENT_ID;
    const off = await fetch(`${origin}/api/auth/status`);
    const status = (await off.json()) as { enabled: boolean; providers: { apple: { enabled: boolean }; email: { enabled: boolean } } };
    assert.equal(status.providers.apple.enabled, false);
    assert.equal(status.providers.email.enabled, true);
    const denied = await fetch(`${origin}/api/auth/apple`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityToken: "test:apple:ada:ada@example.com" }),
    });
    assert.equal(denied.status, 503);
    const guest = await fetch(`${origin}/api/lists`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Guest", items: [] }),
    });
    assert.equal(guest.status, 201);
    const me = await fetch(`${origin}/api/auth/me`);
    assert.equal(((await me.json()) as { account: null }).account, null);
    process.env.APPLE_CLIENT_ID = "app.grocerygitter.service";
  });

  it("signs in with Apple, merges this device, and links Google by the same email", async () => {
    await reset();
    process.env.KROGER_CLIENT_ID = "client-id";
    process.env.KROGER_CLIENT_SECRET = "client-secret";
    process.env.KROGER_REDIRECT_URI = "https://example.com/api/kroger/oauth/callback";
    const list = await createList();
    const tagged = await SharedList.findOne({ ownerDeviceId: DEVICE }).lean();
    assert.equal(typeof tagged?.ownerDeviceId, "string");
    await PriceWatch.create({
      deviceId: DEVICE,
      listId: "list-auth-01",
      listName: "My list",
      zip: "45202",
      enabled: true,
      items: [
        {
          productId: "upc:111",
          productKey: "111",
          name: "Whole Milk",
          brand: "",
          watch: "inherit",
          baselinePrice: 4,
          baselineStore: "Kroger",
        },
      ],
    });
    await PriceAlert.create({
      deviceId: DEVICE,
      listId: "list-auth-01",
      listName: "My list",
      productId: "upc:111",
      productKey: "111",
      itemName: "Whole Milk",
      storeName: "Kroger",
      oldPrice: 4,
      newPrice: 3,
      savings: 1,
      baselinePrice: 4,
      reason: "saved",
      dropKey: "auth-drop-1",
    });
    const sealed = sealShopperToken("client-secret", {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAtMs: Date.now() + 60_000,
    });

    const response = await fetch(`${origin}/api/auth/apple`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${KROGER_SHOPPER_COOKIE}=${encodeURIComponent(sealed)}` },
      body: JSON.stringify({
        identityToken: "test:apple:apple-sub-1:ada@example.com",
        displayName: "Ada",
        deviceId: DEVICE,
        lists: [{ shareToken: list.shareToken, ownerToken: list.ownerToken }],
        list: listBody("upc:111", "Whole Milk", 2_000),
      }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      token: string;
      account: { id: string; email: string; providers: string[]; krogerLinked: boolean };
      merged: { sharedLists: number; savedList: boolean; krogerLinked: boolean; priceWatches: number };
    };
    assert.equal(body.account.email, "ada@example.com");
    assert.equal(body.account.krogerLinked, true);
    assert.equal(body.merged.savedList, true);
    assert.equal(body.merged.sharedLists, 1);
    assert.match(response.headers.get("set-cookie") ?? "", /gg_session=/);
    const watch = await PriceWatch.findOne({ deviceId: DEVICE }).lean();
    assert.equal(watch?.accountId, body.account.id);
    const shared = await SharedList.findOne({ accountId: body.account.id }).lean();
    assert.ok(shared);

    const google = await fetch(`${origin}/api/auth/google`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: "test:google:google-sub-1:ada@example.com" }),
    });
    assert.equal(google.status, 200);
    const googleBody = (await google.json()) as { account: { id: string; providers: string[] } };
    assert.equal(googleBody.account.id, body.account.id);
    assert.equal(googleBody.account.providers.length, 2);
    assert.equal(await Account.countDocuments({}), 1);

    const other = await fetch(`${origin}/api/me/list`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${body.token}` },
      body: JSON.stringify({
        ...listBody("upc:222", "Bread", 3_000),
        baseRevision: 1,
        items: [
          { id: "upc:111", name: "Whole Milk", quantity: 2, writtenAt: 2_500 },
          { id: "upc:222", name: "Bread", quantity: 1, writtenAt: 3_000 },
        ],
      }),
    });
    assert.equal(other.status, 200);
    const saved = (await other.json()) as { list: { revision: number; items: Array<{ id: string }> } };
    assert.equal(saved.list.revision, 2);
    assert.deepEqual(saved.list.items.map((item) => item.id).sort(), ["upc:111", "upc:222"]);

    const alerts = await fetch(`${origin}/api/price-alerts?deviceId=${OTHER}`, {
      headers: { authorization: `Bearer ${body.token}` },
    });
    const alertBody = (await alerts.json()) as { alerts: Array<{ itemName: string }> };
    assert.equal(alertBody.alerts.length, 1);
    assert.equal(alertBody.alerts[0]?.itemName, "Whole Milk");

    const removed = await fetch(`${origin}/api/me/data`, {
      method: "DELETE",
      headers: { "content-type": "application/json", authorization: `Bearer ${body.token}` },
      body: JSON.stringify({
        deviceId: DEVICE,
        lists: [{ shareToken: list.shareToken, ownerToken: list.ownerToken }],
      }),
    });
    assert.equal(removed.status, 200);
    const removedBody = (await removed.json()) as { account: { deleted: boolean } };
    assert.equal(removedBody.account.deleted, true);
    assert.equal(await Account.countDocuments({}), 0);
    assert.equal(await AuthSession.countDocuments({}), 0);
    assert.equal(await SharedList.countDocuments({}), 0);
    assert.equal(await PriceWatch.countDocuments({ deviceId: DEVICE }), 0);
    const gone = await fetch(`${origin}/api/auth/me`, { headers: { authorization: `Bearer ${body.token}` } });
    assert.equal(((await gone.json()) as { account: null }).account, null);
  });

  it("emails a one-time link and refuses a second use", async () => {
    await reset();
    const start = await fetch(`${origin}/api/auth/email/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "Sam@Example.com", return: "/?from=email" }),
    });
    assert.equal(start.status, 200);
    assert.equal(sent.length, 1);
    const link = sent[0]?.text.match(/https?:\/\/\S+/)?.[0];
    assert.ok(link);
    const token = new URL(link as string).searchParams.get("token");
    const first = await fetch(`${origin}/api/auth/email/callback?token=${encodeURIComponent(token ?? "")}`, { redirect: "manual" });
    assert.equal(first.status, 302);
    assert.match(first.headers.get("location") ?? "", /session=/);
    assert.match(first.headers.get("set-cookie") ?? "", /gg_session=/);
    const second = await fetch(`${origin}/api/auth/email/callback?token=${encodeURIComponent(token ?? "")}`);
    assert.equal(second.status, 400);
    delete process.env.RESEND_API_KEY;
    const off = await fetch(`${origin}/api/auth/email/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "sam@example.com" }),
    });
    assert.equal(off.status, 503);
    process.env.RESEND_API_KEY = "re_test";
  });

  it("starts the Apple redirect only when Apple is configured", async () => {
    const started = await fetch(`${origin}/api/auth/apple/start?return=https://evil.example/phish`, { redirect: "manual" });
    assert.equal(started.status, 302);
    const location = started.headers.get("location") ?? "";
    assert.match(location, /^https:\/\/appleid\.apple\.com\/auth\/authorize\?/);
    assert.match(location, /client_id=app\.grocerygitter\.service/);
    delete process.env.APPLE_CLIENT_ID;
    const off = await fetch(`${origin}/api/auth/apple/start`);
    assert.equal(off.status, 503);
    const google = await fetch(`${origin}/api/auth/google/start`);
    assert.equal(google.status, 503);
    process.env.APPLE_CLIENT_ID = "app.grocerygitter.service";
  });
});
