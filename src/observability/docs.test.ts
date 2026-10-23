import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function read(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

describe("crash reporting docs", () => {
  it("documents the env vars and the no-op when SENTRY_DSN is unset", () => {
    const readme = read("README.md");
    const example = read(".env.example");
    const cloud = read("docs/IOS_CLOUD_BUILD.md");
    for (const name of ["SENTRY_DSN", "SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT", "SENTRY_RELEASE"]) {
      assert.match(readme, new RegExp(name));
      assert.match(example, new RegExp(name));
    }
    assert.match(readme, /SENTRY_DSN` is set/);
    assert.match(readme, /does not download the SDK/);
    assert.match(cloud, /SENTRY_DSN/);
    assert.match(cloud, /SENTRY_AUTH_TOKEN/);
    assert.match(example, /Leave SENTRY_DSN empty/);
  });

  it("tells Codemagic to skip upload when the auth token is unset", () => {
    const yaml = read("codemagic.yaml");
    assert.match(yaml, /Sentry debug file upload skipped \(SENTRY_AUTH_TOKEN unset\)/);
    assert.match(yaml, /SENTRY_ORG/);
    assert.match(yaml, /SENTRY_PROJECT/);
    assert.equal(yaml.split("Sentry debug file upload skipped").length, 3);
  });

  it("lists crash data on the store privacy labels", () => {
    const store = read("docs/APP_STORE.md");
    assert.match(store, /Diagnostics → Crash Data/);
    assert.match(store, /App info → Crash logs/);
    assert.match(store, /SENTRY_DSN/);
    assert.match(store, /kroger_shopper/);
    assert.match(store, /not tied to an account|Not linked to identity/);
    assert.match(store, /crash report/);
  });
});
