/**
 * Model calls for parse, photo, and speech. Prompts and shopper content
 * stay in the request body and are not logged.
 */

import { importConfig, type ImportConfig, type ProviderName } from "./config";
import { getFetch } from "./runtime";
import { shelfPrompt } from "./shelfScan";
import { scrubSecret, upstreamMessage, visionFailure, type VisionFailure } from "./visionErrors";

/** 1x1 JPEG. The admin check uses it so a stored key is proven with a real vision call. */
const TINY_JPEG =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAPwB/AP/Z";

const PARSE_SYSTEM = [
  "Turn a shopper's grocery note into JSON only.",
  '{"items":[{"name":"","quantity":1,"brand":"","size":"","notes":""}]}',
  "name is the product. quantity is a whole number of packages from 1 to 99.",
  '"a couple" means 2, "a few" means 3, "some" means 1.',
  "Put a named brand and pack size in their fields.",
  "Combine duplicates. Do not invent items that are not in the note.",
  "Do not include prices, stores, or websites.",
  "Ignore totals, tax, buttons, and headers.",
  '"the usual" and "same as last time" are not items. Skip them.',
].join(" ");

const ASK_SYSTEM = [
  "The shopper described a grocery goal. Propose a calm supermarket list as JSON only.",
  '{"items":[{"name":"","quantity":1,"brand":"","size":"","notes":""}]}',
  "Use 6 to 14 real grocery products. quantity is packages, not recipe cups.",
  "No prices and no store names. No brand unless the goal names one.",
  "Do not claim anything is the cheapest.",
].join(" ");

const VISION_SYSTEM = [
  PARSE_SYSTEM,
  "The note is a photo of a handwritten list, a receipt, or a store order.",
  "When a UPC or barcode number is printed, copy those digits into upc. Do not guess a brand from a barcode.",
  "Leave brand empty unless the package name prints one.",
  'Also include "text": a plain transcript of the grocery lines, keeping each title, the quantity x price line, coupon lines, and UPC: lines.',
  "Do not transcribe addresses, card numbers, loyalty numbers, or order numbers.",
].join(" ");

const FAST_VISION_FALLBACK = "gpt-4o-mini";

export class ModelError extends Error {
  readonly status: number | null;
  readonly upstream: string;
  readonly failure: VisionFailure | "unconfigured" | "empty";

