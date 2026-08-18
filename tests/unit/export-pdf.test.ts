import { describe, it, expect, vi } from "vitest";

// export-pdf.ts imports $lib/server/db, which evaluates neon() at module
// load. Stub it out so this unit test doesn't need a database — same
// pattern as tests/unit/export-csv.test.ts.
// This module imports `db` but must never reach it. unusedDb THROWS on any
// property access, so an accidental query fails loudly instead of silently
// returning [] — do not "upgrade" this to createFakeDb().
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).unusedDb);

const { formatDoseLogLine } = await import("../../src/lib/server/export-pdf");

const TZ = "Europe/London";

type Row = Parameters<typeof formatDoseLogLine>[0];

function dose(overrides: Partial<Row> = {}): Row {
  return {
    takenAt: new Date("2026-06-01T08:30:00Z"),
    quantity: 1,
    status: "taken",
    medName: "Sertraline",
    dosageAmount: "50",
    dosageUnit: "mg",
    ...overrides,
  };
}

describe("formatDoseLogLine — status must be visible", () => {
  it("labels a missed dose", () => {
    // The whole point: a missed dose in a report handed to a clinician
    // must not read as a dose that was taken.
    expect(formatDoseLogLine(dose({ status: "missed" }), TZ, "24h")).toContain("[MISSED]");
  });

  it("labels a skipped dose", () => {
    expect(formatDoseLogLine(dose({ status: "skipped" }), TZ, "24h")).toContain("[SKIPPED]");
  });

  it("leaves a taken dose unlabelled", () => {
    const line = formatDoseLogLine(dose({ status: "taken" }), TZ, "24h");
    expect(line).not.toContain("[");
  });

  it("renders the three statuses DIFFERENTLY from each other", () => {
    const lines = (["taken", "skipped", "missed"] as const).map((status) =>
      formatDoseLogLine(dose({ status }), TZ, "24h"),
    );
    expect(new Set(lines).size).toBe(3);
  });
});

describe("formatDoseLogLine — quantity only means something for a taken dose", () => {
  it("shows the quantity for a taken dose", () => {
    expect(formatDoseLogLine(dose({ status: "taken", quantity: 2 }), TZ, "24h")).toContain("x2");
  });

  it("does NOT show a quantity for a missed dose", () => {
    // TimelineEntry.svelte only renders quantity when status === "taken".
    // Printing "x2" against a missed dose asserts two doses were consumed
    // when none were.
    const line = formatDoseLogLine(dose({ status: "missed", quantity: 2 }), TZ, "24h");
    expect(line).not.toContain("x2");
  });

  it("does NOT show a quantity for a skipped dose", () => {
    const line = formatDoseLogLine(dose({ status: "skipped", quantity: 3 }), TZ, "24h");
    expect(line).not.toContain("x3");
  });
});

describe("formatDoseLogLine — the parts that already worked", () => {
  it("keeps medication name and dosage", () => {
    const line = formatDoseLogLine(dose(), TZ, "24h");
    expect(line).toContain("Sertraline");
    expect(line).toContain("50mg");
  });

  it("renders the date and time in the user's timezone", () => {
    // 1 June is BST (UTC+1), so 08:30Z is 9:30 local. Not zero-padded:
    // formatUserTime uses hour "numeric", which the CSV export shares.
    const line = formatDoseLogLine(dose(), TZ, "24h");
    expect(line).toContain("1 Jun 2026");
    expect(line).toContain("9:30");
  });

  it("honours the 12-hour preference", () => {
    expect(formatDoseLogLine(dose(), TZ, "12h")).toMatch(/9:30\s?am/i);
  });
});
