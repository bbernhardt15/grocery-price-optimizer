import { Router, type Request, type Response } from "express";
import { PriceAlert, PriceWatch, PushSubscription } from "../alerts/models";
import { requestAuth } from "../auth/middleware";
import { nativePushConfigured } from "../alerts/push";
import { vapidConfig, webPushConfigured } from "../alerts/vapid";
import { parsePublicId, parsePushSubscription, parseWatchBody } from "../alerts/watchInput";
import { blockUnlessFeature } from "../billing/middleware";

const router = Router();

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    handler(req, res).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      }
    });
  };
}

function alertScope(deviceId: string, accountId: string | undefined): Record<string, unknown> {
  if (!accountId) return { deviceId };
  return { $or: [{ deviceId }, { accountId }] };
}

function deviceFrom(value: unknown, res: Response): string | null {
  const deviceId = parsePublicId(value);
  if (!deviceId) {
    res.status(400).json({ error: "deviceId must be 8–80 letters, numbers, dashes, or underscores." });
    return null;
  }
  return deviceId;
}

router.get("/price-alerts/status", (_req, res) => {
  const config = vapidConfig();
  res.json({
    webPush: {
      enabled: config != null,
      ...(config ? { publicKey: config.publicKey } : {}),
    },
    nativePush: { enabled: nativePushConfigured() },
  });
});

router.put("/price-alerts/watches", asyncRoute(async (req: Request, res: Response) => {
  const watch = parseWatchBody(req.body);
  if (!watch) {
    res.status(400).json({
      error: "Send deviceId, listId, enabled, and items with a product id, name, and the price when you saved each one.",
    });
    return;
  }
  const turningOn = watch.enabled || watch.items.some((item) => item.watch === "on");
  if (turningOn && (await blockUnlessFeature(req, res, "priceAlerts", "Price alerts are part of Grocery Gitter Pro."))) {
    return;
  }
  const accountId = requestAuth(res)?.accountId;
  await PriceWatch.findOneAndUpdate(
    { deviceId: watch.deviceId, listId: watch.listId },
    {
      $set: {
        listName: watch.listName,
        zip: watch.zip,
        enabled: watch.enabled,
        items: watch.items,
        ...(accountId ? { accountId } : {}),
      },
    },
    { upsert: true, new: true }
  );
  res.json({
    deviceId: watch.deviceId,
    listId: watch.listId,
    listName: watch.listName,
    enabled: watch.enabled,
    items: watch.items.length,
  });
}));

router.get("/price-alerts", asyncRoute(async (req: Request, res: Response) => {
  const deviceId = deviceFrom(req.query.deviceId, res);
  if (!deviceId) {
    return;
  }
  const scope = alertScope(deviceId, requestAuth(res)?.accountId);
  const [alerts, unread] = await Promise.all([
    PriceAlert.find(scope).sort({ createdAt: -1 }).limit(40).lean(),
    PriceAlert.countDocuments({ ...scope, seenAt: null }),
  ]);
  res.json({
    unread,
    alerts: alerts.map((alert) => ({
      id: String(alert._id),
      listId: alert.listId,
      listName: alert.listName,
      productId: alert.productId,
      itemName: alert.itemName,
      storeName: alert.storeName,
      oldPrice: alert.oldPrice,
      newPrice: alert.newPrice,
      savings: alert.savings,
      hitTarget: Boolean(alert.hitTarget),
      seen: alert.seenAt != null,
      createdAt: alert.createdAt,
    })),
  });
}));

router.post("/price-alerts/seen", asyncRoute(async (req: Request, res: Response) => {
  const body = req.body as { deviceId?: unknown; ids?: unknown } | undefined;
  const deviceId = deviceFrom(body?.deviceId, res);
  if (!deviceId) {
    return;
  }
  const filter: Record<string, unknown> = { ...alertScope(deviceId, requestAuth(res)?.accountId), seenAt: null };
  if (body?.ids != null) {
    if (!Array.isArray(body.ids) || body.ids.length > 100) {
      res.status(400).json({ error: "ids must be a list of alert ids." });
      return;
    }
    const ids: string[] = [];
    for (const id of body.ids) {
      if (typeof id !== "string" || !/^[a-f0-9]{24}$/i.test(id)) {
        res.status(400).json({ error: "ids must be a list of alert ids." });
        return;
      }
      ids.push(id);
    }
    filter._id = { $in: ids };
  }
  const result = await PriceAlert.updateMany(filter, { $set: { seenAt: new Date() } });
  res.json({ updated: result.modifiedCount ?? 0 });
}));

router.post("/price-alerts/push", asyncRoute(async (req: Request, res: Response) => {
  const body = req.body as { deviceId?: unknown } | undefined;
  const deviceId = deviceFrom(body?.deviceId, res);
  if (!deviceId) {
    return;
  }
  if (!webPushConfigured()) {
    res.status(503).json({
      error: "Browser notifications are off until VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are set.",
    });
    return;
  }
  const subscription = parsePushSubscription(req.body);
  if (!subscription) {
    res.status(400).json({ error: "Send a Web Push subscription with an https endpoint and keys." });
    return;
  }
  await PushSubscription.findOneAndUpdate(
    { endpoint: subscription.endpoint },
    {
      $set: {
        deviceId,
        ...(requestAuth(res)?.accountId ? { accountId: requestAuth(res)?.accountId } : {}),
        channel: "web",
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
        platform: "web",
      },
    },
    { upsert: true }
  );
  res.json({ subscribed: true, channel: "web" });
}));

router.delete("/price-alerts/push", asyncRoute(async (req: Request, res: Response) => {
  const body = req.body as { deviceId?: unknown; endpoint?: unknown } | undefined;
  const deviceId = deviceFrom(body?.deviceId, res);
  if (!deviceId) {
    return;
  }
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint.trim() : "";
  if (!endpoint) {
    res.status(400).json({ error: "Send the push endpoint to remove." });
    return;
  }
  await PushSubscription.deleteOne({ deviceId, endpoint, channel: "web" });
  res.json({ subscribed: false });
}));

export default router;
