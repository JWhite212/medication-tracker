import { eq, and, gte, lt, desc } from "drizzle-orm";
import { db } from "$lib/server/db";
import { doseLogs, medications } from "$lib/server/db/schema";
import {
  formatDateTimeLocal,
  formatUserTime,
  isoDayKey,
  parseDateTimeLocal,
  utcOffsetLabel,
  type TimeFormat,
} from "$lib/utils/time";
import { escapeCsvCell } from "./csv-cell";

// Re-exported at its old path: the import round-trip and export tests
// import it from here.
export { escapeCsvCell };

/**
 * The Time cell's disambiguator: ` UTC±HH:MM` for a dose whose local wall
 * clock happens twice and names the LATER instant, `""` for every other dose.
 *
 * The cell is a timezone-less local minute, and the importer resolves it with
 * `parseDateTimeLocal`, whose overlap policy is the EARLIER instant. So a
 * Europe/London dose at the second 01:30 on a fall-back day (01:30Z, GMT)
 * came back as the first one (00:30Z, BST): an hour earlier, and — because
 * merge dedupe keys on the UTC minute — imported as a second dose beside the
 * original. The importer reads this suffix as an exact offset and skips zone
 * resolution, so the round trip names the instant it started from.
 *
 * Only the ambiguous case carries it, on purpose: every other row resolves
 * back to itself already, and leaving them untouched keeps the column a plain
 * time a spreadsheet recognises. "Ambiguous" is decided by asking the
 * importer's own resolver, not by re-deriving DST rules here.
 */
function overlapOffsetSuffix(dt: Date, timezone: string): string {
  const resolved = parseDateTimeLocal(formatDateTimeLocal(dt, timezone), timezone);
  // Within a minute rather than "same minute": the cell drops seconds, and a
  // historical offset that is not a whole minute (London LMT is -0:01:15)
  // moves the resolved instant across a minute boundary without making the
  // wall clock ambiguous. A real overlap is a transition apart, never < 1m.
  const resolvesBack = Math.abs(resolved.getTime() - dt.getTime()) < 60_000;
  return resolvesBack ? "" : ` UTC${utcOffsetLabel(dt, timezone)}`;
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
    .where(and(eq(doseLogs.userId, userId), gte(doseLogs.takenAt, from), lt(doseLogs.takenAt, to)))
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
    const time = `${formatUserTime(dt, timezone, timeFormat)}${overlapOffsetSuffix(dt, timezone)}`;
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
