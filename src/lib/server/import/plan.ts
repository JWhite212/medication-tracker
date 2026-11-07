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
  type DosePrecision,
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

/**
 * Stable handle for a medication within one import. JSON files carry
 * ids; a CSV only has names, so the normalised name is the key.
 *
 * The two are namespaced apart so a hand-edited file can't make an
 * id-keyed medication and a name-keyed one collide (a medication whose
 * `id` is null and whose name happens to equal another row's id would
 * otherwise share a ref, and one would silently shadow the other).
 */
function refFor(sourceId: string | null, name: string): string {
  return sourceId ? `id:${sourceId}` : `name:${normaliseName(name)}`;
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

  // Merge appends imported medications above whatever the user already
  // has: getActiveMedications orders by sortOrder first, so reusing the
  // file's values would interleave them into a hand-ordered list.
  //
  // Replace keeps the file's own sortOrder instead. The export has no
  // ORDER BY, so its array order is arbitrary — renumbering by array
  // position would scramble the ordering the user had set. Merge has the
  // same problem, so it renumbers in the file's own sortOrder rather than
  // in array order: the imported list keeps its relative order and is
  // only offset above `maxSortOrder`. A tie keeps its array position
  // (the source account had no order between them either), and the
  // output array itself is left in file order.
  const mergeSortOrder = new Map<number, number>();
  if (!replacing) {
    bundle.medications
      .map((source, index) => ({ sortOrder: source.sortOrder, index }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.index - b.index)
      .forEach(({ index }, rank) => mergeSortOrder.set(index, snapshot.maxSortOrder + 1 + rank));
  }

  const medications: PlannedMedication[] = bundle.medications.map((source, index) => {
    const ref = refFor(source.sourceId, source.name);
    const key = normaliseName(source.name);
    const backDated = source.startedAt ?? earliestDoseByRef.get(ref) ?? null;
    const withDates = {
      ...source,
      startedAt: backDated,
      sortOrder: replacing ? source.sortOrder : mergeSortOrder.get(index)!,
    };

    if (replacing) {
      return { source: withDates, action: "create", existingId: null, ref, reason: null };
    }

    // A name mapping only ever describes CSV medication names. Applying
    // a stale mapping to a JSON backup would skip or re-point
    // medications the user never chose anything for.
    //
    // hasOwnProperty, not a bare lookup: `nameMapping` is a plain object
    // built from client JSON, so a medication literally named
    // "constructor" would otherwise resolve through Object.prototype,
    // enter this branch with `action` undefined, and fall through to
    // "create" — bypassing both the dedupe and the unmatched-name gate.
    const choice =
      bundle.format === "dose-csv" && Object.prototype.hasOwnProperty.call(nameMapping, key)
        ? nameMapping[key]
        : undefined;
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

  // A JSON backup carries millisecond timestamps, so two distinct doses
  // in the same minute must stay distinct. A CSV only carries HH:mm, so
  // it has to match on minutes or it would never dedupe at all.
  const precision: DosePrecision = bundle.format === "dose-csv" ? "minute" : "exact";

  // Two questions, answered separately:
  //
  //  - Is this dose already in the account? Answered by content, because
  //    an account row shares no id with the file. Merge only — replace
  //    has wiped the account, so nothing in the snapshot counts.
  //  - Has this file already listed this dose? A JSON backup carries each
  //    dose's id, so a row repeats only when its id repeats. Two distinct
  //    doses can legitimately share a medication, instant, status and
  //    quantity (both edited to 08:00 in the dose dialog, whose
  //    datetime-local input zeroes the seconds), and keying the file on
  //    content collapsed them, losing one for good on a replace. A row
  //    with no id (every CSV row, or a hand-edited file) still dedupes on
  //    content, against every row the file has listed so far.
  const accountDoseKeys = replacing ? new Set<string>() : snapshot.doseKeys;
  const fileDoseKeys = new Set<string>();
  const fileDoseIds = new Set<string>();

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
    const key = doseKey(namespace, source.takenAt, source.status, source.quantity, precision);

    if (accountDoseKeys.has(key)) {
      return {
        source,
        action: "skip",
        medicationRef: ref,
        reason: "Duplicate — already recorded.",
      };
    }

    const sourceId = source.sourceId ?? null;
    const idKey = sourceId !== null ? `${namespace}|${sourceId}` : null;
    if (idKey !== null ? fileDoseIds.has(idKey) : fileDoseKeys.has(key)) {
      return {
        source,
        action: "skip",
        medicationRef: ref,
        reason: "Duplicate — it appears more than once in this file.",
      };
    }

    if (idKey !== null) fileDoseIds.add(idKey);
    fileDoseKeys.add(key);
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

/**
 * True when the plan would write nothing.
 *
 * Deliberately ignores `medicationsDeleted`. Counting a replace-mode
 * deletion as "something happening" would mean a file that parsed to
 * zero rows still passed the caller's not-empty check — and replace
 * would then delete every medication (cascading to schedules, doses and
 * inventory events) and insert nothing in their place.
 *
 * That is reachable without any malice: export the dose CSV, open it in
 * Excel, save (Excel rewrites `2026-08-01` as `01/08/2026`), re-import
 * in replace mode. Every row fails the strict date check, the file
 * parses to zero doses, and the account is wiped.
 */
export function planIsEmpty(plan: ImportPlan): boolean {
  return (
    plan.summary.medicationsCreated === 0 &&
    plan.summary.dosesCreated === 0 &&
    plan.summary.inventoryEventsCreated === 0 &&
    !plan.summary.profileUpdated &&
    !plan.summary.preferencesUpdated
  );
}
