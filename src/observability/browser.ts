/**
 * Browser bundle entry. esbuild writes public/sentry.js.
 * `@sentry/capacitor` reports native crashes inside the iOS/Android shells
 * and uses `@sentry/browser` on the website, where the native bridge is absent.
 * Nothing here reads SENTRY_DSN. The loader calls `init` only when a DSN exists.
 */
import * as Sentry from "@sentry/capacitor";
import * as SentryBrowser from "@sentry/browser";
import { sentryPrivacyOptions } from "./privacyOptions";
import { scrubBreadcrumb, scrubSentryEvent } from "./scrub";

export type SentryClientConfig = {
  dsn?: string;
  release?: string;
  environment?: string;
};

let active = false;

export function initSentryClient(config: SentryClientConfig | null | undefined): void {
  const dsn = String(config?.dsn || "").trim();
  if (!dsn || active) return;
  const release = String(config?.release || "").trim() || undefined;
  const environment = String(config?.environment || "").trim() || undefined;
  Sentry.init(
    {
      dsn,
      release,
      environment,
      enableCaptureFailedRequests: false,
      enableAutoSessionTracking: false,
      ...sentryPrivacyOptions(),
      beforeSend(event) {
        return scrubSentryEvent(event);
      },
      beforeBreadcrumb(breadcrumb) {
        return scrubBreadcrumb(breadcrumb);
      },
    },
    SentryBrowser.init,
  );
  active = true;
}

export function captureClientException(error: unknown): void {
  if (!active) return;
  const exception = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Unknown error");
  Sentry.captureException(exception);
}

const root = globalThis as typeof globalThis & {
  GroceryGitterSentry?: {
    init: typeof initSentryClient;
    capture: typeof captureClientException;
  };
};

root.GroceryGitterSentry = {
  init: initSentryClient,
  capture: captureClientException,
};
