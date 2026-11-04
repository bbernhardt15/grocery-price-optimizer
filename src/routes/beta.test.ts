import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app";
import { BetaClientError, BetaEvent, BetaFeedback, BetaSignup } from "../beta/models";
import { resetRateLimits } from "../beta/rateLimit";
import { FEEDBACK_LIMIT, feedbackTextIssue, pickContext, readyPayload } from "../beta/service";
import { sentryIsActive } from "../observability/sentry";

const DEVICE = "device-beta-01";
const OTHER = "device-beta-02";

describe("beta tester routes", { concurrency: false }, () => {
  let memory: MongoMemoryServer;
  let server: http.Server;
  let origin: string;
  const previous = {
    GG_ADMIN_TOKEN: process.env.GG_ADMIN_TOKEN,
    ADMIN_TOKEN: process.env.ADMIN_TOKEN,
    BETA_INVITE_CODES: process.env.BETA_INVITE_CODES,
    SENTRY_DSN: process.env.SENTRY_DSN,
  };

  before(async () => {
    delete process.env.SENTRY_DSN;
    memory = await MongoMemoryServer.create();
    await mongoose.connect(memory.getUri());
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    restore("GG_ADMIN_TOKEN", previous.GG_ADMIN_TOKEN);
    restore("ADMIN_TOKEN", previous.ADMIN_TOKEN);
    restore("BETA_INVITE_CODES", previous.BETA_INVITE_CODES);
    restore("SENTRY_DSN", previous.SENTRY_DSN);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await mongoose.disconnect();
    await memory.stop();
  });

  beforeEach(async () => {
    resetRateLimits();
    delete process.env.GG_ADMIN_TOKEN;
    delete process.env.BETA_INVITE_CODES;
    await Promise.all([
      BetaFeedback.deleteMany({}),
      BetaSignup.deleteMany({}),
      BetaEvent.deleteMany({}),
      BetaClientError.deleteMany({}),
    ]);
  });

  function restore(name: string, value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: Record<string, unknown> }> {
    const response = await fetch(`${origin}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  it("GET /api/health/ready reports mongo when the database is up", async () => {
    const response = await fetch(`${origin}/api/health/ready`);
    const body = (await response.json()) as { ok: boolean; mongo: string };
    assert.equal(response.status, 200);
    assert.deepEqual(body, { ok: true, mongo: "connected" });
    assert.deepEqual(readyPayload(0), { status: 503, body: { ok: false, mongo: "unavailable" } });
  });

  it("stays open when BETA_INVITE_CODES is unset", async () => {
    const gate = await fetch(`${origin}/api/beta/gate`);
    assert.deepEqual(await gate.json(), { required: false });
    const invite = await post("/api/beta/invite", { code: "anything", deviceId: DEVICE }, { "x-device-id": DEVICE });
    assert.equal(invite.status, 200);
    assert.deepEqual(invite.json, { ok: true, required: false });
    assert.equal(await BetaSignup.countDocuments(), 0);
  });

  it("remembers a valid code and counts signups without personal data", async () => {
    process.env.BETA_INVITE_CODES = "friend, neighbor";
    const missing = await post("/api/beta/invite", { code: "nope", deviceId: DEVICE }, { "x-device-id": DEVICE });
    assert.equal(missing.status, 401);
    assert.equal(await BetaSignup.countDocuments(), 0);

    const first = await post("/api/beta/invite", { code: "Friend", deviceId: DEVICE }, { "x-device-id": DEVICE });
    assert.equal(first.status, 200);
    assert.deepEqual(first.json, { ok: true, required: true });
    await new Promise((resolve) => setTimeout(resolve, 15));
    const second = await post("/api/beta/invite", { code: "neighbor", deviceId: OTHER }, { "x-device-id": OTHER });
    assert.equal(second.status, 200);
    const again = await post("/api/beta/invite", { code: "neighbor", deviceId: DEVICE }, { "x-device-id": DEVICE });
    assert.equal(again.status, 200);

    process.env.GG_ADMIN_TOKEN = "beta-admin";
    const denied = await fetch(`${origin}/api/admin/beta/signups`);
    assert.equal(denied.status, 401);
    const listed = await fetch(`${origin}/api/admin/beta/signups`, {
      headers: { authorization: "Bearer beta-admin" },
    });
    const body = (await listed.json()) as { codes: Array<{ code: string; signups: number }> };
    assert.equal(listed.status, 200);
    assert.deepEqual(
      body.codes.map((row) => `${row.code}:${row.signups}`),
      ["neighbor:1", "friend:1"]
    );
    const packed = JSON.stringify(body);
    assert.equal(packed.includes(DEVICE), false);
    assert.equal(packed.includes("@"), false);
    const kept = await BetaSignup.findOne({ deviceId: DEVICE }).lean();
    assert.equal(kept?.code, "friend");
  });

  it("stores a rating with non-sensitive context and lists it newest first", async () => {
    const context = {
      appVersion: "1.0.0",
      shellCache: "v35",
      screen: "/",
      tab: "plan",
      userAgent: "BetaTest",
      tripItemCount: 3,
      storeCount: 2,
      timestamp: "2026-11-04T01:00:00.000Z",
      receipt: "secret whole milk 3.29",
      items: ["secret whole milk"],
    };
    assert.equal("receipt" in pickContext(context), false);
    const older = await post(
      "/api/beta/feedback",
      { rating: 2, message: "Add was fine.", screen: "Add", context, deviceId: DEVICE },
      { "x-device-id": DEVICE }
    );
    assert.equal(older.status, 201);
    await new Promise((resolve) => setTimeout(resolve, 15));
    const newer = await post(
      "/api/beta/feedback",
      { rating: 5, message: "Review was clear.", screen: "Review", context, deviceId: DEVICE },
      { "x-device-id": DEVICE }
    );
    assert.equal(newer.status, 201);

    const stored = await BetaFeedback.find().lean();
    assert.equal(stored.length, 2);
    for (const row of stored) {
      const packed = JSON.stringify(row);
      assert.equal(packed.includes("secret whole milk"), false);
      assert.equal(packed.includes("receipt"), false);
      assert.equal(row.context?.tripItemCount, 3);
      assert.equal(row.context?.storeCount, 2);
      assert.equal(row.context?.shellCache, "v35");
    }

    process.env.GG_ADMIN_TOKEN = "beta-admin";
    const open = await fetch(`${origin}/api/admin/beta/feedback`);
    assert.equal(open.status, 401);
    const listed = await fetch(`${origin}/api/admin/beta/feedback`, {
      headers: { "x-admin-token": "beta-admin" },
    });
    const body = (await listed.json()) as { feedback: Array<{ rating: number; message: string; deviceId?: string }> };
    assert.equal(body.feedback.map((row) => row.rating).join(","), "5,2");
    assert.equal(JSON.stringify(body).includes("device-beta"), false);

    const csvResponse = await fetch(`${origin}/api/admin/beta/feedback.csv`, {
      headers: { authorization: "Bearer beta-admin" },
    });
    const csv = await csvResponse.text();
    assert.equal(csvResponse.status, 200);
    assert.match(csvResponse.headers.get("content-type") || "", /text\/csv/);
    assert.match(csv, /Review was clear/);
    assert.match(csv, /Add was fine/);
    assert.equal(csv.includes("secret whole milk"), false);
    assert.ok(csv.indexOf("Review was clear") < csv.indexOf("Add was fine"));
  });

  it("rejects receipt contents, a missing device, and a burst of notes", async () => {
    const anonymous = await post("/api/beta/feedback", { rating: 4, message: "Hello" });
    assert.equal(anonymous.status, 401);
    const receipt = await post(
      "/api/beta/feedback",
      { rating: 4, message: "Milk $1.00 bread $2.00 eggs $3.00 bananas $4.00 subtotal", deviceId: DEVICE },
      { "x-device-id": DEVICE }
    );
    assert.equal(receipt.status, 400);
    assert.match(feedbackTextIssue("password: hunter2") || "", /password/i);
    const secret = await post(
      "/api/beta/feedback",
      { rating: 4, message: "password: hunter2", deviceId: DEVICE },
      { "x-device-id": DEVICE }
    );
    assert.equal(secret.status, 400);

    for (let index = 0; index < FEEDBACK_LIMIT; index += 1) {
      const ok = await post(
        "/api/beta/feedback",
        { rating: 3, message: `Note ${index}`, deviceId: DEVICE },
        { "x-device-id": DEVICE }
      );
      assert.equal(ok.status, 201);
    }
    const limited = await post(
      "/api/beta/feedback",
      { rating: 3, message: "One more", deviceId: DEVICE },
      { "x-device-id": DEVICE }
    );
    assert.equal(limited.status, 429);
  });

  it("requires GG_ADMIN_TOKEN and accepts ADMIN_TOKEN", async () => {
    const saved = process.env.ADMIN_TOKEN;
    delete process.env.ADMIN_TOKEN;
    delete process.env.GG_ADMIN_TOKEN;
    try {
      const missing = await fetch(`${origin}/api/admin/beta/feedback`);
      assert.equal(missing.status, 503);
      process.env.ADMIN_TOKEN = "catalog-admin";
      const withAdmin = await fetch(`${origin}/api/admin/beta/events`, {
        headers: { authorization: "Bearer catalog-admin" },
      });
      assert.equal(withAdmin.status, 200);
    } finally {
      if (saved === undefined) delete process.env.ADMIN_TOKEN;
      else process.env.ADMIN_TOKEN = saved;
    }
  });

  it("counts product events and summarizes them for an admin", async () => {
    const built = await post("/api/beta/events", { name: "plan_built" });
    const again = await post("/api/beta/events", { name: "plan_built" });
    const walmart = await post("/api/beta/events", { name: "walmart_opened" });
    const unknown = await post("/api/beta/events", { name: "feedback_sent" });
    assert.equal(built.status, 202);
    assert.equal(built.json.stored, true);
    assert.equal(again.json.stored, true);
    assert.equal(walmart.json.stored, true);
    assert.equal(unknown.status, 400);

    await post(
      "/api/beta/feedback",
      { rating: 4, message: "Sent from the sheet.", deviceId: DEVICE },
      { "x-device-id": DEVICE }
    );
    process.env.GG_ADMIN_TOKEN = "beta-admin";
    const response = await fetch(`${origin}/api/admin/beta/events`, {
      headers: { authorization: "Bearer beta-admin" },
    });
    const body = (await response.json()) as { events: Array<{ name: string; count: number }> };
    const counts = Object.fromEntries(body.events.map((row) => [row.name, row.count]));
    assert.equal(counts.plan_built, 2);
    assert.equal(counts.walmart_opened, 1);
    assert.equal(counts.feedback_sent, 1);
    assert.equal(counts.onboarding_completed, 0);
    assert.equal(counts.kroger_cart_sent, 0);
    assert.equal(counts.trip_completed, 0);
    assert.equal(counts.receipt_imported, 0);
    const packed = JSON.stringify(body);
    assert.equal(packed.includes(DEVICE), false);
  });

  it("records a client error without Sentry when SENTRY_DSN is unset and throttles repeats", async () => {
    assert.equal(process.env.SENTRY_DSN, undefined);
    assert.equal(sentryIsActive(), false);
    const first = await post(
      "/api/beta/client-errors",
      { message: "Something broke on review", stack: "Error: Something broke\n at plan", deviceId: DEVICE },
      { "x-device-id": DEVICE }
    );
    const second = await post(
      "/api/beta/client-errors",
      { message: "Something broke on review", deviceId: DEVICE },
      { "x-device-id": DEVICE }
    );
    assert.equal(first.status, 202);
    assert.equal(first.json.stored, true);
    assert.equal(second.json.stored, false);
    assert.equal(await BetaClientError.countDocuments(), 1);
    const row = await BetaClientError.findOne().lean();
    assert.match(row?.message || "", /Something broke/);
    assert.equal(JSON.stringify(row).includes("password"), false);
  });

  it("deletes feedback, the invite signup, and client errors with the account route", async () => {
    await BetaFeedback.create({ rating: 4, message: "Keep the other device", deviceId: OTHER, screen: "", context: {} });
    await BetaFeedback.create({ rating: 5, message: "Mine", deviceId: DEVICE, screen: "Review", context: { tripItemCount: 1, storeCount: 1 } });
    await BetaSignup.create({ deviceId: DEVICE, code: "friend" });
    await BetaSignup.create({ deviceId: OTHER, code: "neighbor" });
    await BetaClientError.create({ message: "Mine", deviceId: DEVICE });
    await BetaEvent.create({ name: "plan_built", count: 4 });

    const response = await fetch(`${origin}/api/me/data`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: DEVICE }),
    });
    const body = (await response.json()) as { beta: { feedback: number; signups: number; clientErrors: number } };
    assert.equal(response.status, 200);
    assert.equal(body.beta.feedback, 1);
    assert.equal(body.beta.signups, 1);
    assert.equal(body.beta.clientErrors, 1);
    assert.equal(await BetaFeedback.countDocuments({ deviceId: DEVICE }), 0);
    assert.equal(await BetaFeedback.countDocuments({ deviceId: OTHER }), 1);
    assert.equal(await BetaSignup.countDocuments({ deviceId: DEVICE }), 0);
    assert.equal(await BetaSignup.countDocuments({ deviceId: OTHER }), 1);
    const counter = await BetaEvent.findOne({ name: "plan_built" }).lean();
    assert.equal(counter?.count, 4);
  });
});
