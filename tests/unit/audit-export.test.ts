import { describe, it, expect } from "vitest";
import { buildAuditCsv } from "../../src/lib/server/audit-export";

describe("buildAuditCsv", () => {
  it("emits the canonical header row even when there are no events", () => {
    const csv = buildAuditCsv([]);
    expect(csv).toBe("Date,Time,Entity,Entity ID,Action,Changes");
  });

  it("renders one row per event with ISO date/time and action", () => {
    const csv = buildAuditCsv([
      {
        createdAt: new Date("2026-05-04T08:30:15Z"),
        entityType: "medication",
        entityId: "med-A",
        action: "create",
        changes: null,
      },
    ]);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe("2026-05-04,08:30:15,medication,med-A,create,");
  });

  it("serialises a changes object as JSON inside a CSV cell", () => {
    const csv = buildAuditCsv([
      {
        createdAt: new Date("2026-05-04T08:30:15Z"),
        entityType: "user",
        entityId: "u1",
        action: "update",
        changes: { emailReminders: { from: true, to: false } },
      },
    ]);
    // The whole JSON gets wrapped in double-quotes because it contains
    // a comma. escapeCsvCell doubles inner quotes so JSON re-parses.
    expect(csv).toContain(`"{""emailReminders"":{""from"":true,""to"":false}}"`);
  });

  it("neutralises spreadsheet formula injection in entity ids", () => {
    const csv = buildAuditCsv([
      {
        createdAt: new Date("2026-05-04T08:30:15Z"),
        entityType: "medication",
        entityId: "=evil()",
        action: "create",
        changes: null,
      },
    ]);
    // Cells starting with =/+/-/@ get a leading apostrophe per
    // escapeCsvCell. Confirms the audit exporter inherits the
    // formula-injection guard from the dose CSV path.
    expect(csv).toContain(",'=evil(),create,");
  });

  it("uses CRLF line endings (RFC 4180)", () => {
    const csv = buildAuditCsv([
      {
        createdAt: new Date("2026-05-04T08:30:15Z"),
        entityType: "medication",
        entityId: "med-A",
        action: "create",
        changes: null,
      },
    ]);
    expect(csv.includes("\r\n")).toBe(true);
  });
});
