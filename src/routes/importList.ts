import { timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { requestAuth } from "../auth/middleware";
import { loadKnownProducts } from "../catalog/service";
import { createRateLimiter } from "../lists/sharedList";
import { parseModelJson, validateAiItems } from "../import/aiSchema";
import { importBudget } from "../import/budget";
import { importConfig } from "../import/config";
import { constraintNote } from "../import/constraints";
import { readSharedLink } from "../import/linkFetch";
import { matchImportItems, type ImportMatchResult } from "../import/matchImport";
import { IMPORT_MESSAGES, KROGER_HISTORY_REASON } from "../import/messages";
import { visionDetail } from "../import/imageDetail";
import { mapPool } from "../import/pool";
import { rasterizePdf } from "../import/pdfRaster";
import { extractPdfText } from "../import/pdfText";
import { analyzeReceipt, applyCatalogBrands, learnReceiptLines, receiptFromVision, relearnReceipt, type ReceiptAnalysis, type ReceiptLine } from "../import/receiptLearn";
import { parseImportText, type ParsedImportItem } from "../import/parseImportText";
import { contentHash, readReceiptCache, resetReceiptCache, writeReceiptCache } from "../import/receiptCache";
import { parseCouponVision } from "../import/couponVision";
import { aiAsk, aiParseText, aiReadCoupon, aiReadImage, aiReadShelf, ModelError, probeVision, transcribeAudio } from "../import/providers";
import { parseShelfScan } from "../import/shelfScan";
import { setImportRuntime } from "../import/runtime";
import { NOT_IN_SERVICE_AREA_CODE, OUT_OF_AREA_MESSAGE, PLAN_ZIP_ERROR, requirePlanZip } from "../serviceArea";

const router = Router();
const limiter = createRateLimiter({ windowMs: 10 * 60_000 });

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/ogg",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
  "video/webm",
]);

const MAX_TEXT = 50_000;
const VISION_CONCURRENCY = 6;
const MAX_IMAGE = 4_000_000;
const MAX_AUDIO = 8_000_000;
const MAX_PDF = 8_000_000;

export function resetImportForTests(): void {
  limiter.reset();
  photoBursts.clear();
  importBudget.reset();
  resetReceiptCache();
  setImportRuntime(null);
}

function clientKey(req: Request, res: Response): string {
  const account = requestAuth(res)?.accountId;
  if (account) return `acct:${account}`;
  const device = String(req.get("x-device-id") || "").trim();
  if (/^[A-Za-z0-9_-]{8,80}$/.test(device)) return `dev:${device}`;
  return `ip:${req.ip || "unknown"}`;
}

function allowed(req: Request, res: Response): boolean {
  const limit = importConfig().rateLimit;
  if (limit === 0) return true;
  return limiter.allow(clientKey(req, res), limit);
}

function tooFast(res: Response): void {
  res.status(429).json({ error: IMPORT_MESSAGES.rate });
}

/** Several photos from one tap are one list, not a burst of lists. */
const photoBursts = new Map<string, { at: number; used: number }>();
const PHOTO_BURST = 16;
const PHOTO_BURST_MS = 15_000;

function allowPhotoBatch(req: Request, res: Response): boolean {
  const key = clientKey(req, res);
  const now = Date.now();
  const current = photoBursts.get(key);
  if (current && now - current.at < PHOTO_BURST_MS && current.used < PHOTO_BURST) {
    current.used += 1;
    return true;
  }
  if (!allowed(req, res)) return false;
  photoBursts.set(key, { at: now, used: 1 });
  return true;
}

async function review(items: ParsedImportItem[]): Promise<ImportMatchResult> {
  const upcs = items.map((item) => item.upc || "").filter(Boolean);
  const products = await loadKnownProducts({
    queries: items.map((item) => item.name).slice(0, 24),
    ...(upcs.length ? { upcs } : {}),
  });
  return matchImportItems(items, products);
}

