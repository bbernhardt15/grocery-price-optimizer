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
    const couponOff = await post("/api/import/coupon", { imageBase64: Buffer.from("nope").toString("base64"), mimeType: "image/jpeg" });
    assert.equal(couponOff.status, 503);
    assert.equal(((await couponOff.json()) as { code: string }).code, "unconfigured");

    const audio = await post("/api/import/audio", { audioBase64: Buffer.from("nope").toString("base64"), mimeType: "audio/webm" });
    assert.equal(audio.status, 503);
    assert.equal(((await audio.json()) as { error: string }).error, IMPORT_MESSAGES.speechOff);

    const ask = await post("/api/import/ask", { goal: "taco night for 6" });
    assert.equal(ask.status, 503);
    assert.equal(((await ask.json()) as { error: string }).error, IMPORT_MESSAGES.askOff);
    assert.equal(calls.length, 0);
  });

  it("reads a digital order and a paper receipt when only OPENAI_API_KEY is set", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const status = await fetch(`${origin}/api/import/status`);
    assert.equal(status.headers.get("cache-control"), "no-store");
    const statusBody = (await status.json()) as { photo: boolean };
    assert.equal(statusBody.photo, true);

    const digitalMarker = Buffer.from("digital-order-marker").toString("base64");
    const paperMarker = Buffer.from("paper-receipt-marker").toString("base64");
    const failMarker = Buffer.from("vision-fail-marker").toString("base64");
    const paperText = ["KROGER #412", "MILK GALLON                 3.29", "EGGS 18CT                   4.99", "BREAD                       3.49", "SUBTOTAL                   11.77"].join("\n");
    const digital = JSON.stringify({
      text: "Organic Whole Milk, 1 gal\n1.0 x $3.49\nUPC:0001111040101\nLarge Eggs, 12 ct\n1.0 x $2.19\nUPC:0001111040102",
      items: [
        { name: "Organic Whole Milk", quantity: 1, upc: "0001111040101" },
        { name: "Large Eggs", quantity: 1, upc: "0001111040102" },
      ],
    });
    setImportRuntime({
      lookup: async () => ["8.8.8.8"],
      fetchImpl: async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith(origin)) return originalFetch(input, init);
        calls.push(url);
        const raw = typeof init?.body === "string" ? init.body : "";
        if (raw.includes(failMarker)) return jsonResponse({ error: { message: "overloaded" } }, 503);
        if (raw.includes(paperMarker)) return jsonResponse({ choices: [{ message: { content: paperText } }] });
        return jsonResponse({ choices: [{ message: { content: digital } }] });
      },
    });

    const digitalRes = await post("/api/import/photo", { imageBase64: digitalMarker, mimeType: "image/jpeg" }, "device-photo-digital");
    assert.equal(digitalRes.status, 200);
    const digitalBody = (await digitalRes.json()) as {
      items: Array<{ name: string }>;
      receipt?: { paper?: boolean };
    };
    assert.ok(digitalBody.items.some((item) => /organic whole milk/i.test(item.name)));
    assert.ok(digitalBody.items.some((item) => /large eggs/i.test(item.name)));
    assert.equal(digitalBody.receipt?.paper, false);
    assert.equal(JSON.stringify(digitalBody).includes("isn't switched on"), false);

    const paperRes = await post("/api/import/photo", { imageBase64: paperMarker, mimeType: "image/jpeg" }, "device-photo-paper");
    assert.equal(paperRes.status, 200);
    const paperBody = (await paperRes.json()) as {
      items?: Array<{ name: string }>;
      lines?: Array<{ name: string }>;
      paper?: boolean;
      paperNote?: string;
      receipt?: { paper?: boolean; paperNote?: string };
    };
    const note = paperBody.receipt?.paperNote || paperBody.paperNote || "";
    assert.match(note, /shortened/);
    const names = [...(paperBody.items || []), ...(paperBody.lines || [])].map((item) => item.name).join(" ");
    assert.match(names, /milk/i);
    assert.equal(/isn't switched on/i.test(JSON.stringify(paperBody)), false);

    const failRes = await post("/api/import/photo", { imageBase64: failMarker, mimeType: "image/jpeg" }, "device-photo-fail");
    assert.equal(failRes.status, 502);
    const failBody = (await failRes.json()) as { error: string };
    assert.match(failBody.error, /didn't answer/i);
    assert.equal(/isn't switched on/i.test(failBody.error), false);
    assert.equal(logs.some((line) => line.includes("test-key")), false);
  });

  it("reads a coupon screenshot through the vision reader and leaves a missing amount blank", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.IMPORT_VISION_PROVIDER = "openai";
    process.env.IMPORT_AI_PROVIDER = "off";
    const shot = Buffer.from("coupon-shot-marker").toString("base64");
    const blank = Buffer.from("coupon-no-amount").toString("base64");
    setImportRuntime({
      lookup: async () => ["8.8.8.8"],
      fetchImpl: async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith(origin)) return originalFetch(input, init);
        calls.push(url);
        const raw = typeof init?.body === "string" ? init.body : "";
        if (raw.includes(blank)) {
          return jsonResponse({
            choices: [{ message: { content: JSON.stringify({ storeName: "Kroger", itemName: "Milk", kind: "dollars", amount: null, conditions: "Clip to save" }) } }],
          });
        }
        return jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  storeName: "Kroger",
                  itemName: "Large eggs",
                  kind: "dollars",
                  amount: 1,
                  expiresOn: "2026-12-01",
                  minQuantity: 2,
                  conditions: "When you buy 2",
                }),
              },
            },
          ],
        });
      },
    });
    const read = await post("/api/import/coupon", { imageBase64: shot, mimeType: "image/jpeg" }, "device-coupon");
    assert.equal(read.status, 200);
    const body = (await read.json()) as { source: string; coupon: { amount: number; minQuantity: number; conditions: string; gaps: string[] } };
    assert.equal(body.source, "screenshot");
    assert.equal(body.coupon.amount, 1);
    assert.equal(body.coupon.minQuantity, 2);
    assert.equal(body.coupon.conditions, "When you buy 2");
    assert.deepEqual(body.coupon.gaps, []);
    assert.ok(calls.some((url) => url.includes("/chat/completions")));
    const missing = await post("/api/import/coupon", { imageBase64: blank, mimeType: "image/jpeg" }, "device-coupon-blank");
    const missingBody = (await missing.json()) as { coupon: { amount: number | null; gaps: string[] } };
    assert.equal(missingBody.coupon.amount, null);
    assert.ok(missingBody.coupon.gaps.includes("amount"));
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

  it("returns the same receipt photo from the content hash without a second vision call", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.IMPORT_VISION_PROVIDER = "openai";
    process.env.IMPORT_AI_PROVIDER = "off";
    process.env.IMPORT_DAILY_LIMIT = "1";
    const image = Buffer.from("same-receipt-bytes").toString("base64");
    const first = await post("/api/import/photo", { imageBase64: image, mimeType: "image/jpeg" }, "device-receipt-cache");
    assert.equal(first.status, 200);
    const visionCalls = calls.filter((url) => url.includes("/chat/completions")).length;
    calls.length = 0;
    const second = await post("/api/import/photo", { imageBase64: image, mimeType: "image/jpeg" }, "device-receipt-cache");
    assert.equal(second.status, 200);
    assert.equal(calls.filter((url) => url.includes("/chat/completions")).length, 0);
    assert.equal(visionCalls >= 1, true);
    const again = (await second.json()) as { items?: Array<{ name?: string }> };
    assert.equal(again.items?.[0]?.name, "bananas");
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

  it("streams progress and does not call vision when the PDF already has Kroger text", async () => {
    const body = `BT
(Tide Liquid Laundry Detergent, 92 oz) Tj
(1.0 x $11.99) Tj
(UPC: 0003620021933) Tj
ET`;
    const pdf = Buffer.from(
      `%PDF-1.1
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj
4 0 obj << /Length ${body.length} >> stream
${body}
endstream
endobj
trailer << /Root 1 0 R >>
%%EOF`,
      "latin1"
    );
    const response = await post("/api/import/pdf", { pdfBase64: pdf.toString("base64"), progress: true }, "device-pdf-progress");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /ndjson/);
    const events = (await response.text())
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type?: string; message?: string; analysis?: { lines: Array<{ brand: string }> } });
    assert.ok(events.some((event) => event.message === "Preparing…"));
    assert.ok(events.some((event) => event.message === "Matching brands…"));
    assert.equal(events.at(-1)?.type, "result");
    assert.ok(events.at(-1)?.analysis?.lines.some((line) => /tide/i.test(line.brand)));
    assert.equal(calls.some((url) => url.includes("/chat/completions")), false);
  });

  it("reads a fridge photo into staple rows and does not log the picture", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.IMPORT_AI_PROVIDER = "off";
    process.env.IMPORT_VISION_PROVIDER = "openai";
    const info: string[] = [];
    const originalInfo = console.info;
    console.info = (...args: unknown[]) => {
      info.push(args.map(String).join(" "));
    };
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
                  meals: ["omelette"],
                  items: [
                    { name: "milk", confidence: "high", fullness: "low" },
                    { name: "eggs", confidence: "high", fullness: "empty" },
                    { name: "omelette recipe", confidence: "high", fullness: "full" },
                  ],
                }),
              },
            },
          ],
        });
      },
    });
    try {
      const image = Buffer.from("fridge-photo-DO-NOT-LOG").toString("base64");
      const response = await post("/api/import/shelf", { imageBase64: image, mimeType: "image/jpeg" }, "device-shelf-1");
      assert.equal(response.status, 200);
      const body = (await response.json()) as { items: Array<{ family: string; fullness: string; confidence: string }> };
      assert.deepEqual(
        body.items.map((item) => item.family),
        ["milk", "eggs"]
      );
      assert.equal(body.items[0]?.fullness, "low");
      assert.equal(JSON.stringify(body).includes(image), false);
      assert.equal(info.some((line) => line.includes("DO-NOT-LOG") || line.includes(image)), false);
      assert.ok(info.some((line) => /shelf stage=photo/.test(line) && /items=2/.test(line)));
      assert.equal(info.some((line) => /\bmilk\b/i.test(line)), false);
    } finally {
      console.info = originalInfo;
    }
  });

  it("hides shelf scan without a key and names photo failures", async () => {
    const status = await fetch(`${origin}/api/import/status`);
    const statusBody = (await status.json()) as { shelf: boolean };
    assert.equal(statusBody.shelf, false);
    const off = await post("/api/import/shelf", { imageBase64: Buffer.from("x").toString("base64"), mimeType: "image/jpeg" }, "device-shelf-off");
    assert.equal(off.status, 503);
    assert.equal(((await off.json()) as { error: string }).error, IMPORT_MESSAGES.shelfOff);

    process.env.OPENAI_API_KEY = "test-key";
    process.env.IMPORT_VISION_PROVIDER = "openai";
    process.env.IMPORT_AI_PROVIDER = "off";
    const on = await fetch(`${origin}/api/import/status`);
    assert.equal(((await on.json()) as { shelf: boolean }).shelf, true);

    const cases: Array<{ name: string; status: number; code: string; error: string; respond: () => Promise<Response> }> = [
      {
        name: "unauthorized",
        status: 502,
        code: "unauthorized",
        error: IMPORT_MESSAGES.shelfUnauthorized,
        respond: async () => jsonResponse({ error: { message: "Incorrect API key provided" } }, 401),
      },
      {
        name: "too_large",
        status: 413,
        code: "too_large",
        error: IMPORT_MESSAGES.shelfTooLarge,
        respond: async () => jsonResponse({ error: { message: "image too large" } }, 413),
      },
      {
        name: "timeout",
        status: 504,
        code: "timeout",
        error: IMPORT_MESSAGES.shelfTimeout,
        respond: async () => {
          const error = new Error("timed out");
          error.name = "TimeoutError";
          throw error;
        },
      },
      {
        name: "empty",
        status: 422,
        code: "empty",
        error: IMPORT_MESSAGES.shelfEmpty,
        respond: async () => jsonResponse({ choices: [{ message: { content: JSON.stringify({ items: [{ name: "blurry jar" }] }) } }] }),
      },
    ];
    for (const [index, item] of cases.entries()) {
      setImportRuntime({
        fetchImpl: async (input, init) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (url.startsWith(origin)) return originalFetch(input, init);
          return item.respond();
        },
      });
      const response = await post(
        "/api/import/shelf",
        { imageBase64: Buffer.from(`case-${item.name}`).toString("base64"), mimeType: "image/jpeg" },
        `device-shelf-${index}`
      );
      const body = (await response.json()) as { error: string; code: string };
      assert.equal(response.status, item.status, item.name);
      assert.equal(body.code, item.code, item.name);
      assert.equal(body.error, item.error, item.name);
    }
  });

  it("withholds store offers unless the ZIP is in the service area", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const image = Buffer.from("zip-gate-photo").toString("base64");
    const audio = Buffer.from("zip-gate-audio").toString("base64");
    const pdfBody = "BT\n(MILK GALLON                 3.29) Tj\nET";
    const pdf = Buffer.from(
      `%PDF-1.1
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj
4 0 obj << /Length ${pdfBody.length} >> stream
${pdfBody}
endstream
endobj
trailer << /Root 1 0 R >>
%%EOF`,
      "latin1"
    ).toString("base64");
    setImportRuntime({
      lookup: async () => ["8.8.8.8"],
      fetchImpl: async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith(origin)) return originalFetch(input, init);
        if (url.includes("/audio/transcriptions")) return jsonResponse({ text: "milk and bread" });
        if (url.includes("walmart.com")) {
          return new Response("<html><body><p>Organic Whole Milk</p><p>Bananas</p></body></html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          });
        }
        const raw = typeof init?.body === "string" ? init.body : "";
        if (raw.includes("fridge") || raw.includes("pantry shelf")) {
          return jsonResponse({
            choices: [{ message: { content: JSON.stringify({ items: [{ name: "milk", confidence: "high", fullness: "half" }] }) } }],
          });
        }
        if (raw.includes("coupon screenshot")) {
          return jsonResponse({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    storeName: "Kroger",
                    itemName: "Large eggs",
                    kind: "dollars",
                    amount: 1,
                    conditions: "When you buy 2",
                  }),
                },
              },
            ],
          });
        }
        return jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [{ name: "Whole Milk", quantity: 1 }],
                  text: "Whole Milk",
                }),
              },
            },
          ],
          content: [{ text: JSON.stringify({ items: [{ name: "Organic Whole Milk", quantity: 1 }] }) }],
        });
      },
    });

    const cases: Array<{ path: string; body: Record<string, unknown>; priced: "offers" | "receipt" | "coupon" | "names" }> = [
      { path: "/api/import/text", body: { text: "Whole Milk" }, priced: "offers" },
      { path: "/api/import/file", body: { text: "Whole Milk" }, priced: "offers" },
      { path: "/api/import/link", body: { url: "https://www.walmart.com/lists/shared" }, priced: "offers" },
      { path: "/api/import/ask", body: { goal: "milk for the week" }, priced: "offers" },
      { path: "/api/import/photo", body: { imageBase64: image, mimeType: "image/jpeg" }, priced: "offers" },
      { path: "/api/import/receipt", body: { text: "MILK GALLON                 3.29" }, priced: "receipt" },
      { path: "/api/import/pdf", body: { pdfBase64: pdf }, priced: "receipt" },
      { path: "/api/import/coupon", body: { imageBase64: image, mimeType: "image/jpeg" }, priced: "coupon" },
      { path: "/api/import/shelf", body: { imageBase64: image, mimeType: "image/jpeg" }, priced: "names" },
      { path: "/api/import/audio", body: { audioBase64: audio, mimeType: "audio/webm", durationSec: 3 }, priced: "names" },
    ];

    for (const [index, item] of cases.entries()) {
      const bare = await post(item.path, item.body, `device-zip-bare-${index}`);
      const bareBody = await bare.json();
      assert.equal(bare.status, 200, `${item.path} no zip status ${bare.status} ${JSON.stringify(bareBody)}`);
      assert.deepEqual(storePriceLeaks(bareBody), [], `${item.path} no zip leaked ${storePriceLeaks(bareBody).join(",")}`);

      const out = await post(item.path, { ...item.body, zipCode: "04101" }, `device-zip-out-${index}`);
      const outBody = (await out.json()) as { code?: string };
      assert.equal(out.status, 422, item.path);
      assert.equal(outBody.code, "not_in_service_area", item.path);
      assert.deepEqual(storePriceLeaks(outBody), [], item.path);

      const bad = await post(item.path, { ...item.body, zipCode: "12" }, `device-zip-bad-${index}`);
      assert.equal(bad.status, 400, item.path);
      assert.deepEqual(storePriceLeaks(await bad.json()), [], item.path);

      const inside = await post(item.path, { ...item.body, zipCode: "45202" }, `device-zip-in-${index}`);
      const insideBody = await inside.json();
      assert.equal(inside.status, 200, `${item.path} in area ${inside.status} ${JSON.stringify(insideBody).slice(0, 240)}`);
      if (item.priced === "offers") assert.equal(hasOfferPrice(insideBody), true, item.path);
      if (item.priced === "receipt") assert.equal(hasNumericPrice(insideBody), true, item.path);
      if (item.priced === "coupon") {
        const coupon = (insideBody as { coupon?: { storeName?: string; amount?: number } }).coupon;
        assert.equal(coupon?.storeName, "Kroger");
        assert.equal(coupon?.amount, 1);
      }
      if (item.priced === "names") assert.deepEqual(storePriceLeaks(insideBody), [], item.path);
    }
  });
});

