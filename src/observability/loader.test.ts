import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const require = createRequire(__filename);
const { resolveLoaderConfig, observabilityUrl } = require("../../public/sentry-loader.js") as {
  resolveLoaderConfig: (input: {
    baked?: { dsn?: string; release?: string; environment?: string };
    remote?: { enabled?: boolean; dsn?: string; release?: string; environment?: string } | null;
  }) => { dsn: string; release: string; environment: string } | null;
  observabilityUrl: (apiOrigin: string) => string;
};

const { nativeConfigSource, nativeSentryFields } = require("../../scripts/native-config.js") as {
  nativeConfigSource: (origin: string, sentry?: { dsn: string; release: string; environment: string }) => string;
  nativeSentryFields: (
    env: { SENTRY_DSN?: string; SENTRY_ENVIRONMENT?: string },
    release: string,
  ) => { dsn: string; release: string; environment: string };
};

describe("sentry loader", () => {
  it("does nothing without a DSN", () => {
    assert.equal(resolveLoaderConfig({}), null);
    assert.equal(resolveLoaderConfig({ baked: { dsn: "  " }, remote: { enabled: false } }), null);
    assert.equal(resolveLoaderConfig({ remote: { enabled: false, dsn: "https://ignored.example/1" } }), null);
  });

  it("uses a baked DSN and keeps the native release ahead of the server sha", () => {
    const config = resolveLoaderConfig({
      baked: { dsn: "", release: "native-sha", environment: "production" },
      remote: {
        enabled: true,
        dsn: "https://examplePublicKey@o0.ingest.sentry.io/0",
        release: "server-sha",
        environment: "staging",
      },
    });
    assert.deepEqual(config, {
      dsn: "https://examplePublicKey@o0.ingest.sentry.io/0",
      release: "native-sha",
      environment: "production",
    });
  });

  it("asks the API on the page origin or the native API origin", () => {
    assert.equal(observabilityUrl(""), "/api/observability");
    assert.equal(
      observabilityUrl("https://grocery-price-optimizer-production.up.railway.app"),
      "https://grocery-price-optimizer-production.up.railway.app/api/observability",
    );
  });

  it("is loaded from the shopper page after the native shell", () => {
    const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
    const shell = html.indexOf('src="/native-shell.js');
    const loader = html.indexOf('src="/sentry-loader.js');
    assert.ok(shell > 0);
    assert.ok(loader > shell);
  });
});

describe("native sentry config", () => {
  it("bakes an empty DSN when SENTRY_DSN is unset and still records the release", () => {
    const fields = nativeSentryFields({}, "abc1234");
    assert.equal(fields.dsn, "");
    assert.equal(fields.release, "abc1234");
    assert.equal(fields.environment, "production");
    const source = nativeConfigSource("https://grocery.example", fields);
    assert.match(source, /GROCERY_GITTER_API_ORIGIN = "https:\/\/grocery.example"/);
    assert.match(source, /"dsn":""/);
    assert.match(source, /"release":"abc1234"/);
    assert.equal(source.includes("SENTRY_AUTH_TOKEN"), false);
  });

  it("trims a DSN and keeps a custom environment", () => {
    const fields = nativeSentryFields(
      { SENTRY_DSN: " https://examplePublicKey@o0.ingest.sentry.io/0 ", SENTRY_ENVIRONMENT: "staging" },
      "abc1234",
    );
    assert.equal(fields.dsn, "https://examplePublicKey@o0.ingest.sentry.io/0");
    assert.equal(fields.environment, "staging");
  });
});
