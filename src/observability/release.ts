import { createRequire } from "node:module";

const nodeRequire = createRequire(__filename);

type ReleaseEnv = {
  RELEASE_ENV_KEYS: readonly string[];
  resolveRelease: (
    env?: NodeJS.ProcessEnv,
    readGitSha?: () => string | undefined,
  ) => string | undefined;
};

const releaseEnv = nodeRequire("../../scripts/release-env.js") as ReleaseEnv;

export const RELEASE_ENV_KEYS = releaseEnv.RELEASE_ENV_KEYS;

/** Git sha (or SENTRY_RELEASE) used as the Sentry release. Undefined when unknown. */
export function resolveRelease(
  env: NodeJS.ProcessEnv = process.env,
  readGitSha?: () => string | undefined,
): string | undefined {
  return releaseEnv.resolveRelease(env, readGitSha);
}
