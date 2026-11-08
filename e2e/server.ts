/**
 * The real Express app for end-to-end tests.
 * Invite codes are on, retailer APIs are off, and receipt lines are priced
 * from deterministic catalog rows in the in-memory database.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

process.env.BETA_INVITE_CODES = process.env.BETA_INVITE_CODES || "Brandon-50y4";
process.env.GG_ADMIN_TOKEN = process.env.GG_ADMIN_TOKEN || "e2e-feedback-admin";
process.env.CATALOG_INGEST_ENABLED = "false";
process.env.KROGER_INGEST_ENABLED = "false";
process.env.WALMART_INGEST_ENABLED = "false";
process.env.FLIPP_ENABLED = "false";
delete process.env.KROGER_CLIENT_ID;
delete process.env.KROGER_CLIENT_SECRET;
delete process.env.WALMART_CONSUMER_ID;
delete process.env.WALMART_PRIVATE_KEY;
delete process.env.WALMART_PUBLISHER_ID;
delete process.env.FLIPP_ACCESS_TOKEN;
delete process.env.OPENAI_API_KEY;
delete process.env.IMPORT_OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.IMPORT_ANTHROPIC_API_KEY;
delete process.env.IMPORT_VISION_PROVIDER;
delete process.env.IMPORT_AI_PROVIDER;
delete process.env.IMPORT_SPEECH_PROVIDER;
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
delete process.env.VAPID_SUBJECT;
delete process.env.MONGO_URL;
delete process.env.MONGODB_URI;

const features = process.env.E2E_FEATURES === "1";
if (features) {
  process.env.OPENAI_API_KEY = "test-key";
}

async function main(): Promise<void> {
if (features) {
  const webpush = await import("web-push");
  const api = webpush.default ?? webpush;
  const keys = api.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
}

const { connectDatabase } = await import("../src/db.ts");
const { default: app } = await import("../src/app.ts");
const { Product } = await import("../src/models/Product.ts");
const { DEMO_KROGER_LOCATION_ID } = await import("../src/krogerService.ts");
const { extractPdfText } = await import("../src/import/pdfText.ts");
const { analyzeReceipt } = await import("../src/import/receiptLearn.ts");

function priceFor(name: string, store: "Kroger" | "Walmart"): number {
  let hash = 0;
  for (const char of `${store}:${name}`) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  const dollars = 1.25 + (hash % 700) / 100;
  return Math.round(dollars * 100) / 100;
}

await connectDatabase();

const pdf = readFileSync(new URL("./fixtures/sample-order.pdf", import.meta.url));
const analysis = analyzeReceipt(extractPdfText(pdf));
const names = new Set<string>();
for (const line of analysis.lines) {
  const brand = String(line.brand || "").trim();
  const itemName = String(line.name || "").trim();
  const name =
    brand && itemName && !itemName.toLowerCase().includes(brand.toLowerCase())
      ? `${brand} ${itemName}`
      : itemName || brand;
  if (name) names.add(name);
}
const now = new Date();
const rows = [...names].flatMap((name) => {
  const brand = name.split(" ")[0] || "Store";
  return (["Kroger", "Walmart"] as const).map((storeName) => ({
    name,
    brand,
    storeName,
    ...(storeName === "Kroger" ? { locationId: DEMO_KROGER_LOCATION_ID } : {}),
    price: priceFor(name, storeName),
    unit: "count" as const,
    normalizedUnit: "count" as const,
    priceSource: "seed" as const,
    lastUpdated: now,
  }));
});
if (rows.length) await Product.insertMany(rows);
const demoShelf = [
  ["Bananas", "Fresh", "Aldi", 0.49, "lbs"],
  ["Bananas", "Fresh", "Walmart", 0.54, "lbs"],
  ["Bananas", "Fresh", "Kroger", 0.62, "lbs"],
  ["Bananas", "Fresh", "Target", 0.69, "lbs"],
  ["Whole Milk", "Dairy Pure", "Walmart", 3.18, "gal"],
  ["Whole Milk", "Dairy Pure", "Kroger", 3.29, "gal"],
  ["Whole Milk", "Dairy Pure", "Target", 3.49, "gal"],
  ["Salted Butter", "Challenge", "Walmart", 4.48, "oz"],
  ["Salted Butter", "Challenge", "Kroger", 4.29, "oz"],
  ["Salted Butter", "Challenge", "Target", 4.69, "oz"],
] as const;
await Product.insertMany(
  demoShelf.map(([name, brand, storeName, price, unit]) => ({
    name,
    brand,
    storeName,
    ...(storeName === "Kroger" ? { locationId: DEMO_KROGER_LOCATION_ID } : {}),
    price,
    unit,
    normalizedUnit: unit,
    priceSource: "seed" as const,
    lastUpdated: now,
  }))
);

if (features) {
  const { setImportRuntime } = await import("../src/import/runtime.ts");
  const { noteTestPush, setWebPushSender } = await import("../src/alerts/push.ts");
  let visionCalls = 0;
  const paperText = ["KROGER #412", "MILK GALLON                 3.29", "EGGS 18CT                   4.99", "BREAD                       3.49", "SUBTOTAL                   11.77"].join("\n");
  const digital = JSON.stringify({
    text: "Organic Whole Milk, 1 gal\n1.0 x $3.49\nUPC:0001111040101\nLarge Eggs, 12 ct\n1.0 x $2.19\nUPC:0001111040102",
    items: [
      { name: "Organic Whole Milk", quantity: 1, upc: "0001111040101" },
      { name: "Large Eggs", quantity: 1, upc: "0001111040102" },
    ],
  });
  setWebPushSender(async (_subscription, payload) => {
    const parsed = JSON.parse(payload) as { title?: string };
    noteTestPush(String(parsed.title || ""));
  });
  setImportRuntime({
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!String(url).includes("api.openai.com")) {
        return new Response("unexpected", { status: 500 });
      }
      visionCalls += 1;
      if (visionCalls >= 3) {
        return new Response(JSON.stringify({ error: { message: "overloaded" } }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      const content = visionCalls === 2 ? paperText : digital;
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
}

const port = Number(process.env.PORT) || 4173;
const server = createServer(app);
server.listen(port, "127.0.0.1", () => {
  console.log(`e2e server http://127.0.0.1:${port} (${names.size} receipt prices)`);
});
}

void main();
