import { Router } from "express";
import { showAdStores } from "../pricing/storeScope";

const router = Router();

/** Shopper UI flag. No list contents. */
router.get("/shopper/config", (_req, res) => {
  res.json({ showAdStores: showAdStores() });
});

export default router;
