// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

// The fold must stay callable without a database: the landing walkthrough's
// Analytics check feeds it demo figures. This factory THROWS, so if
// `status-breakdown.ts` ever reaches `$lib/server/db` — directly, or through a
// module that does — this file fails to load instead of quietly passing.
vi.mock("$lib/server/db", () => {
  throw new Error("analytics/status-breakdown.ts must not import $lib/server/db");
});

import {
  foldDoseStatusBreakdown,
  type MedicationStatusCounts,
} from "$lib/server/analytics/status-breakdown";

/** One medication's figures; every taken dose is ×1 unless overridden. */
function med(
  takenEvents: number,
  expectedTotal: number,
  overrides: Partial<MedicationStatusCounts> = {},
): MedicationStatusCounts {
  return { takenEvents, takenQuantity: takenEvents, skippedEvents: 0, expectedTotal, ...overrides };
}

/**
 * The pure half of `getDoseStatusBreakdown`. The PGlite suite
 * (`tests/unit/pg/analytics-denominator.test.ts`) proves the same rules
 * through the real query; these pin the arithmetic alone, with every field
 * compared, so a mutation that moves any one of them fails here.
 */
describe("foldDoseStatusBreakdown", () => {
  it("sums missed per medication, so one medication's surplus never settles another's debt", () => {
    // No PRN anywhere. `under` took 5 of 30 and `over` took 55 of 30, so a
    // pooled Σexpected − Σtaken reads 60 − 60 = 0 missed. 25 were missed.
    expect(foldDoseStatusBreakdown([med(5, 30), med(55, 30)])).toEqual({
      takenEvents: 60,
      takenQuantity: 60,
      skippedEvents: 0,
      missedEvents: 25,
      expectedTotal: 60,
      // Credited per medication: min(5, 30) + min(55, 30) = 35 of 60.
      adherencePercent: 58.3,
      // The surplus is visible rather than absorbed: 25 of 60.
      overusePercent: 41.7,
    });
  });

  it("counts a medication's own skips as resolved, not missed", () => {
    // 30 expected, 20 taken and 5 deliberately skipped leaves 5 missed, but
    // skipping is not adherence: the numerator is taken doses only.
    expect(foldDoseStatusBreakdown([med(20, 30, { skippedEvents: 5 })])).toEqual({
      takenEvents: 20,
      takenQuantity: 20,
      skippedEvents: 5,
      missedEvents: 5,
      expectedTotal: 30,
      adherencePercent: 66.7,
      overusePercent: 0,
    });
  });

  it("caps the adherence numerator but measures overuse on the uncapped surplus", () => {
    // Feeding the capped numerator to calculateOveruse would satisfy
    // taken <= expected forever, and export-pdf.ts's `> 0` gate would then
    // delete the overuse line for 45 doses against 30 expected.
    expect(foldDoseStatusBreakdown([med(45, 30)])).toEqual({
      takenEvents: 45,
      takenQuantity: 45,
      skippedEvents: 0,
      missedEvents: 0,
      expectedTotal: 30,
      adherencePercent: 100,
      overusePercent: 50,
    });
  });

  it("keeps a PRN medication's doses in the counts and out of every ratio", () => {
    // The PRN medication expects nothing. Its 15 doses (18 units, some ×2)
    // and 2 skips stay in the factual counts, which is what the clinician
    // PDF prints as "Taken events"; they must not settle the scheduled
    // medication's 10 missed doses, and without the `expectedTotal > 0`
    // guard all 15 would read as surplus, i.e. 50% overuse.
    const prn = med(15, 0, { takenQuantity: 18, skippedEvents: 2 });
    expect(foldDoseStatusBreakdown([med(20, 30), prn])).toEqual({
      takenEvents: 35,
      takenQuantity: 38,
      skippedEvents: 2,
      missedEvents: 10,
      expectedTotal: 30,
      adherencePercent: 66.7,
      overusePercent: 0,
    });
  });

  it("lets a medication that expects nothing perturb no ratio on its own", () => {
    // Both ratios keep calculateAdherence/calculateOveruse's
    // "expected === 0 → 0" contract.
    expect(foldDoseStatusBreakdown([med(15, 0)])).toEqual({
      takenEvents: 15,
      takenQuantity: 15,
      skippedEvents: 0,
      missedEvents: 0,
      expectedTotal: 0,
      adherencePercent: 0,
      overusePercent: 0,
    });
  });

  it("folds no medications to all zeros", () => {
    expect(foldDoseStatusBreakdown([])).toEqual({
      takenEvents: 0,
      takenQuantity: 0,
      skippedEvents: 0,
      missedEvents: 0,
      expectedTotal: 0,
      adherencePercent: 0,
      overusePercent: 0,
    });
  });
});
