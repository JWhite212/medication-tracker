import PDFDocument from "pdfkit";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { db } from "$lib/server/db";
import { doseLogs, medications } from "$lib/server/db/schema";
import { formatTime } from "$lib/utils/time";

export async function generateReport(
  userId: string,
  timezone: string,
  from: Date,
  to: Date,
): Promise<Buffer> {
  const doses = await db
    .select({
      takenAt: doseLogs.takenAt,
      quantity: doseLogs.quantity,
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

  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.fontSize(20).text("MedTracker Report", { align: "center" });
    doc.moveDown();
    doc
      .fontSize(12)
      .text(`${from.toLocaleDateString()} — ${to.toLocaleDateString()}`, {
        align: "center",
      });
    doc.moveDown(2);
    doc.fontSize(14).text("Dose Log");
    doc.moveDown();

    for (const dose of doses) {
      doc
        .fontSize(10)
        .text(
          `${formatTime(new Date(dose.takenAt), timezone)}  ${dose.medName} ${dose.dosageAmount}${dose.dosageUnit} x${dose.quantity}`,
        );
    }

    doc.end();
  });
}
