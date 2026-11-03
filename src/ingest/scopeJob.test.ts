import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app";
import { isGroceryUpc } from "../catalog/normalize";
import { deactivateOutOfScopeCatalog } from "./maintenance";
import { finishLookups, krogerLookupBlock, matchProgress, nextKrogerLookups } from "./crossLookup";
import { CatalogMaster, CatalogMatchDay, CatalogOffer } from "./models";
import { readStoredRecords } from "./readStore";

describe("deactivate out-of-scope catalog", () => {
  let memory: MongoMemoryServer;

  before(async () => {
    memory = await MongoMemoryServer.create();
    await mongoose.connect(memory.getUri());
  });

  after(async () => {
    await mongoose.disconnect();
    await memory.stop();
    delete process.env.ADMIN_TOKEN;
  });

  it("dry-run counts by department and apply deactivates without deleting", async () => {
    const now = new Date("2026-11-02T12:00:00.000Z");
    await CatalogMaster.deleteMany({});
    await CatalogOffer.deleteMany({});
    await CatalogMatchDay.deleteMany({});
    const rows = [
      {
        key: "scope-milk",
        name: "Whole Milk",
        departmentId: "dairy-eggs",
        categoryPaths: ["Food/Dairy/Milk"],
        upc: "049000042566",
      },
      {
        key: "scope-paper",
        name: "Bounty Paper Towels",
        departmentId: "household",
        categoryPaths: ["Household Essentials/Paper"],
        upc: "016000275287",
      },
      {
        key: "scope-washer",
        name: "GE Profile Dishwasher",
        departmentId: "household",
        categoryPaths: ["Home/Appliances/Dishwashers"],
        upc: "012345678905",
      },
      {
        key: "scope-movies",
        name: "Disney Frozen",
        departmentId: "frozen",
        categoryPaths: ["Movies/Frozen Movies"],
        upc: "012345678905",
      },
      {
        key: "scope-delivery",
        name: "Haul away the old unit",
        departmentId: "deli",
        categoryPaths: ["Home/Services/Appliance Delivery"],
        upc: "012345678905",
      },
    ];
    for (const row of rows) {
      await CatalogMaster.create({
        ...row,
        brand: "Test",
        walmartItemId: row.key,
        lastSeenAt: now,
        status: "active",
      });
      await CatalogOffer.create({
        productKey: row.key,
        storeName: "Walmart",
        locationId: "",
        price: 4,
        lastSeenAt: now,
        status: "stale",
      });
    }

    const dry = await deactivateOutOfScopeCatalog(false);
    assert.equal(dry.dryRun, true);
    assert.equal(dry.apply, false);
    assert.equal(dry.updatedMasters, 0);
    assert.equal(dry.updatedOffers, 0);
    assert.equal(dry.byDepartment.household?.inScope, 1);
    assert.equal(dry.byDepartment.household?.outOfScope, 1);
    assert.equal(dry.byDepartment.frozen?.outOfScope, 1);
    assert.equal(dry.byDepartment.deli?.outOfScope, 1);
    assert.equal(dry.byDepartment["dairy-eggs"]?.inScope, 1);
    assert.ok(dry.sample.some((row) => row.key === "scope-delivery" && /appliance-delivery/.test(row.reason)));
    assert.ok(dry.sample.some((row) => row.key === "scope-movies" && /movies/.test(row.reason)));
    assert.equal((await CatalogMaster.findOne({ key: "scope-washer" }))?.status, "active");
    assert.equal(await CatalogMaster.countDocuments({ key: "scope-washer" }), 1);

    const preview = await readStoredRecords({ query: "dishwasher" });
    assert.ok(preview.records.some((row) => row.name.includes("Dishwasher")));

    const applied = await deactivateOutOfScopeCatalog(true);
    assert.equal(applied.dryRun, false);
    assert.equal(applied.apply, true);
    assert.ok(applied.updatedMasters >= 3);
    assert.ok(applied.updatedOffers >= 3);
    const washer = await CatalogMaster.findOne({ key: "scope-washer" }).lean<{ status?: string; outOfScope?: boolean }>();
    assert.equal(washer?.status, "discontinued");
    assert.equal(washer?.outOfScope, true);
    const washerOffer = await CatalogOffer.findOne({ productKey: "scope-washer" }).lean<{
      status?: string;
      outOfScope?: boolean;
      refreshExcluded?: boolean;
    }>();
    assert.equal(washerOffer?.status, "discontinued");
    assert.equal(washerOffer?.outOfScope, true);
    assert.equal(washerOffer?.refreshExcluded, true);
    assert.equal(await CatalogMaster.countDocuments({ key: "scope-washer" }), 1);
    assert.equal((await CatalogMaster.findOne({ key: "scope-milk" }))?.status, "active");
    assert.notEqual((await CatalogMaster.findOne({ key: "scope-paper" }))?.outOfScope, true);

    const hidden = await readStoredRecords({ query: "dishwasher" });
    assert.equal(hidden.records.some((row) => row.name.includes("Dishwasher")), false);
    const milk = await readStoredRecords({ query: "milk" });
    assert.ok(milk.records.some((row) => row.name === "Whole Milk"));
    const plans = await readStoredRecords({ departmentId: "household" });
    assert.equal(plans.records.some((row) => row.name.includes("Dishwasher")), false);
    assert.ok(plans.records.some((row) => row.name.includes("Paper Towels")));

    assert.equal(isGroceryUpc("049000042566"), true);
    assert.equal(krogerLookupBlock({ name: "GE Profile Dishwasher", categoryPaths: ["Home/Appliances/Dishwashers"], upc: "049000042566" }) !== null, true);
    assert.equal(
      krogerLookupBlock({
        name: "Whole Milk",
        departmentId: "dairy-eggs",
        categoryPaths: ["Food/Dairy/Milk"],
        upc: "12345",
      }),
      "upc-check"
    );
    assert.equal(
      krogerLookupBlock({
        name: "Whole Milk",
        departmentId: "dairy-eggs",
        categoryPaths: ["Food/Dairy/Milk"],
        upc: "049000042566",
      }),
      null
    );

    await CatalogMaster.updateMany({}, { $set: { matchKrogerAt: now } });
    await CatalogMaster.updateOne({ key: "scope-milk" }, { $unset: { matchKrogerAt: 1 } });
    await CatalogMaster.updateOne({ key: "scope-washer" }, { $unset: { matchKrogerAt: 1 }, $set: { status: "active", outOfScope: false } });
    const picks = await nextKrogerLookups(now, 5);
    assert.deepEqual(picks.map((pick) => pick.key), ["scope-milk"]);
    assert.equal(picks[0]?.departmentId, "dairy-eggs");

    await finishLookups("kroger", picks, now);
    const progress = await matchProgress(now);
    assert.equal(progress.hitRate.krogerAttempts, 1);
    assert.equal(progress.hitRate.krogerByDepartment["dairy-eggs"]?.attempts, 1);
    assert.equal(typeof progress.hitRate.krogerByDepartment["dairy-eggs"]?.rate, "number");
  });

  it("serves a safe dry-run and requires apply true to write", async () => {
    process.env.ADMIN_TOKEN = "secret-token";
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const denied = await fetch(`${origin}/api/admin/catalog/deactivate-out-of-scope`);
    assert.equal(denied.status, 401);
    const dry = await fetch(`${origin}/api/admin/catalog/deactivate-out-of-scope`, {
      headers: { authorization: "Bearer secret-token" },
    });
    assert.equal(dry.status, 200);
    const dryBody = (await dry.json()) as { dryRun: boolean; apply: boolean; byDepartment: Record<string, { inScope: number }> };
    assert.equal(dryBody.dryRun, true);
    assert.equal(dryBody.apply, false);
    const before = (await CatalogMaster.findOne({ key: "scope-milk" }))?.status;
    const posted = await fetch(`${origin}/api/admin/catalog/deactivate-out-of-scope`, {
      method: "POST",
      headers: { authorization: "Bearer secret-token", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(posted.status, 200);
    const postedBody = (await posted.json()) as { dryRun: boolean };
    assert.equal(postedBody.dryRun, true);
    assert.equal((await CatalogMaster.findOne({ key: "scope-milk" }))?.status, before);
    const status = await fetch(`${origin}/api/admin/catalog/status`, {
      headers: { authorization: "Bearer secret-token" },
    });
    const statusBody = (await status.json()) as {
      scope: { inScopeProducts: number; outOfScopeProducts: number; byDepartment: Record<string, { inScope: number; outOfScope: number }> };
      refresh: { staleRatio: number; adaptedShareWalmart: number };
      match: { hitRate: { krogerByDepartment: Record<string, { attempts: number }> } };
    };
    assert.equal(status.status, 200);
    assert.equal(typeof statusBody.scope.inScopeProducts, "number");
    assert.equal(typeof statusBody.scope.outOfScopeProducts, "number");
    assert.equal(typeof statusBody.refresh.staleRatio, "number");
    assert.equal(typeof statusBody.refresh.adaptedShareWalmart, "number");
    assert.equal(typeof statusBody.match.hitRate.krogerByDepartment, "object");
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
});
