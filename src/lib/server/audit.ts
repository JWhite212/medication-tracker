import { createId } from "@paralleldrive/cuid2";
import { db } from "$lib/server/db";
import { auditLogs } from "$lib/server/db/schema";

// Minimal client surface that both the global `db` and a transaction
// `tx` (yielded by `dbTx.transaction`) satisfy. We only ever call
// `.insert(auditLogs).values(...)` on it.
type AuditClient = Pick<typeof db, "insert">;

export function computeChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> | null {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes[key] = { from: before[key], to: after[key] };
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
  action: "create" | "update" | "delete" | "failed_login",
  changes?: Record<string, { from: unknown; to: unknown }> | null,
  client: AuditClient = db,
) {
  await client
    .insert(auditLogs)
    .values({ id: createId(), userId, entityType, entityId, action, changes });
}
