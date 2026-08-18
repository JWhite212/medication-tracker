import { describe, it, expect, vi } from "vitest";

// The import parser itself is pure — nothing in its dependency graph
// touches the database, which is the whole reason it lives apart from
// apply.ts. Only the round-trip check below reaches for the *exporter*'s
// escapeCsvCell, and export-csv.ts imports $lib/server/db, which
// evaluates neon() at module load. Stub it so this file still runs
// without a DATABASE_URL.
// This module imports `db` but must never reach it. unusedDb THROWS on any
// property access, so an accidental query fails loudly instead of silently
// returning [] — do not "upgrade" this to createFakeDb().
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).unusedDb);

import {
  parseCsv,
  unescapeCsvCell,
  parseClockTime,
  splitDosage,
  parseSideEffects,
  colourForName,
  parseDoseCsv,
} from "../../src/lib/server/import/csv";
import { DOSE_CSV_HEADER } from "../../src/lib/server/import/detect";

const { escapeCsvCell } = await import("../../src/lib/server/export-csv");

describe("parseCsv (RFC 4180)", () => {
  it("splits plain rows on CRLF", () => {
    expect(parseCsv("a,b\r\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("accepts LF and bare CR as row terminators", () => {
    expect(parseCsv("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseCsv("a,b\rc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps commas inside quoted fields", () => {
    expect(parseCsv('a,"b,c",d')).toEqual([["a", "b,c", "d"]]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsv('a,"say ""hi""",b')).toEqual([["a", 'say "hi"', "b"]]);
  });

  it("keeps newlines inside quoted fields", () => {
    expect(parseCsv('a,"line1\r\nline2",b')).toEqual([["a", "line1\r\nline2", "b"]]);
  });

  it("does not invent a trailing row for a file ending in a newline", () => {
    expect(parseCsv("a,b\r\n")).toEqual([["a", "b"]]);
  });

  it("preserves empty trailing fields", () => {
    expect(parseCsv("a,b,,")).toEqual([["a", "b", "", ""]]);
  });

  it("treats a quote in the MIDDLE of a field as a literal character", () => {
    // Otherwise one stray unescaped quote opens a quoted run that eats
    // the rest of the file into a single cell.
    expect(parseCsv('a,5" patch,b\r\nc,d,e')).toEqual([
      ["a", '5" patch', "b"],
      ["c", "d", "e"],
    ]);
  });

  it("stops at the row cap instead of materialising an unbounded array", () => {
    const many = Array.from({ length: 100 }, (_, i) => `r${i},x`).join("\r\n");
    expect(parseCsv(many, 10)).toHaveLength(10);
  });
});

describe("unescapeCsvCell — inverse of the formula-injection guard", () => {
  it("strips the guard apostrophe before a formula character", () => {
    expect(unescapeCsvCell("'=SUM(A1)")).toBe("=SUM(A1)");
    expect(unescapeCsvCell("'-5 left")).toBe("-5 left");
    expect(unescapeCsvCell("'+44 7700")).toBe("+44 7700");
    expect(unescapeCsvCell("'@handle")).toBe("@handle");
  });

  it("leaves a genuine apostrophe alone when the next char is safe", () => {
    expect(unescapeCsvCell("'tis a note")).toBe("'tis a note");
    expect(unescapeCsvCell("O'Brien")).toBe("O'Brien");
  });

  it("round-trips every cell the exporter would guard", () => {
    for (const original of ["=cmd", "+1", "-2 tablets", "@x", "plain", "O'Brien", ""]) {
      // escapeCsvCell also quotes; strip the quoting the way parseCsv does.
      const escaped = escapeCsvCell(original);
      const unquoted =
        escaped.startsWith('"') && escaped.endsWith('"')
          ? escaped.slice(1, -1).replace(/""/g, '"')
          : escaped;
      expect(unescapeCsvCell(unquoted)).toBe(original);
    }
  });
});

describe("parseClockTime", () => {
  it("reads 24-hour times", () => {
    expect(parseClockTime("15:45")).toEqual({ hours: 15, minutes: 45 });
    expect(parseClockTime("00:00")).toEqual({ hours: 0, minutes: 0 });
  });

  it("reads 12-hour times with a day period", () => {
    expect(parseClockTime("3:45 pm")).toEqual({ hours: 15, minutes: 45 });
    expect(parseClockTime("3:45 AM")).toEqual({ hours: 3, minutes: 45 });
  });

  it("handles the narrow no-break space newer ICU puts before am/pm", () => {
    expect(parseClockTime("3:45 pm")).toEqual({ hours: 15, minutes: 45 });
    expect(parseClockTime("3:45 am")).toEqual({ hours: 3, minutes: 45 });
  });

  it("gets midnight and noon the right way round", () => {
    expect(parseClockTime("12:00 am")).toEqual({ hours: 0, minutes: 0 });
    expect(parseClockTime("12:00 pm")).toEqual({ hours: 12, minutes: 0 });
  });

  it("returns null for unreadable input", () => {
    expect(parseClockTime("")).toBeNull();
    expect(parseClockTime("half past three")).toBeNull();
    expect(parseClockTime("25:00")).toBeNull();
    expect(parseClockTime("10:99")).toBeNull();
    expect(parseClockTime("13:00 pm")).toBeNull();
  });
});

describe("splitDosage", () => {
  it("splits the exporter's fused amount+unit cell", () => {
    expect(splitDosage("500mg")).toEqual({ amount: "500", unit: "mg" });
    expect(splitDosage("2.5ml")).toEqual({ amount: "2.5", unit: "ml" });
    expect(splitDosage("1 tablet")).toEqual({ amount: "1", unit: "tablet" });
  });

  it("falls back rather than losing the row", () => {
    expect(splitDosage("")).toEqual({ amount: "1", unit: "dose" });
    expect(splitDosage("unknown")).toEqual({ amount: "1", unit: "dose" });
    expect(splitDosage("10")).toEqual({ amount: "10", unit: "dose" });
  });
});

describe("parseSideEffects", () => {
  it("reverses the exporter's 'name (severity)' join", () => {
    expect(parseSideEffects("Nausea (mild); Headache (severe)")).toEqual([
      { name: "Nausea", severity: "mild" },
      { name: "Headache", severity: "severe" },
    ]);
  });

  it("returns null for an empty cell", () => {
    expect(parseSideEffects("")).toBeNull();
    expect(parseSideEffects("   ")).toBeNull();
  });

  it("keeps a name that has no severity rather than dropping it", () => {
    expect(parseSideEffects("Dizziness")).toEqual([{ name: "Dizziness", severity: "mild" }]);
  });
});

describe("colourForName", () => {
  it("is deterministic, so re-importing a name doesn't recolour it", () => {
    expect(colourForName("Sertraline")).toBe(colourForName("Sertraline"));
  });

  it("always produces a valid hex colour", () => {
    for (const name of ["A", "Sertraline", "", "ω"]) {
      expect(colourForName(name)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

const TZ = "Europe/London";

function csv(...rows: string[]): string {
  return [DOSE_CSV_HEADER, ...rows].join("\r\n");
}

describe("parseDoseCsv", () => {
  it("parses a well-formed export", () => {
    const result = parseDoseCsv(
      csv("2026-06-01,08:30,taken,Sertraline,50mg,1,Felt fine,Nausea (mild)"),
      TZ,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.bundle.format).toBe("dose-csv");
    expect(result.bundle.medications).toHaveLength(1);
    expect(result.bundle.medications[0]).toMatchObject({
      name: "Sertraline",
      dosageAmount: "50",
      dosageUnit: "mg",
      // A CSV carries no schedule, so a guessed interval would feed
      // dailyRateFor and skew refill forecasts. PRN is the honest shape.
      scheduleType: "as_needed",
    });
    expect(result.bundle.medications[0].schedules[0].scheduleKind).toBe("prn");

    expect(result.bundle.doses).toHaveLength(1);
    expect(result.bundle.doses[0]).toMatchObject({
      medicationName: "Sertraline",
      quantity: 1,
      status: "taken",
      notes: "Felt fine",
    });
    expect(result.bundle.doses[0].sideEffects).toEqual([{ name: "Nausea", severity: "mild" }]);
  });

  it("reads the wall-clock time in the given timezone", () => {
    // 1 June is BST (UTC+1), so 08:30 local is 07:30Z.
    const result = parseDoseCsv(csv("2026-06-01,08:30,taken,A,1mg,1,,"), TZ);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.doses[0].takenAt.toISOString()).toBe("2026-06-01T07:30:00.000Z");
  });

  it("preserves skipped and missed statuses", () => {
    const result = parseDoseCsv(
      csv("2026-06-01,08:30,skipped,A,1mg,1,,", "2026-06-02,08:30,missed,A,1mg,1,,"),
      TZ,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.doses.map((d) => d.status)).toEqual(["skipped", "missed"]);
  });

  it("back-dates the stub medication to its earliest dose", () => {
    const result = parseDoseCsv(
      csv("2026-06-10,08:30,taken,A,1mg,1,,", "2026-01-05,08:30,taken,A,1mg,1,,"),
      TZ,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Without this, analytics scores every day before "today" as
    // "medication didn't exist yet".
    expect(result.bundle.medications[0].startedAt?.toISOString()).toContain("2026-01-05");
  });

  it("groups rows by medication name case-insensitively", () => {
    const result = parseDoseCsv(
      csv(
        "2026-06-01,08:30,taken,Sertraline,50mg,1,,",
        "2026-06-02,08:30,taken,sertraline,50mg,1,,",
      ),
      TZ,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.medications).toHaveLength(1);
    expect(result.bundle.doses).toHaveLength(2);
  });

  it("skips unreadable rows and reports them instead of failing the file", () => {
    const result = parseDoseCsv(
      csv(
        "2026-06-01,08:30,taken,Good,1mg,1,,",
        "01/06/2026,08:30,taken,AmbiguousDate,1mg,1,,",
        "2026-06-02,half past,taken,BadTime,1mg,1,,",
        "2026-06-03,08:30,taken,,1mg,1,,",
      ),
      TZ,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.doses).toHaveLength(1);
    expect(result.bundle.warnings[0]).toMatch(/3 rows were skipped/);
  });

  it("REJECTS DD/MM/YYYY rather than guessing between it and MM/DD/YYYY", () => {
    const result = parseDoseCsv(csv("03/04/2026,08:30,taken,A,1mg,1,,"), TZ);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.doses).toHaveLength(0);
    expect(result.bundle.warnings[0]).toMatch(/YYYY-MM-DD/);
  });

  it("strips the exporter's formula guard from notes", () => {
    const result = parseDoseCsv(csv(`2026-06-01,08:30,taken,A,1mg,1,'=SUM(A1),`), TZ);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.doses[0].notes).toBe("=SUM(A1)");
  });

  it("handles quoted notes containing commas and newlines", () => {
    const raw = `${DOSE_CSV_HEADER}\r\n2026-06-01,08:30,taken,A,1mg,1,"one, two\r\nthree",`;
    const result = parseDoseCsv(raw, TZ);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.doses[0].notes).toBe("one, two\r\nthree");
  });

  it("REJECTS a file whose header doesn't match the export", () => {
    const result = parseDoseCsv("When,What\n2026-06-01,A", TZ);
    expect(result.ok).toBe(false);
  });

  it("REJECTS a date that matches the shape but isn't a real day", () => {
    // ^\d{4}-\d{2}-\d{2}$ happily accepts 2026-13-45, which then reaches
    // Intl.DateTimeFormat and throws RangeError — 500ing the whole import
    // over one bad row.
    const result = parseDoseCsv(
      csv("2026-13-45,08:30,taken,A,1mg,1,,", "2026-02-31,08:30,taken,A,1mg,1,,"),
      TZ,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.doses).toHaveLength(0);
    expect(result.bundle.warnings[0]).toMatch(/real YYYY-MM-DD/);
  });

  it("REJECTS a date outside the supported range", () => {
    // The JSON path gets this bound from importDate; the CSV path has to
    // apply it itself or a dose dated 9999 stretches every future range.
    const result = parseDoseCsv(csv("9999-12-31,09:00,taken,A,1mg,1,,"), TZ);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.doses).toHaveLength(0);
    expect(result.bundle.warnings[0]).toMatch(/supported range/);
  });

  it("does not let a stray quote swallow the rest of the file", () => {
    // A bare quote mid-cell must not open a quoted run that absorbs every
    // following comma and newline into one field.
    const result = parseDoseCsv(
      csv('2026-06-01,08:30,taken,5" patch,1mg,1,,', "2026-06-02,08:30,taken,B,1mg,1,,"),
      TZ,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.doses).toHaveLength(2);
    expect(result.bundle.medications.map((m) => m.name).sort()).toEqual(['5" patch', "B"]);
  });

  it("tolerates leading blank lines, matching what detectFormat accepts", () => {
    const result = parseDoseCsv("\r\n\r\n" + csv("2026-06-01,08:30,taken,A,1mg,1,,"), TZ);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.doses).toHaveLength(1);
  });

  it("carries no inventory events — a dose CSV has none", () => {
    const result = parseDoseCsv(csv("2026-06-01,08:30,taken,A,1mg,1,,"), TZ);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.inventoryEvents).toEqual([]);
    expect(result.bundle.profile).toBeNull();
    expect(result.bundle.preferences).toBeNull();
  });
});
