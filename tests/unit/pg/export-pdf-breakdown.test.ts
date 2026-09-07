// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

/**
 * The clinician PDF's "Adherence summary", driven by the REAL query.
 *
 * `tests/unit/export-pdf-report.test.ts` stubs `getDoseStatusBreakdown` with
 * fixed values — the right seam for its `from`/`to` bound assertions, and
 * kept — but it means the block below had no coverage of the numbers it
 * prints. Two of the three values this file guards (`adherencePercent`,
 * `overusePercent`) reach NO web surface at all: `StatusBreakdownBar` takes
 * only taken/skipped/missed/expected. Without this file they would have no
 * evidence anywhere, and `export-pdf.ts`'s `if (overusePercent > 0)` branch
 * had never executed in any committed test.
 *
 * Only `pdfkit` is replaced, by a recorder. Everything below it is real.
 */

const textCalls: string[] = [];

vi.mock("pdfkit", () => {
  class RecordingDocument {
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
  return { default: RecordingDocument };
});

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

// Deliberately NOT mocked — this file exists to run it.
const { generateReport } = await import("../../../src/lib/server/export-pdf");

const NOW = new Date("2026-09-01T12:00:00Z");
const LONG_AGO = new Date("2026-01-01T00:00:00Z");

// The window the export route hands in: `to` is the EXCLUSIVE start of the
// day after the last requested one (parseDayRangeParam), so 1–30 August is
// thirty days. `export-pdf.ts` passes the breakdown `to - 1ms`.
const FROM = new Date("2026-08-01T00:00:00Z");
const TO = new Date("2026-08-31T00:00:00Z");

beforeAll(() => {
  // Date only — faking all timers stalls PGlite's WASM layer.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  textCalls.length = 0;
  await pgDb.reset();
  await pgDb.seedUser();
});

async function seedScheduledMed(id: string) {
  await pgDb.seedMedication({
    id,
    name: `Scheduled ${id}`,
    scheduleType: "scheduled",
    startedAt: LONG_AGO,
  });
  await pgDb.seedSchedule({ medicationId: id, scheduleKind: "fixed_time", timeOfDay: "08:00" });
}

async function seedPrnMed(id: string) {
  await pgDb.seedMedication({
    id,
    name: `PRN ${id}`,
    scheduleType: "as_needed",
    startedAt: LONG_AGO,
  });
  await pgDb.seedSchedule({ medicationId: id, scheduleKind: "prn", timeOfDay: null });
}

/**
 * `count` doses, all inside the window.
 *
 * Spread across 25 days and stacked by hour, not laid out on consecutive
 * days: the overuse fixture needs more doses than the window has days, and
 * running off the end would drop the surplus the test is there to see.
 */
async function seedDoses(medicationId: string, count: number) {
  for (let i = 0; i < count; i++) {
    await pgDb.seedDose({
      medicationId,
      takenAt: new Date(Date.UTC(2026, 7, 1 + (i % 25), 6 + Math.floor(i / 25), 0, 0)),
    });
  }
}

/** The seven lines a clinician reads, in the order the document emits them. */
function summaryBlock(): string[] {
  return textCalls.filter((line) =>
    /^(Taken events|Taken quantity|Skipped events|Missed events|Expected events|Adherence|Overuse):/.test(
      line,
    ),
  );
}

describe("the clinician PDF's adherence summary", () => {
  it("does not claim overuse, or hide misses, for a patient who under-took", async () => {
    // 30-day window, one daily medication: 30 expected, 20 taken. Plus a
    // PRN medication taken 15 times, which expects nothing.
    await seedScheduledMed("sched");
    await seedDoses("sched", 20);
    await seedPrnMed("prn");
    await seedDoses("prn", 15);

    await generateReport("u1", "UTC", FROM, TO, "", "24h", "DD/MM/YYYY");

    expect(summaryBlock()).toEqual([
      "Taken events: 35",
      "Taken quantity: 35",
      "Skipped events: 0",
      "Missed events: 10",
      "Expected events: 30",
      "Adherence: 66.7%",
    ]);
    // The overuse line is gated on `> 0`, so a correct 0 removes it entirely.
    expect(summaryBlock().some((l) => l.startsWith("Overuse:"))).toBe(false);
  });

  it("still reports genuine overuse", async () => {
    await seedScheduledMed("sched");
    await seedDoses("sched", 45);

    await generateReport("u1", "UTC", FROM, TO, "", "24h", "DD/MM/YYYY");

    expect(summaryBlock()).toContain("Adherence: 100%");
    expect(summaryBlock()).toContain("Overuse: 50%");
  });

  // `api/export/+server.ts` builds these bounds with `parseDayRangeParam(...,
  // tz, ...)`, so they are LOCAL midnights — and a civil range containing a
  // spring-forward is an hour short of `days * 24h`. Counted in flat 24-hour
  // days it loses one, which on this document means a month's report claiming
  // fewer expected doses than it has days, and an overuse line on a patient
  // who took every dose.
  describe("across a spring-forward, for a user in a DST zone", () => {
    // Europe/London, 1–31 March 2026. BST starts on the 29th, so local
    // midnight on 1 April is 30 days and 23 hours after local midnight on
    // 1 March, not 31 flat days.
    const MARCH_FROM = new Date("2026-03-01T00:00:00Z");
    const APRIL_FROM = new Date("2026-03-31T23:00:00Z");

    it("counts every civil day, and claims no overuse from the missing hour", async () => {
      await seedScheduledMed("sched");
      // One dose on each of the 31 civil days.
      for (let day = 1; day <= 31; day++) {
        await pgDb.seedDose({
          medicationId: "sched",
          takenAt: new Date(Date.UTC(2026, 2, day, 9, 0, 0)),
        });
      }

      await generateReport("u1", "Europe/London", MARCH_FROM, APRIL_FROM, "", "24h", "DD/MM/YYYY");

      expect(summaryBlock()).toContain("Taken events: 31");
      expect(summaryBlock()).toContain("Expected events: 31");
      expect(summaryBlock()).toContain("Adherence: 100%");
      expect(summaryBlock().some((l) => l.startsWith("Overuse:"))).toBe(false);
    });

    it("counts the transition day itself as a day", async () => {
      // The acute case: a one-day report on 29 March spans 23 local hours.
      // Truncating scored it zero, so a patient who took their dose read
      // "Expected events: 0" and "Adherence: 0%".
      await seedScheduledMed("sched");
      await pgDb.seedDose({
        medicationId: "sched",
        takenAt: new Date("2026-03-29T09:00:00Z"),
      });

      await generateReport(
        "u1",
        "Europe/London",
        new Date("2026-03-29T00:00:00Z"),
        new Date("2026-03-29T23:00:00Z"),
        "",
        "24h",
        "DD/MM/YYYY",
      );

      expect(summaryBlock()).toContain("Expected events: 1");
      expect(summaryBlock()).toContain("Adherence: 100%");
    });
  });
});
