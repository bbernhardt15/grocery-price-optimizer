import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type { Express } from "express";
import { observabilityResponse } from "./config";
import { sourcemapUploadPlan } from "./sourcemaps";

describe("observabilityResponse", () => {
  it("is a no-op payload when SENTRY_DSN is unset", () => {
    const body = observabilityResponse({ SENTRY_AUTH_TOKEN: "secret-token" });
    assert.deepEqual(body, { enabled: false });
    assert.equal(JSON.stringify(body).includes("secret-token"), false);
    assert.equal("dsn" in body, false);
  });

  it("returns the DSN and release and never the auth token", () => {
    const body = observabilityResponse(
      {
        SENTRY_DSN: " https://examplePublicKey@o0.ingest.sentry.io/0 ",
        SENTRY_RELEASE: "abc1234",
        SENTRY_ENVIRONMENT: "production",
        SENTRY_AUTH_TOKEN: "secret-token",
      },
      () => "should-not-run",
    );
    assert.equal(body.enabled, true);
    if (!body.enabled) return;
    assert.equal(body.dsn, "https://examplePublicKey@o0.ingest.sentry.io/0");
    assert.equal(body.release, "abc1234");
    assert.equal(body.environment, "production");
    assert.equal(JSON.stringify(body).includes("secret-token"), false);
  });
});

describe("GET /api/observability", () => {
  let server: http.Server;
  let origin: string;
  let previous: string | undefined;

  before(async () => {
    previous = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    const { default: app } = (await import("../app")) as { default: Express };
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (previous === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = previous;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("stays disabled until a DSN is set, then returns it without the auth token", async () => {
    delete process.env.SENTRY_DSN;
    process.env.SENTRY_AUTH_TOKEN = "secret-token";
    const off = await fetch(`${origin}/api/observability`);
    assert.equal(off.status, 200);
    const offBody = await off.json();
    assert.deepEqual(offBody, { enabled: false });

    process.env.SENTRY_DSN = "https://examplePublicKey@o0.ingest.sentry.io/0";
    process.env.SENTRY_RELEASE = "abc1234";
    const on = await fetch(`${origin}/api/observability`);
    const onBody = (await on.json()) as { enabled: boolean; dsn?: string; release?: string };
    assert.equal(onBody.enabled, true);
    assert.equal(onBody.dsn, "https://examplePublicKey@o0.ingest.sentry.io/0");
    assert.equal(onBody.release, "abc1234");
    assert.equal(JSON.stringify(onBody).includes("secret-token"), false);
    delete process.env.SENTRY_RELEASE;
    delete process.env.SENTRY_AUTH_TOKEN;
  });
});

describe("sourcemapUploadPlan", () => {
  it("skips when the auth token is unset", () => {
    assert.deepEqual(sourcemapUploadPlan({}), { upload: false });
    assert.deepEqual(sourcemapUploadPlan({ SENTRY_AUTH_TOKEN: "  " }), { upload: false });
  });

  it("requires org, project, and a release when the token is set", () => {
    assert.throws(
      () => sourcemapUploadPlan({ SENTRY_AUTH_TOKEN: "token" }),
      /SENTRY_ORG and SENTRY_PROJECT/,
    );
    assert.throws(
      () =>
        sourcemapUploadPlan(
          {
            SENTRY_AUTH_TOKEN: "token",
            SENTRY_ORG: "org",
            SENTRY_PROJECT: "project",
          },
          () => undefined,
        ),
      /SENTRY_RELEASE/,
    );
    assert.deepEqual(
      sourcemapUploadPlan({
        SENTRY_AUTH_TOKEN: "token",
        SENTRY_ORG: " org ",
        SENTRY_PROJECT: " project ",
        SENTRY_RELEASE: "abc1234",
      }),
      { upload: true, org: "org", project: "project", release: "abc1234" },
    );
  });
});

describe("sentry init", () => {
  it("does not start the SDK when SENTRY_DSN is unset", async () => {
    const previous = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    try {
      const sentry = await import("./sentry");
      sentry.initSentry();
      assert.equal(sentry.sentryIsActive(), false);
      sentry.captureServerException(new Error("shopper@example.com"));
      await sentry.flushSentry();
    } finally {
      if (previous === undefined) delete process.env.SENTRY_DSN;
      else process.env.SENTRY_DSN = previous;
    }
  });
});
