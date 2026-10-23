/**
 * Copy public/ into the iOS and Android projects.
 * The website's native-config.js stays empty (same-origin /api). The copies
 * inside ios/ and android/ get CAPACITOR_API_URL, or the production Railway
 * origin when that variable is unset.
 *
 * Loads .env so CAPACITOR_API_URL and CAPACITOR_SERVER_URL can live there.
 * capacitor.config.ts reads CAPACITOR_SERVER_URL from the environment.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import dotenv from "dotenv";

dotenv.config();

const require = createRequire(import.meta.url);
const { resolveSyncApiUrl } = require("../public/native-shell.js");
const { nativeConfigSource, nativeSentryFields } = require("./native-config.js");
const { resolveRelease } = require("./release-env.js");

const configPath = new URL("../public/native-config.js", import.meta.url);
const original = readFileSync(configPath, "utf8");

function nativeConfig(origin) {
  const release = resolveRelease(process.env) || "";
  return nativeConfigSource(origin, nativeSentryFields(process.env, release));
}

let status = 1;
try {
  const origin = resolveSyncApiUrl(process.env.CAPACITOR_API_URL);
  writeFileSync(configPath, nativeConfig(origin));
  const args = process.argv.slice(2);
  const result = spawnSync("npx", ["cap", "sync", ...args], {
    stdio: "inherit",
    env: process.env,
  });
  status = result.status === null ? 1 : result.status;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  status = 1;
} finally {
  writeFileSync(configPath, original);
}

process.exit(status);
