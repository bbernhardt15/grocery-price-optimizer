import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  INSTACART_DEV_BASE_URL,
  buildProductsLinkBody,
  createInstacartShoppingList,
  isInstacartHandoffEnabled,
  matchRetailerKey,
  readInstacartConfig,
  retailerNamesMatch,
  toInstacartLineItem,
  withRetailerKey,
} from "./instacartHandoff";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.INSTACART_API_KEY;
  delete process.env.INSTACART_API_BASE_URL;
  delete process.env.INSTACART_PARTNER_API_KEY;
  delete process.env.INSTACART_PARTNER_BASE_URL;
});

function enableInstacart(): void {
  process.env.INSTACART_API_KEY = "keys.test-secret";
  process.env.INSTACART_API_BASE_URL = INSTACART_DEV_BASE_URL;
}

describe("Instacart handoff config", () => {
  it("stays off when the Developer Platform key or base URL is unset", () => {
    assert.equal(isInstacartHandoffEnabled(), false);
    process.env.INSTACART_API_KEY = "keys.test-secret";
    assert.equal(readInstacartConfig(), null);
    delete process.env.INSTACART_API_KEY;
    process.env.INSTACART_API_BASE_URL = INSTACART_DEV_BASE_URL;
    assert.equal(readInstacartConfig(), null);
  });

  it("does not treat the partner-feed stub vars as a shopping-list key", () => {
    process.env.INSTACART_PARTNER_API_KEY = "partner-key";
    process.env.INSTACART_PARTNER_BASE_URL = "https://proxy.example";
    assert.equal(isInstacartHandoffEnabled(), false);
  });

  it("requires an https base and ignores userinfo", () => {
    process.env.INSTACART_API_KEY = "keys.test-secret";
    process.env.INSTACART_API_BASE_URL = "http://connect.dev.instacart.tools";
    assert.equal(readInstacartConfig(), null);
    process.env.INSTACART_API_BASE_URL = "https://user:pass@connect.instacart.com/ignored";
    assert.equal(readInstacartConfig(), null);
    process.env.INSTACART_API_BASE_URL = `${INSTACART_DEV_BASE_URL}/`;
    assert.deepEqual(readInstacartConfig(), {
      apiKey: "keys.test-secret",
      baseUrl: INSTACART_DEV_BASE_URL,
    });
  });
});

describe("Instacart line items", () => {
  it("sends name, quantity, mapped unit, display size, and UPC", () => {
    const line = toInstacartLineItem({
      name: "Whole Milk",
      brand: "Friendly Farms",
      quantity: 2,
      unit: "gal",
      upc: "0001111041700",
    });
    assert.ok(line);
    assert.equal(line.name, "Whole Milk");
    assert.equal(line.quantity, 2);
    assert.equal(line.unit, "gallon");
    assert.equal(line.display_text, "Friendly Farms Whole Milk (2 gal)");
    assert.deepEqual(line.line_item_measurements, [{ quantity: 2, unit: "gallon" }]);
    assert.deepEqual(line.upcs, ["0001111041700"]);
    assert.equal("product_ids" in line, false);
  });

  it("maps grocery units onto Instacart's supported units", () => {
    assert.equal(toInstacartLineItem({ name: "Bananas", unit: "lbs", quantity: 3 })?.unit, "pound");
    assert.equal(toInstacartLineItem({ name: "Butter", unit: "oz" })?.unit, "ounce");
    assert.equal(toInstacartLineItem({ name: "Eggs", unit: "count" })?.unit, "each");
    assert.equal(toInstacartLineItem({ name: "Rice", unit: "g" })?.unit, "gram");
    assert.equal(toInstacartLineItem({ name: "Juice", unit: "ml" })?.unit, "milliliter");
    assert.equal(toInstacartLineItem({ name: "Soda", unit: "l" })?.unit, "liter");
    assert.equal(toInstacartLineItem({ name: "Chicken", unit: "kg" })?.unit, "kilogram");
  });

  it("does not send an unsupported unit as the measurement", () => {
    const line = toInstacartLineItem({ name: "Rolls", unit: "dozen", quantity: 1 });
    assert.equal(line?.unit, "each");
    assert.equal(line?.display_text, "Rolls (1 dozen)");
    assert.equal(line?.upcs, undefined);
  });

  it("builds a shopping_list body without a retailer field", () => {
    const body = buildProductsLinkBody({
      items: [{ name: "Eggs", quantity: 1, unit: "count" }],
      title: "Grocery Gitter · Aldi",
      instructions: ["Items priced at Aldi."],
      partnerLinkbackUrl: "https://grocery.example/",
    });
    assert.equal(body.link_type, "shopping_list");
    assert.equal(body.expires_in, 7);
    assert.equal("retailer_key" in body, false);
    assert.equal(body.landing_page_configuration?.partner_linkback_url, "https://grocery.example/");
    assert.equal(body.line_items[0]?.unit, "each");
  });
});

