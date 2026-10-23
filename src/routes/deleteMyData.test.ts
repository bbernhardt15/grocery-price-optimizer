import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app";
import { PriceAlert, PriceWatch, PushSubscription } from "../alerts/models";
import { CatalogDemand, ShopperZip } from "../ingest/models";
import { KROGER_SHOPPER_COOKIE, sealShopperToken } from "../krogerCartAuth";
import { SharedList } from "../models/SharedList";

const OWNER_DEVICE = "owner-device-01";
const OTHER_DEVICE = "other-device-01";

type CreatedList = {
  shareToken: string;
  ownerToken: string;
};

type DeletionBody = {
  deleted: {
    priceWatches: number;
    priceAlerts: number;
    pushSubscriptions: number;
    sharedLists: number;
    sharedListsRefused: number;
  };
  kroger: { hadToken: boolean; revoked: boolean; cookieCleared: boolean };
  notLinkedToYou: { shopperZips: string; catalogDemand: string };
};

describe("delete my data", { concurrency: false }, () => {
  let memory: MongoMemoryServer;
  let server: http.Server;
  let origin: string;
  const originalFetch = globalThis.fetch;
  const previous = {
    KROGER_CLIENT_ID: process.env.KROGER_CLIENT_ID,
    KROGER_CLIENT_SECRET: process.env.KROGER_CLIENT_SECRET,
    KROGER_REDIRECT_URI: process.env.KROGER_REDIRECT_URI,
  };

  before(async () => {
    memory = await MongoMemoryServer.create();
    await mongoose.connect(memory.getUri());
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    restore("KROGER_CLIENT_ID", previous.KROGER_CLIENT_ID);
    restore("KROGER_CLIENT_SECRET", previous.KROGER_CLIENT_SECRET);
    restore("KROGER_REDIRECT_URI", previous.KROGER_REDIRECT_URI);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await mongoose.disconnect();
    await memory.stop();
  });

  function restore(name: string, value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  async function reset(): Promise<void> {
    globalThis.fetch = originalFetch;
    delete process.env.KROGER_CLIENT_ID;
    delete process.env.KROGER_CLIENT_SECRET;
    delete process.env.KROGER_REDIRECT_URI;
    await Promise.all([
      PriceAlert.deleteMany({}),
      PriceWatch.deleteMany({}),
      PushSubscription.deleteMany({}),
      SharedList.deleteMany({}),
      ShopperZip.deleteMany({}),
      CatalogDemand.deleteMany({}),
    ]);
  }

  async function createList(): Promise<CreatedList> {
    const response = await originalFetch(`${origin}/api/lists`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Saturday",
        items: [
          {
            itemId: "upc:111",
            catalogId: "upc:111",
            name: "Whole Milk",
            brand: "Dairy Pure",
            quantity: 1,
            checked: false,
            writtenAt: 1_000,
          },
        ],
      }),
    });
    assert.equal(response.status, 201);
    const body = (await response.json()) as CreatedList;
    assert.equal(body.shareToken.length >= 43, true);
    return body;
  }

  async function watch(deviceId: string, listId: string): Promise<void> {
    await PriceWatch.create({
      deviceId,
      listId,
      listName: "My list",
      zip: "45202",
      enabled: true,
      items: [
        {
          productId: "upc:111",
          productKey: "111",
          name: "Whole Milk",
          brand: "Dairy Pure",
          watch: "inherit",
          baselinePrice: 4,
          baselineStore: "Kroger",
        },
      ],
    });
  }

  async function alert(deviceId: string, listId: string, dropKey: string): Promise<void> {
    await PriceAlert.create({
      deviceId,
      listId,
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
      dropKey,
    });
  }

  async function deleteData(
    body: unknown,
    cookie?: string
  ): Promise<{ status: number; json: DeletionBody; setCookie: string }> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (cookie) headers.cookie = cookie;
    const response = await originalFetch(`${origin}/api/me/data`, {
      method: "DELETE",
      headers,
      body: JSON.stringify(body),
    });
    const json = (await response.json()) as DeletionBody;
    return { status: response.status, json, setCookie: response.headers.get("set-cookie") ?? "" };
  }

  it("deletes the caller's rows, invalidates an owned share link, and leaves aggregate counts", async () => {
    await reset();
    const list = await createList();
    await watch(OWNER_DEVICE, "personal-list-1");
    await watch(OTHER_DEVICE, list.shareToken);
    await watch(OTHER_DEVICE, "someone-else");
    await alert(OWNER_DEVICE, "personal-list-1", "drop-owner");
    await alert(OTHER_DEVICE, list.shareToken, "drop-shared");
    await alert(OTHER_DEVICE, "someone-else", "drop-other");
    await PushSubscription.create({
      deviceId: OWNER_DEVICE,
      channel: "web",
      endpoint: "https://push.example/owner",
      p256dh: "key",
      auth: "auth",
      platform: "web",
    });
    await PushSubscription.create({
      deviceId: OTHER_DEVICE,
      channel: "web",
      endpoint: "https://push.example/other",
      p256dh: "key",
      auth: "auth",
      platform: "web",
    });
    await ShopperZip.create({ zip: "45202", hits: 4, lastSeenAt: new Date() });
    await CatalogDemand.create({ kind: "search", text: "oat milk", hits: 3, lastSeenAt: new Date() });
    await CatalogDemand.create({ kind: "list", text: "whole milk", hits: 2, lastSeenAt: new Date() });

    const first = await deleteData({
      deviceId: OWNER_DEVICE,
      lists: [{ shareToken: list.shareToken, ownerToken: list.ownerToken }],
    });
    assert.equal(first.status, 200);
    assert.equal(first.json.deleted.sharedLists, 1);
    assert.equal(first.json.deleted.sharedListsRefused, 0);
    assert.equal(first.json.deleted.priceWatches, 2);
    assert.equal(first.json.deleted.priceAlerts, 2);
    assert.equal(first.json.deleted.pushSubscriptions, 1);
    assert.equal(first.json.kroger.hadToken, false);
    assert.equal(first.json.kroger.revoked, false);
    assert.equal(first.json.kroger.cookieCleared, true);
    assert.match(first.json.notLinkedToYou.shopperZips, /no device id/);
    assert.match(first.json.notLinkedToYou.catalogDemand, /no device id/);
    assert.match(first.setCookie, /kroger_shopper=;/);
    assert.match(first.setCookie, /Max-Age=0/);

    assert.equal(await SharedList.countDocuments({}), 0);
    const gone = await originalFetch(`${origin}/api/lists/${list.shareToken}`);
    assert.equal(gone.status, 404);
    assert.equal(await PriceWatch.countDocuments({ deviceId: OWNER_DEVICE }), 0);
    assert.equal(await PriceWatch.countDocuments({ listId: list.shareToken }), 0);
    assert.equal(await PriceWatch.countDocuments({ deviceId: OTHER_DEVICE, listId: "someone-else" }), 1);
    assert.equal(await PriceAlert.countDocuments({ dropKey: "drop-other" }), 1);
    assert.equal(await PriceAlert.countDocuments({ dropKey: "drop-owner" }), 0);
    assert.equal(await PriceAlert.countDocuments({ dropKey: "drop-shared" }), 0);
    assert.equal(await PushSubscription.countDocuments({ deviceId: OWNER_DEVICE }), 0);
    assert.equal(await PushSubscription.countDocuments({ deviceId: OTHER_DEVICE }), 1);
    assert.equal(await ShopperZip.countDocuments({ zip: "45202" }), 1);
    assert.equal(await CatalogDemand.countDocuments({ text: "oat milk" }), 1);
    assert.equal(await CatalogDemand.countDocuments({ text: "whole milk" }), 1);

    const second = await deleteData({
      deviceId: OWNER_DEVICE,
      lists: [{ shareToken: list.shareToken, ownerToken: list.ownerToken }],
    });
    assert.equal(second.status, 200);
    assert.equal(second.json.deleted.sharedLists, 0);
    assert.equal(second.json.deleted.priceWatches, 0);
    assert.equal(second.json.deleted.priceAlerts, 0);
    assert.equal(second.json.deleted.pushSubscriptions, 0);
    assert.equal(second.json.deleted.sharedListsRefused, 0);
    assert.equal(await PriceWatch.countDocuments({ listId: "someone-else" }), 1);
    assert.equal(await ShopperZip.countDocuments({ zip: "45202" }), 1);
  });

  it("does not delete a shared list when the owner token does not match", async () => {
    await reset();
    const list = await createList();
    await watch(OWNER_DEVICE, "personal-list-1");
    await watch(OTHER_DEVICE, list.shareToken);
    const result = await deleteData({
      deviceId: OWNER_DEVICE,
      lists: [{ shareToken: list.shareToken, ownerToken: "b".repeat(43) }],
    });
    assert.equal(result.status, 200);
    assert.equal(result.json.deleted.sharedLists, 0);
    assert.equal(result.json.deleted.sharedListsRefused, 1);
    assert.equal(result.json.deleted.priceWatches, 1);
    const still = await originalFetch(`${origin}/api/lists/${list.shareToken}`);
    assert.equal(still.status, 200);
    assert.equal(await PriceWatch.countDocuments({ listId: list.shareToken }), 1);
    assert.equal(await PriceWatch.countDocuments({ deviceId: OWNER_DEVICE }), 0);
  });

  it("rejects a request that does not name a device and deletes nothing", async () => {
    await reset();
    const list = await createList();
    await watch(OWNER_DEVICE, "personal-list-1");
    const missing = await deleteData({});
    assert.equal(missing.status, 400);
    assert.equal(missing.setCookie.includes("Max-Age=0"), false);
    const malformed = await deleteData({
      deviceId: OWNER_DEVICE,
      lists: [{ shareToken: "short", ownerToken: "also-short" }],
    });
    assert.equal(malformed.status, 400);
    assert.equal(await SharedList.countDocuments({}), 1);
    assert.equal(await PriceWatch.countDocuments({ deviceId: OWNER_DEVICE }), 1);
    const still = await originalFetch(`${origin}/api/lists/${list.shareToken}`);
    assert.equal(still.status, 200);
  });

  it("revokes and drops a Kroger shopper cookie, including a second call", async () => {
    await reset();
    process.env.KROGER_CLIENT_ID = "client-id";
    process.env.KROGER_CLIENT_SECRET = "client-secret";
    process.env.KROGER_REDIRECT_URI = "https://example.com/api/kroger/oauth/callback";
    const sealed = sealShopperToken("client-secret", {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAtMs: Date.now() + 60_000,
    });
    const revoked: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith(origin)) return originalFetch(input, init);
      assert.match(url, /\/connect\/oauth2\/revoke$/);
      const params = new URLSearchParams(String(init?.body));
      revoked.push(`${params.get("token_type_hint")}:${params.get("token")}`);
      return new Response(null, { status: 200 });
    };

    const first = await deleteData({ deviceId: OWNER_DEVICE }, `${KROGER_SHOPPER_COOKIE}=${encodeURIComponent(sealed)}`);
    assert.equal(first.status, 200);
    assert.equal(first.json.kroger.hadToken, true);
    assert.equal(first.json.kroger.revoked, true);
    assert.equal(first.json.kroger.cookieCleared, true);
    assert.match(first.setCookie, /Max-Age=0/);
    assert.deepEqual(revoked.sort(), ["access_token:access-1", "refresh_token:refresh-1"]);

    revoked.length = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith(origin)) return originalFetch(input, init);
      const params = new URLSearchParams(String(init?.body));
      revoked.push(params.get("token") ?? "");
      return Response.json({ error: "invalid_token" }, { status: 400 });
    };
    const second = await deleteData({ deviceId: OWNER_DEVICE }, `${KROGER_SHOPPER_COOKIE}=${encodeURIComponent(sealed)}`);
    assert.equal(second.status, 200);
    assert.equal(second.json.deleted.priceWatches, 0);
    assert.equal(second.json.kroger.hadToken, true);
    assert.equal(second.json.kroger.revoked, true);
    assert.equal(second.json.kroger.cookieCleared, true);
    assert.equal(revoked.length, 2);
  });

  it("still clears the cookie when Kroger refuses the revoke", async () => {
    await reset();
    process.env.KROGER_CLIENT_ID = "client-id";
    process.env.KROGER_CLIENT_SECRET = "client-secret";
    process.env.KROGER_REDIRECT_URI = "https://example.com/api/kroger/oauth/callback";
    const sealed = sealShopperToken("client-secret", {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAtMs: Date.now() + 60_000,
    });
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith(origin)) return originalFetch(input, init);
      return Response.json({ error: "server_error" }, { status: 500 });
    };
    const result = await deleteData({ deviceId: OWNER_DEVICE }, `${KROGER_SHOPPER_COOKIE}=${encodeURIComponent(sealed)}`);
    assert.equal(result.status, 200);
    assert.equal(result.json.kroger.hadToken, true);
    assert.equal(result.json.kroger.revoked, false);
    assert.equal(result.json.kroger.cookieCleared, true);
    assert.match(result.setCookie, /Max-Age=0/);
  });

  it("clears the system-browser Kroger cookie from GET /api/kroger/logout", async () => {
    await reset();
    process.env.KROGER_CLIENT_ID = "client-id";
    process.env.KROGER_CLIENT_SECRET = "client-secret";
    process.env.KROGER_REDIRECT_URI = "https://example.com/api/kroger/oauth/callback";
    const sealed = sealShopperToken("client-secret", {
      accessToken: "access-9",
      refreshToken: "refresh-9",
      expiresAtMs: Date.now() + 60_000,
    });
    const revoked: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith(origin)) return originalFetch(input, init);
      revoked.push(new URLSearchParams(String(init?.body)).get("token") ?? "");
      return new Response(null, { status: 200 });
    };
    const response = await originalFetch(`${origin}/api/kroger/logout`, {
      headers: { cookie: `${KROGER_SHOPPER_COOKIE}=${encodeURIComponent(sealed)}` },
    });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Kroger sign-in removed/);
    assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);
    assert.deepEqual(revoked.sort(), ["access-9", "refresh-9"]);

    globalThis.fetch = originalFetch;
    const again = await originalFetch(`${origin}/api/kroger/logout`);
    assert.equal(again.status, 200);
    assert.match(await again.text(), /Kroger sign-in removed/);
    assert.match(again.headers.get("set-cookie") ?? "", /Max-Age=0/);
  });
});
