import { Router, type Request, type Response } from "express";
import { adminAuthorized, adminTokenConfigured, catalogStatus } from "../ingest/status";

const router = Router();

router.get("/admin/catalog/status", async (req: Request, res: Response) => {
  if (!adminTokenConfigured()) {
    res.status(503).json({ error: "Set ADMIN_TOKEN to open catalog ingest status." });
    return;
  }
  const header = req.header("authorization") ?? req.header("x-admin-token") ?? undefined;
  if (!adminAuthorized(header)) {
    res.status(401).json({ error: "Admin token required." });
    return;
  }
  try {
    res.json(await catalogStatus());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;