function shelfHttp(error: unknown): { status: number; error: string; code: string } {
  const failure = error instanceof ModelError ? error.failure : "upstream";
  const http = error instanceof ModelError ? error.status : null;
  console.error(`Shelf photo failed (code=${failure} status=${http ?? "none"})`);
  if (failure === "unauthorized") return { status: 502, error: IMPORT_MESSAGES.shelfUnauthorized, code: "unauthorized" };
  if (failure === "too_large") return { status: 413, error: IMPORT_MESSAGES.shelfTooLarge, code: "too_large" };
  if (failure === "timeout") return { status: 504, error: IMPORT_MESSAGES.shelfTimeout, code: "timeout" };
  if (failure === "unreadable" || failure === "empty") return { status: 422, error: IMPORT_MESSAGES.shelfEmpty, code: "unreadable" };
  return { status: 502, error: IMPORT_MESSAGES.shelfUpstream, code: "upstream" };
}

function visionHttp(error: unknown): { status: number; error: string; code: string } {
  const failure = error instanceof ModelError ? error.failure : "upstream";
  const upstream = error instanceof ModelError ? error.upstream : "";
  const http = error instanceof ModelError ? error.status : null;
  console.error(`Import photo failed (code=${failure} status=${http ?? "none"} upstream=${upstream || "none"})`);
  if (failure === "unauthorized") return { status: 502, error: IMPORT_MESSAGES.visionUnauthorized, code: "unauthorized" };
  if (failure === "too_large") return { status: 413, error: IMPORT_MESSAGES.visionTooLarge, code: "too_large" };
  if (failure === "timeout") return { status: 504, error: IMPORT_MESSAGES.visionTimeout, code: "timeout" };
  if (failure === "unreadable" || failure === "empty") return { status: 422, error: IMPORT_MESSAGES.visionUnreadable, code: "unreadable" };
  return { status: 502, error: IMPORT_MESSAGES.visionUpstream, code: "upstream" };
}

function linesToItems(lines: ReceiptLine[]): ParsedImportItem[] {
  return lines.map((line) => ({
    raw: line.raw || line.name,
    name: line.name,
    quantity: line.quantity,
    ...(line.brand ? { brand: line.brand } : {}),
    ...(line.size ? { size: line.size } : {}),
    ...(line.upc ? { upc: line.upc } : {}),
  }));
}

async function withCatalogBrands(analysis: ReceiptAnalysis): Promise<ReceiptAnalysis> {
  const upcs = analysis.lines.map((line) => line.upc).filter(Boolean);
  if (!upcs.length) return analysis;
  const started = Date.now();
  const products = await loadKnownProducts({ upcs });
  const lines = applyCatalogBrands(analysis.lines, products);
  const matchMs = Date.now() - started;
  if (lines === analysis.lines) {
    console.info(`receipt stage=match ms=${matchMs} upc=${upcs.length} branded=0`);
    return analysis;
  }
  const next = relearnReceipt(lines);
  console.info(`receipt stage=match ms=${matchMs} upc=${upcs.length} branded=${next.lines.filter((line) => line.brand).length}`);
  return next;
}

function mergeReceipts(parts: ReceiptAnalysis[]): ReceiptAnalysis | null {
  const lines = parts.flatMap((part) => part.lines || []);
  if (!lines.length) return null;
  return learnReceiptLines(lines);
}

function visionAdminOk(req: Request, res: Response): boolean {
  const expected = [process.env.GG_ADMIN_TOKEN, process.env.ADMIN_TOKEN].map((value) => value?.trim() || "").filter(Boolean);
  if (!expected.length) {
    res.status(503).json({ error: "Set GG_ADMIN_TOKEN to check the vision key." });
    return false;
  }
  const header = req.header("authorization") ?? req.header("x-admin-token") ?? "";
  const presented = header.replace(/^Bearer\s+/i, "").trim();
  const ok = expected.some((token) => {
    const left = Buffer.from(presented);
    const right = Buffer.from(token);
    return left.length === right.length && timingSafeEqual(left, right);
  });
  if (!ok) {
    res.status(401).json({ error: "Admin token required." });
    return false;
  }
  return true;
}

