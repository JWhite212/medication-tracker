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

// Queue of return values for db.insert(...).returning() calls.
// Default per call (when queue is empty): [{ id: "evt" }] meaning row
// inserted (dedupe key was new). Push [] for a specific call to
// simulate a unique-constraint conflict (dedupe key already seen).
const reminderEventInsertResults: Array<Array<{ id: string }>> = [];

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
    insert: () => {
      const result = reminderEventInsertResults.shift() ?? [{ id: "evt" }];
      const chain: Record<string, unknown> = {};
      const passthrough = () => chain;
      chain.values = passthrough;
      chain.onConflictDoNothing = passthrough;
      chain.returning = () => Promise.resolve(result);
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
  reminderEventInsertResults.length = 0;
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

  it("fires once per (schedule, slot) — different schedule timings produce separate notifications", async () => {
    const now = Date.now();
    const eightHoursAgo = new Date(now - 8 * 3600 * 1000);

    // Two interval schedules for the SAME medication with DIFFERENT
    // intervals → two distinct overdue slots → two distinct dedupe
    // keys → two notifications. (Per-schedule semantics under the
    // new reminder_events dedupe scheme.)
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

    expect(sentEmails).toHaveLength(2);
    expect(sentPushes).toHaveLength(2);
  });

  it("dedupes a repeat run via reminder_events conflict (insert returns no row)", async () => {
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

    // Simulate a unique-constraint conflict on dedupe_key: the insert
    // returns an empty array, meaning "row already existed; skip notify".
    reminderEventInsertResults.push([]);

    await checkOverdueMedications();

    expect(sentEmails).toHaveLength(0);
    expect(sentPushes).toHaveLength(0);
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
