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
import { mealFromAsk, type MealIdea } from "../import/mealIdeas";
import { IMPORT_MESSAGES, KROGER_HISTORY_REASON } from "../import/messages";
import { parseImportText, type ParsedImportItem } from "../import/parseImportText";
import { aiAsk, aiParseText, aiReadImage, ModelError, transcribeAudio } from "../import/providers";
import { setImportRuntime } from "../import/runtime";

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
const MAX_IMAGE = 4_000_000;
const MAX_AUDIO = 8_000_000;

export function resetImportForTests(): void {
  limiter.reset();
  importBudget.reset();
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

async function review(items: ParsedImportItem[]): Promise<ImportMatchResult> {
  const products = await loadKnownProducts({ queries: items.map((item) => item.name).slice(0, 24) });
  return matchImportItems(items, products);
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
  idea?: MealIdea;
};

async function fromMeal(text: string): Promise<ReadResult | null> {
  const meal = mealFromAsk(text);
  if (!meal) return null;
  return {
    match: await review(meal.items),
    parser: "rules",
    aiFallback: false,
    paused: false,
    suggested: true,
    idea: meal.idea,
  };
}

async function interpret(text: string, key: string, allowAi: boolean): Promise<ReadResult> {
  const meal = await fromMeal(text);
  if (meal) return meal;
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

function sendMatch(
  res: Response,
  result: Awaited<ReturnType<typeof interpret>>,
  extra: Record<string, unknown> = {}
): void {
  if (!result.match.items.length) {
    res.status(422).json({ error: IMPORT_MESSAGES.empty, parser: result.parser });
    return;
  }
  res.json({
    ...result.match,
    parser: result.parser,
    aiFallback: result.aiFallback,
    paused: result.paused,
    ...(result.suggested ? { suggested: true } : {}),
    ...(result.idea ? { idea: result.idea } : {}),
    ...extra,
  });
}

router.get("/import/status", (_req, res) => {
  const config = importConfig();
  res.json({
    paste: true,
    file: true,
    link: true,
    photo: config.photo,
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
  sendMatch(res, await interpret(text, clientKey(req, res), allowAi));
});

router.post("/import/file", async (req, res) => {
  if (!allowed(req, res)) return tooFast(res);
  const text = readText(req.body?.text);
  if (!text.trim()) {
    res.status(400).json({ error: IMPORT_MESSAGES.textMissing });
    return;
  }
  if (text.length > MAX_TEXT) {
    res.status(400).json({ error: IMPORT_MESSAGES.tooLong });
    return;
  }
  sendMatch(res, await interpret(text, clientKey(req, res), req.body?.preferAi === true));
});

router.post("/import/photo", async (req, res) => {
  if (!allowed(req, res)) return tooFast(res);
  const config = importConfig();
  if (!config.photo) {
    res.status(503).json({ error: IMPORT_MESSAGES.photoOff, code: "unconfigured" });
    return;
  }
  const mimeType = readText(req.body?.mimeType).toLowerCase() || "image/jpeg";
  if (!IMAGE_TYPES.has(mimeType)) {
    res.status(400).json({ error: IMPORT_MESSAGES.badImage });
    return;
  }
  const image = decodeBase64(req.body?.imageBase64, MAX_IMAGE);
  if (!image) {
    res.status(400).json({ error: IMPORT_MESSAGES.tooBig });
    return;
  }
  const budget = importBudget.take(clientKey(req, res), config.dailyLimit, config.globalDailyCap);
  if (!budget.ok) {
    res.status(429).json({ error: IMPORT_MESSAGES.daily });
    return;
  }
  try {
    const extracted = await aiReadImage(image.toString("base64"), mimeType);
    const items = itemsFromModel(extracted) ?? parseImportText(extracted);
    const match = await review(items);
    if (!match.items.length) {
      res.status(422).json({ error: IMPORT_MESSAGES.empty });
      return;
    }
    res.json({ ...match, parser: itemsFromModel(extracted) ? "ai" : "rules", aiFallback: false, paused: false });
  } catch (error) {
    const status = error instanceof ModelError ? error.message : "failed";
    console.error(`Import photo failed (${status})`);
    res.status(502).json({ error: IMPORT_MESSAGES.generic });
  }
});

router.post("/import/audio", async (req, res) => {
  if (!allowed(req, res)) return tooFast(res);
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
    res.json({ transcript });
  } catch (error) {
    const status = error instanceof ModelError ? error.message : "failed";
    console.error(`Import voice failed (${status})`);
    res.status(502).json({ error: IMPORT_MESSAGES.generic });
  }
});

router.post("/import/link", async (req, res) => {
  if (!allowed(req, res)) return tooFast(res);
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
  sendMatch(res, await interpret(text, clientKey(req, res), false));
});

router.post("/import/ask", async (req, res) => {
  if (!allowed(req, res)) return tooFast(res);
  const goal = readText(req.body?.goal).trim();
  if (!goal) {
    res.status(400).json({ error: IMPORT_MESSAGES.goalMissing });
    return;
  }
  if (goal.length > 400) {
    res.status(400).json({ error: IMPORT_MESSAGES.tooLong });
    return;
  }
  const meal = await fromMeal(goal);
  if (meal) {
    sendMatch(res, meal);
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
    res.json({ ...match, parser: "ai", suggested: true, aiFallback: false, paused: false });
  } catch (error) {
    const status = error instanceof ModelError ? error.message : "failed";
    console.error(`Import suggestions failed (${status})`);
    res.status(502).json({ error: IMPORT_MESSAGES.askFailed });
  }
});

export default router;
