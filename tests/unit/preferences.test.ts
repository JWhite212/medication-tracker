import { describe, it, expect, beforeEach, vi } from "vitest";
import { userPreferences } from "$lib/server/db/schema";

// Only the db is faked. `computeChanges` and `logAudit` run for real, so
// these tests exercise the actual diff and the actual audit-row shape
// rather than a stand-in for them.
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);

import { fakeDb } from "./helpers/fake-db";

// The before-image `getOrCreatePreferences` finds. Seeded as the standing
// value for the table, so it is also what an insert's RETURNING materialises.
function seedStored(row: Record<string, unknown> | undefined) {
  fakeDb.seed(userPreferences, row ? [row] : []);
}

// The row `db.update(...).returning()` hands back. Primed separately from the
// stored row so a test can make the after-image differ from the before-image
// in fields the caller never asked to change.
function seedUpdated(row: Record<string, unknown> | undefined) {
  fakeDb.seedReturning(userPreferences, row ? [row] : []);
}

const insertsOf = (table: string) =>
  fakeDb.attempted.filter((c) => c.op === "insert" && c.table === table);
const updates = () => fakeDb.attempted.filter((c) => c.op === "update");

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

// Shaped as `{ values }` so every assertion below reads exactly as it did
// against the hand-rolled fake.
function auditRows() {
  return insertsOf("audit_logs").map((c) => ({
    values: c.payload as Record<string, unknown>,
  }));
}

beforeEach(() => {
  fakeDb.reset();
  seedStored({ ...BASE_ROW });
  seedUpdated({ ...BASE_ROW });
});

describe("updatePreferences audit", () => {
  it("logs a user_preferences update keyed to the user", async () => {
    seedUpdated({ ...BASE_ROW, accentColor: "#ff0000" });

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
    seedUpdated({
      ...BASE_ROW,
      accentColor: "#ff0000",
      timeFormat: "24h",
      reducedMotion: true,
    });

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
    seedUpdated({ ...BASE_ROW, overduePushReminders: false, lowInventoryPushAlerts: true });

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
    seedUpdated({ ...BASE_ROW, updatedAt: new Date("2026-08-14T12:00:00Z") });

    await updatePreferences("u1", { accentColor: "#6366f1", timeFormat: "12h" });

    expect(updates()).toHaveLength(1); // the write still happens
    expect(auditRows()).toHaveLength(0);
  });

  it("writes no audit row for an empty payload", async () => {
    seedUpdated({ ...BASE_ROW, updatedAt: new Date("2026-08-14T12:00:00Z") });

    await updatePreferences("u1", {});

    expect(auditRows()).toHaveLength(0);
  });

  it("never reports updatedAt as a change alongside a real one", async () => {
    // A whole-row diff would pair the genuine accentColor change with a
    // meaningless updatedAt one. This is why each door used to hand-roll
    // its own field subset.
    seedUpdated({
      ...BASE_ROW,
      accentColor: "#ff0000",
      updatedAt: new Date("2026-08-14T12:00:00Z"),
    });

    await updatePreferences("u1", { accentColor: "#ff0000" });

    expect(auditRows()[0].values.changes).toEqual({
      accentColor: { from: "#6366f1", to: "#ff0000" },
    });
  });

  it("audits only the fields a partial payload named", async () => {
    // exportFormat is the only field submitted; heatmapPeriod differing in
    // the returned row (a concurrent write, say) must not leak in.
    seedUpdated({ ...BASE_ROW, exportFormat: "csv", heatmapPeriod: 30 });

    await updatePreferences("u1", { exportFormat: "csv" });

    expect(auditRows()[0].values.changes).toEqual({
      exportFormat: { from: "pdf", to: "csv" },
    });
  });

  it("creates the preferences row before updating when none exists", async () => {
    // The first read misses; the insert then materialises the row, so the
    // re-read inside getOrCreatePreferences finds it. A standing seed with a
    // one-shot empty batch in front models exactly that sequence.
    fakeDb.seedQueue(userPreferences, [[]]);
    seedStored({ ...BASE_ROW });
    seedUpdated({ ...BASE_ROW, exportFormat: "csv" });

    await updatePreferences("u1", { exportFormat: "csv" });

    expect(insertsOf("user_preferences")).toHaveLength(1);
    expect(updates()[0].table).toBe("user_preferences");
  });
});
