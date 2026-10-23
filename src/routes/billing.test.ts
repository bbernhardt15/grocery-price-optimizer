import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app";
import { Account } from "../auth/models";
import { setRevenueCatFetcher } from "../billing/revenuecat";
import { SharedList } from "../models/SharedList";

const DEVICE = "device-bill-01";
const SECRET = "webhook-secret";

describe("subscriptions", { concurrency: false }, () => {
  let memory: MongoMemoryServer;
  let server: http.Server;
  let origin: string;
  const previous = {
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_ALLOW_TEST_TOKENS: process.env.AUTH_ALLOW_TEST_TOKENS,
    APPLE_CLIENT_ID: process.env.APPLE_CLIENT_ID,
    REVENUECAT_WEBHOOK_SECRET: process.env.REVENUECAT_WEBHOOK_SECRET,
    REVENUECAT_SECRET_API_KEY: process.env.REVENUECAT_SECRET_API_KEY,
    REVENUECAT_IOS_API_KEY: process.env.REVENUECAT_IOS_API_KEY,
    REVENUECAT_ENTITLEMENT_ID: process.env.REVENUECAT_ENTITLEMENT_ID,
    KROGER_CLIENT_ID: process.env.KROGER_CLIENT_ID,
    KROGER_CLIENT_SECRET: process.env.KROGER_CLIENT_SECRET,
    KROGER_REDIRECT_URI: process.env.KROGER_REDIRECT_URI,
  };

  before(async () => {
    process.env.AUTH_SECRET = "test-secret-test-secret-test-secret";
    process.env.AUTH_ALLOW_TEST_TOKENS = "1";
    process.env.APPLE_CLIENT_ID = "app.grocerygitter.service";
    process.env.REVENUECAT_WEBHOOK_SECRET = SECRET;
    process.env.REVENUECAT_IOS_API_KEY = "appl_public";
    delete process.env.REVENUECAT_SECRET_API_KEY;
    delete process.env.REVENUECAT_ENTITLEMENT_ID;
    delete process.env.KROGER_CLIENT_ID;
    delete process.env.KROGER_CLIENT_SECRET;
    delete process.env.KROGER_REDIRECT_URI;
    memory = await MongoMemoryServer.create();
    await mongoose.connect(memory.getUri());
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    setRevenueCatFetcher(null);
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
    process.env.REVENUECAT_WEBHOOK_SECRET = SECRET;
    delete process.env.REVENUECAT_SECRET_API_KEY;
    setRevenueCatFetcher(null);
    await Promise.all([Account.deleteMany({}), SharedList.deleteMany({})]);
  }

  async function signIn(): Promise<{ token: string; id: string }> {
    const response = await fetch(`${origin}/api/auth/apple`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityToken: "test:apple:ada:ada@example.com", deviceId: DEVICE }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { token: string; account: { id: string } };
    return { token: body.token, id: body.account.id };
  }

  function webhook(event: Record<string, unknown>, authorization = `Bearer ${SECRET}`) {
    return fetch(`${origin}/api/billing/revenuecat`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization },
      body: JSON.stringify({ event }),
    });
  }

  it("fails open and publishes the planned limits while RevenueCat is unset", async () => {
    delete process.env.REVENUECAT_WEBHOOK_SECRET;
    const response = await fetch(`${origin}/api/billing/status`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      enforced: boolean;
      limits: { multiStore: boolean; priceAlerts: boolean };
      plans: { free: { sharedLists: number; multiStore: boolean }; pro: { sharedLists: number } };
      stripe: { enabled: boolean; note: string };
      keys: { ios: string };
    };
    assert.equal(body.enforced, false);
    assert.equal(body.limits.multiStore, true);
    assert.equal(body.limits.priceAlerts, true);
    assert.equal(body.plans.free.sharedLists, 1);
    assert.equal(body.plans.free.multiStore, false);
    assert.equal(body.plans.pro.sharedLists, 0);
    assert.equal(body.stripe.enabled, false);
    assert.match(body.stripe.note, /iOS and Android apps/);
    assert.equal(body.keys.ios, "appl_public");
    process.env.REVENUECAT_WEBHOOK_SECRET = SECRET;
  });

  it("stores pro from the webhook and removes it on expiration", async () => {
    await reset();
    const missing = await webhook({
      type: "INITIAL_PURCHASE",
      app_user_id: "507f1f77bcf86cd799439011",
      entitlement_ids: ["pro"],
    });
    assert.equal(missing.status, 200);
    assert.equal(((await missing.json()) as { stored: boolean }).stored, false);

    const account = await signIn();
    const ignored = await webhook({
      type: "INITIAL_PURCHASE",
      app_user_id: account.id,
      entitlement_ids: ["plus"],
    });
    assert.equal(((await ignored.json()) as { stored: boolean }).stored, false);

    const granted = await webhook(
      {
        type: "INITIAL_PURCHASE",
        app_user_id: account.id,
        entitlement_ids: ["pro"],
        expiration_at_ms: Date.now() + 86_400_000,
      },
      SECRET
    );
    assert.equal(granted.status, 200);
    assert.equal(((await granted.json()) as { stored: boolean }).stored, true);

    const status = await fetch(`${origin}/api/billing/status`, {
      headers: { authorization: `Bearer ${account.token}` },
    });
    const statusBody = (await status.json()) as { pro: boolean; plan: string; enforced: boolean; limits: { multiStore: boolean } };
    assert.equal(statusBody.enforced, true);
    assert.equal(statusBody.pro, true);
    assert.equal(statusBody.plan, "pro");
    assert.equal(statusBody.limits.multiStore, true);

    const cancelled = await webhook({
      type: "CANCELLATION",
      app_user_id: account.id,
      expiration_at_ms: Date.now() + 86_400_000,
    });
    assert.equal(((await cancelled.json()) as { stored: boolean }).stored, true);
    const still = await Account.findById(account.id).lean();
    assert.equal(still?.entitlement, "pro");

    const expired = await webhook({ type: "EXPIRATION", app_user_id: account.id, expiration_at_ms: Date.now() - 1000 });
    assert.equal(((await expired.json()) as { stored: boolean }).stored, true);
    const guest = await fetch(`${origin}/api/billing/status`, { headers: { authorization: `Bearer ${account.token}` } });
    assert.equal(((await guest.json()) as { pro: boolean }).pro, false);

    const unauthorized = await webhook({ type: "RENEWAL", app_user_id: account.id }, "Bearer wrong");
    assert.equal(unauthorized.status, 401);
    delete process.env.REVENUECAT_WEBHOOK_SECRET;
    const off = await webhook({ type: "RENEWAL", app_user_id: account.id });
    assert.equal(off.status, 503);
    process.env.REVENUECAT_WEBHOOK_SECRET = SECRET;
  });

  it("refreshes from RevenueCat when the secret API key is set", async () => {
    await reset();
    const account = await signIn();
    const idle = await fetch(`${origin}/api/billing/refresh`, {
      method: "POST",
      headers: { authorization: `Bearer ${account.token}` },
    });
    assert.equal(idle.status, 200);
    assert.equal(((await idle.json()) as { refreshed: boolean }).refreshed, false);

    process.env.REVENUECAT_SECRET_API_KEY = "sk_test";
    setRevenueCatFetcher(async () => ({
      ok: true,
      status: 200,
      present: true,
      expiresDate: new Date(Date.now() + 86_400_000).toISOString(),
    }));
    const refreshed = await fetch(`${origin}/api/billing/refresh`, {
      method: "POST",
      headers: { authorization: `Bearer ${account.token}` },
    });
    const body = (await refreshed.json()) as { refreshed: boolean; pro: boolean };
    assert.equal(body.refreshed, true);
    assert.equal(body.pro, true);
    const anon = await fetch(`${origin}/api/billing/refresh`, { method: "POST" });
    assert.equal(anon.status, 401);
  });

  it("blocks a second shared list, price alerts, and cart handoffs on the free plan", async () => {
    await reset();
    const first = await fetch(`${origin}/api/lists`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Saturday", deviceId: DEVICE }),
    });
    assert.equal(first.status, 201);
    const created = (await first.json()) as { ownerToken: string; shareToken: string };
    const second = await fetch(`${origin}/api/lists`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Sunday", deviceId: DEVICE }),
    });
    assert.equal(second.status, 402);
    const resumed = await fetch(`${origin}/api/lists`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: DEVICE, ownerToken: created.ownerToken, shareToken: created.shareToken }),
    });
    assert.equal(resumed.status, 200);
    const anonymous = await fetch(`${origin}/api/lists`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "No device" }),
    });
    assert.equal(anonymous.status, 402);

    const enable = await fetch(`${origin}/api/price-alerts/watches`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: DEVICE, listId: "list-bill-01", enabled: true, items: [] }),
    });
    assert.equal(enable.status, 402);
    const disable = await fetch(`${origin}/api/price-alerts/watches`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: DEVICE, listId: "list-bill-01", enabled: false, items: [] }),
    });
    assert.equal(disable.status, 200);

    const badCart = await fetch(`${origin}/api/kroger/cart/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(badCart.status, 400);
    const cart = await fetch(`${origin}/api/kroger/cart/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [{ name: "Milk" }] }),
    });
    assert.equal(cart.status, 402);
    const badInstacart = await fetch(`${origin}/api/instacart/shopping-list`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(badInstacart.status, 400);
    const instacart = await fetch(`${origin}/api/instacart/shopping-list`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [{ name: "Milk" }] }),
    });
    assert.equal(instacart.status, 402);

    delete process.env.REVENUECAT_WEBHOOK_SECRET;
    const openCart = await fetch(`${origin}/api/kroger/cart/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [{ name: "Milk", upc: "111111111111" }] }),
    });
    assert.equal(openCart.status, 501);
    process.env.REVENUECAT_WEBHOOK_SECRET = SECRET;

    const account = await signIn();
    await webhook({
      type: "INITIAL_PURCHASE",
      app_user_id: account.id,
      expiration_at_ms: Date.now() + 86_400_000,
    });
    const proAlerts = await fetch(`${origin}/api/price-alerts/watches`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${account.token}` },
      body: JSON.stringify({ deviceId: DEVICE, listId: "list-bill-01", enabled: true, items: [] }),
    });
    assert.equal(proAlerts.status, 200);
    const extra = await fetch(`${origin}/api/lists`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${account.token}` },
      body: JSON.stringify({ title: "Pro list", deviceId: DEVICE }),
    });
    assert.equal(extra.status, 201);
  });
});
