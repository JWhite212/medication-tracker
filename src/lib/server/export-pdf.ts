import { eq, and, gte, lte, desc } from "drizzle-orm";
import { db } from "$lib/server/db";
import { doseLogs, medications } from "$lib/server/db/schema";
import { formatUserTime, type TimeFormat } from "$lib/utils/time";
import { getDoseStatusBreakdown } from "$lib/server/analytics";

const MEDICAL_DISCLAIMER =
  "MedTracker is a personal tracking tool. It does not provide medical advice, dosage recommendations, diagnosis, or emergency guidance. Always follow advice from a qualified healthcare professional.";

function formatDateInTz(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export async function generateReport(
  userId: string,
  timezone: string,
  from: Date,
  to: Date,
  userName: string = "",
  timeFormat: TimeFormat = "12h",
): Promise<Buffer> {
  const { default: PDFDocument } = await import("pdfkit");

  const [doses, medSummary, breakdown] = await Promise.all([
    db
      .select({
        takenAt: doseLogs.takenAt,
        quantity: doseLogs.quantity,
        sideEffects: doseLogs.sideEffects,
        status: doseLogs.status,
        medName: medications.name,
        dosageAmount: medications.dosageAmount,
        dosageUnit: medications.dosageUnit,
      })
      .from(doseLogs)
      .innerJoin(medications, eq(doseLogs.medicationId, medications.id))
      .where(
        and(eq(doseLogs.userId, userId), gte(doseLogs.takenAt, from), lte(doseLogs.takenAt, to)),
      )
      .orderBy(desc(doseLogs.takenAt)),
    db
      .select({
        name: medications.name,
        dosageAmount: medications.dosageAmount,
        dosageUnit: medications.dosageUnit,
        scheduleType: medications.scheduleType,
        isArchived: medications.isArchived,
      })
      .from(medications)
      .where(eq(medications.userId, userId)),
    getDoseStatusBreakdown(userId, 0, timezone, { from, to }),
  ]);

  // Side-effect frequency aggregate
  const sideEffectCounts = new Map<string, number>();
  for (const d of doses) {
    if (!d.sideEffects) continue;
    for (const e of d.sideEffects) {
      sideEffectCounts.set(e.name, (sideEffectCounts.get(e.name) ?? 0) + 1);
    }
  }

  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    // Header
    doc.fontSize(20).fillColor("#0a93cf").text("MedTracker Report", {
      align: "center",
    });
    doc.fillColor("#000000");
    doc.moveDown(0.3);

    if (userName) {
      doc.fontSize(11).text(userName, { align: "center" });
    }
    doc.fontSize(11).text(`${formatDateInTz(from, timezone)} — ${formatDateInTz(to, timezone)}`, {
      align: "center",
    });
    doc.fontSize(9).fillColor("#666666").text(`Timezone: ${timezone}`, {
      align: "center",
    });
    doc.fillColor("#000000");
    doc.moveDown(1.5);

    // Adherence summary
    doc.fontSize(14).text("Adherence summary");
    doc.moveDown(0.5);
    doc
      .fontSize(10)
      .text(`Taken events: ${breakdown.takenEvents}`)
      .text(`Taken quantity: ${breakdown.takenQuantity}`)
      .text(`Skipped events: ${breakdown.skippedEvents}`)
      .text(`Missed events: ${breakdown.missedEvents}`)
      .text(`Expected events: ${breakdown.expectedTotal}`)
      .text(`Adherence: ${breakdown.adherencePercent}%`);
    if (breakdown.overusePercent > 0) {
      doc.text(`Overuse: ${breakdown.overusePercent}%`);
    }
    doc.moveDown(1);

    // Medication summary
    doc.fontSize(14).text("Medications");
    doc.moveDown(0.5);
    if (medSummary.length === 0) {
      doc.fontSize(10).text("No medications on record.");
    } else {
      for (const m of medSummary) {
        const archived = m.isArchived ? " (archived)" : "";
        doc
          .fontSize(10)
          .text(`• ${m.name} — ${m.dosageAmount}${m.dosageUnit}, ${m.scheduleType}${archived}`);
      }
    }
    doc.moveDown(1);

    // Dose log
    doc.fontSize(14).text("Dose log");
    doc.moveDown(0.5);
    if (doses.length === 0) {
      doc.fontSize(10).text("No doses recorded in this range.");
    } else {
      for (const dose of doses) {
        const time = formatUserTime(new Date(dose.takenAt), timezone, timeFormat);
        const date = formatDateInTz(new Date(dose.takenAt), timezone);
        const statusLabel = dose.status === "skipped" ? " [SKIPPED]" : "";
        doc
          .fontSize(10)
          .text(
            `${date} ${time}${statusLabel}  ${dose.medName} ${dose.dosageAmount}${dose.dosageUnit} x${dose.quantity}`,
          );
        if (dose.sideEffects?.length) {
          doc
            .fontSize(8)
            .fillColor("#888888")
            .text(
              `  Side effects: ${dose.sideEffects.map((e) => `${e.name} (${e.severity})`).join(", ")}`,
            )
            .fillColor("#000000");
        }
      }
    }
    doc.moveDown(1);

    // Side-effect frequency
    if (sideEffectCounts.size > 0) {
      doc.fontSize(14).text("Side-effect frequency");
      doc.moveDown(0.5);
      const sorted = [...sideEffectCounts.entries()].sort((a, b) => b[1] - a[1]);
      for (const [name, count] of sorted) {
        doc.fontSize(10).text(`• ${name}: ${count}`);
      }
      doc.moveDown(1);
    }

    // Footer: generated-at + disclaimer
    doc
      .fontSize(8)
      .fillColor("#666666")
      .text(
        `Generated ${formatDateInTz(new Date(), timezone)} ${formatUserTime(new Date(), timezone, timeFormat)}`,
        { align: "center" },
      );
    doc.moveDown(0.5);
    doc.fontSize(7).text(MEDICAL_DISCLAIMER, { align: "center" });
    doc.fillColor("#000000");

    doc.end();
  });
}
