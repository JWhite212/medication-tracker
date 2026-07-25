import { describe, it, expect } from "vitest";
import {
  serializeAuditLog,
  serializeDoseLog,
  serializeInventoryEvent,
  serializeMedication,
  serializePreferences,
  serializeSchedule,
  serializeTombstone,
  toSessionUser,
} from "../../../src/lib/server/api/serialize";

describe("serializers", () => {
  it("converts dates to ISO and keeps numeric strings (medication)", () => {
    const d = serializeMedication({
      id: "m1",
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
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    expect(d.dosageAmount).toBe("500");
    expect(d.scheduleIntervalHours).toBe("8");
    expect(d.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(d.startedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(d.archivedAt).toBeNull();
    expect(d.endedAt).toBeNull();
    expect(d.colourSecondary).toBeNull();
  });

  it("serializes dose log dates and passes sideEffects through", () => {
    const sideEffects = [{ name: "nausea", severity: "mild" as const }];
    const d = serializeDoseLog({
      id: "d1",
      userId: "u1",
      medicationId: "m1",
      quantity: 1,
      takenAt: new Date("2026-01-02T08:00:00Z"),
      loggedAt: new Date("2026-01-02T08:05:00Z"),
      notes: null,
      sideEffects,
      status: "taken",
      updatedAt: new Date("2026-01-02T08:05:00Z"),
    });
    expect(d.takenAt).toBe("2026-01-02T08:00:00.000Z");
    expect(d.loggedAt).toBe("2026-01-02T08:05:00.000Z");
    expect(d.updatedAt).toBe("2026-01-02T08:05:00.000Z");
    expect(d.sideEffects).toBe(sideEffects);
  });

  it("serializes schedule dates and passes daysOfWeek through", () => {
    const daysOfWeek = [1, 3, 5];
    const s = serializeSchedule({
      id: "s1",
      medicationId: "m1",
      userId: "u1",
      scheduleKind: "fixed_time",
      timeOfDay: "08:00",
      intervalHours: null,
      daysOfWeek,
      sortOrder: 0,
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      effectiveTo: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    expect(s.effectiveFrom).toBe("2026-01-01T00:00:00.000Z");
    expect(s.effectiveTo).toBeNull();
    expect(s.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(s.daysOfWeek).toBe(daysOfWeek);
    expect(s.intervalHours).toBeNull();
  });

  it("keeps interval hours (numeric-as-string) unchanged when present", () => {
    const s = serializeSchedule({
      id: "s2",
      medicationId: "m1",
      userId: "u1",
      scheduleKind: "interval",
      timeOfDay: null,
      intervalHours: "6",
      daysOfWeek: null,
      sortOrder: 0,
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      effectiveTo: new Date("2026-02-01T00:00:00Z"),
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    expect(s.intervalHours).toBe("6");
    expect(s.effectiveTo).toBe("2026-02-01T00:00:00.000Z");
  });

  it("serializes inventory event createdAt, signed quantityChange, and previous/newCount", () => {
    const e = serializeInventoryEvent({
      id: "e1",
      userId: "u1",
      medicationId: "m1",
      eventType: "dose_taken",
      quantityChange: -1,
      previousCount: 30,
      newCount: 29,
      note: null,
      createdAt: new Date("2026-01-02T08:00:00Z"),
    });
    expect(e.createdAt).toBe("2026-01-02T08:00:00.000Z");
    expect(e.quantityChange).toBe(-1);
    expect(e.previousCount).toBe(30);
    expect(e.newCount).toBe(29);

    const refill = serializeInventoryEvent({
      id: "e2",
      userId: "u1",
      medicationId: "m1",
      eventType: "refill",
      quantityChange: 30,
      previousCount: 0,
      newCount: 30,
      note: "pharmacy pickup",
      createdAt: new Date("2026-01-03T08:00:00Z"),
    });
    expect(refill.quantityChange).toBe(30);
    expect(refill.note).toBe("pharmacy pickup");
  });

  it("serializes audit log createdAt and passes changes through", () => {
    const changes = { before: { name: "Old" }, after: { name: "New" } };
    const a = serializeAuditLog({
      id: "a1",
      userId: "u1",
      entityType: "medication",
      entityId: "m1",
      action: "update",
      changes,
      createdAt: new Date("2026-01-04T00:00:00Z"),
    });
    expect(a.createdAt).toBe("2026-01-04T00:00:00.000Z");
    expect(a.changes).toBe(changes);
  });

  it("serializes preferences updatedAt", () => {
    const p = serializePreferences({
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
      updatedAt: new Date("2026-01-05T00:00:00Z"),
    });
    expect(p.updatedAt).toBe("2026-01-05T00:00:00.000Z");
    expect(p.accentColor).toBe("#6366f1");
    expect(p.doseLogPageSize).toBe(20);
  });

  it("serializes tombstone deletedAt", () => {
    const t = serializeTombstone({
      id: "t1",
      userId: "u1",
      entityType: "medication",
      entityId: "m1",
      deletedAt: new Date("2026-01-06T00:00:00Z"),
    });
    expect(t.deletedAt).toBe("2026-01-06T00:00:00.000Z");
    expect(t.entityType).toBe("medication");
  });

  it("toSessionUser returns exactly the 7 session-user fields", () => {
    const u = toSessionUser({
      id: "u1",
      email: "a@b.com",
      name: "Ada",
      avatarUrl: null,
      timezone: "UTC",
      twoFactorEnabled: false,
      emailVerified: true,
      // Extra fields present on a real users row must NOT leak through.
      passwordHash: "secret-hash",
      totpSecret: "secret-totp",
    } as never);
    expect(u).toEqual({
      id: "u1",
      email: "a@b.com",
      name: "Ada",
      avatarUrl: null,
      timezone: "UTC",
      twoFactorEnabled: false,
      emailVerified: true,
    });
    expect(Object.keys(u)).toHaveLength(7);
  });
});
