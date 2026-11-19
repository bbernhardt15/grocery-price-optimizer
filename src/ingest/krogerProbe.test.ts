import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";
import app from "../app";
import { krogerMatchLookupPaused } from "../catalog/krogerLookupFormat";
import { krogerFormatCode, krogerLookupCodes, krogerProbeCandidates } from "../catalog/normalize";
import { MemoryBudgetStore } from "./budget";
import { KROGER_PROBE_SAFE_LIMIT, krogerProbeJob, runKrogerProbe, startKrogerProbeJob } from "./krogerProbe";

describe("Kroger probe", () => {
  const savedToken = process.env.GG_ADMIN_TOKEN;
  const savedAdmin = process.env.ADMIN_TOKEN;
  const savedFormat = process.env.KROGER_LOOKUP_FORMAT;
  const savedPause = process.env.KROGER_MATCH_LOOKUP_PAUSED;

  after(() => {
    restore("GG_ADMIN_TOKEN", savedToken);
    restore("ADMIN_TOKEN", savedAdmin);
    restore("KROGER_LOOKUP_FORMAT", savedFormat);
    restore("KROGER_MATCH_LOOKUP_PAUSED", savedPause);
  });

  it("is paused unless the flag is turned off, and one env picks the id that is sent", () => {
    delete process.env.KROGER_MATCH_LOOKUP_PAUSED;
    assert.equal(krogerMatchLookupPaused(), true);
    process.env.KROGER_MATCH_LOOKUP_PAUSED = "0";
    assert.equal(krogerMatchLookupPaused(), false);
    delete process.env.KROGER_LOOKUP_FORMAT;
    assert.deepEqual(krogerLookupCodes("049000042566"), ["0004900004256"]);
    process.env.KROGER_LOOKUP_FORMAT = "with-check";
    assert.deepEqual(krogerLookupCodes("049000042566"), ["0049000042566"]);
    process.env.KROGER_LOOKUP_FORMAT = "upc-a";
    assert.deepEqual(krogerLookupCodes("049000042566"), ["049000042566"]);
    assert.deepEqual(krogerLookupCodes("0000000004011"), ["0000000004011"]);
    assert.deepEqual(krogerProbeCandidates("4011").map((row) => row.format), ["plu"]);
    assert.deepEqual(krogerProbeCandidates("0000000004011").map((row) => row.code), ["0000000004011"]);
    assert.equal(krogerFormatCode("4011", "plu"), "0000000004011");
    assert.equal(krogerFormatCode("0000000004011", "upc-a"), null);
    assert.equal(krogerFormatCode("0000000004011", "with-check"), null);
    assert.equal(krogerFormatCode("0000000004011", "gtin-14"), null);
    assert.equal(krogerFormatCode("049000042566", "plu"), null);
  });

  it("tries each shape, waits out the gap, and counts the call", async () => {
    const waits: number[] = [];
    let clock = 0;
    const seen: string[] = [];
    const report = await runKrogerProbe({
      limit: 1,
      misses: [{ name: "Bananas", departmentId: "produce", upc: "4011" }],
      locations: ["01400902"],
      minIntervalMs: 2500,
      dailyBudget: 30,
      store: new MemoryBudgetStore(),
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
      client: {
        location: async (locationId) => ({ httpStatus: locationId === "01400902" ? 200 : 404, valid: locationId === "01400902" }),
        product: async (input) => {
          seen.push(`${input.locationId || "none"}:${input.code}`);
          if (!input.locationId && input.code === "0000000004011") {
            return { httpStatus: 200, hits: [{ productId: "0000000004011", upc: "4011" }] };
          }
          return { httpStatus: 400, hits: [] };
        },
        term: async () => ({ httpStatus: 200, hits: [] }),
      },
    });
    assert.equal(report.locations[0]?.valid, true);
    assert.ok(waits.some((ms) => ms === 2500));
    assert.ok(seen.includes("none:0000000004011"));
    assert.equal(report.summary.byFormat["plu"]?.hits, 1);
    assert.equal(report.summary.byFormat["upc-a"], undefined);
    assert.equal(report.summary.byFormat["with-check"], undefined);
    assert.equal(report.summary.byFormat["gtin-14"], undefined);
    assert.equal(report.summary.byLocation.none?.hits, 1);
    assert.equal(report.items[0]?.attempts.find((row) => row.format === "plu" && row.locationId === null)?.hit, true);
    assert.equal(
      report.items[0]?.attempts.every((row) => row.format === "term" || row.code === "0000000004011"),
      true
    );
    const body = JSON.stringify(report);
    assert.equal(body.includes("Bearer"), false);
    assert.equal(body.includes("client_secret"), false);
    assert.equal(report.calls > 0, true);
  });

  it("returns 401 without GG_ADMIN_TOKEN", async () => {
    delete process.env.GG_ADMIN_TOKEN;
    delete process.env.ADMIN_TOKEN;
    const server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const missing = await fetch(`${origin}/api/admin/kroger/probe`, { method: "POST" });
      assert.equal(missing.status, 401);
      process.env.GG_ADMIN_TOKEN = "probe-secret";
      const wrong = await fetch(`${origin}/api/admin/kroger/probe`, {
        method: "POST",
        headers: { authorization: "Bearer nope" },
      });
      assert.equal(wrong.status, 401);
      const status = await fetch(`${origin}/api/admin/kroger/probe/missing`);
      assert.equal(status.status, 401);
    } finally {
      server.close();
    }
  });

  it("waits out the shared checkpoint gap and does not call when the lock is busy", async () => {
    let persisted = 0;
    let clock = 0;
    const waits: number[] = [];
    const client = {
      location: async () => ({ httpStatus: 200, valid: true }),
      product: async () => ({ httpStatus: 400, hits: [] as Array<{ productId: string; upc: string }> }),
      term: async () => ({ httpStatus: 200, hits: [] as Array<{ productId: string; upc: string }> }),
    };
    const pace = {
      misses: [{ name: "Milk", departmentId: "dairy", upc: "049000042566" }],
      locations: [] as string[],
      minIntervalMs: 2500,
      dailyBudget: 30,
      store: new MemoryBudgetStore(),
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
      client,
    };
    await runKrogerProbe({ ...pace, limit: 1 });
    assert.equal(persisted - clock, 2500);
    waits.length = 0;
    await runKrogerProbe({ ...pace, limit: 1, store: new MemoryBudgetStore() });
    assert.equal(waits[0], 2500);

    let called = false;
    const busy = await runKrogerProbe({
      ...pace,
      limit: 1,
      holdLock: async () => null,
      client: {
        location: async () => {
          called = true;
          return { httpStatus: 200, valid: true };
        },
        product: async () => {
          called = true;
          return { httpStatus: 400, hits: [] };
        },
        term: async () => {
          called = true;
          return { httpStatus: 200, hits: [] };
        },
      },
    });
    assert.equal(busy.stopped, "busy");
    assert.equal(busy.calls, 0);
    assert.equal(called, false);
    assert.equal(KROGER_PROBE_SAFE_LIMIT, 3);
  });

  it("keeps a pollable job and fills it as results arrive", async () => {
    const started = startKrogerProbeJob(3, async (_limit, onProgress) => {
      const partial = {
        pausedMatchLookup: true,
        lookupFormat: "no-check",
        safeLimit: 3,
        sample: 0,
        calls: 1,
        stopped: "" as const,
        refresh: "",
        locations: [],
        items: [],
        summary: { byFormat: {}, byLocation: {} },
      };
      onProgress(partial);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { ...partial, calls: 2, sample: 1 };
    });
    assert.equal(started.status, "running");
    assert.equal(started.safeLimit, 3);
    assert.match(started.poll, /^\/api\/admin\/kroger\/probe\//);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const done = krogerProbeJob(started.id);
    assert.equal(done?.status, "done");
    assert.equal(done?.calls, 2);
    assert.equal(done?.report?.sample, 1);
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
