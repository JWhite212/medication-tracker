import { describe, it, expect, vi, beforeEach } from "vitest";

// Spy on `gt` while delegating to the real implementation. sync.ts
// branches `since ? gt(col, since) : eq(col, userId)` per table — this
// lets us assert which branch actually ran (5 gt-filtered tables when
// `since` is threaded through, 0 when it's null/reset by epoch) without
// having to introspect the resulting SQL fragment's internal shape.
const gtSpy = vi.fn();
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    gt: (...args: Parameters<typeof actual.gt>) => {
      gtSpy(...args);
      return actual.gt(...args);
    },
  };
});

// Table-aware db mock, same pattern as tests/unit/inventory-events.test.ts:
// a WeakMap keyed by the (mocked) table reference resolves the table
// name, and `.from(tableRef)` hands back whatever rows are seeded for
// that table. `.where()` is a chainable no-op (it ignores the actual
// condition — filtering correctness is Postgres's job, not this
// unit's); `.limit()` is likewise a no-op slice.
type Row = Record<string, unknown>;

const tableNames = new WeakMap<object, string>();
const medicationsTable = {};
const doseLogsTable = {};
const inventoryEventsTable = {};
const auditLogsTable = {};
const userPreferencesTable = {};
const usersTable = {};
const syncTombstonesTable = {};
tableNames.set(medicationsTable, "medications");
tableNames.set(doseLogsTable, "dose_logs");
tableNames.set(inventoryEventsTable, "inventory_events");
tableNames.set(auditLogsTable, "audit_logs");
tableNames.set(userPreferencesTable, "user_preferences");
tableNames.set(usersTable, "users");
tableNames.set(syncTombstonesTable, "sync_tombstones");

vi.mock("$lib/server/db/schema", () => ({
  medications: medicationsTable,
  doseLogs: doseLogsTable,
  inventoryEvents: inventoryEventsTable,
  auditLogs: auditLogsTable,
  userPreferences: userPreferencesTable,
  users: usersTable,
  syncTombstones: syncTombstonesTable,
}));

let seeded: Record<string, Row[]> = {};

function awaitableRows(rows: Row[]) {
  const promise = Promise.resolve(rows) as Promise<Row[]> & {
    limit: (n: number) => Promise<Row[]>;
  };
  promise.limit = (n: number) => Promise.resolve(rows.slice(0, n));
  return promise;
}

function buildDb() {
  return {
    select: () => ({
      from: (tableRef: object) => {
        const name = tableNames.get(tableRef) ?? "unknown";
        return {
          where: (_cond: unknown) => awaitableRows(seeded[name] ?? []),
        };
      },
    }),
  };
}

vi.mock("$lib/server/db", () => ({ db: buildDb() }));

// Schedules are synced as children of medications — getSchedulesForUser
// returns a Map<medicationId, schedule[]> that sync.ts merges in.
const getSchedulesForUser = vi.fn<(userId: string) => Promise<Map<string, Row[]>>>();
vi.mock("$lib/server/schedules", () => ({
  getSchedulesForUser: (userId: string) => getSchedulesForUser(userId),
}));

const { buildSyncResponse } = await import("../../../src/lib/server/api/sync");

