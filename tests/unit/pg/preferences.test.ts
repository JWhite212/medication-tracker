// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, userPreferences } from "../../../src/lib/server/db/schema";

// Real Postgres, not the fake. updatePreferences now reads its
// before-image through a locking CTE (`with ... for update`), and
// fakeDb's chainable has no `$with`, no update `.from()` and no select
// `.for()`. Per CLAUDE.md, behaviour the database decides belongs here
// rather than in a bigger fake.
vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { updatePreferences } = await import("../../../src/lib/server/preferences");

// A complete stored row, matching the schema defaults.
const BASE_ROW = {
  userId: "u1",
  accentColor: "#4f46e5",
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
};

async function auditRows() {
  return pgDb.db.select().from(auditLogs).where(eq(auditLogs.entityType, "user_preferences"));
}

async function storedRow() {
  const [row] = await pgDb.db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, "u1"));
  return row;
}

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  await pgDb.seedPreferences(BASE_ROW);
});

describe("updatePreferences audit", () => {
  it("logs a user_preferences update keyed to the user", async () => {
    await updatePreferences("u1", { accentColor: "#ff0000" });

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: "u1",
      entityType: "user_preferences",
      entityId: "u1",
      action: "update",
      changes: { accentColor: { from: "#4f46e5", to: "#ff0000" } },
    });
  });

  it("diffs every field an appearance save submits", async () => {
    await updatePreferences("u1", {
      accentColor: "#ff0000",
      dateFormat: "DD/MM/YYYY",
      timeFormat: "24h",
      uiDensity: "comfortable",
      reducedMotion: true,
    });

    expect((await auditRows())[0].changes).toEqual({
      accentColor: { from: "#4f46e5", to: "#ff0000" },
      timeFormat: { from: "12h", to: "24h" },
      reducedMotion: { from: false, to: true },
    });
  });

  it("diffs every field a notifications save submits", async () => {
    await updatePreferences("u1", {
      overdueEmailReminders: true,
      overduePushReminders: false,
      lowInventoryEmailAlerts: true,
      lowInventoryPushAlerts: true,
    });

    expect((await auditRows())[0].changes).toEqual({
      overduePushReminders: { from: true, to: false },
      lowInventoryPushAlerts: { from: false, to: true },
    });
  });

  it("writes no audit row when the submitted values match the stored ones", async () => {
    // updatePreferences stamps updatedAt on every write, so the
    // after-image always differs from the before-image somewhere, even on
    // a no-op save. The write must still happen; only the audit row is
    // suppressed.
    const before = (await storedRow()).updatedAt;

    await updatePreferences("u1", { accentColor: "#4f46e5", timeFormat: "12h" });

    expect((await storedRow()).updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(await auditRows()).toHaveLength(0);
  });

  it("writes no audit row for an empty payload", async () => {
    await updatePreferences("u1", {});

    expect(await auditRows()).toHaveLength(0);
  });

  it("never reports updatedAt as a change alongside a real one", async () => {
    // A whole-row diff would pair the genuine accentColor change with a
    // meaningless updatedAt one. This is why each door used to hand-roll
    // its own field subset.
    await updatePreferences("u1", { accentColor: "#ff0000" });

    expect((await auditRows())[0].changes).toEqual({
      accentColor: { from: "#4f46e5", to: "#ff0000" },
    });
  });

  it("audits only the fields a partial payload named", async () => {
    // exportFormat is the only field submitted; heatmapPeriod must not
    // leak into the recorded changes even though it is part of the row
    // the UPDATE returns.
    await updatePreferences("u1", { exportFormat: "csv" });

    expect((await auditRows())[0].changes).toEqual({
      exportFormat: { from: "pdf", to: "csv" },
    });
  });

  it("creates the preferences row before updating when none exists", async () => {
    // Reset past the shared beforeEach seed so getOrCreatePreferences has
    // to create the row itself before the update runs.
    await pgDb.reset();
    await pgDb.seedUser();

    await updatePreferences("u1", { exportFormat: "csv" });

    expect((await storedRow()).exportFormat).toBe("csv");
    expect((await auditRows())[0].changes).toEqual({
      exportFormat: { from: "pdf", to: "csv" },
    });
  });
});