function itemsFromModel(text: string): ParsedImportItem[] | null {
  try {
    const valid = validateAiItems(parseModelJson(text));
    return valid.ok ? valid.items : null;
  } catch {
    return null;
  }
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

type ImportPriceMode = "priced" | "names";

/**
 * Store offers are returned only for an in-area ZIP.
 * A missing ZIP stays on names (a receipt line may keep price: null).
 * A malformed ZIP is 400. An out-of-area ZIP is 422.
 */
function importPriceMode(body: unknown): ImportPriceMode | "invalid" | "out" {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "names";
  const record = body as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, "zipCode") && !Object.prototype.hasOwnProperty.call(record, "zip")) {
    return "names";
  }
  const raw = record.zipCode !== undefined ? record.zipCode : record.zip;
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) return "names";
  const decision = requirePlanZip(raw);
  if (decision.ok) return "priced";
  return decision.status === 422 ? "out" : "invalid";
}

function refuseImportZip(res: Response, mode: ImportPriceMode | "invalid" | "out"): mode is "invalid" | "out" {
  if (mode === "invalid") {
    res.status(400).json({ error: PLAN_ZIP_ERROR });
    return true;
  }
  if (mode === "out") {
    res.status(422).json({ error: OUT_OF_AREA_MESSAGE, code: NOT_IN_SERVICE_AREA_CODE });
    return true;
  }
  return false;
}

const PRICE_NULL_KEYS = new Set(["price", "regularPrice", "unitPrice", "priceFrom", "priceTo", "unitPriceText"]);
const PRICE_DROP_KEYS = new Set(["offers", "bestOffer", "bestPrice", "bestStore", "storeName", "store"]);

function redactStorePrices(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactStorePrices(entry));
  if (typeof value === "string") return value.replace(/\$\s?\d+(?:\.\d{1,2})?/g, "").replace(/ {2,}/g, " ").trim();
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (PRICE_DROP_KEYS.has(key)) continue;
    if (PRICE_NULL_KEYS.has(key)) {
      out[key] = null;
      continue;
    }
    out[key] = redactStorePrices(entry);
  }
  return out;
}

function sendImport(res: Response, body: unknown, mode: ImportPriceMode): void {
  res.json(mode === "priced" ? body : redactStorePrices(body));
}

function decodeBase64(value: unknown, max: number): Buffer | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/^data:[^,]*,/, "").replace(/\s/g, "");
  if (!cleaned || cleaned.length > Math.ceil((max * 4) / 3) + 64) return null;
  const buffer = Buffer.from(cleaned, "base64");
  if (!buffer.length || buffer.length > max) return null;
  return buffer;
}

type ReadResult = {
  match: ImportMatchResult;
  parser: "rules" | "ai";
  aiFallback: boolean;
  paused: boolean;
  suggested?: boolean;
};

async function interpret(text: string, key: string, allowAi: boolean): Promise<ReadResult> {
  const config = importConfig();
  if (allowAi && config.ai) {
    const budget = importBudget.take(key, config.dailyLimit, config.globalDailyCap);
    if (!budget.ok) {
      return { match: await review(parseImportText(text)), parser: "rules" as const, aiFallback: true, paused: true };
    }
    try {
      const modeled = itemsFromModel(await aiParseText(text));
      if (modeled?.length) {
        return { match: await review(modeled), parser: "ai" as const, aiFallback: false, paused: false };
      }
    } catch (error) {
      const status = error instanceof ModelError ? error.message : "failed";
      console.error(`Import parse used the built-in reader (${status})`);
    }
    return { match: await review(parseImportText(text)), parser: "rules" as const, aiFallback: true, paused: false };
  }
  return { match: await review(parseImportText(text)), parser: "rules" as const, aiFallback: false, paused: false };
}

function receiptFor(text: string): ReturnType<typeof analyzeReceipt> | null {
  try {
    const receipt = analyzeReceipt(text);
    return receipt.lines.length ? receipt : null;
  } catch {
    return null;
  }
}

