import { eq, and, gte, lte, desc } from "drizzle-orm";
import { db } from "$lib/server/db";
import { doseLogs, medications } from "$lib/server/db/schema";
import { formatUserTime, isoDayKey, type TimeFormat } from "$lib/utils/time";

/**
 * Escape a single CSV cell.
 *
 * - Cells starting with `= + - @ \t \r` get a leading apostrophe to
 *   neutralise spreadsheet formula injection (CWE-1236).
 * - Quotes are doubled per RFC 4180.
 * - Cells containing comma / quote / CR / LF are wrapped in quotes.
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

export async function generateCsvReport(
  userId: string,
  timezone: string,
  from: Date,
  to: Date,
  timeFormat: TimeFormat = "12h",
): Promise<string> {
  const doses = await db
    .select({
      takenAt: doseLogs.takenAt,
      quantity: doseLogs.quantity,
      notes: doseLogs.notes,
      sideEffects: doseLogs.sideEffects,
      status: doseLogs.status,
      medName: medications.name,
      dosageAmount: medications.dosageAmount,
      dosageUnit: medications.dosageUnit,
    })
    .from(doseLogs)
    .innerJoin(medications, eq(doseLogs.medicationId, medications.id))
    .where(and(eq(doseLogs.userId, userId), gte(doseLogs.takenAt, from), lte(doseLogs.takenAt, to)))
    .orderBy(desc(doseLogs.takenAt));

  const header = [
    "Date",
    "Time",
    "Status",
    "Medication",
    "Dosage",
    "Quantity",
    "Notes",
    "Side Effects",
  ].join(",");

  const rows = doses.map((dose) => {
    const dt = new Date(dose.takenAt);
    // Deliberately NOT preferences.dateFormat. The importer re-reads this
    // column as strict YYYY-MM-DD (`import/csv.ts` — "date must be a real
    // YYYY-MM-DD"), so a user on MM/DD/YYYY would export a file their own
    // account then refuses to import. The time cell opposite is preference-
    // driven only because `parseClockTime` was written to read both clocks
    // back; nothing equivalent exists for dates, and adding it would make
    // 01/02/2026 ambiguous on the wire.
    //
    // `isoDayKey` rather than a bare en-CA format call: the round trip needs
    // the shape guaranteed, not merely likely. Asking a locale for the whole
    // string left the year unpadded, so a dose dated before year 1000 wrote a
    // cell the importer rejects — and left the column one CLDR change away
    // from reordering entirely.
    const date = isoDayKey(dt, timezone);
    const time = formatUserTime(dt, timezone, timeFormat);
    const sideEffects = dose.sideEffects?.map((e) => `${e.name} (${e.severity})`).join("; ") ?? "";

    return [
      escapeCsvCell(date),
      escapeCsvCell(time),
      escapeCsvCell(dose.status),
      escapeCsvCell(dose.medName),
      escapeCsvCell(`${dose.dosageAmount}${dose.dosageUnit}`),
      escapeCsvCell(dose.quantity),
      escapeCsvCell(dose.notes ?? ""),
      escapeCsvCell(sideEffects),
    ].join(",");
  });

  // RFC 4180 line endings — Excel and Numbers both prefer CRLF.
  return [header, ...rows].join("\r\n");
}
