/**
 * Server-side structured logging — the one choke point where a failure becomes observable.
 *
 * Two distinct obligations get conflated in a `try/catch`, and this module exists to keep them
 * apart:
 *
 * 1. **What the caller is told.** Sometimes the honest answer is a degraded success: a flaky IGDB
 *    lookup must not cost the user the entry they just typed. That is a deliberate product
 *    decision and it stays.
 * 2. **What the operator is told.** *Never* degraded. A swallowed error that nobody records is
 *    invisible: an IGDB outage shows up only as a mysterious run of `metadata_status='no_match'`
 *    rows, weeks later, with nothing to correlate against.
 *
 * So: every `catch` in this codebase either rethrows, or answers with an error status, or calls
 * into here — but it never just disappears.
 *
 * Output is one JSON line per event on `console.error`/`console.warn`, which is what workerd hands
 * to Cloudflare Workers Logs (and to `wrangler tail`); JSON so the fields stay queryable instead of
 * being buried in a prose string.
 *
 * This is also the single seam Sentry hooks into — one `captureException` in `logError`, not one
 * per `catch`. Three things about that wiring are decisions, not accidents:
 *
 * - **No DSN handling belongs here.** The SDK is initialized at the Worker entrypoint
 *   (`sentry.server.config.ts`), which is the only place a DSN is read. Where no DSN was
 *   configured — local dev, CI — the SDK never initializes and `captureException` no-ops, so this
 *   module needs no environment access and no branch of its own.
 * - **`logWarning` is deliberately not forwarded.** Warnings are degradations, not failures, and
 *   `auth.signin.malformed_request` fires on any malformed POST — forwarding it would spend the
 *   error quota on noise. Cloudflare Workers Logs still has every warning.
 * - **The console line is the guarantee; Sentry is best-effort.** `console.error` runs first and
 *   unconditionally, and the capture is wrapped so an SDK throw cannot reach the caller's `catch`.
 */
import * as Sentry from "@sentry/cloudflare";

/** Arbitrary structured context attached to an event. Keep it free of secrets and credentials. */
export type LogFields = Record<string, unknown>;

/**
 * Reduce an unknown thrown value to something JSON-serializable.
 *
 * `catch` binds `unknown`, and a plain `JSON.stringify(error)` on an `Error` yields `{}` — its
 * fields are non-enumerable — which is how a stack trace silently becomes an empty object in the
 * logs. Non-`Error` throws (strings, Supabase's `PostgrestError` object) are kept as-is.
 */
function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(error.cause === undefined ? {} : { cause: serializeError(error.cause) }),
    };
  }
  return error;
}

/**
 * Record a failure that was caught and handled (degraded, translated to a 4xx/5xx, or both).
 *
 * `event` is a stable dot-namespaced identifier (`library.create.enrichment_failed`) rather than a
 * sentence, so occurrences stay groupable across deploys even as the wording changes.
 */
export function logError(event: string, error: unknown, fields: LogFields = {}): void {
  // eslint-disable-next-line no-console -- deliberate server-side diagnostic; the sole log sink
  console.error(JSON.stringify({ level: "error", event, error: serializeError(error), ...fields }));

  try {
    Sentry.captureException(error, {
      // A tag, not a nested context field: `event` is the grouping key, and only tags are
      // filterable and searchable from the issue stream.
      tags: { event },
      extra: fields,
      // Several call sites already thread `userId` through `fields`; promoting it to Sentry's
      // first-class user field is what makes "one broken account" distinguishable from "an
      // outage". Id only — no email, no IP.
      ...(typeof fields.userId === "string" ? { user: { id: fields.userId } } : {}),
    });
  } catch {
    // Best-effort by design. The console line above already landed, and a transport or
    // serialization failure inside the SDK must not surface in the caller's `catch` as if the
    // original operation had failed twice.
  }
}

/**
 * Record a degradation that carries no thrown error — a best-effort path that produced a worse
 * answer than it should have, but had nothing to catch.
 */
export function logWarning(event: string, fields: LogFields = {}): void {
  // eslint-disable-next-line no-console -- deliberate server-side diagnostic; the sole log sink
  console.warn(JSON.stringify({ level: "warn", event, ...fields }));
}
