import { PriceAlert, PushSubscription, type PriceAlertDoc, type PushSubscriptionDoc } from "./models";
import { vapidConfig, webPushConfigured } from "./vapid";

export type PushChannel = "web" | "native";

export type NativePushMessage = {
  token: string;
  payload: string;
};

/**
 * Native shells (Capacitor, APNs, FCM) register one of these at process start.
 * Detection does not know which channel delivers an alert.
 */
export type NativePushTransport = {
  channel: "native";
  configured(): boolean;
  send(message: NativePushMessage): Promise<"sent" | "gone" | "failed">;
};

export type WebPushSender = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string
) => Promise<void>;

const nativeTransports: NativePushTransport[] = [];
let webPushSender: WebPushSender | null = null;

export function registerNativePushTransport(transport: NativePushTransport): void {
  nativeTransports.push(transport);
}

export function clearNativePushTransports(): void {
  nativeTransports.length = 0;
}

export function nativePushConfigured(): boolean {
  return nativeTransports.some((transport) => transport.configured());
}

/** Tests inject a sender so a scan does not call the push service. */
export function setWebPushSender(sender: WebPushSender | null): void {
  webPushSender = sender;
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function alertPushPayload(alert: {
  id: string;
  itemName: string;
  storeName: string;
  oldPrice: number;
  newPrice: number;
  savings: number;
}): string {
  return JSON.stringify({
    title: `Price drop: ${alert.itemName}`,
    body: `${alert.storeName} · ${formatUsd(alert.oldPrice)} → ${formatUsd(alert.newPrice)} · save ${formatUsd(alert.savings)}`,
    url: "/?alerts=1",
    alertId: alert.id,
    icon: "/icons/icon-192.png",
  });
}

function pushStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("statusCode" in error)) {
    return undefined;
  }
  const code = (error as { statusCode?: unknown }).statusCode;
  return typeof code === "number" ? code : undefined;
}

async function defaultWebPushSender(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string
): Promise<void> {
  const config = vapidConfig();
  if (!config) {
    throw new Error("Web Push is not configured.");
  }
  const webpush = await import("web-push");
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  await webpush.sendNotification(subscription, payload, { TTL: 12 * 60 * 60 });
}

type Delivery = "sent" | "skipped" | "failed" | "pending";

async function deliverOne(alert: PriceAlertDoc, subscriptions: PushSubscriptionDoc[]): Promise<Delivery> {
  const payload = alertPushPayload({
    id: String(alert._id),
    itemName: alert.itemName,
    storeName: alert.storeName,
    oldPrice: alert.oldPrice,
    newPrice: alert.newPrice,
    savings: alert.savings,
  });
  const webSubs = subscriptions.filter(
    (sub) => sub.channel === "web" && sub.endpoint && sub.p256dh && sub.auth
  );
  const nativeSubs = subscriptions.filter((sub) => sub.channel === "native" && sub.nativeToken);
  const nativeTransport = nativeTransports.find((transport) => transport.configured());
  let sent = 0;
  let failed = 0;
  let waiting = false;

  if (webSubs.length > 0 && !webPushConfigured()) {
    waiting = true;
  } else {
    const send = webPushSender ?? defaultWebPushSender;
    for (const sub of webSubs) {
      try {
        await send({ endpoint: sub.endpoint!, keys: { p256dh: sub.p256dh!, auth: sub.auth! } }, payload);
        sent += 1;
      } catch (error) {
        const status = pushStatusCode(error);
        if (status === 404 || status === 410) {
          await PushSubscription.deleteOne({ _id: sub._id });
        } else {
          failed += 1;
        }
      }
    }
  }

  if (nativeSubs.length > 0 && !nativeTransport) {
    waiting = true;
  } else if (nativeTransport) {
    for (const sub of nativeSubs) {
      try {
        const result = await nativeTransport.send({ token: sub.nativeToken!, payload });
        if (result === "sent") {
          sent += 1;
        } else if (result === "gone") {
          await PushSubscription.deleteOne({ _id: sub._id });
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }
  }

  if (sent > 0) {
    return "sent";
  }
  if (failed > 0) {
    return "failed";
  }
  if (waiting) {
    return "pending";
  }
  return "skipped";
}

/** Send alerts that are still pending. No-ops when Web Push keys are unset and no native transport is registered. */
export async function deliverPendingAlerts(limit = 20): Promise<number> {
  const pending = await PriceAlert.find({ pushState: "pending" }).sort({ createdAt: 1 }).limit(limit);
  if (pending.length === 0) {
    return 0;
  }
  const deviceIds = [...new Set(pending.map((alert) => alert.deviceId))];
  const subscriptions = await PushSubscription.find({ deviceId: { $in: deviceIds } }).lean<PushSubscriptionDoc[]>();
  let pushed = 0;
  for (const alert of pending) {
    const mine = subscriptions.filter((sub) => sub.deviceId === alert.deviceId);
    const result = await deliverOne(alert.toObject() as PriceAlertDoc, mine);
    if (result === "pending") {
      continue;
    }
    if (result === "failed") {
      const attempts = (alert.pushAttempts ?? 0) + 1;
      await PriceAlert.updateOne(
        { _id: alert._id },
        { $set: { pushState: attempts >= 3 ? "failed" : "pending", pushAttempts: attempts } }
      );
      continue;
    }
    await PriceAlert.updateOne({ _id: alert._id }, { $set: { pushState: result } });
    if (result === "sent") {
      pushed += 1;
    }
  }
  return pushed;
}
