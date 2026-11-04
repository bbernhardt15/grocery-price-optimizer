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
const THIRD = "device-beta-03";
const STRANGER = "device-beta-04";

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

  it("stores the invite code from the device signup on feedback and ignores a code in the body", async () => {
    process.env.BETA_INVITE_CODES = "mom-uqq6,dad-uqq6";
    process.env.GG_ADMIN_TOKEN = "beta-admin";
    const auth = { authorization: "Bearer beta-admin" };
    await post("/api/beta/invite", { code: "mom-uqq6", deviceId: DEVICE }, { "x-device-id": DEVICE });
    await post("/api/beta/invite", { code: "dad-uqq6", deviceId: OTHER }, { "x-device-id": OTHER });

    const mom = await post(
      "/api/beta/feedback",
      { rating: 5, message: "The list was easy.", screen: "Review", code: "dad-uqq6", email: "mom@example.com", deviceId: DEVICE },
      { "x-device-id": DEVICE }
    );
    assert.equal(mom.status, 201);
    const dad = await post(
      "/api/beta/feedback",
      { rating: 3, message: "Search was slow.", code: "mom-uqq6", deviceId: OTHER },
      { "x-device-id": OTHER }
    );
    assert.equal(dad.status, 201);
    const stranger = await post(
      "/api/beta/feedback",
      { rating: 4, message: "No invite yet.", code: "mom-uqq6", deviceId: STRANGER },
      { "x-device-id": STRANGER }
    );
    assert.equal(stranger.status, 201);

    const stored = await BetaFeedback.findOne({ deviceId: DEVICE }).lean();
    assert.equal(stored?.code, "mom-uqq6");
    assert.equal("email" in (stored ?? {}), false);
    assert.equal(JSON.stringify(stored).includes("dad-uqq6"), false);
    assert.equal(JSON.stringify(stored).includes("example.com"), false);
    const blank = await BetaFeedback.findOne({ deviceId: STRANGER }).lean();
    assert.equal(blank?.code || "", "");

    const denied = await fetch(`${origin}/api/admin/beta/feedback?code=mom-uqq6`);
    assert.equal(denied.status, 401);
    const listed = await fetch(`${origin}/api/admin/beta/feedback?code=Mom-Uqq6`, { headers: auth });
    const listedBody = (await listed.json()) as { code: string; feedback: Array<{ code: string; message: string }> };
    assert.equal(listed.status, 200);
    assert.equal(listedBody.code, "Mom-Uqq6");
    assert.deepEqual(
      listedBody.feedback.map((row) => row.message),
      ["The list was easy."]
    );
    assert.equal(listedBody.feedback[0].code, "mom-uqq6");
    const packed = JSON.stringify(listedBody);
    assert.equal(packed.includes(DEVICE), false);
    assert.equal(packed.includes("example.com"), false);

    const wildcard = await fetch(`${origin}/api/admin/beta/feedback?code=${encodeURIComponent(".*")}`, { headers: auth });
    const wildcardBody = (await wildcard.json()) as { feedback: unknown[] };
    assert.equal(wildcard.status, 200);
    assert.deepEqual(wildcardBody.feedback, []);

    const csvResponse = await fetch(`${origin}/api/admin/beta/feedback.csv?code=mom-uqq6`, { headers: auth });
    const csv = await csvResponse.text();
    const [header, ...rows] = csv.trim().split("\n");
    assert.equal(csvResponse.status, 200);
    assert.equal(header.endsWith(",code"), true);
    assert.deepEqual(rows.length, 1);
    assert.match(rows[0], /The list was easy/);
    assert.match(rows[0], /mom-uqq6/);
    assert.equal(csv.includes("Search was slow"), false);
    assert.equal(csv.includes(DEVICE), false);

    const events = await fetch(`${origin}/api/admin/beta/events`, { headers: auth });
    const eventBody = (await events.json()) as { events: Array<{ name: string; count: number; byCode: Record<string, number> }> };
    const sent = eventBody.events.find((row) => row.name === "feedback_sent");
    assert.equal(sent?.count, 3);
    assert.equal(sent?.byCode["mom-uqq6"], 1);
    assert.equal(sent?.byCode["dad-uqq6"], 1);
    assert.equal(JSON.stringify(eventBody).includes(DEVICE), false);
  });

  it("stores the invite code from the device signup on client errors and ignores a code in the body", async () => {
    process.env.BETA_INVITE_CODES = "mom-uqq6,dad-uqq6";
    await post("/api/beta/invite", { code: "mom-uqq6", deviceId: DEVICE }, { "x-device-id": DEVICE });
    const first = await post(
      "/api/beta/client-errors",
      { message: "Review failed to paint", stack: "Error: Review failed\n at plan", code: "dad-uqq6", email: "mom@example.com", deviceId: DEVICE },
      { "x-device-id": DEVICE }
    );
    assert.equal(first.status, 202);
    assert.equal(first.json.stored, true);
    const stranger = await post(
      "/api/beta/client-errors",
      { message: "Stranger failed", code: "mom-uqq6", deviceId: STRANGER },
      { "x-device-id": STRANGER }
    );
    assert.equal(stranger.json.stored, true);

    const row = await BetaClientError.findOne({ deviceId: DEVICE }).lean();
    assert.equal(row?.code, "mom-uqq6");
    assert.equal("email" in (row ?? {}), false);
    assert.equal(JSON.stringify(row).includes("dad-uqq6"), false);
    assert.equal(JSON.stringify(row).includes("example.com"), false);
    const blank = await BetaClientError.findOne({ deviceId: STRANGER }).lean();
    assert.equal(blank?.code || "", "");
  });

  it("splits product counters by the device invite code and keeps the totals", async () => {
    process.env.BETA_INVITE_CODES = "mom-uqq6,dad-uqq6";
    process.env.GG_ADMIN_TOKEN = "beta-admin";
    const auth = { authorization: "Bearer beta-admin" };
    await post("/api/beta/invite", { code: "mom-uqq6", deviceId: DEVICE }, { "x-device-id": DEVICE });
    await post("/api/beta/invite", { code: "dad-uqq6", deviceId: OTHER }, { "x-device-id": OTHER });

    const first = await post(
      "/api/beta/events",
      { name: "trip_completed", code: "dad-uqq6", deviceId: DEVICE },
      { "x-device-id": DEVICE }
    );
    const second = await post(
      "/api/beta/events",
      { name: "trip_completed", code: "dad-uqq6", deviceId: DEVICE },
      { "x-device-id": DEVICE }
    );
    const dad = await post("/api/beta/events", { name: "trip_completed", deviceId: OTHER }, { "x-device-id": OTHER });
    const anonymous = await post("/api/beta/events", { name: "plan_built", code: "mom-uqq6" });
    assert.equal(first.json.stored, true);
    assert.equal(second.json.stored, true);
    assert.equal(dad.json.stored, true);
    assert.equal(anonymous.json.stored, true);

    const denied = await fetch(`${origin}/api/admin/beta/events?code=mom-uqq6`);
    assert.equal(denied.status, 401);
    const response = await fetch(`${origin}/api/admin/beta/events`, { headers: auth });
    const body = (await response.json()) as { events: Array<{ name: string; count: number; byCode: Record<string, number> }> };
    const counts = Object.fromEntries(body.events.map((row) => [row.name, row]));
    assert.equal(counts.trip_completed.count, 3);
    assert.equal(counts.trip_completed.byCode["mom-uqq6"], 2);
    assert.equal(counts.trip_completed.byCode["dad-uqq6"], 1);
    assert.equal(counts.plan_built.count, 1);
    assert.deepEqual(counts.plan_built.byCode, {});
    assert.equal(JSON.stringify(body).includes(DEVICE), false);

    const filtered = await fetch(`${origin}/api/admin/beta/events?code=mom-uqq6`, { headers: auth });
    const filteredBody = (await filtered.json()) as {
      code: string;
      events: Array<{ name: string; count: number; codeCount: number; byCode: Record<string, number> }>;
    };
    assert.equal(filteredBody.code, "mom-uqq6");
    const trip = filteredBody.events.find((row) => row.name === "trip_completed");
    const plan = filteredBody.events.find((row) => row.name === "plan_built");
    assert.equal(trip?.count, 3);
    assert.equal(trip?.codeCount, 2);
    assert.deepEqual(trip?.byCode, { "mom-uqq6": 2 });
    assert.equal(plan?.count, 1);
    assert.equal(plan?.codeCount, 0);
    assert.deepEqual(plan?.byCode, {});

    const wildcard = await fetch(`${origin}/api/admin/beta/events?code=${encodeURIComponent(".*")}`, { headers: auth });
    const wildcardBody = (await wildcard.json()) as { events: Array<{ name: string; codeCount: number }> };
    const wildcardTrip = wildcardBody.events.find((row) => row.name === "trip_completed");
    assert.equal(wildcardTrip?.codeCount, 0);
  });

  it("summarizes each invite code with devices, activity, feedback, trips, and errors", async () => {
    process.env.BETA_INVITE_CODES = "mom-uqq6,dad-uqq6";
    process.env.GG_ADMIN_TOKEN = "beta-admin";
    const auth = { authorization: "Bearer beta-admin" };
    await post("/api/beta/invite", { code: "mom-uqq6", deviceId: DEVICE }, { "x-device-id": DEVICE });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await post("/api/beta/invite", { code: "mom-uqq6", deviceId: THIRD }, { "x-device-id": THIRD });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await post("/api/beta/invite", { code: "dad-uqq6", deviceId: OTHER }, { "x-device-id": OTHER });

    await post(
      "/api/beta/feedback",
      { rating: 5, message: "From mom.", deviceId: DEVICE },
      { "x-device-id": DEVICE }
    );
    await post("/api/beta/events", { name: "trip_completed", deviceId: DEVICE }, { "x-device-id": DEVICE });
    await post(
      "/api/beta/client-errors",
      { message: "Mom hit an error", deviceId: DEVICE },
      { "x-device-id": DEVICE }
    );
    await post(
      "/api/beta/feedback",
      { rating: 2, message: "From dad.", deviceId: OTHER },
      { "x-device-id": OTHER }
    );

    const denied = await fetch(`${origin}/api/admin/beta/signups?code=mom-uqq6`);
    assert.equal(denied.status, 401);
    const response = await fetch(`${origin}/api/admin/beta/signups`, { headers: auth });
    const body = (await response.json()) as {
      codes: Array<{
        code: string;
        signups: number;
        devices: number;
        firstSeen: string;
        lastActive: string;
        lastSignupAt: string;
        feedbackCount: number;
        tripCompleteCount: number;
        errorCount: number;
      }>;
    };
    assert.equal(response.status, 200);
    const mom = body.codes.find((row) => row.code === "mom-uqq6");
    const dad = body.codes.find((row) => row.code === "dad-uqq6");
    assert.ok(mom);
    assert.ok(dad);
    assert.equal(mom.devices, 2);
    assert.equal(mom.signups, 2);
    assert.equal(mom.feedbackCount, 1);
    assert.equal(mom.tripCompleteCount, 1);
    assert.equal(mom.errorCount, 1);
    assert.equal(dad.devices, 1);
    assert.equal(dad.feedbackCount, 1);
    assert.equal(dad.tripCompleteCount, 0);
    assert.equal(dad.errorCount, 0);
    assert.ok(Date.parse(mom.firstSeen) <= Date.parse(mom.lastSignupAt));
    assert.ok(Date.parse(mom.lastActive) >= Date.parse(mom.firstSeen));
    assert.ok(Date.parse(dad.lastActive) >= Date.parse(dad.firstSeen));
    assert.equal(body.codes.map((row) => row.code).join(","), "dad-uqq6,mom-uqq6");
    const packed = JSON.stringify(body);
    assert.equal(packed.includes(DEVICE), false);
    assert.equal(packed.includes(THIRD), false);
    assert.equal(packed.includes("@"), false);

    const filtered = await fetch(`${origin}/api/admin/beta/signups?code=Mom-Uqq6`, { headers: auth });
    const filteredBody = (await filtered.json()) as { code: string; codes: Array<{ code: string }> };
    assert.equal(filteredBody.code, "Mom-Uqq6");
    assert.deepEqual(
      filteredBody.codes.map((row) => row.code),
      ["mom-uqq6"]
    );
    const wildcard = await fetch(`${origin}/api/admin/beta/signups?code=${encodeURIComponent(".*")}`, { headers: auth });
    const wildcardBody = (await wildcard.json()) as { codes: unknown[] };
    assert.deepEqual(wildcardBody.codes, []);
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
