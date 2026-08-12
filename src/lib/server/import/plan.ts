// ImportBundle + AccountSnapshot -> ImportPlan. Pure — no DB, no I/O.
//
// The planner decides *everything*: what gets created, what is reused,
// what is skipped and why. `apply.ts` then executes the plan without
// making a single judgement call of its own. That split is what lets the
// preview shown to the user be the same object that gets written, and
// lets all the interesting behaviour be tested without a database.
import {
  doseKey,
  emptySummary,
  inventoryEventKey,
  normaliseName,
  type AccountSnapshot,
  type ImportBundle,
  type ImportMode,
  type ImportPlan,
  type ImportSections,
  type NameMapping,
  type PlannedDose,
  type PlannedInventoryEvent,
  type PlannedMedication,
} from "./types";

export type PlanOptions = {
  mode: ImportMode;
  sections: ImportSections;
  /** CSV only: user decisions for names with no match in the account. */
  nameMapping?: NameMapping;
};

/** Stable handle for a medication within one import. JSON files carry
 * ids; a CSV only has names, so the normalised name is the key. */
function refFor(sourceId: string | null, name: string): string {
  return sourceId ?? normaliseName(name);
}

export function buildImportPlan(
  bundle: ImportBundle,
  snapshot: AccountSnapshot,
  options: PlanOptions,
): ImportPlan {
  const { mode, sections } = options;
  const nameMapping = options.nameMapping ?? {};
  const summary = emptySummary();
  const warnings = [...bundle.warnings];
  const unmatchedNames: string[] = [];

  // Replace wipes the account first, so nothing in the snapshot can be
  // matched or deduped against — every row in the file is new.
  const replacing = mode === "replace";

  const existingByName = new Map<string, { id: string; name: string }>();
  if (!replacing) {
    for (const med of snapshot.medications) {
      const key = normaliseName(med.name);
      // First writer wins: `snapshot.medications` is ordered active-first,
      // so an active medication is preferred over an archived namesake.
      if (!existingByName.has(key)) existingByName.set(key, { id: med.id, name: med.name });
    }
  }

  // Earliest dose per medication, used to back-date `startedAt` when the
  // file doesn't carry one. Without this every imported medication looks
  // like it was created today and analytics scores the whole
  // back-catalogue as "not expected yet".
  const earliestDoseByRef = new Map<string, Date>();
  for (const dose of bundle.doses) {
    const ref = refFor(dose.sourceMedicationId, dose.medicationName ?? "");
    const current = earliestDoseByRef.get(ref);
    if (!current || dose.takenAt < current) earliestDoseByRef.set(ref, dose.takenAt);
  }

  // Imported medications are appended above whatever the user already
  // has, preserving their file order relative to each other.
  const sortOffset = replacing ? 0 : snapshot.maxSortOrder + 1;
  let nextSortOrder = sortOffset;

  const medications: PlannedMedication[] = bundle.medications.map((source) => {
    const ref = refFor(source.sourceId, source.name);
    const key = normaliseName(source.name);
    const backDated = source.startedAt ?? earliestDoseByRef.get(ref) ?? null;
    const withDates = { ...source, startedAt: backDated, sortOrder: nextSortOrder++ };

    if (replacing) {
      return { source: withDates, action: "create", existingId: null, ref, reason: null };
    }

    const choice = nameMapping[key];
    if (choice) {
      if (choice.action === "skip") {
        return {
          source: withDates,
          action: "skip",
          existingId: null,
          ref,
          reason: "You chose to skip this medication.",
        };
      }
      if (choice.action === "map") {
        return {
          source: withDates,
          action: "reuse",
          existingId: choice.medicationId,
          ref,
          reason: "Mapped to an existing medication.",
        };
      }
      return { source: withDates, action: "create", existingId: null, ref, reason: null };
    }

    const existing = existingByName.get(key);
    if (existing) {
      return {
        source: withDates,
        action: "reuse",
        existingId: existing.id,
        ref,
        reason: `Already in your account as "${existing.name}" — its details, schedule and inventory are left untouched.`,
      };
    }

    // A JSON backup carries every field, so creating is unambiguous. A
    // CSV would have to invent form, category, colour and schedule, so
    // the user is asked first.
    if (bundle.format === "dose-csv") {
      unmatchedNames.push(source.name);
      return {
        source: withDates,
        action: "skip",
        existingId: null,
        ref,
        reason: "Not in your account yet — choose what to do with it.",
      };
    }

    return { source: withDates, action: "create", existingId: null, ref, reason: null };
  });

  const plannedByRef = new Map(medications.map((med) => [med.ref, med]));

  for (const med of medications) {
    if (med.action === "create") {
      summary.medicationsCreated++;
      summary.schedulesCreated += med.source.schedules.length;
    } else if (med.action === "reuse") {
      summary.medicationsReused++;
    } else {
      summary.medicationsSkipped++;
    }
  }

  // Seeded from the account so a merge doesn't re-add rows the user
  // already has; extended as we go so duplicates *within* one file are
  // caught too.
  const seenDoseKeys = new Set(replacing ? [] : snapshot.doseKeys);

  const doses: PlannedDose[] = bundle.doses.map((source) => {
    const ref = refFor(source.sourceMedicationId, source.medicationName ?? "");
    const med = plannedByRef.get(ref);

    if (!med || med.action === "skip") {
      return {
        source,
        action: "skip",
        medicationRef: ref,
        reason: med ? "Its medication was skipped." : "No matching medication in the file.",
      };
    }

    // A medication being created has no rows in the account yet, so its
    // dedupe namespace is the new id — unknown until apply time. Use the
    // ref instead; it's unique per medication within this import, which
    // is all within-file dedupe needs.
    const namespace = med.action === "reuse" ? med.existingId! : `new:${ref}`;
    const key = doseKey(namespace, source.takenAt, source.status, source.quantity);

    if (seenDoseKeys.has(key)) {
      return {
        source,
        action: "skip",
        medicationRef: ref,
        reason: "Duplicate — already recorded.",
      };
    }

    seenDoseKeys.add(key);
    return { source, action: "create", medicationRef: ref, reason: null };
  });

  for (const dose of doses) {
    if (dose.action === "create") summary.dosesCreated++;
    else summary.dosesSkipped++;
  }

  const seenEventKeys = new Set(replacing ? [] : snapshot.inventoryEventKeys);

  const inventoryEvents: PlannedInventoryEvent[] = bundle.inventoryEvents.map((source) => {
    const ref = refFor(source.sourceMedicationId, "");
    const med = plannedByRef.get(ref);

    if (!sections.inventory) {
      return { source, action: "skip", medicationRef: ref, reason: "Inventory not selected." };
    }
    if (!med || med.action === "skip") {
      return {
        source,
        action: "skip",
        medicationRef: ref,
        reason: med ? "Its medication was skipped." : "No matching medication in the file.",
      };
    }
    // The single most important rule for not corrupting a working
    // account: an existing medication keeps its own count and its own
    // ledger. Replaying imported events onto it would leave the ledger
    // and `inventoryCount` disagreeing, with no way to tell which is right.
    if (med.action === "reuse") {
      return {
        source,
        action: "skip",
        medicationRef: ref,
        reason: "Medication already exists — its own inventory history is kept.",
      };
    }

    const key = inventoryEventKey(
      `new:${ref}`,
      source.createdAt,
      source.eventType,
      source.quantityChange,
    );
    if (seenEventKeys.has(key)) {
      return { source, action: "skip", medicationRef: ref, reason: "Duplicate event." };
    }

    seenEventKeys.add(key);
    return { source, action: "create", medicationRef: ref, reason: null };
  });

  for (const event of inventoryEvents) {
    if (event.action === "create") summary.inventoryEventsCreated++;
    else summary.inventoryEventsSkipped++;
  }

  if (replacing) {
    summary.medicationsDeleted = snapshot.medications.length;
    summary.dosesDeleted = snapshot.existingDoseCount;
  }

  const profile = sections.profile ? bundle.profile : null;
  const preferences = sections.preferences ? bundle.preferences : null;
  summary.profileUpdated = profile !== null;
  summary.preferencesUpdated = preferences !== null;

  if (summary.medicationsReused > 0 && bundle.inventoryEvents.length > 0 && sections.inventory) {
    warnings.push(
      "Inventory counts were not applied to medications that already exist — their current counts and history are kept as-is.",
    );
  }

  return {
    format: bundle.format,
    mode,
    sections,
    medications,
    doses,
    inventoryEvents,
    profile,
    preferences,
    unmatchedNames: [...new Set(unmatchedNames)],
    warnings,
    summary,
  };
}

/** Nothing to do — used to keep the UI honest instead of reporting a
 * successful import that wrote zero rows. */
export function planIsEmpty(plan: ImportPlan): boolean {
  return (
    plan.summary.medicationsCreated === 0 &&
    plan.summary.dosesCreated === 0 &&
    plan.summary.inventoryEventsCreated === 0 &&
    plan.summary.medicationsDeleted === 0 &&
    !plan.summary.profileUpdated &&
    !plan.summary.preferencesUpdated
  );
}
