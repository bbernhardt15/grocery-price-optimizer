import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import { RELEASE_ENV_KEYS, resolveRelease } from "./release";

describe("resolveRelease", () => {
  it("prefers SENTRY_RELEASE, then Railway, then Codemagic, then GitHub", () => {
    const none = () => "should-not-run";
    assert.equal(
      resolveRelease(
        {
          SENTRY_RELEASE: " explicit ",
          RAILWAY_GIT_COMMIT_SHA: "railway",
          CM_COMMIT: "codemagic",
        },
        none,
      ),
      "explicit",
    );
    assert.equal(
      resolveRelease({ RAILWAY_GIT_COMMIT_SHA: " railway ", CM_COMMIT: "codemagic" }, none),
      "railway",
    );
    assert.equal(resolveRelease({ CM_COMMIT: " codemagic " }, none), "codemagic");
    assert.equal(resolveRelease({ GITHUB_SHA: "github" }, none), "github");
    assert.equal(resolveRelease({ COMMIT_SHA: "commit" }, none), "commit");
    assert.equal(resolveRelease({ SOURCE_VERSION: "source" }, none), "source");
  });

  it("uses a git sha only when the host did not set one", () => {
    assert.equal(resolveRelease({}, () => "abc1234"), "abc1234");
    assert.equal(resolveRelease({}, () => "not-a-sha"), undefined);
    assert.equal(resolveRelease({}, () => ""), undefined);
  });

  it("reads the checkout sha when env is empty", () => {
    let head = "";
    try {
      head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    } catch {
      return;
    }
    assert.equal(resolveRelease({}), head);
  });

  it("checks the host variables in a stable order", () => {
    assert.deepEqual(RELEASE_ENV_KEYS, [
      "SENTRY_RELEASE",
      "RAILWAY_GIT_COMMIT_SHA",
      "CM_COMMIT",
      "GITHUB_SHA",
      "COMMIT_SHA",
      "SOURCE_VERSION",
    ]);
  });
});
