import { describe, it, expect, beforeEach, vi } from "vitest";
import { userPreferences, auditLogs } from "$lib/server/db/schema";

// The stored row `getOrCreatePreferences` finds (undefined = row absent,
// which sends it down the insert path).
let storedRow: Record<string, unknown> | undefined;

// The row `db.update(...).returning()` hands back. Primed separately from
// `storedRow` so a test can make the after-image differ from the before-
// image in fields the caller never asked to change.
let updatedRow: Record<string, unknown> | undefined;

const inserts: Array<{ table: unknown; values: Record<string, unknown> }> = [];
const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];

// Only the db is faked. `computeChanges` and `logAudit` run for real, so
// these tests exercise the actual diff and the actual audit-row shape
// rather than a stand-in for them.
function buildChainable() {
  return {
    select: () => {
      const chain: Record<string, unknown> = {};
      const passthrough = () => chain;
      chain.from = passthrough;
      chain.where = passthrough;
      chain.limit = () => Promise.resolve(storedRow ? [storedRow] : []);
      return chain;
    },
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ table, values });
        const result = {
          onConflictDoNothing: () => result,
          returning: () => {
            // A real insert materialises the row, so the caller's
            // subsequent read sees it. Model that, or the before-image
            // comes back undefined in the row-absent case.
            if (table === userPreferences && !storedRow) {
              storedRow = { ...BASE_ROW, userId: values.userId as string };
            }
            return Promise.resolve(storedRow ? [storedRow] : []);
          },
          // logAudit awaits `.values(...)` directly.
          then: (onFulfilled: (v: unknown) => unknown) =>
            Promise.resolve().then(() => onFulfilled(undefined)),
        };
        return result;
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        updates.push({ table, values });
        return {
          where: () => ({
            returning: () => Promise.resolve(updatedRow ? [updatedRow] : []),
          }),
        };
      },
    }),
  };
}

vi.mock("$lib/server/db", () => ({ db: buildChainable() }));

const { updatePreferences } = await import("$lib/server/preferences");

// A complete stored row, matching the schema defaults.
const BASE_ROW = {
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
  updatedAt: new Date("2026-08-01T00:00:00Z"),
};

function auditRows() {
  return inserts.filter((i) => i.table === auditLogs);
}

beforeEach(() => {
  inserts.length = 0;
  updates.length = 0;
  storedRow = { ...BASE_ROW };
  updatedRow = { ...BASE_ROW };
});

describe("updatePreferences audit", () => {
  it("logs a user_preferences update keyed to the user", async () => {
    updatedRow = { ...BASE_ROW, accentColor: "#ff0000" };

    await updatePreferences("u1", { accentColor: "#ff0000" });

    expect(auditRows()).toHaveLength(1);
    expect(auditRows()[0].values).toMatchObject({
      userId: "u1",
      entityType: "user_preferences",
      entityId: "u1",
      action: "update",
      changes: { accentColor: { from: "#6366f1", to: "#ff0000" } },
    });
  });

  it("diffs every field an appearance save submits", async () => {
    updatedRow = {
      ...BASE_ROW,
      accentColor: "#ff0000",
      timeFormat: "24h",
      reducedMotion: true,
    };

    await updatePreferences("u1", {
      accentColor: "#ff0000",
      dateFormat: "DD/MM/YYYY",
      timeFormat: "24h",
      uiDensity: "comfortable",
      reducedMotion: true,
    });

    expect(auditRows()[0].values.changes).toEqual({
      accentColor: { from: "#6366f1", to: "#ff0000" },
      timeFormat: { from: "12h", to: "24h" },
      reducedMotion: { from: false, to: true },
    });
  });

  it("diffs every field a notifications save submits", async () => {
    updatedRow = { ...BASE_ROW, overduePushReminders: false, lowInventoryPushAlerts: true };

    await updatePreferences("u1", {
      overdueEmailReminders: true,
      overduePushReminders: false,
      lowInventoryEmailAlerts: true,
      lowInventoryPushAlerts: true,
    });

    expect(auditRows()[0].values.changes).toEqual({
      overduePushReminders: { from: true, to: false },
      lowInventoryPushAlerts: { from: false, to: true },
    });
  });

  it("writes no audit row when the submitted values match the stored ones", async () => {
    // updatePreferences stamps updatedAt on every write, so the after-image
    // always differs from the before-image somewhere, even on a no-op save.
    updatedRow = { ...BASE_ROW, updatedAt: new Date("2026-08-14T12:00:00Z") };

    await updatePreferences("u1", { accentColor: "#6366f1", timeFormat: "12h" });

    expect(updates).toHaveLength(1); // the write still happens
    expect(auditRows()).toHaveLength(0);
  });

  it("writes no audit row for an empty payload", async () => {
    updatedRow = { ...BASE_ROW, updatedAt: new Date("2026-08-14T12:00:00Z") };

    await updatePreferences("u1", {});

    expect(auditRows()).toHaveLength(0);
  });

  it("never reports updatedAt as a change alongside a real one", async () => {
    // A whole-row diff would pair the genuine accentColor change with a
    // meaningless updatedAt one. This is why each door used to hand-roll
    // its own field subset.
    updatedRow = {
      ...BASE_ROW,
      accentColor: "#ff0000",
      updatedAt: new Date("2026-08-14T12:00:00Z"),
    };

    await updatePreferences("u1", { accentColor: "#ff0000" });

    expect(auditRows()[0].values.changes).toEqual({
      accentColor: { from: "#6366f1", to: "#ff0000" },
    });
  });

  it("audits only the fields a partial payload named", async () => {
    // exportFormat is the only field submitted; heatmapPeriod differing in
    // the returned row (a concurrent write, say) must not leak in.
    updatedRow = { ...BASE_ROW, exportFormat: "csv", heatmapPeriod: 30 };

    await updatePreferences("u1", { exportFormat: "csv" });

    expect(auditRows()[0].values.changes).toEqual({
      exportFormat: { from: "pdf", to: "csv" },
    });
  });

  it("creates the preferences row before updating when none exists", async () => {
    storedRow = undefined;
    updatedRow = { ...BASE_ROW, exportFormat: "csv" };

    await updatePreferences("u1", { exportFormat: "csv" });

    expect(inserts.filter((i) => i.table === userPreferences)).toHaveLength(1);
    expect(updates[0].table).toBe(userPreferences);
  });
});
