import { PriceAlert, PriceWatch, PushSubscription } from "../alerts/models";
import { readKrogerOAuthConfig, revokeSealedShopperCookie } from "../krogerCartAuth";
import { SharedList } from "../models/SharedList";
import { Account, AuthIdentity, AuthSession, MagicLink, SavedList } from "./models";
import { unsealSecret } from "./seal";

export type AccountDeletion = {
  deleted: boolean;
  priceWatches: number;
  priceAlerts: number;
  pushSubscriptions: number;
  sharedLists: number;
  krogerSealed?: string;
};

/**
 * Deletes the account and everything that was merged onto it.
 * Device-scoped rows are removed by deleteShopperData first. This pass
 * removes the other devices on the same account, and the account itself.
 */
export async function deleteAccount(accountId: string): Promise<AccountDeletion> {
  const account = await Account.findById(accountId).lean();
  if (!account) {
    return { deleted: false, priceWatches: 0, priceAlerts: 0, pushSubscriptions: 0, sharedLists: 0 };
  }

  const shareTokens: string[] = [];
  for (const link of account.linkedLists ?? []) {
    const token = unsealSecret(link.sealed);
    if (token) shareTokens.push(token);
  }

  let priceWatches = 0;
  let priceAlerts = 0;
  if (shareTokens.length > 0) {
    priceWatches += (await PriceWatch.deleteMany({ listId: { $in: shareTokens } })).deletedCount ?? 0;
    priceAlerts += (await PriceAlert.deleteMany({ listId: { $in: shareTokens } })).deletedCount ?? 0;
  }
  priceWatches += (await PriceWatch.deleteMany({ accountId })).deletedCount ?? 0;
  priceAlerts += (await PriceAlert.deleteMany({ accountId })).deletedCount ?? 0;
  const pushSubscriptions = (await PushSubscription.deleteMany({ accountId })).deletedCount ?? 0;
  const sharedLists = (await SharedList.deleteMany({ accountId })).deletedCount ?? 0;
  await SavedList.deleteMany({ accountId });
  await AuthSession.deleteMany({ accountId });
  await AuthIdentity.deleteMany({ accountId });
  if (account.email) await MagicLink.deleteMany({ email: account.email });
  await Account.deleteOne({ _id: account._id });

  let krogerSealed: string | undefined;
  if (account.krogerSealed && readKrogerOAuthConfig()) krogerSealed = account.krogerSealed;

  return {
    deleted: true,
    priceWatches,
    priceAlerts,
    pushSubscriptions,
    sharedLists,
    ...(krogerSealed ? { krogerSealed } : {}),
  };
}
