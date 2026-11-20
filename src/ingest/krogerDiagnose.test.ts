import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";
import app from "../app";
import { KrogerService } from "../krogerService";
import { MemoryBudgetStore } from "./budget";
import {
  KROGER_DIAGNOSE_CONTROLS,
  KROGER_DIAGNOSE_SAFE_LIMIT,
  describeKrogerIdGap,
  krogerDiagnoseJob,
  runKrogerDiagnose,
  startKrogerDiagnoseJob,
} from "./krogerDiagnose";

const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
  delete process.env.KROGER_CLIENT_ID;
  delete process.env.KROGER_CLIENT_SECRET;
  delete process.env.GG_ADMIN_TOKEN;
  delete process.env.ADMIN_TOKEN;
});

describe("Kroger diagnose", () => {
  it("searches by filter.term, cross-checks ids, and looks up a staple id both ways", async () => {
    const calls: string[] = [];
    const report = await runKrogerDiagnose({
      limit: 1,
      locations: ["01400902", "01400001"],
      controls: ["bananas"],
      misses: [{ name: "Bananas", brand: "", departmentId: "produce", upc: "049000042566" }],
      minIntervalMs: 0,
      dailyBudget: 30,
      store: new MemoryBudgetStore(),
      sleep: async () => undefined,
      now: () => 0,
      holdLock: async () => ({ renew: async () => true, release: async () => undefined }),
      client: {
        location: async (locationId) => {
          calls.push(`location:${locationId}`);
          return { httpStatus: 200, valid: locationId === "01400902" };
        },
        term: async (input) => {
          calls.push(`term:${input.locationId || "none"}:${input.term}`);
          return {
            httpStatus: 200,
            query: "filter.term",
            hits: [{ productId: "1111111111111", upc: "9999999999999", description: "Bananas", brand: "" }],
          };
        },
        product: async (input) => {
          calls.push(`product:${input.locationId || "none"}:${input.code}`);
          return {
            httpStatus: 200,
            query: "filter.productId",
            hits: [{ productId: input.code, upc: input.code, description: "Bananas", brand: "" }],
          };
        },
        productPath: async (input) => {
          calls.push(`path:${input.locationId || "none"}:${input.code}`);
          return {
            httpStatus: 200,
            query: "GET /products/{id}",
            hits: [{ productId: input.code, upc: input.code, description: "Bananas", brand: "" }],
          };
        },
      },
    });

    assert.deepEqual(calls[0], "location:01400902");
    assert.equal(calls.includes("location:01400001"), false);
    assert.ok(calls.includes("term:01400902:Bananas"));
    assert.equal(calls.some((call) => call.startsWith("product:") && call.includes("049000042566")), false);
    assert.equal(report.items[0]?.query, "filter.term");
    assert.equal(report.items[0]?.term, "Bananas");
    assert.equal(report.items[0]?.hits[0]?.sameProduct, true);
    const noCheck = report.items[0]?.crossCheck[0]?.compared.find((row) => row.format === "no-check");
    assert.equal(noCheck?.ours, "0004900004256");
    assert.match(noCheck?.versusProductId ?? "", /0004900004256/);
    assert.match(noCheck?.versusProductId ?? "", /1111111111111/);
    assert.notEqual(noCheck?.versusProductId, "same");
    assert.equal(report.summary.barcodeMatched, 0);
    assert.equal(report.summary.strictBinds, 1);
    assert.ok(calls.includes("product:01400902:1111111111111"));
    assert.ok(calls.includes("product:none:1111111111111"));
    assert.ok(calls.includes("path:01400902:1111111111111"));
    assert.ok(calls.includes("path:none:1111111111111"));
    assert.equal(report.summary.productIdFilterHit, 2);
    assert.equal(report.summary.productPathHit, 2);
    assert.match(report.conclusion, /not enabled/);
    assert.equal(JSON.stringify(report).includes("Bearer"), false);
    assert.equal(describeKrogerIdGap("049000042566", "00049000042566"), "Kroger adds prefix 00");
    assert.equal(KROGER_DIAGNOSE_CONTROLS.length, 3);
    assert.equal(KROGER_DIAGNOSE_SAFE_LIMIT, 3);
  });

  it("waits out the shared checkpoint and does not call when the lock is busy", async () => {
    let persisted = 0;
    let clock = 0;
    const waits: number[] = [];
    const pace = {
      limit: 1,
      locations: [] as string[],
      controls: [] as string[],
      misses: [{ name: "Milk", brand: "Kroger", departmentId: "dairy", upc: "049000042566" }],
      minIntervalMs: 2500,
      dailyBudget: 20,
      now: () => clock,
      sleep: async (ms: number) => {
        waits.push(ms);
        clock += ms;
      },
      readNextAllowedAt: async () => persisted,
      writeNextAllowedAt: async (ms: number) => {
        persisted = ms;
      },
      holdLock: async () => ({ renew: async () => true, release: async () => undefined }),
      client: {
        location: async () => ({ httpStatus: 200, valid: true }),
        term: async () => ({ httpStatus: 200, hits: [] }),
        product: async () => ({ httpStatus: 200, hits: [] }),
        productPath: async () => ({ httpStatus: 200, hits: [] }),
      },
    };
    await runKrogerDiagnose({ ...pace, store: new MemoryBudgetStore() });
    assert.equal(persisted - clock, 2500);
    waits.length = 0;
    await runKrogerDiagnose({ ...pace, store: new MemoryBudgetStore() });
    assert.equal(waits[0], 2500);

    let called = false;
    const busy = await runKrogerDiagnose({
      ...pace,
      holdLock: async () => null,
      client: {
        location: async () => {
          called = true;
          return { httpStatus: 200, valid: true };
        },
        term: async () => {
          called = true;
          return { httpStatus: 200, hits: [] };
        },
        product: async () => {
          called = true;
          return { httpStatus: 200, hits: [] };
        },
        productPath: async () => {
          called = true;
          return { httpStatus: 200, hits: [] };
        },
      },
    });
    assert.equal(busy.stopped, "busy");
    assert.equal(busy.calls, 0);
    assert.equal(called, false);
  });

  it("sends a name as filter.term and a known id as GET /products/{id}", async () => {
    process.env.KROGER_CLIENT_ID = "client-id";
    process.env.KROGER_CLIENT_SECRET = "client-secret";
    const urls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/connect/oauth2/token")) {
        return Response.json({ access_token: "test-token", expires_in: 1800 });
      }
      if (url.includes("/products/0000000004011")) {
        return Response.json({
          data: { productId: "0000000004011", upc: "4011", description: "Bananas", brand: "" },
        });
      }
      return Response.json({ data: [] });
    };
    const service = new KrogerService();
    const term = await service.probeProducts({ term: "Kroger 2% milk gallon", locationId: "01400902" });
    assert.equal(term.query, "filter.term");
    const termUrl = urls.find((url) => url.includes("filter.term=")) ?? "";
    const parsed = new URL(termUrl);
    assert.equal(parsed.searchParams.get("filter.term"), "Kroger 2% milk gallon");
    assert.equal(parsed.searchParams.get("filter.productId"), null);
    assert.equal(parsed.searchParams.get("filter.locationId"), "01400902");
    const byPath = await service.probeProductResource("0000000004011", "01400902");
    assert.equal(byPath.query, "GET /products/{id}");
    assert.equal(byPath.hits[0]?.description, "Bananas");
    const pathUrl = urls.find((url) => url.includes("/products/0000000004011")) ?? "";
    assert.match(pathUrl, /\/products\/0000000004011\?/);
    assert.equal(new URL(pathUrl).searchParams.get("filter.locationId"), "01400902");
    assert.equal(pathUrl.includes("filter.productId="), false);
    globalThis.fetch = originalFetch;
  });

  it("returns 401 without GG_ADMIN_TOKEN and a job that can be polled", async () => {
    globalThis.fetch = originalFetch;
    delete process.env.GG_ADMIN_TOKEN;
    delete process.env.ADMIN_TOKEN;
    const server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const missing = await fetch(`${origin}/api/admin/kroger/diagnose`, { method: "POST" });
      assert.equal(missing.status, 401);
      const status = await fetch(`${origin}/api/admin/kroger/diagnose/missing`);
      assert.equal(status.status, 401);
    } finally {
      server.close();
    }

    const started = startKrogerDiagnoseJob(3, async (_limit, onProgress) => {
      const partial = {
        pausedMatchLookup: true,
        safeLimit: 3,
        calls: 1,
        stopped: "" as const,
        location: null,
        locationsChecked: [],
        items: [],
        controls: [],
        summary: {
          sampled: 0,
          termHttp200: 0,
          strictBinds: 0,
          controlTermsHit: 0,
          productIdFilterHit: 0,
          productPathHit: 0,
          barcodeMatched: 0,
        },
        conclusion: "",
      };
      onProgress(partial);
      await new Promise((resolve) => setTimeout(resolve, 15));
      return { ...partial, calls: 2 };
    });
    assert.equal(started.status, "running");
    assert.match(started.poll, /^\/api\/admin\/kroger\/diagnose\//);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(krogerDiagnoseJob(started.id)?.status, "done");
    assert.equal(krogerDiagnoseJob(started.id)?.calls, 2);
  });
});