function sendMatch(
  res: Response,
  result: Awaited<ReturnType<typeof interpret>>,
  extra: Record<string, unknown> = {},
  mode: ImportPriceMode = "names"
): void {
  if (!result.match.items.length) {
    const payload = { error: IMPORT_MESSAGES.empty, parser: result.parser, ...extra };
    res.status(422).json(mode === "priced" ? payload : redactStorePrices(payload));
    return;
  }
  sendImport(
    res,
    {
      ...result.match,
      parser: result.parser,
      aiFallback: result.aiFallback,
      paused: result.paused,
      ...(result.suggested ? { suggested: true } : {}),
      ...extra,
    },
    mode
  );
}

router.get("/health", (_req, res) => {
  const config = importConfig();
  res.json({
    ai: config.ai,
    vision: config.photo,
    speech: config.speech,
  });
});

router.get("/admin/vision", async (req, res) => {
  if (!visionAdminOk(req, res)) return;
  const probe = await probeVision();
  res.status(probe.configured ? 200 : 503).json(probe);
});

router.get("/import/status", (_req, res) => {
  const config = importConfig();
  res.setHeader("Cache-Control", "no-store");
  res.json({
    paste: true,
    file: true,
    link: true,
    photo: config.photo,
    vision: config.photo,
    shelf: config.photo,
    speech: config.speech,
    ai: config.ai,
    ask: config.ask,
    krogerHistory: false,
    krogerHistoryReason: KROGER_HISTORY_REASON,
    dailyLimit: config.dailyLimit,
    globalDailyCap: config.globalDailyCap,
  });
});

router.post("/import/text", async (req, res) => {
  if (!allowed(req, res)) return tooFast(res);
  const priceMode = importPriceMode(req.body);
  if (refuseImportZip(res, priceMode)) return;
  const text = readText(req.body?.text);
  if (!text.trim()) {
    res.status(400).json({ error: IMPORT_MESSAGES.textMissing });
    return;
  }
  if (text.length > MAX_TEXT) {
    res.status(400).json({ error: IMPORT_MESSAGES.tooLong });
    return;
  }
  const allowAi = req.body?.preferAi !== false;
  const receipt = receiptFor(text);
  sendMatch(res, await interpret(text, clientKey(req, res), allowAi), receipt ? { receipt } : {}, priceMode);
});

router.post("/import/file", async (req, res) => {
  if (!allowed(req, res)) return tooFast(res);
  const priceMode = importPriceMode(req.body);
  if (refuseImportZip(res, priceMode)) return;
  const text = readText(req.body?.text);
  if (!text.trim()) {
    res.status(400).json({ error: IMPORT_MESSAGES.textMissing });
    return;
  }
  if (text.length > MAX_TEXT) {
    res.status(400).json({ error: IMPORT_MESSAGES.tooLong });
    return;
  }
  const receipt = receiptFor(text);
  sendMatch(res, await interpret(text, clientKey(req, res), req.body?.preferAi === true), receipt ? { receipt } : {}, priceMode);
});

