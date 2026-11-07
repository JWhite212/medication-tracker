/**
 * Escape a single CSV cell. The one copy, shared by every CSV the server
 * writes (the dose export and the audit-log export). Pure, with no DB
 * import, so `audit-csv.ts` can use it and stay pure too.
 *
 * - Cells starting with `= + - @ \t \r` get a leading apostrophe to
 *   neutralise spreadsheet formula injection (CWE-1236).
 * - Quotes are doubled per RFC 4180.
 * - Cells containing comma / quote / CR / LF are wrapped in quotes.
 *
 * `import/csv.ts`'s `unescapeCsvCell` is its inverse.
 */
export function escapeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  const escaped = safe.replace(/"/g, '""');
  if (/[",\r\n]/.test(escaped)) {
    return `"${escaped}"`;
  }
  return escaped;
}
