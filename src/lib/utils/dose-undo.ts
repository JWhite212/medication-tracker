/**
 * How long a deleted dose can be put back: ten minutes from the delete.
 *
 * One constant, read by both sides of the wire. The server refuses a restore
 * once `deleted_at <= now - DOSE_UNDO_WINDOW_MS`, and purges trash rows that
 * old. The client sizes its Undo offer from the same number: a create's Undo
 * lasts this long, and a delete's Undo ends 30s before the server's window
 * does, so a press near the end still arrives in time.
 *
 * This module has no imports, on purpose. `src/lib/utils/` is reachable from
 * the browser, so anything this file pulled in would ship to the client too.
 * `tests/unit/dose-undo.test.ts` holds that line.
 */
export const DOSE_UNDO_WINDOW_MS = 10 * 60_000;
