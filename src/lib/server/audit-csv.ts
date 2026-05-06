// Local copy of `escapeCsvCell` so this module stays pure (no DB
// import). Kept identical to `export-csv.ts:escapeCsvCell` so the
// formula-injection guard and quoting rules are consistent.
function escapeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  const escaped = safe.replace(/"/g, '""');
  if (/[",\r\n]/.test(escaped)) {
    return `"${escaped}"`;
  }
  return escaped;
}

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
