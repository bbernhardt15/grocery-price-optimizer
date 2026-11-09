import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import app from "../app";

/**
 * A shopper response with no in-area ZIP must not carry a store price,
 * bestPrice, an offer, or a store field. A receipt line's price: null is allowed.
 */
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

type Call = { method: string; path: string; body?: unknown };

const image = Buffer.from("leak-scan").toString("base64");

const calls: Call[] = [
  { method: "GET", path: "/api" },
  { method: "GET", path: "/api/health" },
  { method: "GET", path: "/api/health/ready" },
  { method: "GET", path: "/api/observability" },
  { method: "GET", path: "/api/shopper/config" },
  { method: "GET", path: "/api/search-catalog?query=milk" },
  { method: "GET", path: "/api/search-catalog?query=milk&zip=04101" },
  { method: "GET", path: "/api/catalog/departments" },
  { method: "GET", path: "/api/catalog/browse?q=milk" },
  { method: "GET", path: "/api/catalog/browse?q=milk&zip=04101" },
  { method: "GET", path: "/api/catalog/suggest?q=milk" },
  { method: "GET", path: "/api/catalog/suggest?q=milk&zip=04101" },
  { method: "GET", path: "/api/catalog/coverage" },
  { method: "GET", path: "/api/catalog/coverage?zip=04101" },
  { method: "GET", path: "/api/catalog/products/milk" },
  { method: "GET", path: "/api/catalog/products/milk?zip=04101" },
  { method: "GET", path: "/api/import/status" },
  { method: "GET", path: "/api/kroger/auth-status" },
  { method: "GET", path: "/api/kroger/logout" },
  { method: "GET", path: "/api/geo/zip?lat=39.1&lng=-84.51" },
  { method: "GET", path: "/api/instacart/status" },
  { method: "GET", path: "/api/price-alerts/status" },
  { method: "GET", path: "/api/price-alerts?deviceId=leak-device-01" },
  { method: "GET", path: "/api/auth/status" },
  { method: "GET", path: "/api/auth/me" },
  { method: "GET", path: "/api/billing/status" },
  { method: "GET", path: "/api/beta/gate" },
  { method: "GET", path: "/api/me/list" },
  { method: "GET", path: "/api/lists/not-a-real-token" },
  { method: "POST", path: "/api/optimize-list", body: { groceryList: ["Whole Milk"] } },
  { method: "POST", path: "/api/optimize-list", body: { groceryList: ["Whole Milk"], zipCode: "04101" } },
  { method: "POST", path: "/api/optimize-list", body: ["Whole Milk"] },
  { method: "POST", path: "/api/import/text", body: { text: "Whole Milk" } },
  { method: "POST", path: "/api/import/text", body: { text: "Whole Milk", zipCode: "04101" } },
  { method: "POST", path: "/api/import/file", body: { text: "Whole Milk" } },
  { method: "POST", path: "/api/import/file", body: { text: "Whole Milk", zipCode: "05401" } },
  { method: "POST", path: "/api/import/ask", body: { goal: "milk for the week" } },
  { method: "POST", path: "/api/import/ask", body: { goal: "milk for the week", zipCode: "04101" } },
  { method: "POST", path: "/api/import/photo", body: { imageBase64: image, mimeType: "image/jpeg" } },
  { method: "POST", path: "/api/import/photo", body: { imageBase64: image, mimeType: "image/jpeg", zipCode: "04101" } },
  { method: "POST", path: "/api/import/coupon", body: { imageBase64: image, mimeType: "image/jpeg" } },
  { method: "POST", path: "/api/import/coupon", body: { imageBase64: image, mimeType: "image/jpeg", zipCode: "04101" } },
  { method: "POST", path: "/api/import/shelf", body: { imageBase64: image, mimeType: "image/jpeg" } },
  { method: "POST", path: "/api/import/shelf", body: { imageBase64: image, mimeType: "image/jpeg", zipCode: "04101" } },
  { method: "POST", path: "/api/import/audio", body: { audioBase64: image, mimeType: "audio/webm" } },
  { method: "POST", path: "/api/import/audio", body: { audioBase64: image, mimeType: "audio/webm", zipCode: "04101" } },
  { method: "POST", path: "/api/import/link", body: { url: "https://evil.example/list" } },
  { method: "POST", path: "/api/import/link", body: { url: "https://evil.example/list", zipCode: "04101" } },
  { method: "POST", path: "/api/import/receipt", body: { lines: [{ name: "Milk", quantity: 1, price: null }] } },
  { method: "POST", path: "/api/import/receipt", body: { text: "MILK GALLON                 3.29" } },
  { method: "POST", path: "/api/import/receipt", body: { text: "MILK GALLON                 3.29", zipCode: "04101" } },
  { method: "POST", path: "/api/import/pdf", body: { pdfBase64: image } },
  { method: "POST", path: "/api/import/pdf", body: { pdfBase64: image, zipCode: "04101" } },
  { method: "POST", path: "/api/instacart/shopping-list", body: {} },
  { method: "POST", path: "/api/price-alerts/seen", body: { deviceId: "leak-device-01" } },
  { method: "POST", path: "/api/price-alerts/push", body: {} },
  { method: "PUT", path: "/api/price-alerts/watches", body: {} },
  { method: "DELETE", path: "/api/price-alerts/push" },
  { method: "POST", path: "/api/lists", body: {} },
  { method: "POST", path: "/api/kroger/cart/start", body: {} },
  { method: "POST", path: "/api/kroger/connect", body: {} },
  { method: "POST", path: "/api/billing/refresh", body: {} },
  { method: "POST", path: "/api/beta/invite", body: {} },
  { method: "POST", path: "/api/beta/events", body: {} },
  { method: "POST", path: "/api/beta/feedback", body: {} },
  { method: "POST", path: "/api/beta/client-errors", body: {} },
  { method: "POST", path: "/api/auth/email/start", body: {} },
  { method: "POST", path: "/api/auth/logout", body: {} },
  { method: "DELETE", path: "/api/me/data" },
  { method: "GET", path: "/api/kroger/oauth/authorize" },
];

describe("shopper routes without an in-area ZIP", () => {
  let server: http.Server;
  let origin: string;
  const savedInvite = process.env.BETA_INVITE_CODES;

  before(async () => {
    delete process.env.BETA_INVITE_CODES;
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    if (savedInvite === undefined) delete process.env.BETA_INVITE_CODES;
    else process.env.BETA_INVITE_CODES = savedInvite;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("does not return price, bestPrice, offers, or store fields", async () => {
    const leaks: string[] = [];
    for (const call of calls) {
      const response = await fetch(`${origin}${call.path}`, {
        method: call.method,
        redirect: "manual",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-device-id": "leak-device-01",
        },
        body: call.body === undefined ? undefined : JSON.stringify(call.body),
      });
      const type = response.headers.get("content-type") || "";
      if (!type.includes("json")) continue;
      const body = await response.json().catch(() => null);
      const found = storePriceLeaks(body);
      if (found.length) leaks.push(`${call.method} ${call.path} -> ${found.join(", ")}`);
    }
    assert.deepEqual(leaks, []);
  });
});
