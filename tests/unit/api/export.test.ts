import { describe, it, expect, vi, beforeEach } from "vitest";

// buildFullExport is a thin reshape over buildSyncResponse's full-resync
// snapshot (Task 10, tests/unit/api/sync.test.ts covers that logic in
// full) — mock it here so this test proves only the reshape: version tag,
// exportedAt sourced from serverTime, and every section passed through
// untouched, including medications' nested `schedules`.
const buildSyncResponse = vi.fn(async (_userId: string, _since: string | null, _epoch: number) => ({
  epoch: 2,
  fullResync: true,
  serverTime: "2026-01-06T12:00:00.000Z",
  cursor: "2026-01-06T12:00:00.000Z",
  medications: [
    {
      id: "med-1",
      name: "Paracetamol",
      schedules: [{ id: "sch-1", timeOfDay: "08:00" }],
    },
    {
      id: "med-2",
      name: "Ibuprofen",
      schedules: [],
    },
  ],
  doseLogs: [{ id: "dose-1", medicationId: "med-1", status: "taken" }],
  inventoryEvents: [{ id: "ie-1", medicationId: "med-1", eventType: "dose_taken" }],
  auditLogs: [{ id: "al-1", entityType: "medication", entityId: "med-1", action: "create" }],
  tombstones: [],
  preferences: { userId: "u1", accentColor: "#6366f1" },
  profile: { id: "u1", email: "ada@example.com", name: "Ada Lovelace" },
}));
vi.mock("$lib/server/api/sync", () => ({
  buildSyncResponse: (userId: string, since: string | null, epoch: number) =>
    buildSyncResponse(userId, since, epoch),
}));

const { buildFullExport } = await import("../../../src/lib/server/api/export");

beforeEach(() => {
  buildSyncResponse.mockClear();
});

describe("buildFullExport", () => {
  it("calls buildSyncResponse for a full resync (since=null, epoch=0)", async () => {
    await buildFullExport("u1");
    expect(buildSyncResponse).toHaveBeenCalledWith("u1", null, 0);
  });

  it("reshapes the sync snapshot into a versioned export envelope with every section populated", async () => {
    const result = await buildFullExport("u1");

    expect(result.version).toBe(1);
    expect(result.exportedAt).toBe("2026-01-06T12:00:00.000Z");

    expect(result.profile).toEqual({ id: "u1", email: "ada@example.com", name: "Ada Lovelace" });
    expect(result.preferences).toEqual({ userId: "u1", accentColor: "#6366f1" });

    expect(result.medications).toHaveLength(2);
    const m1 = result.medications.find((m) => m.id === "med-1");
    expect(m1?.schedules).toEqual([{ id: "sch-1", timeOfDay: "08:00" }]);

    expect(result.doseLogs).toEqual([{ id: "dose-1", medicationId: "med-1", status: "taken" }]);
    expect(result.inventoryEvents).toEqual([
      { id: "ie-1", medicationId: "med-1", eventType: "dose_taken" },
    ]);
    expect(result.auditLogs).toEqual([
      { id: "al-1", entityType: "medication", entityId: "med-1", action: "create" },
    ]);

    // Export envelope omits sync-specific fields not part of the backup shape.
    expect(result).not.toHaveProperty("tombstones");
    expect(result).not.toHaveProperty("epoch");
    expect(result).not.toHaveProperty("fullResync");
    expect(result).not.toHaveProperty("cursor");
  });
});
