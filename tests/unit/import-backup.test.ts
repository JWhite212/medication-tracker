import { describe, it, expect } from "vitest";

// Pure module — validation only, no db in the dependency graph.
import { parseBackup } from "../../src/lib/server/import/backup";

type Json = Record<string, unknown>;

function backup(overrides: Json = {}): Json {
  return {
    version: 1,
    exportedAt: "2026-06-01T10:00:00.000Z",
    profile: {
      id: "user_source",
      email: "someone-else@example.com",
      name: "Source User",
      avatarUrl: null,
      timezone: "Europe/London",
      twoFactorEnabled: true,
      emailVerified: true,
    },
    preferences: {
      userId: "user_source",
      accentColor: "#ff0000",
      timeFormat: "24h",
      doseLogPageSize: 50,
      updatedAt: "2026-06-01T10:00:00.000Z",
    },
    medications: [
      {
        id: "med_1",
        userId: "user_source",
        name: "Sertraline",
        dosageAmount: "50",
        dosageUnit: "mg",
        form: "tablet",
        category: "prescription",
        colour: "#123456",
        colourSecondary: null,
        pattern: "solid",
        notes: null,
        scheduleType: "scheduled",
        scheduleIntervalHours: "24",
        inventoryCount: 30,
        inventoryAlertThreshold: 7,
        sortOrder: 3,
        isArchived: false,
        archivedAt: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        schedules: [
          {
            id: "sched_1",
            medicationId: "med_1",
            userId: "user_source",
            scheduleKind: "fixed_time",
            timeOfDay: "08:00",
            intervalHours: null,
            daysOfWeek: null,
            sortOrder: 0,
            effectiveFrom: "2026-01-01T00:00:00.000Z",
            effectiveTo: null,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    ],
    doseLogs: [
      {
        id: "dose_1",
        userId: "user_source",
        medicationId: "med_1",
        quantity: 2,
        takenAt: "2026-05-01T08:00:00.000Z",
        loggedAt: "2026-05-01T08:05:00.000Z",
        notes: "note",
        sideEffects: [{ name: "Nausea", severity: "mild" }],
        status: "missed",
        updatedAt: "2026-05-01T08:05:00.000Z",
      },
    ],
    inventoryEvents: [
      {
        id: "evt_1",
        userId: "user_source",
        medicationId: "med_1",
        eventType: "refill",
        quantityChange: 30,
        previousCount: 0,
        newCount: 30,
        note: null,
        createdAt: "2026-04-01T00:00:00.000Z",
      },
    ],
    auditLogs: [{ id: "aud_1", userId: "user_source", entityType: "medication", action: "create" }],
    ...overrides,
  };
}

describe("parseBackup — happy path", () => {
  it("parses a full v1 envelope", () => {
    const result = parseBackup(JSON.stringify(backup()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { bundle } = result;
    expect(bundle.format).toBe("backup-json");
    expect(bundle.medications).toHaveLength(1);
    expect(bundle.doses).toHaveLength(1);
    expect(bundle.inventoryEvents).toHaveLength(1);
  });

  it("keeps numeric columns as strings", () => {
    // dosageAmount / intervalHours are Drizzle `numeric`, which round-trips
    // as a string. Coercing to number would change the wire shape.
    const result = parseBackup(JSON.stringify(backup()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.medications[0].dosageAmount).toBe("50");
    expect(typeof result.bundle.medications[0].scheduleIntervalHours).toBe("string");
  });

  it("preserves a 'missed' status that no existing write path can produce", () => {
    const result = parseBackup(JSON.stringify(backup()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.doses[0].status).toBe("missed");
  });

  it("converts timestamps to Date objects", () => {
    const result = parseBackup(JSON.stringify(backup()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.doses[0].takenAt).toBeInstanceOf(Date);
    expect(result.bundle.medications[0].startedAt).toBeInstanceOf(Date);
  });
});

describe("parseBackup — what it refuses to carry across", () => {
  it("NEVER surfaces the file's userId on any row", () => {
    const result = parseBackup(JSON.stringify(backup()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serialised = JSON.stringify(result.bundle);
    expect(serialised).not.toContain("user_source");
  });

  it("NEVER surfaces the file's email or 2FA state", () => {
    const result = parseBackup(JSON.stringify(backup()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.bundle.profile).toEqual({ name: "Source User", timezone: "Europe/London" });
    expect(JSON.stringify(result.bundle)).not.toContain("someone-else@example.com");
  });

  it("DROPS auditLogs entirely — replaying them would fabricate history", () => {
    const result = parseBackup(JSON.stringify(backup()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.bundle)).not.toContain("aud_1");
  });

  it("ignores unknown top-level and row-level keys", () => {
    const raw = backup({ somethingNew: { nested: true } }) as Json;
    (raw.medications as Json[])[0].futureField = "x";
    const result = parseBackup(JSON.stringify(raw));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.bundle)).not.toContain("futureField");
  });

  it("does not let a __proto__ key pollute Object.prototype", () => {
    const raw = `{"version":1,"medications":[],"doseLogs":[],"inventoryEvents":[],"__proto__":{"polluted":true}}`;
    const result = parseBackup(raw);
    expect(result.ok).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("parseBackup — rejections", () => {
  it("REJECTS a version it doesn't understand, and says so", () => {
    const result = parseBackup(JSON.stringify(backup({ version: 2 })));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/version 2/);
  });

  it("REJECTS a missing version", () => {
    const raw = backup();
    delete raw.version;
    expect(parseBackup(JSON.stringify(raw)).ok).toBe(false);
  });

  it("REJECTS invalid JSON", () => {
    expect(parseBackup("{nope}").ok).toBe(false);
  });

  it("REJECTS a top-level array", () => {
    expect(parseBackup("[]").ok).toBe(false);
  });

  it("REJECTS a non-numeric dosage", () => {
    const raw = backup();
    (raw.medications as Json[])[0].dosageAmount = "; DROP TABLE users";
    const result = parseBackup(JSON.stringify(raw));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/dosageAmount/);
  });

  it("REJECTS an invalid timezone in the profile", () => {
    const raw = backup();
    (raw.profile as Json).timezone = "Mars/Olympus_Mons";
    expect(parseBackup(JSON.stringify(raw)).ok).toBe(false);
  });

  it("REJECTS more medications than the cap allows", () => {
    const one = (backup().medications as Json[])[0];
    const raw = backup({ medications: Array.from({ length: 1001 }, () => ({ ...one })) });
    expect(parseBackup(JSON.stringify(raw)).ok).toBe(false);
  });

  it("points at the offending row in its message", () => {
    const raw = backup();
    (raw.medications as Json[])[0].dosageUnit = "";
    const result = parseBackup(JSON.stringify(raw));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("medications[0].dosageUnit");
  });
});

describe("parseBackup — tolerance", () => {
  it("falls back for a cosmetic field rather than failing the import", () => {
    const raw = backup();
    (raw.medications as Json[])[0].colour = "octarine";
    (raw.medications as Json[])[0].form = "hologram";
    const result = parseBackup(JSON.stringify(raw));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.medications[0].colour).toMatch(/^#[0-9a-f]{6}$/i);
    expect(result.bundle.medications[0].form).toBe("other");
  });

  it("drops orphan doses and reports how many", () => {
    const raw = backup();
    (raw.doseLogs as Json[]).push({
      medicationId: "med_missing",
      quantity: 1,
      takenAt: "2026-05-02T08:00:00.000Z",
      status: "taken",
    });
    const result = parseBackup(JSON.stringify(raw));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.doses).toHaveLength(1);
    expect(result.bundle.warnings.join(" ")).toMatch(/1 dose entry/);
  });

  it("accepts an envelope with no optional arrays at all", () => {
    const result = parseBackup(JSON.stringify({ version: 1 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.medications).toEqual([]);
    expect(result.bundle.doses).toEqual([]);
  });
});

describe("parseBackup — one bad row must not sink the file", () => {
  function withExtraDose(takenAt: string): ReturnType<typeof parseBackup> {
    const raw = backup();
    (raw.doseLogs as Json[]).push({
      medicationId: "med_1",
      quantity: 1,
      takenAt,
      status: "taken",
    });
    return parseBackup(JSON.stringify(raw));
  }

  it("skips a dose dated absurdly far in the future, keeping the rest", () => {
    const result = withExtraDose("2099-01-01T00:00:00.000Z");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.doses).toHaveLength(1);
    expect(result.bundle.warnings.join(" ")).toMatch(/could not be read/);
  });

  it("skips a dose dated before 1900, keeping the rest", () => {
    const result = withExtraDose("1850-01-01T00:00:00.000Z");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.doses).toHaveLength(1);
  });

  it("skips an unparseable timestamp, keeping the rest", () => {
    const result = withExtraDose("yesterday-ish");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.doses).toHaveLength(1);
  });

  it("ACCEPTS a near-future dose, because the app itself allows logging one", () => {
    // doseLogSchema puts no upper bound on takenAt, so the app can store
    // a future dose. A tighter window here would make the app's own
    // backup unimportable.
    const soon = new Date(Date.now() + 7 * 86400000).toISOString();
    const result = withExtraDose(soon);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.doses).toHaveLength(2);
    expect(result.bundle.warnings).toEqual([]);
  });

  it("still REJECTS the whole file for a bad medication, which is structural", () => {
    // Dropping a medication would silently orphan all of its dose
    // history, so medications stay strict where doses are tolerant.
    const raw = backup();
    (raw.medications as Json[])[0].dosageAmount = "not-a-number";
    expect(parseBackup(JSON.stringify(raw)).ok).toBe(false);
  });

  it("demotes a fixed-time schedule with no time to PRN rather than writing a broken row", () => {
    const raw = backup();
    (raw.medications as Json[])[0].schedules = [
      { scheduleKind: "fixed_time", timeOfDay: null, sortOrder: 0 },
    ];
    const result = parseBackup(JSON.stringify(raw));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.medications[0].schedules[0].scheduleKind).toBe("prn");
    expect(result.bundle.warnings.join(" ")).toMatch(/as needed/);
  });

  it("demotes a zero-interval schedule to PRN rather than writing a reminder trap", () => {
    // The import door is the only one of three that admits "0" — the web form
    // and /api/v1 both parse through scheduleRowSchema's positive().max(72).
    // A live "0" interval row made the medication overdue the instant it was
    // logged, once per dose.
    const raw = backup();
    (raw.medications as Json[])[0].schedules = [
      { scheduleKind: "interval", intervalHours: "0", sortOrder: 0 },
    ];
    const result = parseBackup(JSON.stringify(raw));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.medications[0].schedules[0].scheduleKind).toBe("prn");
    expect(result.bundle.warnings.join(" ")).toMatch(/as needed/);
  });

  it("demotes an interval above the door cap, which the other two doors reject", () => {
    const raw = backup();
    (raw.medications as Json[])[0].schedules = [
      { scheduleKind: "interval", intervalHours: "9999", sortOrder: 0 },
    ];
    const result = parseBackup(JSON.stringify(raw));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.medications[0].schedules[0].scheduleKind).toBe("prn");
  });

  it("keeps a valid interval at the cap boundary", () => {
    // 72 is admissible; 73 is not. The boundary is inclusive.
    const raw = backup();
    (raw.medications as Json[])[0].schedules = [
      { scheduleKind: "interval", intervalHours: "72", sortOrder: 0 },
    ];
    const result = parseBackup(JSON.stringify(raw));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.medications[0].schedules[0].scheduleKind).toBe("interval");
    expect(result.bundle.medications[0].schedules[0].intervalHours).toBe("72");
    expect(result.bundle.warnings).toEqual([]);
  });
});
