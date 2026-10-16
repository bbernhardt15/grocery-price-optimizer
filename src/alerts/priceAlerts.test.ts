import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app";
import { detectPriceDrops } from "./detect";
import { PriceAlert, PriceWatch, PushSubscription } from "./models";
import { parseWatchBody } from "./watchInput";
import { clearNativePushTransports, registerNativePushTransport, setWebPushSender } from "./push";
import { CatalogOffer, IngestCheckpoint } from "../ingest/models";
import { runIngestTick } from "../ingest/runner";

const DEVICE = "device-test-01";
const LIST = "list-test-0001";

async function offer(fields: {
  productKey?: string;
  storeName: string;
  price: number;
  zip?: string;
  locationId?: string;
  availability?: "in_stock" | "out_of_stock" | "unknown";
  status?: "active" | "stale" | "discontinued";
}): Promise<void> {
  await CatalogOffer.create({
    productKey: fields.productKey ?? "12345",
    storeName: fields.storeName,
    locationId: fields.locationId ?? "",
    zip: fields.zip ?? "",
    price: fields.price,
    availability: fields.availability ?? "in_stock",
    priceSource: "live",
    lastSeenAt: new Date(),
    status: fields.status ?? "active",
    onSale: false,
  });
}

async function saveWatch(fields?: {
  deviceId?: string;
  enabled?: boolean;
  zip?: string;
  watch?: "inherit" | "on" | "off";
  baselinePrice?: number;
  targetPrice?: number;
  productKey?: string;
}): Promise<void> {
  const productKey = fields?.productKey ?? "12345";
  await PriceWatch.create({
    deviceId: fields?.deviceId ?? DEVICE,
    listId: LIST,
    listName: "My list",
    zip: fields?.zip ?? "45103",
    enabled: fields?.enabled ?? true,
    items: [
      {
        productId: `upc:${productKey}`,
        productKey,
        name: "Whole Milk",
        brand: "Dairy Pure",
        watch: fields?.watch ?? "inherit",
        baselinePrice: fields?.baselinePrice ?? 4,
        baselineStore: "Kroger",
        ...(fields?.targetPrice != null ? { targetPrice: fields.targetPrice } : {}),
      },
    ],
  });
}

