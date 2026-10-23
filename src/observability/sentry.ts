import * as Sentry from "@sentry/node";
import type { ErrorEvent, EventHint } from "@sentry/node";
import { readSentryDsn } from "./config";
import { sentryPrivacyOptions } from "./privacyOptions";
import { resolveRelease } from "./release";
import { scrubBreadcrumb, scrubSentryEvent } from "./scrub";

let active = false;

/** True only after init ran with a DSN. Unset DSN never starts the SDK. */
export function sentryIsActive(): boolean {
  return active;
}

/**
 * Start the Node SDK. No-op when SENTRY_DSN is unset or init already ran.
 * Call this before Express is loaded so request isolation can hook the module.
 */
export function initSentry(): void {
  const dsn = readSentryDsn();
  if (!dsn || active) return;
  const release = resolveRelease();
  const environment = process.env.SENTRY_ENVIRONMENT?.trim() || process.env.NODE_ENV || "development";
  Sentry.init({
    dsn,
    release,
    environment,
    ...sentryPrivacyOptions(),
    beforeSend(event: ErrorEvent, _hint: EventHint) {
      return scrubSentryEvent(event);
    },
    beforeBreadcrumb(breadcrumb) {
      return scrubBreadcrumb(breadcrumb);
    },
  });
  active = true;
}

export function captureServerException(error: unknown): void {
  if (!active) return;
  Sentry.captureException(error);
}

export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!active) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    // A reporting failure must not block process shutdown.
  }
}

export function setupSentryExpress(app: { use: (middleware: unknown) => unknown }): void {
  if (!active) return;
  // Error middleware only. A request middleware registered after the 404
  // handler would never run. Express was loaded after init on the server
  // entrypoint, so the SDK's own Express instrumentation still sees requests.
  app.use(Sentry.expressErrorHandler());
}