function storePriceLeaks(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((entry, index) => storePriceLeaks(entry, `${path}[${index}]`));
  if (!value || typeof value !== "object") return [];
  const hits: string[] = [];
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const here = `${path}.${key}`;
    if (key === "price" && typeof entry === "number") hits.push(here);
    if (key === "bestPrice" && entry != null) hits.push(here);
    if ((key === "offers" || key === "bestOffer") && entry != null) hits.push(here);
    if ((key === "storeName" || key === "bestStore") && entry != null && entry !== "") hits.push(here);
    if (key === "store" && entry != null && entry !== "" && typeof entry !== "boolean") hits.push(here);
    if (entry && typeof entry === "object") hits.push(...storePriceLeaks(entry, here));
  }
  return hits;
}

function hasOfferPrice(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((entry) => hasOfferPrice(entry));
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.offers)) {
    for (const offer of record.offers) {
      if (offer && typeof offer === "object" && typeof (offer as { price?: unknown }).price === "number") return true;
    }
  }
  return Object.values(record).some((entry) => entry && typeof entry === "object" && hasOfferPrice(entry));
}

function hasNumericPrice(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((entry) => hasNumericPrice(entry));
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (typeof record.price === "number") return true;
  return Object.values(record).some((entry) => entry && typeof entry === "object" && hasNumericPrice(entry));
}
