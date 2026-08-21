// @vitest-environment node
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

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

async function keys(): Promise<string[]> {
  const rows = await pgDb.db.select().from(reminderEvents);
  return rows.map((r) => r.dedupeKey).sort();
}

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser({ timezone: "UTC" });
  await pgDb.seedPreferences();
  // toFake: ["Date"] only. Faking all timers stalls PGlite's WASM layer.
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("nag series", () => {
  it("mints exactly one key when no repeat is configured", async () => {
    await pgDb.seedMedication({ id: "m1" });
    await pgDb.seedSchedule({ id: "s1", medicationId: "m1", timeOfDay: "08:00" });

    vi.setSystemTime(new Date("2026-05-01T09:00:00.000Z"));
    await checkOverdueMedications();
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"));
    await checkOverdueMedications();

    expect(await keys()).toHaveLength(1);
  });

  it("mints a second key once the repeat interval has elapsed", async () => {
    await pgDb.seedMedication({
      id: "m1",
      notifyRepeatEveryMinutes: 30,
      notifyMaxRepeats: 3,
    });
    await pgDb.seedSchedule({ id: "s1", medicationId: "m1", timeOfDay: "08:00" });

    vi.setSystemTime(new Date("2026-05-01T08:00:00.000Z"));
    await checkOverdueMedications();
    expect(await keys()).toHaveLength(1);

    vi.setSystemTime(new Date("2026-05-01T08:30:00.000Z"));
    await checkOverdueMedications();
    const two = await keys();
    expect(two).toHaveLength(2);
    expect(two[1]).toMatch(/:n1$/);
  });

  it("does not re-claim the same nag window twice", async () => {
    await pgDb.seedMedication({ id: "m1", notifyRepeatEveryMinutes: 30, notifyMaxRepeats: 3 });
    await pgDb.seedSchedule({ id: "s1", medicationId: "m1", timeOfDay: "08:00" });

    vi.setSystemTime(new Date("2026-05-01T08:35:00.000Z"));
    await checkOverdueMedications();
    vi.setSystemTime(new Date("2026-05-01T08:40:00.000Z"));
    await checkOverdueMedications();

    expect(await keys()).toHaveLength(1);
  });

  it("stops at maxRepeats + 1 keys however long the dose goes unlogged", async () => {
    // The bound that makes this safe. #110 had no bound and produced one
    // reminder per interval forever.
    await pgDb.seedMedication({ id: "m1", notifyRepeatEveryMinutes: 30, notifyMaxRepeats: 2 });
    await pgDb.seedSchedule({ id: "s1", medicationId: "m1", timeOfDay: "08:00" });

    for (let h = 8; h <= 22; h++) {
      vi.setSystemTime(new Date(`2026-05-01T${String(h).padStart(2, "0")}:00:00.000Z`));
      await checkOverdueMedications();
      vi.setSystemTime(new Date(`2026-05-01T${String(h).padStart(2, "0")}:30:00.000Z`));
      await checkOverdueMedications();
    }

    expect(await keys()).toHaveLength(3);
  });

  it("stops the series as soon as the dose is logged", async () => {
    await pgDb.seedMedication({ id: "m1", notifyRepeatEveryMinutes: 30, notifyMaxRepeats: 3 });
    await pgDb.seedSchedule({ id: "s1", medicationId: "m1", timeOfDay: "08:00" });

    vi.setSystemTime(new Date("2026-05-01T08:00:00.000Z"));
    await checkOverdueMedications();
    expect(await keys()).toHaveLength(1);

    await pgDb.seedDose({
      medicationId: "m1",
      takenAt: new Date("2026-05-01T08:10:00.000Z"),
      status: "taken",
    });

    vi.setSystemTime(new Date("2026-05-01T09:30:00.000Z"));
    await checkOverdueMedications();
    expect(await keys()).toHaveLength(1);
  });

  it("claims a new nag well inside the 30-minute failure-retry cooldown", async () => {
    // The orthogonality property the spec claims and nothing else proves.
    // RETRY_DELAY_MS is 30 minutes, but it gates re-attempting a FAILED
    // send on an EXISTING row. A new nag is a new dedupe key, so it
    // inserts rather than conflicting and the cooldown never applies.
    //
    // If the ordinal had been stored as a counter on the row instead of
    // in the key, this test would fail — and a short nag interval would
    // also let an in-flight dispatch be reclaimed as an abandoned lease,
    // because RETRY_DELAY_MS doubles as the stale-pending threshold.
    //
    // 5 minutes is below the web picker's 30-minute floor on purpose:
    // the column accepts any interval, so this must hold there too.
    await pgDb.seedMedication({ id: "m1", notifyRepeatEveryMinutes: 5, notifyMaxRepeats: 3 });
    await pgDb.seedSchedule({ id: "s1", medicationId: "m1", timeOfDay: "08:00" });

    vi.setSystemTime(new Date("2026-05-01T08:00:00.000Z"));
    await checkOverdueMedications();
    vi.setSystemTime(new Date("2026-05-01T08:05:00.000Z"));
    await checkOverdueMedications();

    const two = await keys();
    expect(two).toHaveLength(2);
    expect(two.some((k) => k.endsWith(":n1"))).toBe(true);
  });

  it("a skip stops the series just as a taken dose does", async () => {
    await pgDb.seedMedication({ id: "m1", notifyRepeatEveryMinutes: 30, notifyMaxRepeats: 3 });
    await pgDb.seedSchedule({ id: "s1", medicationId: "m1", timeOfDay: "08:00" });

    vi.setSystemTime(new Date("2026-05-01T08:00:00.000Z"));
    await checkOverdueMedications();

    await pgDb.seedDose({
      medicationId: "m1",
      takenAt: new Date("2026-05-01T08:10:00.000Z"),
      status: "skipped",
    });

    vi.setSystemTime(new Date("2026-05-01T09:30:00.000Z"));
    await checkOverdueMedications();
    expect(await keys()).toHaveLength(1);
  });
});
