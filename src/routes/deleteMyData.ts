import { Router } from "express";
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
    const sealed = readRequestCookie(req.headers.cookie, KROGER_SHOPPER_COOKIE);
    const kroger = await revokeSealedShopperCookie(sealed);
    res.append("Set-Cookie", clearShopperCookieHeader());
    res.json({
      deleted,
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
