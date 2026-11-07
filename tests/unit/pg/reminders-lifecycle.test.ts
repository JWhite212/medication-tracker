// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);
vi.mock("$lib/server/email", () => ({
  sendReminderEmail: vi.fn(async () => ({ ok: true })),
  sendLowInventoryEmail: vi.fn(async () => ({ ok: true })),
  isEmailConfigured: () => true,
}));
vi.mock("$lib/server/push", () => ({
  sendPushNotification: vi.fn(async () => ({ ok: true })),
  hasPushSubscriptions: vi.fn(async () => false),
}));

import { pgDb } from "../helpers/pg-db";
import { reminderEvents } from "../../../src/lib/server/db/schema";

const { checkOverdueMedications } = await import("../../../src/lib/server/reminders");

async function claimedKeys(): Promise<string[]> {
  const rows = await pgDb.db.select().from(reminderEvents);
  return rows.map((r) => r.dedupeKey);
}

// SRV-4: the overdue sweep must apply the same lifecycle clip as the
// dashboard (`projectMedicationSlots`): no slot before `startedAt`, none
// at or after `endedAt`.
beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser({ timezone: "UTC", emailVerified: true });
  await pgDb.seedPreferences();
  // Date only: faking every timer stalls PGlite's WASM layer.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-05-01T14:30:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("overdue sweep — medication lifecycle", () => {
  it("control: a medication started yesterday is reminded about today's 08:00", async () => {
    await pgDb.seedMedication({ id: "m1", startedAt: new Date("2026-04-30T09:00:00.000Z") });
    await pgDb.seedSchedule({ id: "s1", medicationId: "m1", timeOfDay: "08:00" });

    await checkOverdueMedications();

    expect(await claimedKeys()).toHaveLength(1);
  });

  it("does not remind about an 08:00 slot for a medication added at 14:00", async () => {
    await pgDb.seedMedication({ id: "m1", startedAt: new Date("2026-05-01T14:00:00.000Z") });
    await pgDb.seedSchedule({ id: "s1", medicationId: "m1", timeOfDay: "08:00" });

    await checkOverdueMedications();

    expect(await claimedKeys()).toHaveLength(0);
  });

  it("does not remind about a medication whose endedAt is in the past", async () => {
    await pgDb.seedMedication({
      id: "m1",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      endedAt: new Date("2026-04-01T00:00:00.000Z"),
    });
    await pgDb.seedSchedule({ id: "s1", medicationId: "m1", timeOfDay: "08:00" });

    await checkOverdueMedications();

    expect(await claimedKeys()).toHaveLength(0);
  });
});

describe("computeOverdueSlot — lifecycle clip (pure)", () => {
  it("an interval slot at or after endedAt is not overdue", async () => {
    const { computeOverdueSlot } = await import("../../../src/lib/server/reminders/domain");
    const now = new Date("2026-05-01T14:30:00.000Z");
    const row = {
      scheduleKind: "interval",
      intervalHours: "6",
      timeOfDay: null,
      daysOfWeek: null,
      userTimezone: "UTC",
      lastEventAt: new Date("2026-05-01T06:00:00.000Z"),
    };
    expect(computeOverdueSlot(row, now)?.toISOString()).toBe("2026-05-01T12:00:00.000Z");
    expect(
      computeOverdueSlot({ ...row, endedAt: new Date("2026-05-01T12:00:00.000Z") }, now),
    ).toBeNull();
    expect(computeOverdueSlot({ ...row, endedAt: null, startedAt: null }, now)).not.toBeNull();
  });
});
