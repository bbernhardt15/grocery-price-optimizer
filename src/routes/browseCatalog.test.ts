import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import app from "../app";

describe("browse catalog routes", () => {
  let server: http.Server;
  let origin: string;
  const previous = {
    KROGER_CLIENT_ID: process.env.KROGER_CLIENT_ID,
    KROGER_CLIENT_SECRET: process.env.KROGER_CLIENT_SECRET,
    WALMART_CONSUMER_ID: process.env.WALMART_CONSUMER_ID,
    WALMART_PRIVATE_KEY: process.env.WALMART_PRIVATE_KEY,
    TARGET_PARTNER_BASE_URL: process.env.TARGET_PARTNER_BASE_URL,
    TARGET_PARTNER_API_KEY: process.env.TARGET_PARTNER_API_KEY,
  };

  before(async () => {
    delete process.env.KROGER_CLIENT_ID;
    delete process.env.KROGER_CLIENT_SECRET;
    delete process.env.WALMART_CONSUMER_ID;
    delete process.env.WALMART_PRIVATE_KEY;
    delete process.env.TARGET_PARTNER_BASE_URL;
    delete process.env.TARGET_PARTNER_API_KEY;
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("lists the shared departments", async () => {
    const response = await fetch(`${origin}/api/catalog/departments`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { departments: Array<{ id: string; name: string }> };
    assert.ok(body.departments.some((department) => department.id === "produce" && department.name === "Produce"));
    assert.ok(body.departments.some((department) => department.id === "dairy-eggs"));
  });

  it("browses the demo catalog by department and reports demo coverage without API keys", async () => {
    const response = await fetch(`${origin}/api/catalog/browse?department=dairy-eggs&sort=price`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      items: Array<{ name: string; bestOffer: { price: number }; gaps: Array<{ storeName: string; substitute: { name: string } | null }> }>;
      coverage: Array<{ storeName: string; mode: string }>;
      catalogSource: string;
    };
    assert.equal(body.catalogSource, "demo");
    assert.ok(body.items.length > 0);
    assert.ok(body.items.every((item) => /milk|egg|butter|yogurt|cheese/i.test(item.name)));
    assert.ok(body.items[0].bestOffer.price <= body.items[1].bestOffer.price);
    const national = body.items.find((item) => item.name === "Whole Milk" && item.gaps.some((gap) => gap.storeName === "Aldi"));
    assert.ok(national);
    const aldi = national.gaps.find((gap) => gap.storeName === "Aldi");
    assert.equal(aldi?.substitute?.name, "Whole Milk");
    const walmart = body.coverage.find((store) => store.storeName === "Walmart");
    assert.equal(walmart?.mode, "demo_only");
  });

  it("filters on sale and suggests matching names", async () => {
    const sale = await fetch(`${origin}/api/catalog/browse?onSale=1`);
    assert.equal(sale.status, 200);
    const saleBody = (await sale.json()) as { items: Array<{ offers: Array<{ onSale: boolean }> }> };
    assert.ok(saleBody.items.length > 0);
    assert.ok(saleBody.items.every((item) => item.offers.some((offer) => offer.onSale)));

    const suggest = await fetch(`${origin}/api/catalog/suggest?q=spaghetti`);
    assert.equal(suggest.status, 200);
    const suggestions = (await suggest.json()) as { suggestions: Array<{ name: string }> };
    assert.ok(suggestions.suggestions.some((item) => /spaghetti/i.test(item.name)));
  });

  it("returns an svg placeholder and 400 for a bad ZIP", async () => {
    const image = await fetch(`${origin}/api/catalog/placeholder.svg?d=produce&t=Bananas`);
    assert.equal(image.status, 200);
    assert.match(image.headers.get("content-type") ?? "", /svg/);
    const markup = await image.text();
    assert.match(markup, /Bananas/);

    const bad = await fetch(`${origin}/api/catalog/browse?zip=nope`);
    assert.equal(bad.status, 400);
  });
});
