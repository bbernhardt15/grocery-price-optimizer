import { timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { deactivateOutOfScopeCatalog, dropShadowLocalKeys, excludeNongroceryFromRefresh, startRecategorizeJob, resetRunCounters } from "../ingest/maintenance";
import { CatalogMaster } from "../ingest/models";
import { CooldownBusyError, clearMatchCooldowns, type CooldownStore } from "../ingest/clearMatchCooldowns";
import { RemergeBusyError, remergeGtinCatalog } from "../ingest/remerge";
import { adminAuthorized, adminTokenConfigured, catalogFamilySample, catalogMatchQueue, catalogMatchSample, catalogOtherBreakdown, catalogSample, catalogStatus, catalogSuspicious } from "../ingest/status";
import { KROGER_PROBE_SAFE_LIMIT, krogerProbeJob, runKrogerProbe, startKrogerProbeJob } from "../ingest/krogerProbe";
import { KROGER_DIAGNOSE_SAFE_LIMIT, krogerDiagnoseJob, runKrogerDiagnose, startKrogerDiagnoseJob } from "../ingest/krogerDiagnose";
import { krogerService } from "../krogerService";

const router = Router();

function probeAuthorized(req: Request, res: Response): boolean {
  const expected = [process.env.GG_ADMIN_TOKEN, process.env.ADMIN_TOKEN].map((value) => value?.trim() || "").filter(Boolean);
  const header = req.header("authorization") ?? req.header("x-admin-token") ?? "";
  const presented = header.replace(/^Bearer\s+/i, "").trim();
  const ok = expected.some((token) => {
    const left = Buffer.from(presented);
    const right = Buffer.from(token);
    return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
  });
  if (!ok) {
    res.status(401).json({ error: "Admin token required." });
    return false;
  }
  return true;
}

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

router.get("/admin/catalog/remerge", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const limit = Number(req.query.limit ?? 200_000);
  try {
    res.json(await remergeGtinCatalog({ apply: false, limit }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

router.post("/admin/catalog/remerge", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const apply = (req.body as { apply?: unknown } | undefined)?.apply === true;
  if (apply && !confirmed(req, "remerge-gtin")) {
    res.status(400).json({ error: 'Send { "apply": true, "confirm": "remerge-gtin" } to merge. Omit apply for a dry run.' });
    return;
  }
  const limit = Number((req.body as { limit?: unknown } | undefined)?.limit ?? 200_000);
  try {
    res.json(await remergeGtinCatalog({ apply, limit }));
  } catch (error) {
    if (error instanceof RemergeBusyError) {
      res.status(409).json({ error: error.message, reason: error.reason });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

router.post("/admin/kroger/probe", (req: Request, res: Response) => {
  if (!probeAuthorized(req, res)) return;
  const raw = Number((req.body as { limit?: unknown } | undefined)?.limit ?? KROGER_PROBE_SAFE_LIMIT);
  const limit = Number.isFinite(raw) ? raw : KROGER_PROBE_SAFE_LIMIT;
  const job = startKrogerProbeJob(limit, (n, onProgress) =>
    runKrogerProbe({
      limit: n,
      onProgress,
      client: {
        product: (input) => krogerService.probeProducts({ productId: input.code, locationId: input.locationId }),
        term: (input) => krogerService.probeProducts({ term: input.term, locationId: input.locationId }),
        location: (locationId) => krogerService.probeLocation(locationId),
      },
    })
  );
  res.status(202).json({
    id: job.id,
    status: job.status,
    poll: job.poll,
    safeLimit: job.safeLimit,
  });
});

router.get("/admin/kroger/probe/:id", (req: Request, res: Response) => {
  if (!probeAuthorized(req, res)) return;
  const job = krogerProbeJob(String(req.params.id || ""));
  if (!job) {
    res.status(404).json({ error: "No probe with that id." });
    return;
  }
  res.json(job);
});

router.post("/admin/kroger/diagnose", (req: Request, res: Response) => {
  if (!probeAuthorized(req, res)) return;
  const raw = Number((req.body as { limit?: unknown } | undefined)?.limit ?? KROGER_DIAGNOSE_SAFE_LIMIT);
  const limit = Number.isFinite(raw) ? raw : KROGER_DIAGNOSE_SAFE_LIMIT;
  const job = startKrogerDiagnoseJob(limit, (n, onProgress) =>
    runKrogerDiagnose({
      limit: n,
      onProgress,
      client: {
        term: (input) => krogerService.probeProducts({ term: input.term, locationId: input.locationId }),
        product: (input) => krogerService.probeProducts({ productId: input.code, locationId: input.locationId }),
        productPath: (input) => krogerService.probeProductResource(input.code, input.locationId),
        location: (locationId) => krogerService.probeLocation(locationId),
      },
    })
  );
  res.status(202).json({
    id: job.id,
    status: job.status,
    poll: job.poll,
    safeLimit: job.safeLimit,
  });
});

router.get("/admin/kroger/diagnose/:id", (req: Request, res: Response) => {
  if (!probeAuthorized(req, res)) return;
  const job = krogerDiagnoseJob(String(req.params.id || ""));
  if (!job) {
    res.status(404).json({ error: "No diagnose job with that id." });
    return;
  }
  res.json(job);
});

router.get("/admin/catalog/kroger-misses", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const limit = Math.max(1, Math.min(100, Math.floor(Number(req.query.limit ?? 40))));
  try {
    const rows = await CatalogMaster.find({
      $or: [
        {
          matchKrogerAt: { $type: "date" },
          $or: [{ krogerProductId: { $exists: false } }, { krogerProductId: null }, { krogerProductId: "" }],
        },
        { matchKrogerSkip: "cooldown" },
      ],
    })
      .sort({ matchKrogerAt: -1, updatedAt: -1 })
      .limit(limit)
      .select("name brand departmentId upc matchKrogerCode matchKrogerHttp matchKrogerTerm matchKrogerSkip matchKrogerAt")
      .lean<Array<Record<string, unknown>>>();
    res.json({
      misses: rows.map((row) => ({
        name: String(row.name || ""),
        brand: String(row.brand || ""),
        department: String(row.departmentId || ""),
        upc: String(row.upc || ""),
        productIdSent: String(row.matchKrogerCode || ""),
        httpStatus: typeof row.matchKrogerHttp === "number" ? row.matchKrogerHttp : null,
        termFallback: row.matchKrogerTerm === true,
        cooldownSkip: row.matchKrogerSkip === "cooldown",
        at: row.matchKrogerAt instanceof Date ? row.matchKrogerAt.toISOString() : "",
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

function cooldownStore(value: unknown): CooldownStore {
  return value === "kroger" || value === "walmart" || value === "both" ? value : "both";
}

router.get("/admin/catalog/match-cooldowns", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const limit = Number(req.query.limit ?? 200_000);
  try {
    res.json(await clearMatchCooldowns({ apply: false, store: cooldownStore(req.query.store), limit }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

router.post("/admin/catalog/match-cooldowns", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const body = (req.body ?? {}) as { apply?: unknown; store?: unknown; limit?: unknown };
  const apply = body.apply === true;
  if (apply && !confirmed(req, "clear-match-cooldowns")) {
    res.status(400).json({
      error: 'Send { "apply": true, "confirm": "clear-match-cooldowns" } to clear. Omit apply for a dry run.',
    });
    return;
  }
  const limit = Number(body.limit ?? 200_000);
  try {
    res.json(await clearMatchCooldowns({ apply, store: cooldownStore(body.store), limit }));
  } catch (error) {
    if (error instanceof CooldownBusyError) {
      res.status(409).json({ error: error.message, reason: error.reason });
      return;
    }
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

router.get("/admin/catalog/deactivate-out-of-scope", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) {
    return;
  }
  try {
    res.json(await deactivateOutOfScopeCatalog(false));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

router.post("/admin/catalog/deactivate-out-of-scope", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) {
    return;
  }
  const apply = (req.body as { apply?: unknown } | undefined)?.apply === true;
  try {
    res.json(await deactivateOutOfScopeCatalog(apply));
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
