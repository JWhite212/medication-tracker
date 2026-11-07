import { escapeCsvCell } from "./csv-cell";

export type AuditRowForExport = {
  createdAt: Date;
  entityType: string;
  entityId: string;
  action: string;
  changes: unknown;
};

/**
 * Pure transform — given rows, return RFC 4180 CSV. Lives in a
 * DB-free module so the formatter can be imported and tested
 * without instantiating the Neon driver. The DB query lives next
 * door in `audit-export.ts`.
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
