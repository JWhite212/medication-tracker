import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakeDb } from "./helpers/fake-db";
import { doseLogs, medications } from "$lib/server/db/schema";

// The unit tests next door prove formatDoseLogLine is correct. This file
// proves generateReport actually USES it — extracting a formatter and then
// forgetting to call it would put the bug straight back, and the PDF is a
// binary blob so nothing else would notice.
//
// pdfkit is replaced with a recorder that captures every text() call, and
// the db + analytics collaborators are stubbed so no database is needed.

const textCalls: string[] = [];

vi.mock("pdfkit", () => {
  class FakeDoc {
    private handlers: Record<string, ((arg?: unknown) => void)[]> = {};
    on(event: string, cb: (arg?: unknown) => void) {
      (this.handlers[event] ??= []).push(cb);
      return this;
    }
    fontSize() {
      return this;
    }
    fillColor() {
      return this;
    }
    moveDown() {
      return this;
    }
    text(value: string) {
      textCalls.push(value);
      return this;
    }
    end() {
      for (const cb of this.handlers["data"] ?? []) cb(Buffer.from(""));
      for (const cb of this.handlers["end"] ?? []) cb();
    }
  }
  return { default: FakeDoc };
});

const doseRows = [
  {
    takenAt: new Date("2026-06-01T08:30:00Z"),
    quantity: 2,
    sideEffects: null,
    status: "taken" as const,
    medName: "Sertraline",
    dosageAmount: "50",
    dosageUnit: "mg",
  },
  {
    takenAt: new Date("2026-06-02T08:30:00Z"),
    quantity: 2,
    sideEffects: null,
    status: "missed" as const,
    medName: "Sertraline",
    dosageAmount: "50",
    dosageUnit: "mg",
  },
  {
    takenAt: new Date("2026-06-03T08:30:00Z"),
    quantity: 2,
    sideEffects: null,
    status: "skipped" as const,
    medName: "Sertraline",
    dosageAmount: "50",
    dosageUnit: "mg",
  },
];

const medRows = [
  {
    name: "Sertraline",
    dosageAmount: "50",
    dosageUnit: "mg",
    scheduleType: "scheduled",
    isArchived: false,
  },
];

// generateReport issues its two queries inside one Promise.all, in a fixed
// order: doses first, then the medication summary.

// The database comes from the shared seam. The old fake dispatched by call
// index ([doseRows, medRows][queryIndex++]) — but the two queries read
// DIFFERENT tables (dose_logs, then medications), so seeding per table
// delivers the same rows without depending on which runs first.
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);

vi.mock("$lib/server/analytics", () => ({
  getDoseStatusBreakdown: async () => ({
    takenEvents: 1,
    takenQuantity: 2,
    skippedEvents: 1,
    missedEvents: 1,
    expectedTotal: 3,
    adherencePercent: 33,
    overusePercent: 0,
  }),
}));

const { generateReport } = await import("../../src/lib/server/export-pdf");

beforeEach(() => {
  textCalls.length = 0;
  fakeDb.reset();
  fakeDb.seed(doseLogs, doseRows);
  fakeDb.seed(medications, medRows);
});

describe("generateReport — dose log rendering", () => {
  it("marks the missed dose in the rendered document", async () => {
    await generateReport("user_1", "Europe/London", new Date("2026-06-01"), new Date("2026-06-30"));
    const doseLines = textCalls.filter((line) => line.includes("Sertraline 50mg"));

    expect(doseLines).toHaveLength(3);
    expect(doseLines.some((line) => line.includes("[MISSED]"))).toBe(true);
    expect(doseLines.some((line) => line.includes("[SKIPPED]"))).toBe(true);
  });

  it("renders the taken dose DIFFERENTLY from the missed one", async () => {
    await generateReport("user_1", "Europe/London", new Date("2026-06-01"), new Date("2026-06-30"));
    const doseLines = textCalls.filter((line) => line.includes("Sertraline 50mg"));

    // Same medication, same dosage, same quantity — before the fix these
    // two lines differed only by their date.
    const taken = doseLines.find((line) => !line.includes("["))!;
    const missed = doseLines.find((line) => line.includes("[MISSED]"))!;
    expect(taken.replace(/^.*?2026 /, "")).not.toBe(missed.replace(/^.*?2026 /, ""));
  });

  it("shows a quantity only against the dose that was actually taken", async () => {
    await generateReport("user_1", "Europe/London", new Date("2026-06-01"), new Date("2026-06-30"));
    const doseLines = textCalls.filter((line) => line.includes("Sertraline 50mg"));

    expect(doseLines.filter((line) => line.includes("x2"))).toHaveLength(1);
    expect(doseLines.find((line) => line.includes("x2"))).not.toContain("[");
  });

  it("still reports the status counts in the summary", async () => {
    await generateReport("user_1", "Europe/London", new Date("2026-06-01"), new Date("2026-06-30"));
    expect(textCalls).toContain("Missed events: 1");
    expect(textCalls).toContain("Skipped events: 1");
  });
});
