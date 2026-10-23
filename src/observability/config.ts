import { resolveRelease } from "./release";

export type ObservabilityOff = { enabled: false };

export type ObservabilityOn = {
  enabled: true;
  dsn: string;
  release: string | null;
  environment: string;
};

export type ObservabilityResponse = ObservabilityOff | ObservabilityOn;

export function readSentryDsn(env: NodeJS.ProcessEnv = process.env): string {
  return env.SENTRY_DSN?.trim() ?? "";
}

/** Client config for the website and the native WebView. No auth token. */
export function observabilityResponse(
  env: NodeJS.ProcessEnv = process.env,
  readGitSha?: () => string | undefined,
): ObservabilityResponse {
  const dsn = readSentryDsn(env);
  if (!dsn) return { enabled: false };
  return {
    enabled: true,
    dsn,
    release: resolveRelease(env, readGitSha) ?? null,
    environment: env.SENTRY_ENVIRONMENT?.trim() || env.NODE_ENV || "development",
  };
}
