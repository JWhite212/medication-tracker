// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

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

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser({ timezone: "UTC", emailVerified: true });
  await pgDb.seedPreferences();
});

describe("overdue sweep — per-medication gate", () => {
  it("still reminds a medication with no overrides set", async () => {
    // The LEFT-JOIN trap in reverse: the gate must not drop the common
    // case, which is every medication that has never been configured.
    await pgDb.seedMedication({ id: "m1" });
    await pgDb.seedSchedule({ id: "s1", medicationId: "m1", timeOfDay: "00:01" });

    await checkOverdueMedications();

    expect(await claimedKeys()).toHaveLength(1);
  });

  it("skips a medication whose kill switch is off", async () => {
    await pgDb.seedMedication({ id: "m1", notificationsEnabled: false });
    await pgDb.seedSchedule({ id: "s1", medicationId: "m1", timeOfDay: "00:01" });

    await checkOverdueMedications();

    expect(await claimedKeys()).toHaveLength(0);
  });

  it("skips a medication that has muted both overdue channels", async () => {
    await pgDb.seedMedication({
      id: "m1",
      notifyOverdueEmail: false,
      notifyOverduePush: false,
    });
    await pgDb.seedSchedule({ id: "s1", medicationId: "m1", timeOfDay: "00:01" });

    await checkOverdueMedications();

    expect(await claimedKeys()).toHaveLength(0);
  });

  it("reminds a medication that opted INTO push while the global is off", async () => {
    await pgDb.reset();
    await pgDb.seedUser({ timezone: "UTC", emailVerified: true });
    await pgDb.seedPreferences({
      overdueEmailReminders: false,
      overduePushReminders: false,
    });
    await pgDb.seedMedication({ id: "m1", notifyOverduePush: true });
    await pgDb.seedSchedule({ id: "s1", medicationId: "m1", timeOfDay: "00:01" });

    await checkOverdueMedications();

    expect(await claimedKeys()).toHaveLength(1);
  });

  it("gates each medication independently", async () => {
    await pgDb.seedMedication({ id: "m1", notificationsEnabled: false });
    await pgDb.seedSchedule({ id: "s1", medicationId: "m1", timeOfDay: "00:01" });
    await pgDb.seedMedication({ id: "m2", name: "Other" });
    await pgDb.seedSchedule({ id: "s2", medicationId: "m2", timeOfDay: "00:01" });

    await checkOverdueMedications();

    const keys = await claimedKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain("m2");
  });
});
