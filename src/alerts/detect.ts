import { CatalogOffer } from "../ingest/models";
import { bestQuote, cents, dropKey, evaluateDrop, fromCents, itemIsWatched } from "./compare";
import { PriceAlert, PriceWatch, type PriceWatchDoc } from "./models";
import { deliverPendingAlerts } from "./push";

export type DetectResult = {
  examined: number;
  created: number;
  pushed: number;
};

type OfferRow = {
  productKey: string;
  storeName: string;
  price: number;
  zip?: string;
  availability?: string;
  status?: string;
};

type PriorRow = {
  _id: { deviceId: string; listId: string; productKey: string; baselinePrice: number };
  newPrice: number;
};

function isDuplicateKey(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === 11000);
}

/**
 * Compare opted-in saved lists with active catalog offers.
 * Runs from the ingest tick after prices are refreshed. The same drop
 * (device, list, item, saved price, new price) cannot insert twice.
 */
export async function detectPriceDrops(now = new Date()): Promise<DetectResult> {
  const watches = await PriceWatch.find({
    $or: [{ enabled: true }, { "items.watch": "on" }],
  }).lean<PriceWatchDoc[]>();

  const keys = new Set<string>();
  for (const watch of watches) {
    for (const item of watch.items) {
      if (itemIsWatched(watch.enabled, item.watch) && item.productKey) {
        keys.add(item.productKey);
      }
    }
  }

  const keyList = [...keys];
  const offers =
    keyList.length === 0
      ? []
      : await CatalogOffer.find({ productKey: { $in: keyList }, status: "active", price: { $gt: 0 } })
          .select("productKey storeName price zip availability status")
          .lean<OfferRow[]>();
  const offersByKey = new Map<string, OfferRow[]>();
  for (const offer of offers) {
    const bucket = offersByKey.get(offer.productKey);
    if (bucket) {
      bucket.push(offer);
    } else {
      offersByKey.set(offer.productKey, [offer]);
    }
  }

  const deviceIds = [...new Set(watches.map((watch) => watch.deviceId))];
  const priors =
    keyList.length === 0
      ? []
      : await PriceAlert.aggregate<PriorRow>([
          { $match: { deviceId: { $in: deviceIds }, productKey: { $in: keyList } } },
          {
            $group: {
              _id: {
                deviceId: "$deviceId",
                listId: "$listId",
                productKey: "$productKey",
                baselinePrice: "$baselinePrice",
              },
              newPrice: { $min: "$newPrice" },
            },
          },
        ]);
  const priorPrice = new Map<string, number>();
  for (const row of priors) {
    priorPrice.set(
      `${row._id.deviceId}:${row._id.listId}:${row._id.productKey}:${cents(row._id.baselinePrice)}`,
      row.newPrice
    );
  }

  let examined = 0;
  let created = 0;
  for (const watch of watches) {
    for (const item of watch.items) {
      if (!itemIsWatched(watch.enabled, item.watch) || !item.productKey) {
        continue;
      }
      examined += 1;
      const quote = bestQuote(offersByKey.get(item.productKey) ?? [], watch.zip ?? "");
      if (!quote) {
        continue;
      }
      const priorKey = `${watch.deviceId}:${watch.listId}:${item.productKey}:${cents(item.baselinePrice)}`;
      const decision = evaluateDrop({
        baselinePrice: item.baselinePrice,
        targetPrice: item.targetPrice,
        bestPrice: quote.price,
        lastNotifiedPrice: priorPrice.get(priorKey) ?? null,
      });
      if (!decision) {
        continue;
      }
      try {
        await PriceAlert.create({
          deviceId: watch.deviceId,
          ...(watch.accountId ? { accountId: watch.accountId } : {}),
          listId: watch.listId,
          listName: watch.listName,
          productId: item.productId,
          productKey: item.productKey,
          itemName: item.name,
          storeName: quote.storeName,
          oldPrice: decision.oldPrice,
          newPrice: decision.newPrice,
          savings: decision.savings,
          baselinePrice: fromCents(cents(item.baselinePrice)),
          ...(item.targetPrice != null ? { targetPrice: item.targetPrice } : {}),
          hitTarget: decision.hitTarget,
          reason: decision.reason,
          dropKey: dropKey(watch.deviceId, watch.listId, item.productKey, item.baselinePrice, decision.newPrice),
          seenAt: null,
          pushState: "pending",
          pushAttempts: 0,
          createdAt: now,
        });
        created += 1;
        priorPrice.set(priorKey, decision.newPrice);
      } catch (error) {
        if (!isDuplicateKey(error)) {
          throw error;
        }
      }
    }
  }

  const pushed = await deliverPendingAlerts();
  return { examined, created, pushed };
}
