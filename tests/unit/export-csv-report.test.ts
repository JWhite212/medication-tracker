import { describe, it, expect, beforeEach, vi } from "vitest";
import { doseLogs } from "$lib/server/db/schema";

// A SECOND file rather than an addition to export-csv.test.ts, which is
// deliberately pinned to `unusedDb` so an accidental query there fails loudly.
// This one has to reach the database seam, because the invariant under test is
// what `generateCsvReport` actually writes — and until now nothing executed it.
// `import-round-trip.test.ts` keeps a hand-written replica of the output
// commented "byte-for-byte what generateCsvReport emits", which pins the
// importer against a copy, not against the exporter.
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);

const { fakeDb } = await import("./helpers/fake-db");
const { generateCsvReport } = await import("../../src/lib/server/export-csv");

function seedDose(takenAt: string) {
  fakeDb.reset();
  fakeDb.seed(doseLogs, [
    {
      takenAt: new Date(takenAt),
      quantity: 1,
      notes: null,
      sideEffects: null,
      status: "taken",
      medName: "Ibuprofen",
      dosageAmount: "200",
      dosageUnit: "mg",
    },
  ]);
}

/** The Date column of the single data row. */
async function dateCell(timezone: string): Promise<string> {
  const csv = await generateCsvReport("u1", timezone, new Date(0), new Date(), "24h");
  return csv.split("\n")[1].split(",")[0];
}

describe("generateCsvReport — the Date column", () => {
  beforeEach(() => fakeDb.reset());

  it("writes strict YYYY-MM-DD, which is what the importer demands", async () => {
    seedDose("2026-04-15T17:20:00Z");
    expect(await dateCell("UTC")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    seedDose("2026-04-15T17:20:00Z");
    expect(await dateCell("UTC")).toBe("2026-04-15");
  });

  it("resolves the date in the user's timezone, matching how doses are grouped", async () => {
    // 17:20Z is still the 15th in London but already the 16th in Auckland.
    seedDose("2026-04-15T17:20:00Z");
    expect(await dateCell("Pacific/Auckland")).toBe("2026-04-16");
    seedDose("2026-04-15T17:20:00Z");
    expect(await dateCell("Europe/London")).toBe("2026-04-15");
  });

  it("zero-pads a year below 1000 so the importer still accepts it", async () => {
    // `Intl.DateTimeFormat(...).format()` renders this year as "999", which
    // `import/csv.ts` rejects as not a real YYYY-MM-DD. Only the explicit pad
    // in `isoDayKey` keeps the round trip intact.
    seedDose("0999-01-05T12:00:00Z");
    expect(await dateCell("UTC")).toBe("0999-01-05");
  });

  it("never follows preferences.dateFormat — the column is a key, not a label", async () => {
    // generateCsvReport takes no dateFormat argument at all, which is the
    // structural half of this guarantee. This pins the observable half: the
    // cell stays ISO regardless of anything the caller could pass.
    seedDose("2026-04-15T17:20:00Z");
    const csv = await generateCsvReport("u1", "UTC", new Date(0), new Date(), "12h");
    expect(csv.split("\n")[1].split(",")[0]).toBe("2026-04-15");
  });
});
