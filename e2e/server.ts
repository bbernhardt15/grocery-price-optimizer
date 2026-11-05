/**
 * The real Express app for end-to-end tests.
 * Invite codes are on, retailer APIs are off, and receipt lines are priced
 * from deterministic catalog rows in the in-memory database.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

process.env.BETA_INVITE_CODES = process.env.BETA_INVITE_CODES || "Brandon-50y4";
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
delete process.env.MONGO_URL;
delete process.env.MONGODB_URI;

async function main(): Promise<void> {
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

const port = Number(process.env.PORT) || 4173;
const server = createServer(app);
server.listen(port, "127.0.0.1", () => {
  console.log(`e2e server http://127.0.0.1:${port} (${names.size} receipt prices)`);
});
}

void main();
