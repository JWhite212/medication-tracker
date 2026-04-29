import { eq, and, gte, lte, desc } from "drizzle-orm";
import { db } from "$lib/server/db";
import { doseLogs, medications } from "$lib/server/db/schema";
import { formatUserTime, type TimeFormat } from "$lib/utils/time";

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
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
    }).format(dt);
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
