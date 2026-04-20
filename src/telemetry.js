import * as Sentry from "@sentry/react";

export function initTelemetry() {
  const dsn = String(import.meta.env.VITE_SENTRY_DSN ?? "").trim();
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    sendDefaultPii: false,
    tracesSampleRate: 0.05,
  });
}

export function captureException(error, context) {
  if (!import.meta.env.VITE_SENTRY_DSN) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
