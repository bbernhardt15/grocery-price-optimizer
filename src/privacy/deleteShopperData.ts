import { PriceAlert, PriceWatch, PushSubscription } from "../alerts/models";
import { parsePublicId } from "../alerts/watchInput";
import { deleteOwnedSharedList } from "../lists/repository";
import { isShareToken } from "../lists/sharedList";

export const MAX_OWNED_LISTS = 8;

export type OwnedListProof = {
  shareToken: string;
  ownerToken: string;
};

export type ShopperDeletionCounts = {
  priceWatches: number;
  priceAlerts: number;
  pushSubscriptions: number;
  sharedLists: number;
  sharedListsRefused: number;
};

export const NOT_LINKED_TO_YOU = {
  shopperZips: "ZIP totals have no device id and were left in place.",
  catalogDemand: "Search and list phrases have no device id and were left in place.",
} as const;

/**
 * The caller is this device. deviceId is the random id the app created.
 * Each shared list is deleted only when its owner secret is presented with it.
 */
export function parseDeletionBody(
  body: unknown
): { ok: true; deviceId: string; lists: OwnedListProof[] } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Send deviceId for this device." };
  }
  const record = body as Record<string, unknown>;
  const deviceId = parsePublicId(record.deviceId);
  if (!deviceId) {
    return { ok: false, error: "deviceId must be 8–80 letters, numbers, dashes, or underscores." };
  }
  if (record.lists == null) {
    return { ok: true, deviceId, lists: [] };
  }
  if (!Array.isArray(record.lists)) {
    return { ok: false, error: "lists must be an array of share and owner tokens." };
  }
  if (record.lists.length > MAX_OWNED_LISTS) {
    return { ok: false, error: "Send at most 8 shared lists." };
  }
  const lists: OwnedListProof[] = [];
  for (const entry of record.lists) {
    if (!entry || typeof entry !== "object") {
      return { ok: false, error: "Each list needs a shareToken and an ownerToken." };
    }
    const row = entry as Record<string, unknown>;
    if (!isShareToken(row.shareToken) || !isShareToken(row.ownerToken)) {
      return { ok: false, error: "Each list needs a shareToken and an ownerToken." };
    }
    lists.push({ shareToken: row.shareToken, ownerToken: row.ownerToken });
  }
  return { ok: true, deviceId, lists };
}

function removedCount(result: { deletedCount?: number }): number {
  return result.deletedCount ?? 0;
}

export async function deleteShopperData(
  deviceId: string,
  lists: readonly OwnedListProof[]
): Promise<ShopperDeletionCounts> {
  let sharedLists = 0;
  let sharedListsRefused = 0;
  const removedTokens: string[] = [];
  for (const list of lists) {
    const result = await deleteOwnedSharedList(list.shareToken, list.ownerToken);
    if (result === "deleted") {
      sharedLists += 1;
      removedTokens.push(list.shareToken);
    } else if (result === "refused") {
      sharedListsRefused += 1;
    }
  }

  let priceWatches = 0;
  let priceAlerts = 0;
  if (removedTokens.length > 0) {
    priceWatches += removedCount(await PriceWatch.deleteMany({ listId: { $in: removedTokens } }));
    priceAlerts += removedCount(await PriceAlert.deleteMany({ listId: { $in: removedTokens } }));
  }
  priceWatches += removedCount(await PriceWatch.deleteMany({ deviceId }));
  priceAlerts += removedCount(await PriceAlert.deleteMany({ deviceId }));
  const pushSubscriptions = removedCount(await PushSubscription.deleteMany({ deviceId }));

  return {
    priceWatches,
    priceAlerts,
    pushSubscriptions,
    sharedLists,
    sharedListsRefused,
  };
}
