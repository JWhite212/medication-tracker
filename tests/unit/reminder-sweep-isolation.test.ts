import { describe, it, expect, vi, beforeEach } from "vitest";

// SRV-9: one failed DB call inside the overdue sweep must not cancel the
// rest of that sweep, nor the low-inventory sweep that follows it. The tick
// must still fail loudly afterwards.

vi.mock("$env/dynamic/private", () => ({ env: { CRON_SECRET: "s3cret" } }));
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);
vi.mock("$lib/server/heartbeat", () => ({
  pingHeartbeat: vi.fn(async () => ({ status: "skipped" })),
}));
vi.mock("$lib/server/retention", () => ({ runRetentionForTick: vi.fn(async () => {}) }));
vi.mock("$lib/server/email", () => ({
  isEmailConfigured: () => false,
  sendReminderEmail: vi.fn(),
  sendLowInventoryEmail: vi.fn(),
}));
vi.mock("$lib/server/push", () => ({
  hasPushSubscriptions: vi.fn(async () => false),
  sendPushNotification: vi.fn(),
}));
vi.mock("$lib/server/reminders/dispatch", () => ({ withReminderClaim: vi.fn() }));

import { fakeDb } from "./helpers/fake-db";
import { medicationSchedules, doseLogs, medications } from "$lib/server/db/schema";
import { withReminderClaim } from "$lib/server/reminders/dispatch";
import { GET } from "../../src/routes/api/cron/reminders/+server";

function scheduleRow(medicationId: string) {
  return {
    scheduleId: `s-${medicationId}`,
    scheduleKind: "interval",
    intervalHours: "4",
    timeOfDay: null,
    daysOfWeek: null,
    medicationId,
    medicationName: `Med ${medicationId}`,
    userId: "u1",
    userEmail: "u@example.test",
    userEmailVerified: true,
    userTimezone: "UTC",
    userOverdueEmailReminders: false,
    userOverduePushReminders: true,
    userLowInventoryEmailAlerts: false,
    userLowInventoryPushAlerts: true,
    userTimeSinceDaysFromHours: 48,
    medNotificationsEnabled: true,
    medNotifyOverdueEmail: null,
    medNotifyOverduePush: null,
    medNotifyLowInventoryEmail: null,
    medNotifyLowInventoryPush: null,
    medNotifyOffsetMinutes: 0,
    medNotifyRepeatEveryMinutes: null,
    medNotifyMaxRepeats: 0,
  };
}

describe("reminder tick isolation (SRV-9)", () => {
  beforeEach(() => {
    fakeDb.reset();
    vi.mocked(withReminderClaim).mockReset();
  });

  it("keeps sweeping after one medication's claim throws, runs the low-inventory sweep, and still fails the tick", async () => {
    const tenHoursAgo = new Date(Date.now() - 10 * 3600_000);
    fakeDb.seed(medicationSchedules, [scheduleRow("m1"), scheduleRow("m2"), scheduleRow("m3")]);
    fakeDb.seed(doseLogs, [
      { medicationId: "m1", lastEventAt: tenHoursAgo },
      { medicationId: "m2", lastEventAt: tenHoursAgo },
      { medicationId: "m3", lastEventAt: tenHoursAgo },
    ]);
    fakeDb.seed(medications, []);

    // A transient DB error on the FIRST medication's claim.
    vi.mocked(withReminderClaim)
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValue(undefined as never);

    const request = new Request("http://localhost/api/cron/reminders", {
      headers: { authorization: "Bearer s3cret" },
    });
    const outcome = await (GET as (e: unknown) => Promise<Response>)({ request }).then(
      () => "resolved",
      () => "rejected",
    );

    // The rest of the overdue sweep still ran.
    const claimed = vi.mocked(withReminderClaim).mock.calls.map((c) => c[0].medicationId);
    expect(claimed).toEqual(["m1", "m2", "m3"]);

    // The low-inventory sweep still ran (its step-0 re-arm UPDATE on medications).
    expect(fakeDb.attempted.some((c) => c.op === "update" && c.table === "medications")).toBe(true);

    // ...and the tick still fails, so the platform and the dead-man switch see it.
    expect(outcome).toBe("rejected");
  });
});
