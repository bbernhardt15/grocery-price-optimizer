import { parsePublicId } from "../alerts/watchInput";
import { PriceAlert, PriceWatch, PushSubscription } from "../alerts/models";
import { readKrogerOAuthConfig, unsealShopperToken } from "../krogerCartAuth";
import { hashSecret, isShareToken } from "../lists/sharedList";
import { tagOwnedSharedList } from "../lists/repository";
import type { OwnedListProof } from "../privacy/deleteShopperData";
import { Account } from "./models";
import { sealSecret } from "./seal";
import { parseSavedListWrite, writeSavedList, type SavedListWrite } from "./savedList";

export type MergeResult = {
  priceWatches: number;
  priceAlerts: number;
  pushSubscriptions: number;
  sharedLists: number;
  sharedListsRefused: number;
  savedList: boolean;
  krogerLinked: boolean;
};

function emptyMerge(): MergeResult {
  return {
    priceWatches: 0,
    priceAlerts: 0,
    pushSubscriptions: 0,
    sharedLists: 0,
    sharedListsRefused: 0,
    savedList: false,
    krogerLinked: false,
  };
}

export function parseMergeBody(body: unknown): {
  deviceId?: string;
  lists: OwnedListProof[];
  savedList: SavedListWrite | null;
  error?: string;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { lists: [], savedList: null };
  }
  const row = body as Record<string, unknown>;
  const deviceId = row.deviceId == null ? undefined : parsePublicId(row.deviceId) ?? undefined;
  if (row.deviceId != null && !deviceId) {
    return { lists: [], savedList: null, error: "deviceId must be 8–80 letters, numbers, dashes, or underscores." };
  }
  const lists: OwnedListProof[] = [];
  if (row.lists != null) {
    if (!Array.isArray(row.lists) || row.lists.length > 8) {
      return { lists: [], savedList: null, error: "lists must be at most 8 shared lists." };
    }
    for (const entry of row.lists) {
      if (!entry || typeof entry !== "object") {
        return { lists: [], savedList: null, error: "Each list needs a shareToken and an ownerToken." };
      }
      const item = entry as Record<string, unknown>;
      if (!isShareToken(item.shareToken) || !isShareToken(item.ownerToken)) {
        return { lists: [], savedList: null, error: "Each list needs a shareToken and an ownerToken." };
      }
      lists.push({ shareToken: item.shareToken, ownerToken: item.ownerToken });
    }
  }
  let savedList: SavedListWrite | null = null;
  if (row.list != null) {
    const parsed = parseSavedListWrite(row.list);
    if ("error" in parsed) return { lists: [], savedList: null, error: parsed.error };
    savedList = parsed;
  }
  return { deviceId, lists, savedList };
}

export async function mergeDeviceIntoAccount(
  accountId: string,
  input: { deviceId?: string; lists: readonly OwnedListProof[]; savedList: SavedListWrite | null; krogerSealed?: string }
): Promise<MergeResult> {
  const result = emptyMerge();
  if (input.deviceId) {
    const watches = await PriceWatch.updateMany({ deviceId: input.deviceId }, { $set: { accountId } });
    result.priceWatches = watches.modifiedCount ?? 0;
    const alerts = await PriceAlert.updateMany({ deviceId: input.deviceId }, { $set: { accountId } });
    result.priceAlerts = alerts.modifiedCount ?? 0;
    const pushes = await PushSubscription.updateMany({ deviceId: input.deviceId }, { $set: { accountId } });
    result.pushSubscriptions = pushes.modifiedCount ?? 0;
  }

  const linked: { hash: string; sealed: string }[] = [];
  for (const list of input.lists) {
    const tagged = await tagOwnedSharedList({
      shareToken: list.shareToken,
      ownerToken: list.ownerToken,
      accountId,
      ownerDeviceId: input.deviceId,
    });
    if (tagged === "tagged") {
      result.sharedLists += 1;
      linked.push({ hash: hashSecret(list.shareToken), sealed: sealSecret(list.shareToken) });
    } else if (tagged === "refused") {
      result.sharedListsRefused += 1;
    }
  }
  if (linked.length > 0) {
    const account = await Account.findById(accountId).select("linkedLists").lean();
    const current = (account?.linkedLists ?? []) as { hash: string; sealed: string }[];
    const have = new Set(current.map((row) => row.hash));
    const next = [...current];
    for (const row of linked) {
      if (!have.has(row.hash)) next.push(row);
    }
    await Account.updateOne({ _id: accountId }, { $set: { linkedLists: next.slice(-20) } });
  }

  if (input.savedList) {
    await writeSavedList(accountId, input.savedList);
    result.savedList = true;
  }

  if (input.krogerSealed) {
    const config = readKrogerOAuthConfig();
    if (config && unsealShopperToken(config.clientSecret, input.krogerSealed)) {
      await Account.updateOne({ _id: accountId }, { $set: { krogerSealed: input.krogerSealed } });
      result.krogerLinked = true;
    }
  }
  if (!result.krogerLinked) {
    const account = await Account.findById(accountId).select("krogerSealed").lean();
    result.krogerLinked = Boolean(account?.krogerSealed);
  }
  return result;
}