const userRow = {
  id: "u1",
  email: "ada@example.com",
  name: "Ada Lovelace",
  passwordHash: "hash",
  avatarUrl: null,
  timezone: "UTC",
  totpSecret: null,
  totpLastCounter: null,
  twoFactorEnabled: false,
  emailVerified: true,
  syncEpoch: 2,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const medRow1 = {
  id: "med-1",
  userId: "u1",
  name: "Paracetamol",
  dosageAmount: "500",
  dosageUnit: "mg",
  form: "tablet",
  category: "pain relief",
  colour: "#ff0000",
  colourSecondary: null,
  pattern: "solid",
  notes: null,
  scheduleType: "scheduled",
  scheduleIntervalHours: "8",
  inventoryCount: 30,
  inventoryAlertThreshold: 5,
  sortOrder: 0,
  isArchived: false,
  archivedAt: null,
  startedAt: new Date("2026-01-01T00:00:00Z"),
  endedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-05T00:00:00Z"),
};

const medRow2 = {
  ...medRow1,
  id: "med-2",
  name: "Ibuprofen",
  updatedAt: new Date("2026-01-06T00:00:00Z"),
};

const doseLogRow = {
  id: "dose-1",
  userId: "u1",
  medicationId: "med-1",
  quantity: 1,
  takenAt: new Date("2026-01-05T08:00:00Z"),
  loggedAt: new Date("2026-01-05T08:01:00Z"),
  notes: null,
  sideEffects: null,
  status: "taken",
  updatedAt: new Date("2026-01-05T08:01:00Z"),
};

const inventoryEventRow = {
  id: "ie-1",
  userId: "u1",
  medicationId: "med-1",
  eventType: "dose_taken",
  quantityChange: -1,
  previousCount: 30,
  newCount: 29,
  note: null,
  createdAt: new Date("2026-01-05T08:01:00Z"),
};

const auditLogRow = {
  id: "al-1",
  userId: "u1",
  entityType: "medication",
  entityId: "med-1",
  action: "create",
  changes: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const preferencesRow = {
  userId: "u1",
  accentColor: "#6366f1",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "12h",
  uiDensity: "comfortable",
  reducedMotion: false,
  overdueEmailReminders: true,
  overduePushReminders: true,
  lowInventoryEmailAlerts: true,
  lowInventoryPushAlerts: false,
  doseLogPageSize: 20,
  heatmapPeriod: 90,
  exportFormat: "pdf",
  updatedAt: new Date("2026-01-02T00:00:00Z"),
};

const tombstoneRow = {
  id: "tomb-1",
  userId: "u1",
  entityType: "medication",
  entityId: "med-old",
  deletedAt: new Date("2026-01-06T00:00:00Z"),
};

const scheduleRow1 = {
  id: "sch-1",
  medicationId: "med-1",
  userId: "u1",
  scheduleKind: "fixed_time",
  timeOfDay: "08:00",
  intervalHours: null,
  daysOfWeek: null,
  sortOrder: 0,
  effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  effectiveTo: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const scheduleRow2 = {
  ...scheduleRow1,
  id: "sch-2",
  timeOfDay: "20:00",
  sortOrder: 1,
};

const scheduleRow3 = {
  ...scheduleRow1,
  id: "sch-3",
  medicationId: "med-2",
};

beforeEach(() => {
  gtSpy.mockClear();
  getSchedulesForUser.mockReset();
  getSchedulesForUser.mockResolvedValue(
    new Map([
      ["med-1", [scheduleRow1, scheduleRow2]],
      ["med-2", [scheduleRow3]],
    ]),
  );
  seeded = {
    users: [userRow],
    medications: [medRow1, medRow2],
    dose_logs: [doseLogRow],
    inventory_events: [inventoryEventRow],
    audit_logs: [auditLogRow],
    user_preferences: [preferencesRow],
    sync_tombstones: [tombstoneRow],
  };
});

describe("buildSyncResponse", () => {
  it("since=null: returns all rows, medications carry their full schedule set, fullResync=true", async () => {
    const result = await buildSyncResponse("u1", null, 2);

    expect(result.fullResync).toBe(true);
    expect(result.epoch).toBe(2);
    expect(typeof result.serverTime).toBe("string");
    expect(result.cursor).toBe(result.serverTime);

    expect(result.medications).toHaveLength(2);
    const m1 = result.medications.find((m) => m.id === "med-1");
    const m2 = result.medications.find((m) => m.id === "med-2");
    expect(m1?.schedules).toHaveLength(2);
    expect(m1?.schedules.map((s) => s.id)).toEqual(["sch-1", "sch-2"]);
    expect(m2?.schedules).toHaveLength(1);
    expect(m2?.schedules[0].id).toBe("sch-3");
    // Dates serialized to ISO, numeric-string columns pass through.
    expect(m1?.updatedAt).toBe("2026-01-05T00:00:00.000Z");
    expect(m1?.dosageAmount).toBe("500");

    expect(result.doseLogs).toHaveLength(1);
    expect(result.doseLogs[0].id).toBe("dose-1");
    expect(result.inventoryEvents).toHaveLength(1);
    expect(result.auditLogs).toHaveLength(1);

    // Full resync: since is null, so tombstones are never queried —
    // the client is rebuilding from scratch and has nothing to reconcile.
    expect(result.tombstones).toEqual([]);

    expect(result.preferences).toMatchObject({ userId: "u1", accentColor: "#6366f1" });
    expect(result.profile).toEqual({
      id: "u1",
      email: "ada@example.com",
      name: "Ada Lovelace",
      avatarUrl: null,
      timezone: "UTC",
      twoFactorEnabled: false,
      emailVerified: true,
    });

    // No `since` threaded through -> no table used the gt(...) branch.
    expect(gtSpy).not.toHaveBeenCalled();
  });

  it("since=<ISO>, clientEpoch === serverEpoch: fullResync=false, gt(...) filter threaded for every cursor table, tombstones included", async () => {
    const since = "2026-01-03T00:00:00.000Z";
    const result = await buildSyncResponse("u1", since, 2);

    expect(result.fullResync).toBe(false);
    expect(result.epoch).toBe(2);

    // medications.updatedAt, doseLogs.updatedAt, inventoryEvents.createdAt,
    // auditLogs.createdAt, syncTombstones.deletedAt.
    expect(gtSpy).toHaveBeenCalledTimes(5);
    for (const call of gtSpy.mock.calls) {
      expect(call[1]).toEqual(new Date(since));
    }

    expect(result.tombstones).toHaveLength(1);
    expect(result.tombstones[0]).toMatchObject({ id: "tomb-1", entityId: "med-old" });
    expect(result.medications).toHaveLength(2);
    expect(result.doseLogs).toHaveLength(1);
  });

  it("clientEpoch < users.syncEpoch: forces fullResync=true and ignores `since`", async () => {
    const result = await buildSyncResponse("u1", "2026-01-03T00:00:00.000Z", 0);

    expect(result.fullResync).toBe(true);
    expect(result.epoch).toBe(2);
    // since gets nulled out internally by the epoch check, so no gt(...)
    // branch runs and tombstones stay empty, same as a plain since=null call.
    expect(gtSpy).not.toHaveBeenCalled();
    expect(result.tombstones).toEqual([]);
  });
});