router.post("/import/photo", async (req, res) => {
  const priceMode = importPriceMode(req.body);
  if (refuseImportZip(res, priceMode)) return;
  const config = importConfig();
  if (!config.photo) {
    res.status(503).json({ error: IMPORT_MESSAGES.photoOff, code: "unconfigured" });
    return;
  }
  if (!allowPhotoBatch(req, res)) return tooFast(res);
  const mimeType = readText(req.body?.mimeType).toLowerCase() || "image/jpeg";
  if (!IMAGE_TYPES.has(mimeType)) {
    res.status(400).json({ error: IMPORT_MESSAGES.badImage });
    return;
  }
  const image = decodeBase64(req.body?.imageBase64, MAX_IMAGE);
  if (!image) {
    res.status(400).json({ error: IMPORT_MESSAGES.tooBig, code: "too_large" });
    return;
  }
  const photoKey = `photo:${contentHash(image)}`;
  const cachedPhoto = readReceiptCache(photoKey);
  if (cachedPhoto) {
    console.info(`receipt stage=photo cache=hit ms=0 bytes=${image.length}`);
    sendImport(res, cachedPhoto, priceMode);
    return;
  }
  const budget = importBudget.take(clientKey(req, res), config.dailyLimit, config.globalDailyCap);
  if (!budget.ok) {
    res.status(429).json({ error: IMPORT_MESSAGES.daily });
    return;
  }
  const started = Date.now();
  try {
    const detail = visionDetail(image);
    const extracted = await aiReadImage(image.toString("base64"), mimeType, process.env, { detail });
    console.info(`receipt stage=photo detail=${detail} ms=${Date.now() - started} bytes=${image.length}`);
    let visionReceipt = receiptFromVision(extracted);
    if (visionReceipt?.lines.some((line) => line.upc)) visionReceipt = await withCatalogBrands(visionReceipt);
    const modeled = itemsFromModel(extracted);
    const withUpc = Boolean(visionReceipt?.lines.some((line) => line.upc));
    const items = withUpc && visionReceipt ? linesToItems(visionReceipt.lines) : modeled ?? parseImportText(extracted);
    const match = await review(items);
    let receipt = (withUpc ? visionReceipt : null) ?? visionReceipt ?? receiptFor(extracted);
    if (receipt?.lines.some((line) => line.upc) && receipt !== visionReceipt) receipt = await withCatalogBrands(receipt);
    if (!match.items.length && !receipt?.lines.length) {
      res.status(422).json({ error: IMPORT_MESSAGES.visionUnreadable, code: "unreadable" });
      return;
    }
    if (!match.items.length && receipt?.lines.length) {
      writeReceiptCache(photoKey, receipt);
      sendImport(res, receipt, priceMode);
      return;
    }
    const body = {
      ...match,
      parser: modeled && !withUpc ? "ai" : withUpc ? "rules" : "rules",
      aiFallback: false,
      paused: false,
      ...(receipt?.lines.length ? { receipt } : {}),
    };
    writeReceiptCache(photoKey, body);
    sendImport(res, body, priceMode);
  } catch (error) {
    const mapped = visionHttp(error);
    res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
  }
});

router.post("/import/coupon", async (req, res) => {
  if (!allowed(req, res)) return tooFast(res);
  const priceMode = importPriceMode(req.body);
  if (refuseImportZip(res, priceMode)) return;
  const config = importConfig();
  if (!config.photo) {
    res.status(503).json({ error: IMPORT_MESSAGES.photoOff, code: "unconfigured" });
    return;
  }
  const mimeType = readText(req.body?.mimeType).toLowerCase() || "image/jpeg";
  if (!IMAGE_TYPES.has(mimeType)) {
    res.status(400).json({ error: IMPORT_MESSAGES.badImage, code: "unreadable" });
    return;
  }
  const image = decodeBase64(req.body?.imageBase64, MAX_IMAGE);
  if (!image) {
    res.status(400).json({ error: IMPORT_MESSAGES.tooBig, code: "too_large" });
    return;
  }
  const budget = importBudget.take(clientKey(req, res), config.dailyLimit, config.globalDailyCap);
  if (!budget.ok) {
    res.status(429).json({ error: IMPORT_MESSAGES.daily, code: "daily" });
    return;
  }
  const started = Date.now();
  try {
    const detail = visionDetail(image);
    const extracted = await aiReadCoupon(image.toString("base64"), mimeType, process.env, { detail });
    const coupon = parseCouponVision(extracted);
    console.info(`coupon stage=photo detail=${detail} ms=${Date.now() - started} bytes=${image.length} gaps=${coupon.gaps.join(",") || "none"}`);
    sendImport(res, { coupon, source: "screenshot" }, priceMode);
  } catch (error) {
    const mapped = visionHttp(error);
    res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
  }
});

