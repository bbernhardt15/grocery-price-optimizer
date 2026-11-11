/**
 * Replay one stored code against Kroger and, when Walmart credentials exist, Walmart.
 *
 * Kroger's Products API documents filter.productId as 13 digits with the
 * barcode check digit removed. This script still tries the other shapes so a
 * live sample can show which one returns a product.
 *
 *   KROGER_CLIENT_ID=... KROGER_CLIENT_SECRET=... npx tsx scripts/replayLookupFormats.ts
 *
 * Optional: KROGER_LOCATION_ID, WALMART_CONSUMER_ID, WALMART_PRIVATE_KEY,
 * WALMART_KEY_VERSION. Without Kroger credentials the script prints the four
 * forms and exits 2.
 */
import { storeLookupFormats } from "../src/catalog/normalize";

const SAMPLE: Array<{ name: string; upc: string }> = [
  { name: "Honey Nut Cheerios", upc: "016000124790" },
  { name: "Coca-Cola", upc: "049000042566" },
  { name: "Chobani Greek Yogurt Vanilla", upc: "894700010144" },
  { name: "A.1. Sauce", upc: "0005440000004" },
  { name: "Activia variety pack", upc: "0003663202851" },
  { name: "Babybel snack cheese", upc: "0004175702575" },
  { name: "Brummel & Brown spread", upc: "0001111534004" },
  { name: "Cadbury Dairy Milk Caramello", upc: "0003400004047" },
  { name: "Barilla whole grain spaghetti", upc: "0007680800584" },
  { name: "Bertolli olive oil sauce", upc: "0003620021933" },
  { name: "Classico spicy tomato", upc: "0004112963110" },
  { name: "Classico Italian sausage", upc: "0004112907702" },
  { name: "Cajun Power spaghetti sauce", upc: "0003692156206" },
  { name: "Kroger low fat chocolate milk example", upc: "0001111043115" },
  { name: "Kroger sweet acidophilus example", upc: "0001111042210" },
  { name: "Bush's beans invalid check", upc: "070708200500" },
  { name: "Great Value milk", upc: "078742351896" },
  { name: "Diet Coke", upc: "049000028904" },
  { name: "Nature Valley", upc: "016000275287" },
  { name: "Tide", upc: "037000318026" },
];

type FormatName = "krogerProductId" | "gtin14" | "stored" | "upcA";

const KROGER_TOKEN = "https://api.kroger.com/v1/connect/oauth2/token";
const KROGER_PRODUCTS = "https://api.kroger.com/v1/products";

async function krogerToken(): Promise<string> {
  const id = process.env.KROGER_CLIENT_ID ?? "";
  const secret = process.env.KROGER_CLIENT_SECRET ?? "";
  if (!id || !secret) {
    throw new Error("Set KROGER_CLIENT_ID and KROGER_CLIENT_SECRET");
  }
  const response = await fetch(KROGER_TOKEN, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "product.compact" }),
  });
  if (!response.ok) {
    throw new Error(`Kroger token ${response.status}`);
  }
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("Kroger token response had no access_token");
  return body.access_token;
}

async function krogerHit(token: string, productId: string): Promise<"hit" | "miss" | "error"> {
  if (!productId) return "miss";
  const params = new URLSearchParams({ "filter.productId": productId, "filter.limit": "1" });
  const location = process.env.KROGER_LOCATION_ID?.trim();
  if (location) params.set("filter.locationId", location);
  const response = await fetch(`${KROGER_PRODUCTS}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (response.status === 400 || response.status === 404) return "miss";
  if (!response.ok) return "error";
  const body = (await response.json()) as { data?: unknown[] };
  return (body.data?.length ?? 0) > 0 ? "hit" : "miss";
}

async function main(): Promise<number> {
  const rows = SAMPLE.map((row) => ({ ...row, formats: storeLookupFormats(row.upc) }));
  console.log(JSON.stringify(rows, null, 2));
  if (!process.env.KROGER_CLIENT_ID || !process.env.KROGER_CLIENT_SECRET) {
    console.error("No Kroger credentials in this environment. Formats are printed above; nothing was sent.");
    return 2;
  }
  const token = await krogerToken();
  const tally: Record<FormatName, { hit: number; miss: number; error: number }> = {
    krogerProductId: { hit: 0, miss: 0, error: 0 },
    gtin14: { hit: 0, miss: 0, error: 0 },
    stored: { hit: 0, miss: 0, error: 0 },
    upcA: { hit: 0, miss: 0, error: 0 },
  };
  for (const row of rows) {
    const outcome: Partial<Record<FormatName, string>> = {};
    for (const name of Object.keys(tally) as FormatName[]) {
      const code = row.formats[name] ?? "";
      const result = await krogerHit(token, code);
      tally[name][result] += 1;
      outcome[name] = `${result} ${code}`;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    console.log(row.name, outcome);
  }
  console.log(JSON.stringify(tally, null, 2));
  return 0;
}

main().then((code) => process.exit(code)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
