/**
 * Upload server and browser source maps when SENTRY_AUTH_TOKEN is set.
 * With no token this still builds the browser bundle and exits 0.
 * The auth token stays in the environment. It is not passed on the command line.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { sourcemapUploadPlan } from "../src/observability/sourcemaps";

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.slice(0, 2).join(" ")} failed`);
  }
}

function buildClient(keepMap: boolean): void {
  const args = ["scripts/build-sentry-client.mjs"];
  if (keepMap) args.push("--keep-map");
  run("node", args);
}

function stripClient(): void {
  run("node", ["scripts/build-sentry-client.mjs", "--strip-only"]);
}

let plan: ReturnType<typeof sourcemapUploadPlan>;
try {
  plan = sourcemapUploadPlan(process.env);
} catch (error) {
  buildClient(false);
  throw error;
}

if (!plan.upload) {
  buildClient(false);
  console.log("Sentry source map upload skipped (SENTRY_AUTH_TOKEN unset).");
  process.exit(0);
}

try {
  buildClient(true);
  const paths = ["dist", "public/sentry.js"].filter((entry) => existsSync(entry));
  if (paths.length === 0) {
    throw new Error("No source map paths to upload. Run the TypeScript build first.");
  }
  const common = ["--org", plan.org, "--project", plan.project];
  run("npx", ["sentry-cli", "sourcemaps", "inject", ...common, ...paths]);
  run("npx", ["sentry-cli", "sourcemaps", "upload", ...common, "--release", plan.release, ...paths]);
  console.log(`Uploaded Sentry source maps for release ${plan.release}.`);
} finally {
  stripClient();
}
