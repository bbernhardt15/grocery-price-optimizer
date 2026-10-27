import { Router, type Request, type Response } from "express";
import { dropShadowLocalKeys, excludeNongroceryFromRefresh, startRecategorizeJob, resetRunCounters } from "../ingest/maintenance";
import { adminAuthorized, adminTokenConfigured, catalogFamilySample, catalogMatchQueue, catalogMatchSample, catalogOtherBreakdown, catalogSample, catalogStatus, catalogSuspicious } from "../ingest/status";

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

router.get("/admin/catalog/sample", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) {
    return;
  }
  const department = typeof req.query.department === "string" ? req.query.department : "";
  const limit = Number(req.query.limit ?? 20);
  try {
    const body = await catalogSample(department, limit);
    if ("error" in body) {
      res.status(400).json(body);
      return;
    }
    res.json(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

router.get("/admin/catalog/family-sample", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) {
    return;
  }
  const department = typeof req.query.department === "string" ? req.query.department : "";
  const query = typeof req.query.q === "string" ? req.query.q : typeof req.query.query === "string" ? req.query.query : "";
  const limit = Number(req.query.limit ?? 20);
  const scan = req.query.scan == null || req.query.scan === "" ? undefined : Number(req.query.scan);
  try {
    const body = await catalogFamilySample({
      department,
      query,
      limit,
      ...(scan != null && Number.isFinite(scan) ? { scan } : {}),
    });
    if ("error" in body) {
      res.status(400).json(body);
      return;
    }
    res.json(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

router.get("/admin/catalog/suspicious", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) {
    return;
  }
  const limit = Number(req.query.limit ?? 30);
  try {
    res.json(await catalogSuspicious(limit));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

router.get("/admin/catalog/other-breakdown", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) {
    return;
  }
  const limit = Number(req.query.limit ?? 100);
  try {
    res.json(await catalogOtherBreakdown(limit));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

router.get("/admin/catalog/match-queue", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) {
    return;
  }
  try {
    res.json(await catalogMatchQueue());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

router.get("/admin/catalog/match-sample", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) {
    return;
  }
  try {
    res.json(await catalogMatchSample());
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
    res.json(await startRecategorizeJob());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

router.post("/admin/catalog/exclude-nongrocery-refresh", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) {
    return;
  }
  if (!confirmed(req, "exclude-nongrocery-refresh")) {
    res.status(400).json({
      error:
        'Send { "confirm": "exclude-nongrocery-refresh" } to skip refresh on Other products that are still general merchandise. Nothing is deleted.',
    });
    return;
  }
  try {
    res.json(await excludeNongroceryFromRefresh());
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
