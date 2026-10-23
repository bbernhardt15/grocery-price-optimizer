const { execFileSync } = require("node:child_process");

/** First match wins. Railway and Codemagic set these without a local git checkout. */
const RELEASE_ENV_KEYS = [
  "SENTRY_RELEASE",
  "RAILWAY_GIT_COMMIT_SHA",
  "CM_COMMIT",
  "GITHUB_SHA",
  "COMMIT_SHA",
  "SOURCE_VERSION",
];

const GIT_SHA = /^[0-9a-f]{7,40}$/i;

function defaultGitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Release name for Sentry. Explicit env wins, then the host's git sha, then
 * `git rev-parse HEAD`. Empty when none of those exist.
 */
function resolveRelease(env = process.env, readGitSha = defaultGitSha) {
  for (const key of RELEASE_ENV_KEYS) {
    const value = typeof env[key] === "string" ? env[key].trim() : "";
    if (value) return value;
  }
  const git = typeof readGitSha === "function" ? String(readGitSha() || "").trim() : "";
  if (GIT_SHA.test(git)) return git;
  return undefined;
}

module.exports = {
  RELEASE_ENV_KEYS,
  resolveRelease,
};
