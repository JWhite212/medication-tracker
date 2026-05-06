import { eq, and, gte, lte, desc } from "drizzle-orm";
import { db } from "$lib/server/db";
import { auditLogs } from "$lib/server/db/schema";
import { escapeCsvCell } from "./export-csv";

export type AuditRowForExport = {
  createdAt: Date;
  entityType: string;
  entityId: string;
  action: string;
  changes: unknown;
};

/**
 * Pure transform — given rows, return RFC 4180 CSV. Lives separately
 * from `export-csv.ts` so the dose-export and audit-export schemas
 * stay independent (changing one cannot break the other).
 *
 * Cells use the shared `escapeCsvCell` helper which already
 * neutralises spreadsheet formula injection (`= + - @ \t \r`).
 */
export function buildAuditCsv(rows: AuditRowForExport[]): string {
  const header = ["Date", "Time", "Entity", "Entity ID", "Action", "Changes"].join(",");

  const lines = rows.map((row) => {
    const dt = new Date(row.createdAt);
    const date = dt.toISOString().slice(0, 10);
    const time = dt.toISOString().slice(11, 19);
    const changes =
      row.changes === null || row.changes === undefined ? "" : JSON.stringify(row.changes);
    return [
      escapeCsvCell(date),
      escapeCsvCell(time),
      escapeCsvCell(row.entityType),
      escapeCsvCell(row.entityId),
      escapeCsvCell(row.action),
      escapeCsvCell(changes),
    ].join(",");
  });

  return [header, ...lines].join("\r\n");
}

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
