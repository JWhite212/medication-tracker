// `version: 1` JSON backup -> ImportBundle. Pure — no DB, no I/O.
//
// All trust decisions happen in `backupEnvelopeSchema`
// (src/lib/utils/validation.ts): it strips `userId`, every credential
// field and the whole `auditLogs` array, so nothing this module returns
// can carry another account's identity. `id` survives only as
// `sourceId`, used to resolve references between arrays in the same
// file and never written to the database.
import { backupEnvelopeSchema, IMPORT_SUPPORTED_VERSION } from "$lib/utils/validation";
import { stripBom } from "./detect";
import type { ImportBundle, ImportMedication } from "./types";

export type ParseResult = { ok: true; bundle: ImportBundle } | { ok: false; reason: string };

/**
 * Turn a Zod issue path into something a person can act on, e.g.
 * `medications[3].dosageUnit: Too small`.
 */
function describeIssues(issues: Array<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .slice(0, 5)
    .map((issue) => {
      const path = issue.path
        .map((segment) => (typeof segment === "number" ? `[${segment}]` : `.${String(segment)}`))
        .join("")
        .replace(/^\./, "");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

export function parseBackup(rawText: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(stripBom(rawText));
  } catch {
    return { ok: false, reason: "The file isn't valid JSON." };
  }

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "A backup file must be a JSON object." };
  }

  const version = (raw as { version?: unknown }).version;
  if (version !== IMPORT_SUPPORTED_VERSION) {
    return {
      ok: false,
      reason:
        typeof version === "number"
          ? `This backup is version ${version}, but this app can only read version ${IMPORT_SUPPORTED_VERSION}. Update the app, or export a fresh backup.`
          : `This file has no usable \`version\` field, so it isn't a MedTracker backup.`,
    };
  }

  const parsed = backupEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: `The backup didn't pass validation — ${describeIssues(parsed.error.issues)}`,
    };
  }

  const data = parsed.data;
  const warnings: string[] = [];

  const medications: ImportMedication[] = data.medications.map((med) => ({
    sourceId: med.id,
    name: med.name,
    dosageAmount: med.dosageAmount,
    dosageUnit: med.dosageUnit,
    form: med.form,
    category: med.category,
    colour: med.colour,
    colourSecondary: med.colourSecondary,
    pattern: med.pattern,
    notes: med.notes,
    scheduleType: med.scheduleType,
    scheduleIntervalHours: med.scheduleIntervalHours,
    inventoryCount: med.inventoryCount,
    inventoryAlertThreshold: med.inventoryAlertThreshold,
    sortOrder: med.sortOrder,
    isArchived: med.isArchived,
    archivedAt: med.archivedAt,
    startedAt: med.startedAt,
    endedAt: med.endedAt,
    schedules: med.schedules.map((schedule, index) => ({
      scheduleKind: schedule.scheduleKind,
      timeOfDay: schedule.timeOfDay,
      intervalHours: schedule.intervalHours,
      daysOfWeek: schedule.daysOfWeek,
      sortOrder: schedule.sortOrder || index,
      effectiveFrom: schedule.effectiveFrom,
      effectiveTo: schedule.effectiveTo,
    })),
  }));

  // A dose or event whose medicationId doesn't appear in `medications`
  // has nothing to attach to. Drop it here rather than letting the
  // planner emit a confusing "unmatched" entry for an id the user
  // never sees.
  const knownIds = new Set(medications.map((med) => med.sourceId).filter(Boolean) as string[]);

  const doses = data.doseLogs.filter((dose) => knownIds.has(dose.medicationId));
  const orphanDoses = data.doseLogs.length - doses.length;
  if (orphanDoses > 0) {
    warnings.push(
      `${orphanDoses} dose ${orphanDoses === 1 ? "entry" : "entries"} referenced a medication that isn't in the file and were skipped.`,
    );
  }

  const inventoryEvents = data.inventoryEvents.filter((event) => knownIds.has(event.medicationId));
  const orphanEvents = data.inventoryEvents.length - inventoryEvents.length;
  if (orphanEvents > 0) {
    warnings.push(
      `${orphanEvents} inventory ${orphanEvents === 1 ? "event" : "events"} referenced a medication that isn't in the file and were skipped.`,
    );
  }

  return {
    ok: true,
    bundle: {
      format: "backup-json",
      exportedAt: data.exportedAt,
      profile: data.profile,
      preferences: data.preferences,
      medications,
      doses: doses.map((dose) => ({
        sourceMedicationId: dose.medicationId,
        medicationName: null,
        quantity: dose.quantity,
        takenAt: dose.takenAt,
        loggedAt: dose.loggedAt,
        notes: dose.notes,
        sideEffects: dose.sideEffects,
        status: dose.status,
      })),
      inventoryEvents: inventoryEvents.map((event) => ({
        sourceMedicationId: event.medicationId,
        eventType: event.eventType,
        quantityChange: event.quantityChange,
        previousCount: event.previousCount,
        newCount: event.newCount,
        note: event.note,
        createdAt: event.createdAt,
      })),
      warnings,
    },
  };
}
