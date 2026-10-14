// The status breakdown's arithmetic, with no database: the per-medication
// fold `getDoseStatusBreakdown` applies to `getPerMedicationStats`' rows, and
// the two ratio helpers it is built on. It lives apart from `analytics.ts` so a
// caller holding figures but no database — the landing walkthrough's
// Analytics check — runs the real fold instead of restating it.
//
// Keep it pure. `tests/unit/analytics-status-breakdown.test.ts` mocks
// `$lib/server/db` to throw, so an import that reaches the database fails
// that suite at load.

/** The fields of one `getPerMedicationStats` row that the fold reads. */
export type MedicationStatusCounts = {
  takenEvents: number;
  takenQuantity: number;
  skippedEvents: number;
  expectedTotal: number;
};

export type DoseStatusBreakdown = {
  takenEvents: number;
  takenQuantity: number;
  skippedEvents: number;
  missedEvents: number;
  expectedTotal: number;
  adherencePercent: number;
  overusePercent: number;
};

// Visual adherence: capped at 100% so the bar never overshoots.
// Use calculateOveruse() for the over-100 overflow.
export function calculateAdherence(taken: number, expected: number): number {
  if (expected === 0) return 0;
  const raw = Math.round((taken / expected) * 1000) / 10;
  return Math.min(100, raw);
}

export function calculateOveruse(taken: number, expected: number): number {
  if (expected === 0) return 0;
  if (taken <= expected) return 0;
  return Math.round(((taken - expected) / expected) * 1000) / 10;
}

/**
 * User-level dose status breakdown — "expected but unresolved", aggregated
 * PER MEDICATION.
 *
 * The three derived values are summed from per-medication terms, never
 * computed once over pooled scalars. Pooling is not a simplification of this,
 * it is a different and wrong quantity: `expectedTotal` deliberately excludes
 * a PRN medication (it expects nothing) while `takenEvents` deliberately
 * includes it (those doses were really taken), so a pooled numerator and a
 * pooled denominator range over different medication sets and subtracting one
 * from the other is meaningless. Measured on the shipped version: a patient
 * who took 20 of 30 scheduled doses and 15 PRN doses was shown "Missed 0,
 * Adherence 100%, Overuse 16.7%" on the clinician PDF, beside the analytics
 * page's own 67% for the same window. It is not only PRN — two ordinary
 * scheduled medications reach it too, one's surplus settling the other's
 * debt, so the clamp has to move inside the sum rather than the PRN
 * medication being filtered out.
 *
 * Adherence takes a numerator capped per medication and overuse an uncapped
 * surplus; they must never share one. A capped numerator fed to
 * `calculateOveruse` satisfies `taken <= expected` unconditionally, so overuse
 * would be permanently 0 and `export-pdf.ts`'s `> 0` gate would delete the
 * line — a medication taken 45 times against 30 expected reporting nothing.
 */
export function foldDoseStatusBreakdown(
  stats: readonly MedicationStatusCounts[],
): DoseStatusBreakdown {
  // Factual event counts, over every medication, never capped or filtered.
  let takenEvents = 0;
  let takenQuantity = 0;
  let skippedEvents = 0;
  let expectedTotal = 0;
  // Per-medication terms. `creditedTaken + missedEvents <= expectedTotal`,
  // with equality when no medication over-resolves.
  let missedEvents = 0;
  let creditedTaken = 0;
  let surplusTaken = 0;

  for (const m of stats) {
    takenEvents += m.takenEvents;
    takenQuantity += m.takenQuantity;
    skippedEvents += m.skippedEvents;
    expectedTotal += m.expectedTotal;
    missedEvents += Math.max(0, m.expectedTotal - m.takenEvents - m.skippedEvents);
    creditedTaken += Math.min(m.takenEvents, m.expectedTotal);
    // The `expectedTotal > 0` guard is what keeps a PRN medication out of
    // the surplus: without it every as-needed dose reads as overuse, which
    // is worse than the pooled figure it replaces.
    surplusTaken += m.expectedTotal > 0 ? Math.max(0, m.takenEvents - m.expectedTotal) : 0;
  }

  return {
    takenEvents,
    takenQuantity,
    skippedEvents,
    missedEvents,
    expectedTotal,
    adherencePercent: calculateAdherence(creditedTaken, expectedTotal),
    // Routed back through calculateOveruse rather than open-coded, so the
    // "expected === 0 → 0" arm and the 0.1% rounding keep one owner.
    overusePercent: calculateOveruse(expectedTotal + surplusTaken, expectedTotal),
  };
}
