import { describe, it, expect, vi, beforeEach } from "vitest";

// Two query results: the schedule/medication outer query, and the
// last-taken-per-medication aggregate. Tests push rows into these arrays
// before invoking the function.
const scheduleRows: Array<Record<string, unknown>> = [];
const lastTakenRows: Array<{ medicationId: string; lastTakenAt: Date | null }> = [];

// Track which "select" call we are on so the mock returns the correct
// rows. The function calls select() twice in order: schedules first,
// then the dose-log aggregate.
let selectCallIndex = 0;

vi.mock("$lib/server/db", () => ({
  db: {
    select: () => {
      const callIndex = selectCallIndex++;
      const rowsForCall = () => (callIndex === 0 ? [...scheduleRows] : [...lastTakenRows]);
      // Build a chainable thenable so any sequence of
      // .from().innerJoin()*.where().groupBy()? resolves to the rows.
      const chain: Record<string, unknown> = {};
      const resolver = () => Promise.resolve(rowsForCall());
      const passthrough = () => chain;
      chain.from = passthrough;
      chain.innerJoin = passthrough;
      chain.where = (..._args: unknown[]) => ({
        ...chain,
        groupBy: resolver,
        then: (onFulfilled: (v: unknown) => unknown) => resolver().then(onFulfilled),
      });
      chain.groupBy = resolver;
      return chain;
    },
  },
}));

const sentEmails: Array<{ to: string; medicationName: string; sinceLabel: string }> = [];
const sentPushes: Array<{ userId: string; tag: string }> = [];

vi.mock("$lib/server/email", () => ({
  sendReminderEmail: async (to: string, medicationName: string, sinceLabel: string) => {
    sentEmails.push({ to, medicationName, sinceLabel });
  },
  sendLowInventoryEmail: async () => {},
}));

vi.mock("$lib/server/push", () => ({
  sendPushNotification: async (userId: string, payload: { tag: string }) => {
    sentPushes.push({ userId, tag: payload.tag });
  },
}));

const { checkOverdueMedications } = await import("../../src/lib/server/reminders");

beforeEach(() => {
  scheduleRows.length = 0;
  lastTakenRows.length = 0;
  sentEmails.length = 0;
  sentPushes.length = 0;
  selectCallIndex = 0;
});

describe("checkOverdueMedications — JOIN-based last-taken", () => {
  it("joins lastTakenAt by medicationId and flags overdue interval schedules", async () => {
    const now = Date.now();
    const eightHoursAgo = new Date(now - 8 * 3600 * 1000);

    scheduleRows.push({
      scheduleId: "s1",
      scheduleKind: "interval",
      intervalHours: "6",
      timeOfDay: null,
      daysOfWeek: null,
      medicationId: "med-A",
      medicationName: "Ibuprofen",
      userId: "u1",
      userEmail: "user@example.com",
      userTimezone: "UTC",
    });
    lastTakenRows.push({ medicationId: "med-A", lastTakenAt: eightHoursAgo });

    await checkOverdueMedications();

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe("user@example.com");
    expect(sentEmails[0].medicationName).toBe("Ibuprofen");
    expect(sentPushes).toHaveLength(1);
    expect(sentPushes[0].tag).toBe("overdue-med-A");
  });

  it("does not flag interval schedule when last taken is within interval", async () => {
    const now = Date.now();
    const oneHourAgo = new Date(now - 3600 * 1000);

    scheduleRows.push({
      scheduleId: "s1",
      scheduleKind: "interval",
      intervalHours: "6",
      timeOfDay: null,
      daysOfWeek: null,
      medicationId: "med-A",
      medicationName: "Ibuprofen",
      userId: "u1",
      userEmail: "user@example.com",
      userTimezone: "UTC",
    });
    lastTakenRows.push({ medicationId: "med-A", lastTakenAt: oneHourAgo });

    await checkOverdueMedications();

    expect(sentEmails).toHaveLength(0);
    expect(sentPushes).toHaveLength(0);
  });

  it("treats medication with no taken doses as lastTakenAt=null (interval not overdue)", async () => {
    // Interval schedules require a prior takenAt to compute overdue;
    // when the JS join finds no row, lastTakenAt is null and the
    // interval branch returns false. (Same as original semantics.)
    scheduleRows.push({
      scheduleId: "s1",
      scheduleKind: "interval",
      intervalHours: "6",
      timeOfDay: null,
      daysOfWeek: null,
      medicationId: "med-A",
      medicationName: "Ibuprofen",
      userId: "u1",
      userEmail: "user@example.com",
      userTimezone: "UTC",
    });
    // No row in lastTakenRows — simulates "never taken".

    await checkOverdueMedications();

    expect(sentEmails).toHaveLength(0);
    expect(sentPushes).toHaveLength(0);
  });

  it("dedupes per medication when multiple schedules say overdue", async () => {
    const now = Date.now();
    const eightHoursAgo = new Date(now - 8 * 3600 * 1000);

    // Two interval schedules for the SAME medication, both overdue.
    scheduleRows.push(
      {
        scheduleId: "s1",
        scheduleKind: "interval",
        intervalHours: "6",
        timeOfDay: null,
        daysOfWeek: null,
        medicationId: "med-A",
        medicationName: "Ibuprofen",
        userId: "u1",
        userEmail: "user@example.com",
        userTimezone: "UTC",
      },
      {
        scheduleId: "s2",
        scheduleKind: "interval",
        intervalHours: "4",
        timeOfDay: null,
        daysOfWeek: null,
        medicationId: "med-A",
        medicationName: "Ibuprofen",
        userId: "u1",
        userEmail: "user@example.com",
        userTimezone: "UTC",
      },
    );
    lastTakenRows.push({ medicationId: "med-A", lastTakenAt: eightHoursAgo });

    await checkOverdueMedications();

    // One email/push per medication, not per schedule.
    expect(sentEmails).toHaveLength(1);
    expect(sentPushes).toHaveLength(1);
  });

  it("does not query dose_logs when there are no schedule rows", async () => {
    // Empty schedule rows means medicationIds is empty and we skip the
    // second query. selectCallIndex tracks the count and should be 1.
    await checkOverdueMedications();

    expect(sentEmails).toHaveLength(0);
    expect(sentPushes).toHaveLength(0);
    expect(selectCallIndex).toBe(1);
  });
});
