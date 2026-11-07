import { createId } from "@paralleldrive/cuid2";
import { db } from "$lib/server/db";
import { auditLogs } from "$lib/server/db/schema";

// Minimal client surface that both the global `db` (neon-http) and a
// transaction `tx` (yielded by `dbTx.transaction`, backed by the
// neon-serverless/websocket driver) satisfy. We only ever call
// `.insert(auditLogs).values(...)` on it.
//
// This is intentionally a narrow duck-typed shape rather than
// `Pick<typeof db, "insert">`: `db` and a websocket `tx` return
// structurally different (driver-specific) builder types from
// `.insert(...)`, so pinning to `db`'s full method type would reject a
// `tx` argument even though both satisfy everything we actually use.
type AuditClient = {
  insert: (table: typeof auditLogs) => {
    values: (values: typeof auditLogs.$inferInsert) => PromiseLike<unknown>;
  };
};

/**
 * What a redacted field's `from`/`to` reads in an audit diff. The diff still
 * says the field changed, and whether it was set before and after (unset is
 * `null`, as in the row), but never what it said.
 */
export const REDACTED = "[redacted]";

export type ComputeChangesOptions = {
  /** Keys left out of the diff altogether: bookkeeping columns such as
      `updatedAt`, which every write rewrites. Diffed, they make every save,
      a no-op included, look like a change and write an audit row. */
  ignore?: readonly string[];
  /** Keys whose change is recorded with content-free values (`REDACTED`, or
      `null` when unset): free text the user wrote, because audit rows are
      synced and never purged. A change is still detected on the real values. */
  redact?: readonly string[];
};

function redactedValue(value: unknown): unknown {
  return value === null || value === undefined ? null : REDACTED;
}

/** The `{ key: { from, to } }` diff of `after` against `before`, over the keys
    of `after`, or null when nothing differs. Both options are opt-in, so a
    caller that passes none gets the plain diff. */
export function computeChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  options: ComputeChangesOptions = {},
): Record<string, { from: unknown; to: unknown }> | null {
  const ignore = new Set(options.ignore ?? []);
  const redact = new Set(options.redact ?? []);
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    if (ignore.has(key)) continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes[key] = redact.has(key)
        ? { from: redactedValue(before[key]), to: redactedValue(after[key]) }
        : { from: before[key], to: after[key] };
    }
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

/**
 * Append an audit-log row.
 *
 * `client` defaults to the global `db` so existing callers keep
 * working. Pass a transaction object (yielded from
 * `dbTx.transaction`) when the audit row should commit or roll back
 * with a larger unit of work — for example
 * `createMedicationWithSchedules` writes the audit row inside the
 * same transaction as the medication and schedule inserts.
 */
export async function logAudit(
  userId: string,
  entityType: string,
  entityId: string,
  // "restore" is a deleted dose put back by its Undo (`restoreDose`). Like
  // "delete", it is written with no diff: a dose's diff would carry its note
  // text, and audit rows are synced and never purged.
  action: "create" | "update" | "delete" | "failed_login" | "restore",
  changes?: Record<string, { from: unknown; to: unknown }> | null,
  client: AuditClient = db,
) {
  await client
    .insert(auditLogs)
    .values({ id: createId(), userId, entityType, entityId, action, changes });
}