describe("price drop alerts", { concurrency: false }, () => {
  let memory: MongoMemoryServer;
  let server: http.Server;
  let origin: string;
  const previous = {
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
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
    setWebPushSender(null);
    clearNativePushTransports();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await mongoose.disconnect();
    await memory.stop();
  });

  async function reset(): Promise<void> {
    setWebPushSender(null);
    clearNativePushTransports();
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    await PriceAlert.deleteMany({});
    await PriceWatch.deleteMany({});
    await PushSubscription.deleteMany({});
    await CatalogOffer.deleteMany({ productKey: "12345" });
  }

  it("records one alert for a real drop and skips the same price", async () => {
    await reset();
    await offer({ storeName: "Kroger", price: 2.5, zip: "45103", locationId: "01400999" });
    await offer({ storeName: "Kroger", price: 0.99, zip: "90012", locationId: "far" });
    await offer({ storeName: "Walmart", price: 3, zip: "" });
    await offer({
      storeName: "Aldi",
      price: 0.4,
      zip: "45103",
      locationId: "aldi",
      availability: "out_of_stock",
    });
    await saveWatch();
    const first = await detectPriceDrops();
    assert.equal(first.created, 1);
    const again = await detectPriceDrops();
    assert.equal(again.created, 0);
    const alerts = await PriceAlert.find({ deviceId: DEVICE }).lean();
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]?.itemName, "Whole Milk");
    assert.equal(alerts[0]?.storeName, "Kroger");
    assert.equal(alerts[0]?.oldPrice, 4);
    assert.equal(alerts[0]?.newPrice, 2.5);
    assert.equal(alerts[0]?.savings, 1.5);
  });

  it("alerts again only when the price falls further", async () => {
    await reset();
    await offer({ storeName: "Walmart", price: 3, zip: "" });
    await saveWatch({ baselinePrice: 4 });
    assert.equal((await detectPriceDrops()).created, 1);
    await CatalogOffer.updateOne({ productKey: "12345", storeName: "Walmart" }, { $set: { price: 3.2 } });
    assert.equal((await detectPriceDrops()).created, 0);
    await CatalogOffer.updateOne({ productKey: "12345", storeName: "Walmart" }, { $set: { price: 3 } });
    assert.equal((await detectPriceDrops()).created, 0);
    await CatalogOffer.updateOne({ productKey: "12345", storeName: "Walmart" }, { $set: { price: 2.25 } });
    assert.equal((await detectPriceDrops()).created, 1);
    const alerts = await PriceAlert.find({ deviceId: DEVICE }).sort({ newPrice: -1 }).lean();
    assert.equal(alerts.length, 2);
    assert.equal(alerts[0]?.oldPrice, 4);
    assert.equal(alerts[0]?.newPrice, 3);
    assert.equal(alerts[1]?.oldPrice, 3);
    assert.equal(alerts[1]?.newPrice, 2.25);
    assert.equal(alerts[1]?.savings, 0.75);
  });

  it("respects the list switch and a per-item override", async () => {
    await reset();
    await offer({ storeName: "Walmart", price: 1, zip: "" });
    await saveWatch({ enabled: false, watch: "inherit" });
    assert.equal((await detectPriceDrops()).created, 0);
    await PriceWatch.updateOne({ deviceId: DEVICE }, { $set: { "items.0.watch": "on" } });
    assert.equal((await detectPriceDrops()).created, 1);
    await PriceAlert.deleteMany({});
    await PriceWatch.updateOne({ deviceId: DEVICE }, { $set: { enabled: true, "items.0.watch": "off" } });
    assert.equal((await detectPriceDrops()).created, 0);
  });

  it("marks a target when the new price is under it", async () => {
    await reset();
    await offer({ storeName: "Walmart", price: 2.4, zip: "" });
    await saveWatch({ baselinePrice: 4, targetPrice: 3 });
    await detectPriceDrops();
    const alert = await PriceAlert.findOne({ deviceId: DEVICE }).lean();
    assert.equal(alert?.hitTarget, true);
    assert.equal(alert?.oldPrice, 4);
    assert.equal(alert?.newPrice, 2.4);
  });

  it("serves the in-app list and clears the badge", async () => {
    await reset();
    await offer({ storeName: "Kroger", price: 2.5, zip: "45103", locationId: "01400999" });
    const saved = await fetch(`${origin}/api/price-alerts/watches`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: DEVICE,
        listId: LIST,
        listName: "My list",
        zip: "45103",
        enabled: true,
        items: [
          {
            productId: "upc:12345",
            name: "Whole Milk",
            brand: "Dairy Pure",
            watch: "inherit",
            baselinePrice: 4,
            baselineStore: "Kroger",
          },
        ],
      }),
    });
    assert.equal(saved.status, 200);
    await detectPriceDrops();
    const listed = await fetch(`${origin}/api/price-alerts?deviceId=${DEVICE}`);
    assert.equal(listed.status, 200);
    const body = (await listed.json()) as {
      unread: number;
      alerts: Array<{ itemName: string; storeName: string; oldPrice: number; newPrice: number; savings: number; id: string }>;
    };
    assert.equal(body.unread, 1);
    assert.equal(body.alerts[0]?.itemName, "Whole Milk");
    assert.equal(body.alerts[0]?.storeName, "Kroger");
    assert.equal(body.alerts[0]?.oldPrice, 4);
    assert.equal(body.alerts[0]?.newPrice, 2.5);
    assert.equal(body.alerts[0]?.savings, 1.5);
    const seen = await fetch(`${origin}/api/price-alerts/seen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: DEVICE, ids: [body.alerts[0]?.id] }),
    });
    assert.equal(seen.status, 200);
    const afterSeen = (await (await fetch(`${origin}/api/price-alerts?deviceId=${DEVICE}`)).json()) as { unread: number };
    assert.equal(afterSeen.unread, 0);
    const missing = await fetch(`${origin}/api/price-alerts`);
    assert.equal(missing.status, 400);
  });

  it("keeps browser notifications off until VAPID keys are set", async () => {
    await reset();
    const status = await fetch(`${origin}/api/price-alerts/status`);
    const body = (await status.json()) as { webPush: { enabled: boolean; publicKey?: string }; nativePush: { enabled: boolean } };
    assert.equal(body.webPush.enabled, false);
    assert.equal(body.webPush.publicKey, undefined);
    assert.equal(body.nativePush.enabled, false);
    const subscribed = await fetch(`${origin}/api/price-alerts/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: DEVICE,
        subscription: { endpoint: "https://push.example/device", keys: { p256dh: "key", auth: "auth" } },
      }),
    });
    assert.equal(subscribed.status, 503);
  });

  it("sends one web push for a drop and does not send it again", async () => {
    await reset();
    process.env.VAPID_PUBLIC_KEY = "test-public-key";
    process.env.VAPID_PRIVATE_KEY = "test-private-key";
    const sent: Array<{ endpoint: string; body: string }> = [];
    setWebPushSender(async (subscription, payload) => {
      sent.push({ endpoint: subscription.endpoint, body: payload });
    });
    await PushSubscription.create({
      deviceId: DEVICE,
      channel: "web",
      endpoint: "https://push.example/device",
      p256dh: "key",
      auth: "auth",
      platform: "web",
    });
    await offer({ storeName: "Walmart", price: 2, zip: "" });
    await saveWatch({ baselinePrice: 3 });
    const first = await detectPriceDrops();
    assert.equal(first.created, 1);
    assert.equal(first.pushed, 1);
    assert.equal(sent.length, 1);
    const payload = JSON.parse(sent[0]?.body ?? "{}") as { title: string; body: string; url: string };
    assert.equal(payload.title, "Price drop: Whole Milk");
    assert.match(payload.body, /Walmart/);
    assert.match(payload.body, /\$3\.00/);
    assert.match(payload.body, /\$2\.00/);
    assert.match(payload.body, /save \$1\.00/);
    assert.equal(payload.url, "/?alerts=1");
    await detectPriceDrops();
    assert.equal(sent.length, 1);
    const stored = await PriceAlert.findOne({ deviceId: DEVICE }).lean();
    assert.equal(stored?.pushState, "sent");
  });

  it("drops a subscription the push service says is gone", async () => {
    await reset();
    process.env.VAPID_PUBLIC_KEY = "test-public-key";
    process.env.VAPID_PRIVATE_KEY = "test-private-key";
    setWebPushSender(async () => {
      const error = new Error("gone") as Error & { statusCode?: number };
      error.statusCode = 410;
      throw error;
    });
    await PushSubscription.create({
      deviceId: DEVICE,
      channel: "web",
      endpoint: "https://push.example/gone",
      p256dh: "key",
      auth: "auth",
      platform: "web",
    });
    await offer({ storeName: "Walmart", price: 2, zip: "" });
    await saveWatch();
    await detectPriceDrops();
    assert.equal(await PushSubscription.countDocuments({ endpoint: "https://push.example/gone" }), 0);
    const stored = await PriceAlert.findOne({ deviceId: DEVICE }).lean();
    assert.equal(stored?.pushState, "skipped");
  });

  it("can hand the same alert to a native transport later", async () => {
    await reset();
    const sent: string[] = [];
    registerNativePushTransport({
      channel: "native",
      configured: () => true,
      send: async (message) => {
        sent.push(message.token);
        assert.match(message.payload, /Whole Milk/);
        return "sent";
      },
    });
    await PushSubscription.create({
      deviceId: DEVICE,
      channel: "native",
      nativeToken: "apns-token",
      platform: "ios",
    });
    await offer({ storeName: "Walmart", price: 2, zip: "" });
    await saveWatch();
    const result = await detectPriceDrops();
    assert.equal(result.pushed, 1);
    assert.deepEqual(sent, ["apns-token"]);
    const status = (await (await fetch(`${origin}/api/price-alerts/status`)).json()) as { nativePush: { enabled: boolean } };
    assert.equal(status.nativePush.enabled, true);
  });

  it("finds a demo-catalog drop from the ingest tick", async () => {
    await reset();
    await IngestCheckpoint.deleteMany({ provider: "demo" });
    await PriceWatch.create({
      deviceId: "device-demo-01",
      listId: "list-demo-0001",
      listName: "My list",
      zip: "45103",
      enabled: true,
      items: [
        {
          productId: "upc:99990000018",
          productKey: "99990000018",
          name: "Bananas",
          brand: "Fresh",
          watch: "inherit",
          baselinePrice: 1,
          baselineStore: "Aldi",
        },
      ],
    });
    const first = await runIngestTick({ force: true, maxCalls: 1 });
    assert.equal(first.locked, true);
    const alerts = await PriceAlert.find({ deviceId: "device-demo-01" }).lean();
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]?.itemName, "Bananas");
    assert.equal(alerts[0]?.storeName, "Aldi");
    assert.equal(alerts[0]?.oldPrice, 1);
    assert.equal(alerts[0]?.newPrice, 0.49);
    assert.equal(alerts[0]?.savings, 0.51);
    await CatalogOffer.updateOne({ productKey: "99990000018", storeName: "Aldi" }, { $set: { price: 0.25 } });
    await runIngestTick({ force: true, maxCalls: 1 });
    const next = await PriceAlert.find({ deviceId: "device-demo-01" }).sort({ newPrice: 1 }).lean();
    assert.equal(next.length, 2);
    assert.equal(next[0]?.oldPrice, 0.49);
    assert.equal(next[0]?.newPrice, 0.25);
    assert.equal(next[0]?.savings, 0.24);
  });
});

describe("price alert list ids", () => {
  it("accepts a shared-list token as the list id", () => {
    const item = {
      productId: "upc:12345",
      name: "Whole Milk",
      baselinePrice: 4,
    };
    const shareToken = "a".repeat(43);
    const parsed = parseWatchBody({
      deviceId: DEVICE,
      listId: shareToken,
      enabled: true,
      items: [item],
    });
    assert.equal(parsed?.listId, shareToken);
    const longest = parseWatchBody({
      deviceId: DEVICE,
      listId: "b".repeat(128),
      enabled: false,
      items: [item],
    });
    assert.equal(longest?.listId, "b".repeat(128));
    assert.equal(
      parseWatchBody({
        deviceId: DEVICE,
        listId: "c".repeat(129),
        enabled: false,
        items: [item],
      }),
      null
    );
  });
});
