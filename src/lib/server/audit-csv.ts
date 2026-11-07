import { escapeCsvCell } from "./csv-cell";
import { isoClockTime, isoDayKey } from "$lib/utils/time";

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
 *
 * `Date` and `Time` are the event's wall clock in `timezone`, the account's
 * zone, which is also the zone `/api/audit` reads `from`/`to` and names the
 * file in. They used to be `toISOString()` slices, i.e. UTC under a header
 * that does not say so: an Auckland user asking for 4 May got a 09:00 local
 * edit listed as `2026-05-03,21:00:00`, a day outside the range requested.
 * Both cells are keys built from parts (`isoDayKey`, `isoClockTime`) rather
 * than labels, a fixed 24-hour `HH:mm:ss` whatever the 12h/24h preference, so
 * the file stays sortable. The header is unchanged because
 * `AUDIT_CSV_HEADER` in `import/detect.ts` recognises (and refuses) audit
 * files by it.
 *
 * `timezone` defaults to UTC, which reproduces the previous output exactly;
 * the one production caller always passes the account's zone, and
 * `tests/unit/api/export-time-windows.test.ts` holds it to that.
 */
export function buildAuditCsv(rows: AuditRowForExport[], timezone = "UTC"): string {
  const header = ["Date", "Time", "Entity", "Entity ID", "Action", "Changes"].join(",");

  const lines = rows.map((row) => {
    const dt = new Date(row.createdAt);
    const date = isoDayKey(dt, timezone);
    const time = isoClockTime(dt, timezone);
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