router.post("/import/shelf", async (req, res) => {
  if (!allowed(req, res)) return tooFast(res);
  const priceMode = importPriceMode(req.body);
  if (refuseImportZip(res, priceMode)) return;
  const config = importConfig();
  if (!config.photo) {
    res.status(503).json({ error: IMPORT_MESSAGES.shelfOff, code: "unconfigured" });
    return;
  }
  const mimeType = readText(req.body?.mimeType).toLowerCase() || "image/jpeg";
  if (!IMAGE_TYPES.has(mimeType)) {
    res.status(400).json({ error: IMPORT_MESSAGES.badImage, code: "unreadable" });
    return;
  }
  const image = decodeBase64(req.body?.imageBase64, MAX_IMAGE);
  if (!image) {
    res.status(400).json({ error: IMPORT_MESSAGES.shelfTooLarge, code: "too_large" });
    return;
  }
  const budget = importBudget.take(clientKey(req, res), config.dailyLimit, config.globalDailyCap);
  if (!budget.ok) {
    res.status(429).json({ error: IMPORT_MESSAGES.daily, code: "daily" });
    return;
  }
  const started = Date.now();
  try {
    const detail = visionDetail(image);
    const extracted = await aiReadShelf(image.toString("base64"), mimeType, process.env, { detail });
    const items = parseShelfScan(extracted);
    console.info(
      `shelf stage=photo detail=${detail} ms=${Date.now() - started} bytes=${image.length} items=${items.length} model=${config.visionModel}`
    );
    if (!items.length) {
      res.status(422).json({ error: IMPORT_MESSAGES.shelfEmpty, code: "empty" });
      return;
    }
    sendImport(res, { items }, priceMode);
  } catch (error) {
    const mapped = shelfHttp(error);
    res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
  }
});

router.post("/import/audio", async (req, res) => {
  if (!allowed(req, res)) return tooFast(res);
  const priceMode = importPriceMode(req.body);
  if (refuseImportZip(res, priceMode)) return;
  const config = importConfig();
  if (!config.speech) {
    res.status(503).json({ error: IMPORT_MESSAGES.speechOff, code: "unconfigured" });
    return;
  }
  const duration = Number(req.body?.durationSec);
  if (Number.isFinite(duration) && duration > 90) {
    res.status(400).json({ error: IMPORT_MESSAGES.tooLongAudio });
    return;
  }
  const mimeType = readText(req.body?.mimeType).toLowerCase() || "audio/webm";
  if (!AUDIO_TYPES.has(mimeType)) {
    res.status(400).json({ error: IMPORT_MESSAGES.badAudio });
    return;
  }
  const audio = decodeBase64(req.body?.audioBase64, MAX_AUDIO);
  if (!audio) {
    res.status(400).json({ error: IMPORT_MESSAGES.tooBig });
    return;
  }
  const budget = importBudget.take(clientKey(req, res), config.dailyLimit, config.globalDailyCap);
  if (!budget.ok) {
    res.status(429).json({ error: IMPORT_MESSAGES.daily });
    return;
  }
  try {
    const transcript = await transcribeAudio(audio, mimeType);
    if (!transcript.trim()) {
      res.status(422).json({ error: IMPORT_MESSAGES.empty });
      return;
    }
    sendImport(res, { transcript }, priceMode);
  } catch (error) {
    const status = error instanceof ModelError ? error.message : "failed";
    console.error(`Import voice failed (${status})`);
    res.status(502).json({ error: IMPORT_MESSAGES.generic });
  }
});

router.post("/import/link", async (req, res) => {
  if (!allowed(req, res)) return tooFast(res);
  const priceMode = importPriceMode(req.body);
  if (refuseImportZip(res, priceMode)) return;
  const url = readText(req.body?.url);
  if (!url.trim()) {
    res.status(400).json({ error: IMPORT_MESSAGES.urlMissing });
    return;
  }
  const read = await readSharedLink(url);
  if (!read.ok) {
    res.status(422).json({ error: read.code === "signin" ? IMPORT_MESSAGES.linkHidden : IMPORT_MESSAGES.linkUnread });
    return;
  }
  const text = read.text.slice(0, MAX_TEXT);
  sendMatch(res, await interpret(text, clientKey(req, res), false), {}, priceMode);
});

