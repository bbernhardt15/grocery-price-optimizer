import { Router, type Request, type Response } from "express";
import { dropShadowLocalKeys, recategorizeCatalog, resetRunCounters } from "../ingest/maintenance";
import { adminAuthorized, adminTokenConfigured, catalogStatus } from "../ingest/status";

const router = Router();

function requireAdmin(req: Request, res: Response): boolean {
  if (!adminTokenConfigured()) {
    res.status(503).json({ error: "Set ADMIN_TOKEN to open catalog ingest status." });
    return false;
  }
  const header = req.header("authorization") ?? req.header("x-admin-token") ?? undefined;
  if (!adminAuthorized(header)) {
    res.status(401).json({ error: "Admin token required." });
    return false;
  }
  return true;
}

function confirmed(req: Request, phrase: string): boolean {
  const body = req.body as { confirm?: unknown } | undefined;
  return body?.confirm === phrase;
}

router.get("/admin/catalog/status", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) {
    return;
  }
  try {
    res.json(await catalogStatus());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

router.post("/admin/catalog/reset-run-counters", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) {
    return;
  }
  if (!confirmed(req, "reset-run-counters")) {
    res.status(400).json({ error: 'Send { "confirm": "reset-run-counters" } to zero checkpoint call counters.' });
    return;
  }
  try {
    res.json(await resetRunCounters());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

router.post("/admin/catalog/recategorize", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) {
    return;
  }
  if (!confirmed(req, "recategorize-catalog")) {
    res.status(400).json({
      error: 'Send { "confirm": "recategorize-catalog" } to remap departments from stored category paths.',
    });
    return;
  }
  try {
    res.json(await recategorizeCatalog());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

router.post("/admin/catalog/drop-shadow-local-keys", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) {
    return;
  }
  if (!confirmed(req, "drop-shadow-local-keys")) {
    res.status(400).json({
      error:
        'Send { "confirm": "drop-shadow-local-keys" } to delete local-keyed rows that already have a UPC master.',
    });
    return;
  }
  try {
    res.json(await dropShadowLocalKeys());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;
