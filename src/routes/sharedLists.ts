import { Router, type Request, type Response } from "express";
import { subscribeList } from "../lists/hub";
import { requestAuth } from "../auth/middleware";
import { parsePublicId } from "../alerts/watchInput";
import {
  createOrResumeList,
  findPresentedToken,
  readSharedList,
  tagOwnedSharedList,
  updateListSettings,
  writeSharedItems,
} from "../lists/repository";
import { createRateLimiter, hashSecret, isShareToken } from "../lists/sharedList";
import { accessFor } from "../billing/access";
import { paywallBody } from "../billing/http";
import { withinCap } from "../billing/limits";
import { SharedList } from "../models/SharedList";

const router = Router();
const writeLimiter = createRateLimiter({ windowMs: 60_000 });
const createLimiter = createRateLimiter({ windowMs: 10 * 60_000 });

function limitFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
}

function clientAddress(req: Request): string {
  return (req.ip || req.socket.remoteAddress || "local").slice(0, 80);
}

function ownerTokenFrom(req: Request): string | undefined {
  const header = req.header("x-list-owner")?.trim();
  return header || undefined;
}

function readSince(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function tooMany(res: Response, message = "Too many list edits. Wait a moment and try again."): void {
  res.setHeader("Retry-After", "60");
  res.status(429).json({ error: message });
}

async function sharedListCreateAllowed(
  res: Response,
  deviceIdRaw: unknown,
  ownerToken: unknown
): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await accessFor(res);
  const cap = access.limits.sharedLists;
  if (cap === 0) return { ok: true };
  if (typeof ownerToken === "string" && isShareToken(ownerToken)) {
    const existing = await SharedList.exists({ ownerTokenHash: hashSecret(ownerToken) });
    if (existing) return { ok: true };
  }
  const accountId = requestAuth(res)?.accountId;
  const noun = cap === 1 ? "1 shared list" : `${cap} shared lists`;
  const message = `The free plan includes ${noun}. Grocery Gitter Pro includes unlimited shared lists.`;
  if (accountId) {
    const count = await SharedList.countDocuments({ accountId, revokedAt: null });
    return withinCap(count, cap) ? { ok: true } : { ok: false, error: message };
  }
  const deviceId = parsePublicId(deviceIdRaw);
  if (!deviceId) {
    return { ok: false, error: "Send deviceId to create a shared list, or sign in to Grocery Gitter Pro." };
  }
  const count = await SharedList.countDocuments({ ownerDeviceId: deviceId, revokedAt: null });
  return withinCap(count, cap) ? { ok: true } : { ok: false, error: message };
}

function allowWrite(req: Request, shareToken: string): boolean {
  const address = clientAddress(req);
  const perIp = writeLimiter.allow(`ip:${address}`, limitFromEnv("LIST_WRITE_IP_LIMIT", 120));
  const perList = writeLimiter.allow(`list:${hashSecret(shareToken)}`, limitFromEnv("LIST_WRITE_LIMIT", 60));
  return perIp && perList;
}

router.post("/lists", async (req, res) => {
  if (!createLimiter.allow(`create:${clientAddress(req)}`, limitFromEnv("LIST_CREATE_LIMIT", 30))) {
    tooMany(res, "Too many new lists. Wait a moment and try again.");
    return;
  }
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    res.status(400).json({ error: "Send a JSON object." });
    return;
  }
  const body = req.body as Record<string, unknown>;
  try {
    const allowed = await sharedListCreateAllowed(res, body.deviceId, body.ownerToken);
    if (!allowed.ok) {
      res.status(402).json(paywallBody(allowed.error, "sharedLists"));
      return;
    }
    const result = await createOrResumeList({
      ownerToken: body.ownerToken,
      shareToken: body.shareToken,
      title: body.title,
      displayName: body.displayName,
      items: body.items,
      rotate: body.rotate,
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    const accountId = requestAuth(res)?.accountId;
    const ownerDeviceId = parsePublicId(body.deviceId) ?? undefined;
    if (accountId || ownerDeviceId) {
      await tagOwnedSharedList({
        shareToken: result.shareToken,
        ownerToken: result.ownerToken,
        ...(accountId ? { accountId } : {}),
        ...(ownerDeviceId ? { ownerDeviceId } : {}),
      });
    }
    res.status(result.created ? 201 : 200).json({
      shareToken: result.shareToken,
      ownerToken: result.ownerToken,
      list: result.list,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`Shared list create failed: ${message}`);
    res.status(500).json({ error: "The list could not be saved." });
  }
});

router.get("/lists/:shareToken/events", async (req, res) => {
  const shareToken = req.params.shareToken;
  if (!isShareToken(shareToken)) {
    res.status(404).json({ error: "No list for that link." });
    return;
  }
  const found = await findPresentedToken(shareToken);
  if (found.kind === "retired") {
    res.status(410).json({ error: "This link was turned off." });
    return;
  }
  if (found.kind !== "list") {
    res.status(404).json({ error: "No list for that link." });
    return;
  }
  if (found.record.revokedAt) {
    res.status(410).json({ error: "This link was turned off." });
    return;
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (seq: number) => {
    res.write(`event: list\ndata: ${JSON.stringify({ seq })}\n\n`);
  };
  send(found.record.seq);
  const unsubscribe = subscribeList(found.record.shareTokenHash, send);
  if (!unsubscribe) {
    res.end();
    return;
  }
  const heartbeat = setInterval(() => {
    res.write(": ping\n\n");
  }, 15_000);
  const close = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on("close", close);
});

router.patch("/lists/:shareToken/items", async (req, res) => {
  const shareToken = req.params.shareToken;
  if (!isShareToken(shareToken)) {
    res.status(404).json({ error: "No list for that link." });
    return;
  }
  if (!allowWrite(req, shareToken)) {
    tooMany(res);
    return;
  }
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    res.status(400).json({ error: "Send a JSON object." });
    return;
  }
  const body = req.body as Record<string, unknown>;
  try {
    const result = await writeSharedItems({
      shareToken,
      ownerToken: ownerTokenFrom(req),
      displayName: body.displayName,
      items: body.items,
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json(result.list);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`Shared list edit failed: ${message}`);
    res.status(500).json({ error: "The list could not be saved." });
  }
});

router.post("/lists/:shareToken/settings", async (req, res) => {
  const shareToken = req.params.shareToken;
  if (!isShareToken(shareToken)) {
    res.status(404).json({ error: "No list for that link." });
    return;
  }
  if (!allowWrite(req, shareToken)) {
    tooMany(res);
    return;
  }
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    res.status(400).json({ error: "Send a JSON object." });
    return;
  }
  const body = req.body as Record<string, unknown>;
  try {
    const result = await updateListSettings({
      shareToken,
      ownerToken: ownerTokenFrom(req),
      mode: body.mode,
      revoke: body.revoke,
      rotate: body.rotate,
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ shareToken: result.shareToken, list: result.list });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`Shared list settings failed: ${message}`);
    res.status(500).json({ error: "The list could not be saved." });
  }
});

router.get("/lists/:shareToken", async (req, res) => {
  const shareToken = req.params.shareToken;
  if (!isShareToken(shareToken)) {
    res.status(404).json({ error: "No list for that link." });
    return;
  }
  try {
    const result = await readSharedList(shareToken, ownerTokenFrom(req), readSince(req.query.since));
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json(result.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`Shared list read failed: ${message}`);
    res.status(500).json({ error: "The list could not be loaded." });
  }
});

export default router;