router.post("/import/ask", async (req, res) => {
  if (!allowed(req, res)) return tooFast(res);
  const priceMode = importPriceMode(req.body);
  if (refuseImportZip(res, priceMode)) return;
  const goal = readText(req.body?.goal).trim();
  if (!goal) {
    res.status(400).json({ error: IMPORT_MESSAGES.goalMissing });
    return;
  }
  if (goal.length > 400) {
    res.status(400).json({ error: IMPORT_MESSAGES.tooLong });
    return;
  }
  const config = importConfig();
  if (!config.ask) {
    res.status(503).json({ error: IMPORT_MESSAGES.askOff, code: "unconfigured" });
    return;
  }
  const budget = importBudget.take(clientKey(req, res), config.dailyLimit, config.globalDailyCap);
  if (!budget.ok) {
    res.status(429).json({ error: IMPORT_MESSAGES.daily });
    return;
  }
  try {
    const items = itemsFromModel(await aiAsk(goal, process.env, constraintNote(req.body?.constraints)));
    if (!items?.length) {
      res.status(502).json({ error: IMPORT_MESSAGES.askFailed });
      return;
    }
    const match = await review(items);
    sendImport(res, { ...match, parser: "ai", suggested: true, aiFallback: false, paused: false }, priceMode);
  } catch (error) {
    const status = error instanceof ModelError ? error.message : "failed";
    console.error(`Import suggestions failed (${status})`);
    res.status(502).json({ error: IMPORT_MESSAGES.askFailed });
  }
});

router.post("/import/receipt", async (req, res) => {
  if (!allowed(req, res)) return tooFast(res);
  const priceMode = importPriceMode(req.body);
  if (refuseImportZip(res, priceMode)) return;
  const text = readText(req.body?.text).slice(0, MAX_TEXT);
  const lines = Array.isArray(req.body?.lines) ? req.body.lines : null;
  const analysis = lines ? learnReceiptLines(lines) : text.trim() ? analyzeReceipt(text) : null;
  if (!analysis) {
    res.status(400).json({ error: IMPORT_MESSAGES.textMissing });
    return;
  }
  if (!analysis.lines.length) {
    res.status(422).json({ error: IMPORT_MESSAGES.empty, paper: analysis.paper, paperNote: analysis.paperNote });
    return;
  }
  sendImport(res, analysis, priceMode);
});

