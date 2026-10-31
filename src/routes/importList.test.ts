import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import app from "../app";
import { IMPORT_MESSAGES, KROGER_HISTORY_REASON } from "../import/messages";
import { setImportRuntime } from "../import/runtime";
import { resetImportForTests } from "./importList";

const originalFetch = globalThis.fetch;
const envKeys = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "IMPORT_OPENAI_API_KEY",
  "IMPORT_ANTHROPIC_API_KEY",
  "IMPORT_AI_PROVIDER",
  "IMPORT_VISION_PROVIDER",
  "IMPORT_SPEECH_PROVIDER",
  "IMPORT_DAILY_LIMIT",
  "IMPORT_GLOBAL_DAILY_CAP",
  "IMPORT_RATE_LIMIT",
  "GG_ADMIN_TOKEN",
  "ADMIN_TOKEN",
] as const;
const saved: Record<string, string | undefined> = {};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("import routes", () => {
  let server: http.Server;
  let origin: string;
  const calls: string[] = [];
  const logs: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  before(async () => {
    for (const key of envKeys) saved[key] = process.env[key];
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    console.log = originalLog;
    console.error = originalError;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(() => {
    calls.length = 0;
    logs.length = 0;
    resetImportForTests();
    for (const key of envKeys) delete process.env[key];
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    setImportRuntime({
      lookup: async () => ["8.8.8.8"],
      fetchImpl: async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith(origin)) return originalFetch(input, init);
        calls.push(url);
        if (url.includes("/chat/completions") || url.includes("api.anthropic.com")) {
          return jsonResponse({
            choices: [{ message: { content: JSON.stringify({ items: [{ name: "bananas", quantity: 4 }] }) } }],
            content: [{ text: JSON.stringify({ items: [{ name: "bananas", quantity: 4 }] }) }],
          });
        }
        if (url.includes("/audio/transcriptions")) {
          return jsonResponse({ text: "two gallons of milk and bananas" });
        }
        if (url.includes("walmart.com")) {
          return new Response("<html><body><p>Organic Whole Milk</p><p>Bananas</p></body></html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          });
        }
        throw new Error(`unexpected ${url}`);
      },
    });
  });

  afterEach(() => {
    resetImportForTests();
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    console.log = originalLog;
    console.error = originalError;
  });

  function post(path: string, body: unknown, device = "device-import-1") {
    return fetch(`${origin}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-device-id": device },
      body: JSON.stringify(body),
    });
  }

  it("parses a pasted list with the built-in reader when no key is set", async () => {
    const response = await post("/api/import/text", { text: "bananas\n2x milk gallon\nDO-NOT-LOG-secret" });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { parser: string; found: number; total: number; items: Array<{ name: string }> };
    assert.equal(body.parser, "rules");
    assert.equal(body.total, 3);
    assert.ok(body.found >= 2);
    assert.equal(calls.length, 0);
    assert.equal(logs.some((line) => line.includes("DO-NOT-LOG")), false);
    assert.equal(JSON.stringify(body).includes("DO-NOT-LOG"), true);
  });

  it("uses a valid model list and falls back when the model invents a price", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.IMPORT_AI_PROVIDER = "openai";
    const ai = await post("/api/import/text", { text: "milk DO-NOT-LOG" });
    assert.equal(ai.status, 200);
    const aiBody = (await ai.json()) as { parser: string; items: Array<{ name: string; quantity: number }> };
    assert.equal(aiBody.parser, "ai");
    assert.equal(aiBody.items[0]?.name, "bananas");
    assert.equal(aiBody.items[0]?.quantity, 4);

    setImportRuntime({
      fetchImpl: async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith(origin)) return originalFetch(input, init);
        return jsonResponse({
          choices: [{ message: { content: JSON.stringify({ items: [{ name: "bananas", quantity: 1, price: 1.29 }] }) } }],
        });
      },
    });
    const fallback = await post("/api/import/text", { text: "bananas" }, "device-import-2");
    const fallbackBody = (await fallback.json()) as { parser: string; aiFallback: boolean; items: Array<{ name: string }> };
    assert.equal(fallback.status, 200);
    assert.equal(fallbackBody.parser, "rules");
    assert.equal(fallbackBody.aiFallback, true);
    assert.match(fallbackBody.items[0]?.name || "", /banana/i);
  });

  it("says photo, voice, and suggestions are off without a key", async () => {
    const status = await fetch(`${origin}/api/import/status`);
    const statusBody = (await status.json()) as { photo: boolean; speech: boolean; ask: boolean; krogerHistory: boolean; krogerHistoryReason: string };
    assert.equal(statusBody.photo, false);
    assert.equal(statusBody.speech, false);
    assert.equal(statusBody.ask, false);
    const health = await fetch(`${origin}/api/health`);
    const healthBody = (await health.json()) as { ai: boolean; vision: boolean; speech: boolean };
    assert.equal(health.status, 200);
    assert.deepEqual(healthBody, { ai: false, vision: false, speech: false });
    assert.equal(statusBody.krogerHistory, false);
    assert.match(statusBody.krogerHistoryReason, /cart\.basic:write/);
    assert.equal(statusBody.krogerHistoryReason, KROGER_HISTORY_REASON);

    const photo = await post("/api/import/photo", { imageBase64: Buffer.from("nope").toString("base64"), mimeType: "image/jpeg" });
    assert.equal(photo.status, 503);
    assert.equal(((await photo.json()) as { error: string }).error, IMPORT_MESSAGES.photoOff);

    const audio = await post("/api/import/audio", { audioBase64: Buffer.from("nope").toString("base64"), mimeType: "audio/webm" });
    assert.equal(audio.status, 503);
    assert.equal(((await audio.json()) as { error: string }).error, IMPORT_MESSAGES.speechOff);

    const ask = await post("/api/import/ask", { goal: "taco night for 6" });
    assert.equal(ask.status, 503);
    assert.equal(((await ask.json()) as { error: string }).error, IMPORT_MESSAGES.askOff);
    assert.equal(calls.length, 0);
  });

  it("reads a photo and a voice memo when a key is set, without logging them", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.IMPORT_AI_PROVIDER = "off";
    process.env.IMPORT_VISION_PROVIDER = "openai";
    process.env.IMPORT_SPEECH_PROVIDER = "openai";
    const image = Buffer.from("not-a-real-image-DO-NOT-LOG").toString("base64");
    const photo = await post("/api/import/photo", { imageBase64: image, mimeType: "image/jpeg" });
    assert.equal(photo.status, 200);
    const photoBody = (await photo.json()) as { items: Array<{ name: string; quantity: number }> };
    assert.equal(photoBody.items[0]?.name, "bananas");
    assert.equal(photoBody.items[0]?.quantity, 4);
    assert.equal(logs.some((line) => line.includes(image) || line.includes("DO-NOT-LOG")), false);

    const audio = Buffer.from("audio-bytes-DO-NOT-LOG").toString("base64");
    const voice = await post("/api/import/audio", { audioBase64: audio, mimeType: "audio/webm", durationSec: 3 }, "device-voice-1");
    assert.equal(voice.status, 200);
    const voiceBody = (await voice.json()) as { transcript: string };
    assert.match(voiceBody.transcript, /milk/);
    assert.equal("items" in voiceBody, false);
    assert.equal(logs.some((line) => line.includes(audio)), false);
    assert.ok(calls.some((url) => url.includes("/audio/transcriptions")));
  });

  it("suggests a goal only when AI is configured and stops at the daily cap", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.IMPORT_AI_PROVIDER = "openai";
    process.env.IMPORT_DAILY_LIMIT = "1";
    process.env.IMPORT_GLOBAL_DAILY_CAP = "1";
    const first = await post("/api/import/ask", { goal: "taco night for 6 DO-NOT-LOG" });
    assert.equal(first.status, 200);
    const body = (await first.json()) as { suggested: boolean; parser: string; items: Array<{ name: string }> };
    assert.equal(body.suggested, true);
    assert.equal(body.parser, "ai");
    assert.equal(body.items[0]?.name, "bananas");
    const second = await post("/api/import/ask", { goal: "a picnic with no obvious list" }, "device-import-1");
    assert.equal(second.status, 429);
    assert.match(((await second.json()) as { error: string }).error, /paste a list/);
    assert.equal(logs.some((line) => line.includes("DO-NOT-LOG")), false);
  });

  it("reads a spreadsheet export and a store link, and refuses other links", async () => {
    const file = await post("/api/import/file", {
      filename: "instacart.csv",
      text: "product_name,qty\nBananas,2\nSubtotal,1\n",
    });
    assert.equal(file.status, 200);
    const fileBody = (await file.json()) as { items: Array<{ name: string; quantity: number }> };
    assert.equal(fileBody.items.length, 1);
    assert.match(fileBody.items[0]?.name || "", /banana/i);
    assert.equal(fileBody.items[0]?.quantity, 2);

    const link = await post("/api/import/link", { url: "https://www.walmart.com/lists/shared" }, "device-link-1");
    assert.equal(link.status, 200);
    const linkBody = (await link.json()) as { items: Array<{ name: string }> };
    assert.ok(linkBody.items.some((item) => /milk/i.test(item.name)));

    const blocked = await post("/api/import/link", { url: "https://evil.example/list" }, "device-link-2");
    assert.equal(blocked.status, 422);
    assert.equal(((await blocked.json()) as { error: string }).error, IMPORT_MESSAGES.linkUnread);

    const httpLink = await post("/api/import/link", { url: "http://www.walmart.com/lists/1" }, "device-link-3");
    assert.equal(httpLink.status, 422);
    assert.equal(((await httpLink.json()) as { error: string }).error, IMPORT_MESSAGES.linkUnread);
  });

  it("rate-limits a burst of pastes", async () => {
    process.env.IMPORT_RATE_LIMIT = "2";
    const device = "device-rate-1";
    assert.equal((await post("/api/import/text", { text: "bananas" }, device)).status, 200);
    assert.equal((await post("/api/import/text", { text: "milk" }, device)).status, 200);
    const limited = await post("/api/import/text", { text: "bread" }, device);
    assert.equal(limited.status, 429);
    assert.equal(((await limited.json()) as { error: string }).error, IMPORT_MESSAGES.rate);
  });

  it("says when the vision key is refused and does not log the key", async () => {
    process.env.OPENAI_API_KEY = "sk-live-secret-value";
    process.env.IMPORT_VISION_PROVIDER = "openai";
    process.env.IMPORT_AI_PROVIDER = "off";
    setImportRuntime({
      fetchImpl: async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith(origin)) return originalFetch(input, init);
        calls.push(url);
        const header = new Headers(init?.headers);
        assert.equal(header.get("authorization"), "Bearer sk-live-secret-value");
        return jsonResponse({ error: { message: "Incorrect API key provided: sk-live-secret-value", code: "invalid_api_key" } }, 401);
      },
    });
    const photo = await post("/api/import/photo", { imageBase64: Buffer.from("jpeg").toString("base64"), mimeType: "image/jpeg" });
    assert.equal(photo.status, 502);
    const body = (await photo.json()) as { error: string; code: string };
    assert.equal(body.code, "unauthorized");
    assert.match(body.error, /vision key/i);
    assert.equal(logs.some((line) => line.includes("sk-live-secret-value")), false);
    assert.equal(logs.some((line) => line.includes("status=401")), true);
    assert.equal(logs.some((line) => line.includes("sk-redacted")), true);
  });

  it("checks the vision key for an admin without echoing it", async () => {
    const missing = await fetch(`${origin}/api/admin/vision`);
    assert.equal(missing.status, 503);
    process.env.GG_ADMIN_TOKEN = "admin-secret";
    process.env.OPENAI_API_KEY = "sk-live-secret-value";
    process.env.IMPORT_VISION_PROVIDER = "openai";
    setImportRuntime({
      fetchImpl: async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith(origin)) return originalFetch(input, init);
        return jsonResponse({ error: { message: "Incorrect API key provided: sk-live-secret-value", code: "invalid_api_key" } }, 401);
      },
    });
    const denied = await fetch(`${origin}/api/admin/vision`, { headers: { authorization: "Bearer wrong" } });
    assert.equal(denied.status, 401);
    const probe = await fetch(`${origin}/api/admin/vision`, { headers: { authorization: "Bearer admin-secret" } });
    assert.equal(probe.status, 200);
    const probeBody = (await probe.json()) as { configured: boolean; valid: boolean; status: number; message: string };
    assert.equal(probeBody.configured, true);
    assert.equal(probeBody.valid, false);
    assert.equal(probeBody.status, 401);
    assert.equal(JSON.stringify(probeBody).includes("sk-live"), false);
    const health = await fetch(`${origin}/api/health`);
    const healthBody = (await health.json()) as { vision: boolean };
    assert.equal(healthBody.vision, true);
  });

  it("sends an image-only PDF through vision instead of the no-text error", async () => {
    const pdf = readFileSync(new URL("../import/fixtures/kroger-ios-receipt.pdf", import.meta.url));
    const off = await post("/api/import/pdf", { pdfBase64: pdf.toString("base64") });
    const offBody = (await off.json()) as { error: string; code?: string };
    assert.equal(offBody.error.includes("doesn't have readable text"), false);
    if (off.status === 422) {
      assert.equal(offBody.code, "no_raster");
      return;
    }
    assert.equal(off.status, 503);
    assert.match(offBody.error, /photo reading isn't switched on/i);

    process.env.OPENAI_API_KEY = "test-key";
    process.env.IMPORT_VISION_PROVIDER = "openai";
    process.env.IMPORT_AI_PROVIDER = "off";
    setImportRuntime({
      fetchImpl: async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith(origin)) return originalFetch(input, init);
        calls.push(url);
        return jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  text: "Bertolli Olive Oil and Garlic Pasta Sauce, 24 oz\n1.0 x $1.99\nUPC:0003620021933",
                  items: [{ name: "Bertolli Olive Oil and Garlic Pasta Sauce", quantity: 1, brand: "Bertolli", upc: "0003620021933" }],
                }),
              },
            },
          ],
        });
      },
    });
    const on = await post("/api/import/pdf", { pdfBase64: pdf.toString("base64") }, "device-pdf-1");
    assert.equal(on.status, 200);
    const onBody = (await on.json()) as { lines: Array<{ brand: string; upc: string; name: string }> };
    assert.ok(onBody.lines.some((line) => line.upc && /bertolli/i.test(`${line.brand} ${line.name}`)));
    assert.ok(calls.some((url) => url.includes("/chat/completions")));
  });
});
