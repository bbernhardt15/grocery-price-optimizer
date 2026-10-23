import { Router } from "express";
import { deleteAccount } from "../auth/accountDeletion";
import { requestAuth } from "../auth/middleware";
import { clearSessionCookieHeader } from "../auth/session";
import {
  clearShopperCookieHeader,
  KROGER_SHOPPER_COOKIE,
  readRequestCookie,
  revokeSealedShopperCookie,
} from "../krogerCartAuth";
import { deleteShopperData, NOT_LINKED_TO_YOU, parseDeletionBody } from "../privacy/deleteShopperData";

const router = Router();

router.delete("/me/data", async (req, res) => {
  const parsed = parseDeletionBody(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  try {
    const deleted = await deleteShopperData(parsed.deviceId, parsed.lists);
    const auth = requestAuth(res);
    const account = auth ? await deleteAccount(auth.accountId) : null;
    if (account?.deleted) {
      deleted.priceWatches += account.priceWatches;
      deleted.priceAlerts += account.priceAlerts;
      deleted.pushSubscriptions += account.pushSubscriptions;
      deleted.sharedLists += account.sharedLists;
      res.append("Set-Cookie", clearSessionCookieHeader());
    }
    const sealed = readRequestCookie(req.headers.cookie, KROGER_SHOPPER_COOKIE);
    const cookieResult = await revokeSealedShopperCookie(sealed);
    const accountResult = account?.krogerSealed && account.krogerSealed !== sealed
      ? await revokeSealedShopperCookie(account.krogerSealed)
      : { hadToken: false, revoked: false };
    const kroger = {
      hadToken: cookieResult.hadToken || accountResult.hadToken,
      revoked: (cookieResult.hadToken ? cookieResult.revoked : true) && (accountResult.hadToken ? accountResult.revoked : true) && (cookieResult.hadToken || accountResult.hadToken),
    };
    if (!cookieResult.hadToken && !accountResult.hadToken) kroger.revoked = false;
    res.append("Set-Cookie", clearShopperCookieHeader());
    res.json({
      deleted,
      account: { deleted: Boolean(account?.deleted) },
      kroger: { ...kroger, cookieCleared: true as const },
      notLinkedToYou: NOT_LINKED_TO_YOU,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`Delete my data failed: ${message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: "Your data could not be deleted. Try again." });
    }
  }
});

export default router;
