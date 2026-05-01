/**
 * Sentry initialization — must be imported BEFORE any other module that
 * could throw, so the SDK can hook the global handlers.
 *
 * Reads SENTRY_DSN from the env. If absent (dev, test, or simply not set
 * yet on Railway), the SDK silently no-ops — `captureException()` becomes
 * a free function call that does nothing. So this is safe to import always.
 *
 * Tracing & profiling are intentionally OFF for the free tier (5k errors/
 * month). Only error capture is on.
 */

import * as Sentry from "@sentry/node";

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    // No DSN → no-op. Don't warn loudly: dev / test / first deploy will be
    // missing this var, that's fine.
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    release: process.env.RAILWAY_GIT_COMMIT_SHA ?? undefined,
    // Error capture only, no performance tracing (saves quota).
    tracesSampleRate: 0,
    profilesSampleRate: 0,
    // Strip large request bodies from breadcrumbs to avoid leaking secrets.
    sendDefaultPii: false,
    beforeSend(event) {
      // Defensive: drop common secret-looking strings before sending.
      const clean = (s: string) =>
        s
          .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer ***")
          .replace(/whsec_[A-Za-z0-9]+/g, "whsec_***")
          .replace(/sk_(live|test)_[A-Za-z0-9]+/g, "sk_$1_***")
          .replace(/re_[A-Za-z0-9]+/g, "re_***");
      if (event.message) event.message = clean(event.message);
      if (event.exception?.values) {
        for (const v of event.exception.values) {
          if (v.value) v.value = clean(v.value);
        }
      }
      return event;
    },
  });
  initialized = true;
  console.log("[sentry] initialized");
}

/**
 * Capture an exception explicitly. No-op if Sentry isn't initialized.
 * Use this in catch blocks where you want Sentry to know but the request
 * still completes normally.
 */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.captureException(err, { extra: context });
}

/**
 * Flush pending events before process exit. Call on SIGTERM.
 */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!initialized) return;
  await Sentry.close(timeoutMs);
}
