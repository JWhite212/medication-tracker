// The Log now / chip toast states what the matcher ACTUALLY did, read off the
// reloaded Done row for the returned doseId — never what the client guessed.
import { describe, it, expect } from "vitest";
import { logToastFromReload } from "$lib/components/dashboard/dose-toasts";
import { formatDoseLabel, toastForLog } from "$lib/utils/dashboard-copy";
import type { DoneRow, DoseLogWithMedication } from "$lib/types";

const TZ = "UTC";
const TODAY_START = "2026-05-01T00:00:00.000Z";

function dose(overrides: Partial<DoseLogWithMedication> = {}): DoseLogWithMedication {
  const takenAt = overrides.takenAt ?? new Date("2026-05-01T13:31:00.000Z");
  return {
    id: "d1",
    userId: "u1",
    medicationId: "m1",
    quantity: 1,
    takenAt,
    loggedAt: takenAt,
    notes: null,
    sideEffects: null,
    status: "taken",
    updatedAt: takenAt,
    medication: {
      name: "Metformin",
      dosageAmount: "500",
      dosageUnit: "mg",
      form: "tablet",
      colour: "#6366f1",
      colourSecondary: null,
      pattern: "solid",
    },
    ...overrides,
  };
}

const COVERING: DoneRow = {
  key: "d1",
  dose: dose({ id: "d1", quantity: 4 }),
  covers: ["2026-05-01T08:55:00.000Z", "2026-05-01T09:00:00.000Z", "2026-05-01T11:00:00.000Z"],
  dayLabel: null,
};

const FALLBACK = {
  label: "Metformin 500mg",
  quantity: 1,
  takenAt: new Date("2026-05-01T13:31:00.000Z"),
  todayStart: new Date(TODAY_START),
};

const plain = toastForLog({ ...FALLBACK, covers: [], tz: TZ, timeFormat: "24h" });

describe("logToastFromReload", () => {
  it("builds the toast from the reloaded Done row: its quantity, time and covered slots", () => {
    const got = logToastFromReload(
      { done: [COVERING], todayStart: TODAY_START },
      "d1",
      FALLBACK,
      TZ,
      "24h",
    );
    expect(got).toBe(
      toastForLog({
        label: formatDoseLabel("Metformin", "500", "mg"),
        quantity: 4,
        takenAt: new Date("2026-05-01T13:31:00.000Z"),
        covers: COVERING.covers.map((c) => new Date(c)),
        todayStart: new Date(TODAY_START),
        tz: TZ,
        timeFormat: "24h",
      }),
    );
    expect(got).toContain("8:55"); // formatUserTime does not pad a single-digit hour
  });

  it("falls back to the plain sentence when the reload has no row for the dose", () => {
    expect(
      logToastFromReload(
        { done: [COVERING], todayStart: TODAY_START },
        "other",
        FALLBACK,
        TZ,
        "24h",
      ),
    ).toBe(plain);
  });

  it("falls back when the action returned no doseId", () => {
    expect(
      logToastFromReload({ done: [COVERING], todayStart: TODAY_START }, null, FALLBACK, TZ, "24h"),
    ).toBe(plain);
  });

  it("falls back when the reload produced no dashboard payload at all", () => {
    expect(logToastFromReload(undefined, "d1", FALLBACK, TZ, "24h")).toBe(plain);
    expect(logToastFromReload({ done: "nope" }, "d1", FALLBACK, TZ, "24h")).toBe(plain);
  });
});
