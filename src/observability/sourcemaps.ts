import { resolveRelease } from "./release";

export type SourcemapSkip = { upload: false };

export type SourcemapPlan = {
  upload: true;
  release: string;
  org: string;
  project: string;
};

/**
 * Source map upload runs only when SENTRY_AUTH_TOKEN is set.
 * A token without an org, project, or release is a broken upload, not a skip.
 */
export function sourcemapUploadPlan(
  env: NodeJS.ProcessEnv = process.env,
  readGitSha?: () => string | undefined,
): SourcemapSkip | SourcemapPlan {
  const token = env.SENTRY_AUTH_TOKEN?.trim() ?? "";
  if (!token) return { upload: false };
  const org = env.SENTRY_ORG?.trim() ?? "";
  const project = env.SENTRY_PROJECT?.trim() ?? "";
  if (!org || !project) {
    throw new Error(
      "SENTRY_AUTH_TOKEN is set but SENTRY_ORG and SENTRY_PROJECT are required to upload source maps.",
    );
  }
  const release = resolveRelease(env, readGitSha);
  if (!release) {
    throw new Error(
      "SENTRY_AUTH_TOKEN is set but no git sha was found for the Sentry release. Set SENTRY_RELEASE.",
    );
  }
  return { upload: true, release, org, project };
}
