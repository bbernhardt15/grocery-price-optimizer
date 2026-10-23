/**
 * Bundle the browser and Capacitor Sentry SDKs into public/sentry.js.
 *
 * The default run deletes the source map so Express does not serve it.
 * `npm run build` passes --keep-map, uploads while the map exists, then
 * runs this file again with --strip-only.
 */
import esbuild from "esbuild";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const jsPath = fileURLToPath(new URL("../public/sentry.js", import.meta.url));
const mapPath = fileURLToPath(new URL("../public/sentry.js.map", import.meta.url));

function stripClientSourceMap() {
  try {
    const js = readFileSync(jsPath, "utf8").replace(/\n?\/\/# sourceMappingURL=\S+\s*$/u, "\n");
    writeFileSync(jsPath, js);
  } catch {
    // Nothing to strip when the bundle was not built.
  }
  rmSync(mapPath, { force: true });
}

if (process.argv.includes("--strip-only")) {
  stripClientSourceMap();
} else {
  await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/observability/browser.ts", import.meta.url))],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["es2020", "safari15", "chrome100"],
    outfile: jsPath,
    sourcemap: true,
    sourcesContent: true,
    minify: true,
    legalComments: "none",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  });
  if (!process.argv.includes("--keep-map")) {
    stripClientSourceMap();
  }
}
