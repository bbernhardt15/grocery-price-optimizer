import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app";
import { matchProgress } from "./crossLookup";
import { CooldownBusyError, clearMatchCooldowns } from "./clearMatchCooldowns";
import { CatalogMaster, IngestLock } from "./models";

describe("match cooldown reset", () => {
  let memory: MongoMemoryServer;

  before(async () => {
    memory = await MongoMemoryServer.create();
    await mongoose.connect(memory.getUri());
  });

  after(async () => {
    await mongoose.disconnect();
    await memory.stop();
  });

  it("previews Kroger cooldowns and clears only those rows", async () => {
    const now = new Date("2026-11-11T12:00:00.000Z");
    await CatalogMaster.deleteMany({});
    await IngestLock.deleteMany({ _id: "match-cooldown" });
    await CatalogMaster.create([
      {
        key: "dairy-miss",
        name: "Whole Milk",
        brand: "Dairy Pure",
        departmentId: "dairy-eggs",
        walmartItemId: "1",
        upc: "016000124790",
        matchKrogerAt: now,
        lastSeenAt: now,
      },
      {
        key: "pantry-miss",
        name: "Black Beans",
        brand: "Bush's",
        departmentId: "pantry",
        walmartItemId: "2",
        upc: "070708200500",
        matchKrogerAt: now,
        lastSeenAt: now,
      },
      {
        key: "already-merged",
        name: "Cheerios",
        brand: "General Mills",
        departmentId: "breakfast",
        walmartItemId: "3",
        krogerProductId: "0001600012479",
        upc: "016000124790",
        matchKrogerAt: now,
        lastSeenAt: now,
      },
      {
        key: "walmart-miss",
        name: "Kroger Milk",
        brand: "Kroger",
        departmentId: "dairy-eggs",
        krogerProductId: "0001111041700",
        upc: "0001111041700",
        matchWalmartAt: now,
        lastSeenAt: now,
      },
    ]);
    const dry = await clearMatchCooldowns({ apply: false, store: "kroger", now, pauseMs: 0 });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.kroger, 2);
    assert.equal(dry.walmart, 0);
    assert.equal(dry.cleared, 0);
    const progressBefore = await matchProgress(now);
    assert.equal(progressBefore.cooldowns.kroger, 2);
    const pauses: number[] = [];
    const applied = await clearMatchCooldowns({
      apply: true,
      store: "kroger",
      now,
      pauseMs: 0,
      cooldownMs: 0,
      batchSize: 1,
      pause: async (ms) => {
        pauses.push(ms);
      },
    });
    assert.equal(applied.dryRun, false);
    assert.equal(applied.cleared, 2);
    assert.ok(pauses.length >= 1);
    const again = await clearMatchCooldowns({ apply: false, store: "kroger", now });
    assert.equal(again.kroger, 0);
    const merged = await CatalogMaster.findOne({ key: "already-merged" }).lean<{ matchKrogerAt?: Date } | null>();
    assert.ok(merged?.matchKrogerAt);
    const progressAfter = await matchProgress(now);
    assert.equal(progressAfter.cooldowns.kroger, 0);
    assert.equal(progressAfter.cooldowns.walmart, 1);
  });

  it("refuses a second apply while the lock is held", async () => {
    await IngestLock.deleteMany({ _id: "match-cooldown" });
    const now = new Date();
    let releaseHold: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const running = clearMatchCooldowns({
      apply: true,
      store: "walmart",
      now,
      pauseMs: 0,
      cooldownMs: 60_000,
      hold: () => held,
    });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const lock = await IngestLock.findById("match-cooldown").lean<{ owner?: string } | null>();
      if (lock?.owner && lock.owner !== "cooldown") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await assert.rejects(clearMatchCooldowns({ apply: true, now, pauseMs: 0 }), CooldownBusyError);
    const dry = await clearMatchCooldowns({ apply: false, now });
    assert.equal(dry.dryRun, true);
    process.env.ADMIN_TOKEN = "secret-token";
    const server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const headers = { authorization: "Bearer secret-token", "content-type": "application/json" };
    try {
      const denied = await fetch(`${origin}/api/admin/catalog/match-cooldowns`);
      assert.equal(denied.status, 401);
      const blocked = await fetch(`${origin}/api/admin/catalog/match-cooldowns`, {
        method: "POST",
        headers,
        body: JSON.stringify({ apply: true, confirm: "clear-match-cooldowns", store: "kroger" }),
      });
      assert.equal(blocked.status, 409);
      const peeked = await fetch(`${origin}/api/admin/catalog/match-cooldowns?store=kroger`, {
        headers: { authorization: "Bearer secret-token" },
      });
      assert.equal(peeked.status, 200);
      const body = (await peeked.json()) as { dryRun?: boolean };
      assert.equal(body.dryRun, true);
    } finally {
      releaseHold();
      await running.catch(() => undefined);
      server.close();
      delete process.env.ADMIN_TOKEN;
    }
  });
});
