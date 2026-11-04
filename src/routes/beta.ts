import { Router, type Request } from "express";
import { betaAdminOk } from "../beta/adminAuth";
import {
  acceptProductEvent,
  adminCodeFilter,
  eventSummary,
  feedbackCsv,
  inviteCodes,
  listFeedback,
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

router.get("/beta/gate", (_req, res) => {
  res.json({ required: inviteCodes().length > 0 });
});

router.post("/beta/invite", async (req, res) => {
  const result = await redeemInvite(req, res);
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
