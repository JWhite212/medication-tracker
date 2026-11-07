import { describe, it, expect, beforeEach, vi } from "vitest";
import { doseLogs } from "$lib/server/db/schema";

// The time cells of the two server CSVs, against the importer that reads one
// of them back. The dose export reaches the database seam, so it runs on the
// fake (nothing here is decided by SQL); the audit builder is pure.
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);

const { fakeDb } = await import("./helpers/fake-db");
const { generateCsvReport } = await import("../../src/lib/server/export-csv");
const { parseDoseCsv, parseTimeCell } = await import("../../src/lib/server/import/csv");
const { buildAuditCsv } = await import("../../src/lib/server/audit-csv");

const LONDON = "Europe/London";
// Europe/London 2026-10-25 falls back at 02:00 BST: 01:00–01:59 local happens
// twice. 00:30Z is the first 01:30 (BST), 01:30Z the second (GMT).
const FIRST_PASS = "2026-10-25T00:30:00.000Z";
const SECOND_PASS = "2026-10-25T01:30:00.000Z";

function seedDoses(...takenAt: string[]) {
  fakeDb.reset();
  fakeDb.seed(
    doseLogs,
    takenAt.map((iso) => ({
      takenAt: new Date(iso),
      quantity: 1,
      notes: null,
      sideEffects: null,
      status: "taken",
      medName: "Ibuprofen",
      dosageAmount: "200",
      dosageUnit: "mg",
    })),
  );
}

async function exportCsv(timeFormat: "12h" | "24h" = "24h"): Promise<string> {
  return generateCsvReport("u1", LONDON, new Date(0), new Date("2027-01-01"), timeFormat);
}

function timeCells(csv: string): string[] {
  return csv
    .split("\r\n")
    .slice(1)
    .map((line) => line.split(",")[1]);
}

function reimportedInstants(csv: string, timezone = LONDON): string[] {
  const parsed = parseDoseCsv(csv, timezone);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.bundle.doses.map((d) => d.takenAt.toISOString()).sort();
}

describe("dose CSV: a fall-back hour round-trips to the instant it came from", () => {
  beforeEach(() => fakeDb.reset());

  it("re-imports the second 01:30 as 01:30Z, not an hour earlier", async () => {
    // Without the offset the importer resolves "01:30" to the EARLIER instant
    // by policy, so this dose came back at 00:30Z — and, keyed on the UTC
    // minute, merge mode then imported it beside the original as a duplicate.
    seedDoses(SECOND_PASS);
    expect(reimportedInstants(await exportCsv())).toEqual([SECOND_PASS]);
  });

  it("keeps both passes of the repeated hour distinct", async () => {
    seedDoses(SECOND_PASS, FIRST_PASS);
    const csv = await exportCsv();
    expect(timeCells(csv)).toEqual(["1:30 UTC+00:00", "1:30"]);
    expect(reimportedInstants(csv)).toEqual([FIRST_PASS, SECOND_PASS]);
  });

  it("also round-trips in 12-hour mode", async () => {
    seedDoses(SECOND_PASS);
    const csv = await exportCsv("12h");
    expect(timeCells(csv)[0]).toMatch(/^1:30\s?am UTC\+00:00$/i);
    expect(reimportedInstants(csv)).toEqual([SECOND_PASS]);
  });

  it("names the exact instant even when imported under another zone", async () => {
    seedDoses(SECOND_PASS);
    expect(reimportedInstants(await exportCsv(), "America/New_York")).toEqual([SECOND_PASS]);
  });

  it("leaves every unambiguous row exactly as before", async () => {
    // A normal day, the first pass, and a spring-forward day: none of these
    // wall clocks is ambiguous, so none carries a suffix.
    seedDoses("2026-04-15T17:20:00Z", FIRST_PASS, "2026-03-29T01:30:00Z");
    expect(timeCells(await exportCsv())).toEqual(["18:20", "1:30", "2:30"]);
  });

  it("still reads a file exported before the suffix existed", () => {
    const old = [
      "Date,Time,Status,Medication,Dosage,Quantity,Notes,Side Effects",
      "2026-10-25,01:30,taken,Ibuprofen,200mg,1,,",
    ].join("\r\n");
    // No offset: the documented earlier-of-two policy, unchanged.
    expect(reimportedInstants(old)).toEqual([FIRST_PASS]);
  });
});

describe("parseTimeCell", () => {
  it("reads a bare clock with no offset", () => {
    expect(parseTimeCell("13:05")).toEqual({ hours: 13, minutes: 5, offsetMinutes: null });
  });

  it("reads a signed offset", () => {
    expect(parseTimeCell("1:30 am UTC-03:30")).toEqual({
      hours: 1,
      minutes: 30,
      offsetMinutes: -210,
    });
  });

  it.each(["01:30 UTC+15:00", "01:30 UTC+01:60", "01:30 UTC+1:00", "25:00 UTC+00:00"])(
    "rejects %s",
    (raw) => {
      expect(parseTimeCell(raw)).toBeNull();
    },
  );
});

describe("audit CSV: Date and Time are the account's wall clock", () => {
  const row = (iso: string) => ({
    createdAt: new Date(iso),
    entityType: "medication",
    entityId: "med-A",
    action: "update",
    changes: null,
  });

  it("east of UTC, a 09:00 local event is on the local date", () => {
    // 2026-05-03T21:00Z is 09:00 on 4 May in Auckland. It used to print as
    // 2026-05-03,21:00:00 in a file named for 4 May.
    const csv = buildAuditCsv([row("2026-05-03T21:00:00Z")], "Pacific/Auckland");
    expect(csv.split("\r\n")[1]).toBe("2026-05-04,09:00:00,medication,med-A,update,");
  });

  it("west of UTC, a late-evening event stays on its local date", () => {
    const csv = buildAuditCsv([row("2026-05-05T02:15:30Z")], "America/Los_Angeles");
    expect(csv.split("\r\n")[1]).toBe("2026-05-04,19:15:30,medication,med-A,update,");
  });

  it("renders midnight as 00, never 24", () => {
    const csv = buildAuditCsv([row("2026-05-04T23:00:00Z")], LONDON);
    expect(csv.split("\r\n")[1]).toBe("2026-05-05,00:00:00,medication,med-A,update,");
  });
});
