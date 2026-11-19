import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";
import app from "../app";
import { krogerMatchLookupPaused } from "../catalog/krogerLookupFormat";
import { krogerFormatCode, krogerLookupCodes, krogerProbeCandidates } from "../catalog/normalize";
import { MemoryBudgetStore } from "./budget";
import { runKrogerProbe } from "./krogerProbe";

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
    const shapes = krogerProbeCandidates("4011").map((row) => row.format);
    assert.ok(shapes.includes("plu"));
    assert.ok(shapes.includes("no-check"));
    assert.equal(krogerFormatCode("4011", "plu"), "0000000004011");
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
    assert.equal(report.summary.byFormat["no-check"]?.hits, 1);
    assert.equal(report.summary.byLocation.none?.hits, 1);
    assert.equal(report.items[0]?.attempts.find((row) => row.format === "no-check" && row.locationId === null)?.hit, true);
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
    } finally {
      server.close();
    }
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
