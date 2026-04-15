import { createId } from "@paralleldrive/cuid2";
import { db } from "$lib/server/db";
import { auditLogs } from "$lib/server/db/schema";

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

export async function logAudit(
  userId: string,
  entityType: string,
  entityId: string,
  action: "create" | "update" | "delete" | "failed_login",
  changes?: Record<string, { from: unknown; to: unknown }> | null,
) {
  await db
    .insert(auditLogs)
    .values({ id: createId(), userId, entityType, entityId, action, changes });
}
