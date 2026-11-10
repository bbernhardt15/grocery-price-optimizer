import { Router, type Request } from "express";
import { versionPayload } from "../buildInfo";
import { betaAdminOk } from "../beta/adminAuth";
import {
  acceptProductEvent,
  adminCodeFilter,
  eventSummary,
  feedbackCsv,
  listFeedback,
  readFeedbackShot,
  readyPayload,
  recordClientError,
  redeemInvite,
  signupSummary,
  submitFeedback,
} from "../beta/service";

function requestedCode(req: Request): string {
  return adminCodeFilter(req.query.code);
}

const router = Router();

router.get("/health/ready", (_req, res) => {
  const ready = readyPayload();
  res.status(ready.status).json(ready.body);
});

router.get("/version", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(versionPayload());
});

router.get("/beta/gate", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ required: false });
});

router.post("/beta/invite", async (req, res) => {
  const result = await redeemInvite(req, res);
  res.setHeader("Cache-Control", "no-store");
  res.status(result.status).json(result.body);
});

router.post("/beta/feedback", async (req, res) => {
  const result = await submitFeedback(req, res);
  res.status(result.status).json(result.body);
});

router.post("/beta/events", async (req, res) => {
  const result = await acceptProductEvent(req);
  res.status(result.status).json(result.body);
});

router.post("/beta/client-errors", async (req, res) => {
  const result = await recordClientError(req);
  res.status(result.status).json(result.body);
});

router.get("/admin/beta/feedback/:id/shots/:index", async (req, res) => {
  if (!betaAdminOk(req, res)) return;
  const shot = await readFeedbackShot(req.params.id, Number(req.params.index));
  if (!shot) {
    res.status(404).json({ error: "That screenshot is not on this note." });
    return;
  }
  res.setHeader("Content-Type", shot.mimeType);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(shot.data);
});

router.get("/admin/beta/feedback", async (req, res) => {
  if (!betaAdminOk(req, res)) return;
  const limit = Number(req.query.limit);
  res.json(await listFeedback(Number.isFinite(limit) ? limit : 50, requestedCode(req)));
});

router.get("/admin/beta/feedback.csv", async (req, res) => {
  if (!betaAdminOk(req, res)) return;
  const csv = await feedbackCsv(2000, requestedCode(req));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="grocery-gitter-feedback.csv"');
  res.send(csv);
});

router.get("/admin/beta/signups", async (req, res) => {
  if (!betaAdminOk(req, res)) return;
  res.json(await signupSummary(requestedCode(req)));
});

router.get("/admin/beta/events", async (req, res) => {
  if (!betaAdminOk(req, res)) return;
  res.json(await eventSummary(requestedCode(req)));
});

export default router;
