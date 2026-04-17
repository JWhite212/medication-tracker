import { eq, and, gte, lte, desc } from "drizzle-orm";
import { db } from "$lib/server/db";
import { doseLogs, medications } from "$lib/server/db/schema";
import { formatTime } from "$lib/utils/time";

export async function generateCsvReport(
  userId: string,
  timezone: string,
  from: Date,
  to: Date,
): Promise<string> {
  const doses = await db
    .select({
      takenAt: doseLogs.takenAt,
      quantity: doseLogs.quantity,
      notes: doseLogs.notes,
      sideEffects: doseLogs.sideEffects,
      medName: medications.name,
      dosageAmount: medications.dosageAmount,
      dosageUnit: medications.dosageUnit,
    })
    .from(doseLogs)
    .innerJoin(medications, eq(doseLogs.medicationId, medications.id))
    .where(
      and(
        eq(doseLogs.userId, userId),
        gte(doseLogs.takenAt, from),
        lte(doseLogs.takenAt, to),
      ),
    )
    .orderBy(desc(doseLogs.takenAt));

  const header = "Date,Time,Medication,Dosage,Quantity,Notes,Side Effects";
  const rows = doses.map((dose) => {
    const dt = new Date(dose.takenAt);
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
    }).format(dt);
    const time = formatTime(dt, timezone);
    const escapeCsv = (s: string) =>
      s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    return [
      date,
      time,
      escapeCsv(dose.medName),
      `${dose.dosageAmount}${dose.dosageUnit}`,
      dose.quantity,
      escapeCsv(dose.notes ?? ""),
      escapeCsv(
        dose.sideEffects?.map((e) => `${e.name} (${e.severity})`).join("; ") ??
          "",
      ),
    ].join(",");
  });

  return [header, ...rows].join("\n");
}