router.post("/import/pdf", async (req, res) => {
  if (!allowed(req, res)) return tooFast(res);
  const priceMode = importPriceMode(req.body);
  if (refuseImportZip(res, priceMode)) return;
  const pdf = decodeBase64(req.body?.pdfBase64, MAX_PDF);
  if (!pdf) {
    res.status(400).json({ error: IMPORT_MESSAGES.tooBig });
    return;
  }
  const stream = req.body?.progress === true;
  let streaming = false;
  const emit = (event: Record<string, unknown>) => {
    if (!stream) return;
    if (!streaming) {
      streaming = true;
      res.status(200);
      res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
      res.setHeader("cache-control", "no-cache, no-transform");
      res.setHeader("x-accel-buffering", "no");
    }
    res.write(`${JSON.stringify(event)}\n`);
  };
  const finish = (analysis: ReceiptAnalysis) => {
    const payload = (priceMode === "priced" ? analysis : redactStorePrices(analysis)) as ReceiptAnalysis;
    if (streaming) {
      emit({ type: "result", analysis: payload });
      res.end();
      return;
    }
    res.json(payload);
  };
  const fail = (status: number, error: string, code: string) => {
    if (streaming) {
      emit({ type: "error", error, code });
      res.end();
      return;
    }
    res.status(status).json({ error, ...(code ? { code } : {}) });
  };

  const pdfKey = `pdf:${contentHash(pdf)}`;
  const cachedPdf = readReceiptCache(pdfKey);
  if (cachedPdf && typeof cachedPdf === "object") {
    emit({ type: "progress", stage: "done", message: "Already read this file.", ratio: 1 });
    finish(cachedPdf as Parameters<typeof finish>[0]);
    return;
  }
  const started = Date.now();
  emit({ type: "progress", stage: "preparing", message: "Preparing…", ratio: 0.08 });
  const textStarted = Date.now();
  const text = extractPdfText(pdf).slice(0, MAX_TEXT);
  const textMs = Date.now() - textStarted;
  const fromText = text ? analyzeReceipt(text) : null;
  if (fromText?.lines.length) {
    emit({ type: "progress", stage: "matching", message: "Matching brands…", ratio: 0.72 });
    const analysis = await withCatalogBrands(fromText);
    console.info(
      `receipt stage=pdf-text ms=${textMs} lines=${analysis.lines.length} upc=${analysis.lines.filter((line) => line.upc).length} vision=0 total=${Date.now() - started}`
    );
    writeReceiptCache(pdfKey, analysis);
    finish(analysis);
    return;
  }

  const rasterStarted = Date.now();
  const slices = await rasterizePdf(pdf);
  const rasterMs = Date.now() - rasterStarted;
  if (!slices.length) {
    console.info(`receipt stage=pdf-raster ms=${rasterMs} slices=0 total=${Date.now() - started}`);
    fail(422, IMPORT_MESSAGES.pdfNoRaster, "no_raster");
    return;
  }
  const config = importConfig();
  if (!config.photo) {
    fail(503, IMPORT_MESSAGES.pdfNeedsVision, "unconfigured");
    return;
  }
  const budget = importBudget.take(clientKey(req, res), config.dailyLimit, config.globalDailyCap);
  if (!budget.ok) {
    fail(429, IMPORT_MESSAGES.daily, "");
    return;
  }
  try {
    let finished = 0;
    let detailHigh = 0;
    let detailLow = 0;
    const visionStarted = Date.now();
    const pageCount = new Set(slices.map((slice) => slice.page)).size || 1;
    const reportPage = (page: number, doneCount: number) => {
      emit({
        type: "progress",
        stage: "reading",
        page,
        pages: pageCount,
        message: `Reading page ${page} of ${pageCount}`,
        index: page,
        total: pageCount,
        ratio: 0.15 + (0.6 * doneCount) / slices.length,
      });
    };
    reportPage(slices[0]?.page || 1, 0);
    const parts = await mapPool(slices, VISION_CONCURRENCY, async (slice) => {
      const detail = visionDetail(slice.jpeg);
      if (detail === "high") detailHigh += 1;
      else detailLow += 1;
      const raw = await aiReadImage(slice.jpeg.toString("base64"), "image/jpeg", process.env, { detail });
      finished += 1;
      reportPage(slice.page, finished);
      const receipt = receiptFromVision(raw);
      return receipt?.lines.length ? receipt : null;
    });
    const visionMs = Date.now() - visionStarted;
    const merged = mergeReceipts(parts.filter((part): part is ReceiptAnalysis => Boolean(part)));
    if (!merged?.lines.length) {
      console.info(
        `receipt stage=pdf-vision ms=${visionMs} rasterMs=${rasterMs} slices=${slices.length} concurrency=${VISION_CONCURRENCY} detailHigh=${detailHigh} detailLow=${detailLow} lines=0 total=${Date.now() - started}`
      );
      fail(422, IMPORT_MESSAGES.visionUnreadable, "unreadable");
      return;
    }
    emit({ type: "progress", stage: "matching", message: "Matching brands…", ratio: 0.9 });
    const analysis = await withCatalogBrands(merged);
    console.info(
      `receipt stage=pdf-vision ms=${visionMs} rasterMs=${rasterMs} textMs=${textMs} slices=${slices.length} concurrency=${VISION_CONCURRENCY} detailHigh=${detailHigh} detailLow=${detailLow} lines=${analysis.lines.length} upc=${analysis.lines.filter((line) => line.upc).length} model=${config.visionModel} total=${Date.now() - started}`
    );
    writeReceiptCache(pdfKey, analysis);
    finish(analysis);
  } catch (error) {
    const mapped = visionHttp(error);
    fail(mapped.status, mapped.error, mapped.code);
  }
});

export default router;