describe("retailer hint", () => {
  it("matches banner names and aliases, not a different Giant", () => {
    assert.equal(retailerNamesMatch("Target", "Target"), true);
    assert.equal(retailerNamesMatch("H-E-B", "HEB"), true);
    assert.equal(retailerNamesMatch("Sam's Club", "Sams Club"), true);
    assert.equal(retailerNamesMatch("Giant Eagle", "Giant"), false);
    assert.equal(
      matchRetailerKey("Aldi", [
        { retailer_key: "target", name: "Target" },
        { retailer_key: "aldi", name: "ALDI" },
      ]),
      "aldi"
    );
    assert.equal(matchRetailerKey("Costco", [{ retailer_key: "aldi", name: "Aldi" }]), null);
  });

  it("appends retailer_key without dropping affiliate params", () => {
    const url = withRetailerKey(
      "https://www.instacart.com/store/shopping_lists/abc?aff_id=4204&offer_id=1",
      "target"
    );
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("retailer_key"), "target");
    assert.equal(parsed.searchParams.get("aff_id"), "4204");
    assert.equal(parsed.searchParams.get("offer_id"), "1");
  });
});

describe("createInstacartShoppingList", () => {
  it("POSTs the shopping list with a bearer key and hints a matched retailer", async () => {
    enableInstacart();
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = async (input, init) => {
      const url = input instanceof URL ? input.href : String(input);
      calls.push({ url, init });
      if (url.includes("/idp/v1/products/products_link")) {
        return new Response(
          JSON.stringify({
            products_link_url:
              "https://www.instacart.com/store/shopping_lists/99?aff_id=1",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.includes("/idp/v1/retailers")) {
        return new Response(
          JSON.stringify({
            retailers: [{ retailer_key: "target", name: "Target", retailer_logo_url: "https://example.test/logo" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      throw new Error(`unexpected ${url}`);
    };

    const result = await createInstacartShoppingList({
      storeName: "Target",
      postalCode: "45202-1234",
      partnerLinkbackUrl: "https://app.example/",
      items: [
        { name: "Whole Milk", quantity: 2, unit: "gal", brand: "Good & Gather", upc: "012345678905" },
      ],
    });

    assert.equal(calls.length, 2);
    const createCall = calls[0];
    assert.ok(createCall);
    assert.equal(
      createCall.url,
      `${INSTACART_DEV_BASE_URL}/idp/v1/products/products_link`
    );
    const headers = new Headers(createCall.init?.headers);
    assert.equal(headers.get("Authorization"), "Bearer keys.test-secret");
    assert.equal(headers.get("Content-Type"), "application/json");
    const body = JSON.parse(String(createCall.init?.body)) as {
      title: string;
      link_type: string;
      line_items: Array<{ name: string; unit: string; upcs?: string[] }>;
      retailer_key?: string;
    };
    assert.equal(body.link_type, "shopping_list");
    assert.equal(body.title, "Grocery Gitter · Target");
    assert.equal(body.retailer_key, undefined);
    assert.equal(body.line_items[0]?.name, "Whole Milk");
    assert.equal(body.line_items[0]?.unit, "gallon");
    assert.deepEqual(body.line_items[0]?.upcs, ["012345678905"]);

    const retailerCall = calls[1];
    assert.ok(retailerCall);
    assert.match(retailerCall.url, /postal_code=45202/);
    assert.match(retailerCall.url, /country_code=US/);
    assert.equal(result.retailerPreselected, true);
    assert.equal(result.retailerKey, "target");
    const opened = new URL(result.productsLinkUrl);
    assert.equal(opened.searchParams.get("retailer_key"), "target");
    assert.equal(opened.searchParams.get("aff_id"), "1");
    assert.match(result.retailerNote, /no retailer field/i);
  });

  it("still returns the shopping list when retailer lookup is forbidden", async () => {
    enableInstacart();
    globalThis.fetch = async (input) => {
      const url = input instanceof URL ? input.href : String(input);
      if (url.includes("/products_link")) {
        return new Response(
          JSON.stringify({
            products_link_url: "https://www.instacart.com/store/shopping_lists/1",
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ error: { message: "Forbidden", code: 4001 } }), {
        status: 403,
      });
    };

    const result = await createInstacartShoppingList({
      storeName: "Aldi",
      postalCode: "60601",
      items: [{ name: "Bananas", quantity: 1, unit: "lbs" }],
    });
    assert.equal(result.retailerPreselected, false);
    assert.equal(result.retailerKey, null);
    assert.equal(
      result.productsLinkUrl,
      "https://www.instacart.com/store/shopping_lists/1"
    );
    assert.match(result.retailerNote, /GET \/idp\/v1\/retailers/);
    assert.match(result.retailerNote, /Aldi/);
  });

  it("does not preselect a retailer for the whole list", async () => {
    enableInstacart();
    let retailerCalls = 0;
    globalThis.fetch = async (input) => {
      const url = input instanceof URL ? input.href : String(input);
      if (url.includes("/retailers")) {
        retailerCalls += 1;
      }
      return new Response(
        JSON.stringify({
          products_link_url: "https://www.instacart.com/store/shopping_lists/all",
        }),
        { status: 200 }
      );
    };

    const result = await createInstacartShoppingList({
      items: [{ name: "Eggs", quantity: 1, unit: "count" }],
    });
    assert.equal(retailerCalls, 0);
    assert.equal(result.retailerPreselected, false);
    assert.match(result.retailerNote, /one retailer/i);
  });

  it("surfaces Instacart validation errors without echoing the API key", async () => {
    enableInstacart();
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "There were issues with your request",
            code: 9999,
            errors: [
              {
                error: { message: "Invalid quantity: -0.1. Cannot be lower than or equal to 0.0", code: 1001 },
                meta: { key: "line_items[0].line_item_measurements[0].quantity" },
              },
            ],
          },
        }),
        { status: 400 }
      );

    await assert.rejects(
      () =>
        createInstacartShoppingList({
          items: [{ name: "Milk", quantity: 1 }],
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /HTTP 400/);
        assert.match(error.message, /Invalid quantity/);
        assert.match(error.message, /line_items\[0\]/);
        assert.equal(error.message.includes("keys.test-secret"), false);
        return true;
      }
    );
  });

  it("explains a rejected API key", async () => {
    enableInstacart();
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: { message: "Unauthorized", code: 4001 } }), {
        status: 401,
      });

    await assert.rejects(
      () => createInstacartShoppingList({ items: [{ name: "Milk" }] }),
      /HTTP 401/
    );
  });

  it("rejects a products link that is not an Instacart https URL", async () => {
    enableInstacart();
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ products_link_url: "http://evil.example/phish" }), {
        status: 200,
      });

    await assert.rejects(
      () => createInstacartShoppingList({ items: [{ name: "Milk" }] }),
      /products_link_url/
    );
  });

  it("reports a network failure without calling a real Instacart host", async () => {
    enableInstacart();
    globalThis.fetch = async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    };
    await assert.rejects(
      () => createInstacartShoppingList({ items: [{ name: "Milk" }] }),
      /Could not reach Instacart/
    );
  });
});
