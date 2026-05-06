import { eq, and, gte, lte, desc } from "drizzle-orm";
import { db } from "$lib/server/db";
import { auditLogs } from "$lib/server/db/schema";
import type { AuditRowForExport } from "./audit-csv";

// Re-export the pure CSV helper so existing imports continue to work
// while the formatter itself stays in a DB-free module.
export { buildAuditCsv } from "./audit-csv";
export type { AuditRowForExport } from "./audit-csv";

/**
 * Pull this user's audit log within an inclusive date window. Newest
 * first. Used by `/api/audit` to materialise the rows that
 * `buildAuditCsv` formats.
 */
export async function getAuditLogForExport(
  userId: string,
  from: Date,
  to: Date,
): Promise<AuditRowForExport[]> {
  return db
    .select({
      createdAt: auditLogs.createdAt,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      action: auditLogs.action,
      changes: auditLogs.changes,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.userId, userId),
        gte(auditLogs.createdAt, from),
        lte(auditLogs.createdAt, to),
      ),
    )
    .orderBy(desc(auditLogs.createdAt));
}