  constructor(message: string, extra?: { status?: number | null; upstream?: string; failure?: VisionFailure | "unconfigured" | "empty" }) {
    super(message);
    this.name = "ModelError";
    this.status = extra?.status ?? null;
    this.upstream = extra?.upstream ?? "";
    this.failure = extra?.failure ?? (message === "unconfigured" || message === "empty" ? message : "upstream");
  }
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<unknown> {
  let response: Response;
  try {
    response = await getFetch()(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new ModelError("timeout", { failure: "timeout" });
    }
    const upstream = scrubSecret(error instanceof Error ? error.message : "failed");
    throw new ModelError("upstream", { failure: "upstream", upstream });
  }
  if (!response.ok) {
    const upstream = scrubSecret(upstreamMessage(await response.text().catch(() => "")));
    const failure = visionFailure(response.status, upstream);
    throw new ModelError(failure, { status: response.status, upstream, failure });
  }
  return response.json();
}

function openAiText(payload: unknown): string {
  const choice = (payload as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content;
  if (typeof choice !== "string" || !choice.trim()) throw new ModelError("empty", { failure: "empty" });
  return choice;
}

function anthropicText(payload: unknown): string {
  const blocks = (payload as { content?: Array<{ text?: string }> })?.content;
  const text = blocks?.map((block) => block.text || "").join("\n").trim();
  if (!text) throw new ModelError("empty", { failure: "empty" });
  return text;
}

async function complete(config: ImportConfig, provider: ProviderName, system: string, user: unknown): Promise<string> {
  if (provider === "openai") {
    const payload = await postJson(
      "https://api.openai.com/v1/chat/completions",
      { authorization: `Bearer ${config.openAiKey}`, "content-type": "application/json" },
      {
        model: typeof user === "string" ? config.aiModel : config.visionModel,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      },
      typeof user === "string" ? 20_000 : 45_000
    );
    return openAiText(payload);
  }
  const payload = await postJson(
    "https://api.anthropic.com/v1/messages",
    {
      "x-api-key": config.anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    {
      model: typeof user === "string" ? config.aiModel : config.visionModel,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: user }],
    },
    typeof user === "string" ? 20_000 : 45_000
  );
  return anthropicText(payload);
}

export async function aiParseText(note: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const config = importConfig(env);
  if (!config.aiProvider) throw new ModelError("unconfigured");
  return complete(config, config.aiProvider, PARSE_SYSTEM, note.slice(0, 50_000));
}

export async function aiAsk(goal: string, env: NodeJS.ProcessEnv = process.env, constraints = ""): Promise<string> {
  const config = importConfig(env);
  if (!config.aiProvider) throw new ModelError("unconfigured");
  const note = constraints.trim();
  const user = note
    ? `${goal.slice(0, 400)}\n\nShopper constraints. Obey them. Do not invent products or prices.\n${note.slice(0, 800)}`
    : goal.slice(0, 400);
  return complete(config, config.aiProvider, ASK_SYSTEM, user);
}

function modelMissing(error: unknown): boolean {
  if (!(error instanceof ModelError)) return false;
  return /model_not_found|does not exist or you do not have access|invalid model/i.test(error.upstream);
}

const SHELF_USER = "List the groceries you can see. Do not invent items. Do not suggest meals.";

async function readImage(
  config: ImportConfig,
  imageBase64: string,
  mimeType: string,
  detail: "low" | "high",
  prompt?: { system: string; text: string }
): Promise<string> {
  const system = prompt?.system || VISION_SYSTEM;
  const text = prompt?.text || "Read the groceries in this photo. Copy UPC lines. Do not invent brands.";
  if (config.visionProvider === "openai") {
    return complete(config, "openai", system, [
      { type: "text", text },
      { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}`, detail } },
    ]);
  }
  return complete(config, "anthropic", system, [
    {
      type: "image",
      source: { type: "base64", media_type: mimeType, data: imageBase64 },
    },
    { type: "text", text },
  ]);
}

export async function aiReadImage(
  imageBase64: string,
  mimeType: string,
  env: NodeJS.ProcessEnv = process.env,
  options?: { detail?: "low" | "high" }
): Promise<string> {
  const config = importConfig(env);
  if (!config.visionProvider) throw new ModelError("unconfigured");
  const detail = options?.detail === "high" ? "high" : "low";
  try {
    return await readImage(config, imageBase64, mimeType, detail);
  } catch (error) {
    const explicit = Boolean((env.IMPORT_VISION_MODEL || "").trim());
    if (config.visionProvider === "openai" && !explicit && config.visionModel !== FAST_VISION_FALLBACK && modelMissing(error)) {
      console.info("receipt vision model fallback gpt-4o-mini");
      return readImage({ ...config, visionModel: FAST_VISION_FALLBACK }, imageBase64, mimeType, detail);
    }
    throw error;
  }
}

export async function aiReadShelf(
  imageBase64: string,
  mimeType: string,
  env: NodeJS.ProcessEnv = process.env,
  options?: { detail?: "low" | "high" }
): Promise<string> {
  const config = importConfig(env);
  if (!config.visionProvider) throw new ModelError("unconfigured");
  const detail = options?.detail === "high" ? "high" : "low";
  const prompt = { system: shelfPrompt(), text: SHELF_USER };
  try {
    return await readImage(config, imageBase64, mimeType, detail, prompt);
  } catch (error) {
    const explicit = Boolean((env.IMPORT_VISION_MODEL || "").trim());
    if (config.visionProvider === "openai" && !explicit && config.visionModel !== FAST_VISION_FALLBACK && modelMissing(error)) {
      console.info("shelf vision model fallback gpt-4o-mini");
      return readImage({ ...config, visionModel: FAST_VISION_FALLBACK }, imageBase64, mimeType, detail, prompt);
    }
    throw error;
  }
}

function multipart(file: { filename: string; mimeType: string; data: Buffer }): { body: Buffer; contentType: string } {
  const boundary = `gg${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${importConfig().speechModel}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, file.data, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

export async function transcribeAudio(
  data: Buffer,
  mimeType: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<string> {
  const config = importConfig(env);
  if (!config.speechProvider) throw new ModelError("unconfigured");
  const extension = mimeType.includes("mp4") || mimeType.includes("m4a") ? "m4a" : mimeType.includes("mpeg") ? "mp3" : mimeType.includes("wav") ? "wav" : mimeType.includes("ogg") ? "ogg" : "webm";
  const form = multipart({ filename: `list.${extension}`, mimeType, data });
  const response = await getFetch()(`${config.speechBaseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.openAiKey}`, "content-type": form.contentType },
    body: new Uint8Array(form.body),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    const upstream = scrubSecret(upstreamMessage(await response.text().catch(() => "")));
    const failure = visionFailure(response.status, upstream);
    throw new ModelError(failure, { status: response.status, upstream, failure });
  }
  const payload = (await response.json()) as { text?: string };
  if (!payload.text?.trim()) throw new ModelError("empty", { failure: "empty" });
  return payload.text.trim();
}

export type VisionProbe = {
  configured: boolean;
  valid: boolean;
  provider: ProviderName | null;
  status: number | null;
  message: string;
};

/** A tiny vision call. The key is never included in the result. */
export async function probeVision(env: NodeJS.ProcessEnv = process.env): Promise<VisionProbe> {
  const config = importConfig(env);
  if (!config.visionProvider) {
    return { configured: false, valid: false, provider: null, status: null, message: "Vision is not configured." };
  }
  try {
    await aiReadImage(TINY_JPEG, "image/jpeg", env);
    return { configured: true, valid: true, provider: config.visionProvider, status: 200, message: "Vision key accepted a tiny image." };
  } catch (error) {
    if (error instanceof ModelError && error.failure === "unauthorized") {
      return {
        configured: true,
        valid: false,
        provider: config.visionProvider,
        status: error.status,
        message: "Vision key was refused. Replace it in the host's environment.",
      };
    }
    if (error instanceof ModelError && (error.failure === "empty" || error.failure === "unreadable")) {
      return {
        configured: true,
        valid: true,
        provider: config.visionProvider,
        status: error.status ?? 200,
        message: "Vision key was accepted.",
      };
    }
    const failure = error instanceof ModelError ? error.failure : "upstream";
    const status = error instanceof ModelError ? error.status : null;
    const detail = error instanceof ModelError ? scrubSecret(error.upstream) : "";
    return {
      configured: true,
      valid: false,
      provider: config.visionProvider,
      status,
      message: detail ? `Vision check failed (${failure}): ${detail}` : `Vision check failed (${failure}).`,
    };
  }
}
