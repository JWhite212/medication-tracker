import { describe, it, expect, vi, beforeEach } from "vitest";

// Two query results: the schedule/medication outer query, and the
// last-taken-per-medication aggregate. Tests push rows into these
// arrays before invoking the function.
const scheduleRows: Array<Record<string, unknown>> = [];
const lastTakenRows: Array<{ medicationId: string; lastTakenAt: Date | null }> = [];
let selectCallIndex = 0;

// Queue of return values for db.insert(...).returning() calls (the
// claim step). Default per call: [{ id: "evt", attemptCount: 1 }].
// Push [] for "row exists but is not retryable".
const claimResults: Array<Array<{ id: string; attemptCount: number }>> = [];

// Each completeReminder call appends the UPDATE payload here so tests
// can assert on per-channel statuses.
type UpdateCapture = {
  id: string;
  status: string;
  emailStatus: string;
  pushStatus: string;
  lastError: string | null;
};
const updateCaptures: UpdateCapture[] = [];

vi.mock("$lib/server/db", () => ({
  db: {
    select: () => {
      const callIndex = selectCallIndex++;
      const rowsForCall = () => (callIndex === 0 ? [...scheduleRows] : [...lastTakenRows]);
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
      const result = claimResults.shift() ?? [{ id: "evt", attemptCount: 1 }];
      const chain: Record<string, unknown> = {};
      const passthrough = () => chain;
      chain.values = passthrough;
      chain.onConflictDoNothing = passthrough;
      chain.onConflictDoUpdate = passthrough;
      chain.returning = () => Promise.resolve(result);
      return chain;
    },
    update: () => {
      // Capture the payload that completeReminder writes. Drizzle
      // builds .update(table).set({...}).where(...); the .set call
      // receives the field map.
      let captured: Partial<UpdateCapture> = { id: "evt" };
      const chain: Record<string, unknown> = {};
      chain.set = (payload: Record<string, unknown>) => {
        captured = {
          ...captured,
          status: String(payload.status ?? ""),
          emailStatus: String(payload.emailStatus ?? ""),
          pushStatus: String(payload.pushStatus ?? ""),
          lastError: (payload.lastError as string | null) ?? null,
        };
        return chain;
      };
      chain.where = () => {
        updateCaptures.push(captured as UpdateCapture);
        return Promise.resolve();
      };
      return chain;
    },
  },
}));

// Email mocks return the new EmailResult shape. Per test, push the
// desired result into emailResults; default is { ok: true }.
const emailResults: Array<
  { ok: true; id?: string } | { ok: false; reason: string; message: string }
> = [];
const sentEmails: Array<{ to: string; medicationName: string; sinceLabel: string }> = [];

vi.mock("$lib/server/email", () => ({
  sendReminderEmail: async (to: string, medicationName: string, sinceLabel: string) => {
    sentEmails.push({ to, medicationName, sinceLabel });
    return emailResults.shift() ?? { ok: true, id: "msg-r" };
  },
  sendLowInventoryEmail: async () => emailResults.shift() ?? { ok: true, id: "msg-l" },
  isEmailConfigured: () => true,
}));

// Push mocks. Per test, push the desired result; default is success.
const pushResults: Array<
  { ok: true; deliveredCount: number } | { ok: false; reason: string; message: string }
> = [];
const sentPushes: Array<{ userId: string; tag: string }> = [];
let pushSubscribersByUser: Record<string, boolean> = {};

vi.mock("$lib/server/push", () => ({
  sendPushNotification: async (userId: string, payload: { tag: string }) => {
    sentPushes.push({ userId, tag: payload.tag });
    return pushResults.shift() ?? { ok: true, deliveredCount: 1 };
  },
  hasPushSubscriptions: async (userId: string) => Boolean(pushSubscribersByUser[userId]),
}));

const { checkOverdueMedications } = await import("../../src/lib/server/reminders");

beforeEach(() => {
  scheduleRows.length = 0;
  lastTakenRows.length = 0;
  sentEmails.length = 0;
  sentPushes.length = 0;
  emailResults.length = 0;
  pushResults.length = 0;
  claimResults.length = 0;
  updateCaptures.length = 0;
  selectCallIndex = 0;
  pushSubscribersByUser = { u1: true };
});

function pushDefaultOverdueRow(): void {
  const eightHoursAgo = new Date(Date.now() - 8 * 3600 * 1000);
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
    userEmailVerified: true,
    userTimezone: "UTC",
  });
  lastTakenRows.push({ medicationId: "med-A", lastTakenAt: eightHoursAgo });
}

describe("checkOverdueMedications — claim/complete with per-channel status", () => {
  it("flags overdue interval schedule and sends both channels", async () => {
    pushDefaultOverdueRow();
    await checkOverdueMedications();

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe("user@example.com");
    expect(sentPushes).toHaveLength(1);
    expect(sentPushes[0].tag).toBe("overdue-med-A");
    expect(updateCaptures[0].status).toBe("sent");
  });

  it("does not flag when last taken is within interval", async () => {
    const oneHourAgo = new Date(Date.now() - 3600 * 1000);
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
      userEmailVerified: true,
      userTimezone: "UTC",
    });
    lastTakenRows.push({ medicationId: "med-A", lastTakenAt: oneHourAgo });

    await checkOverdueMedications();
    expect(sentEmails).toHaveLength(0);
    expect(sentPushes).toHaveLength(0);
    expect(updateCaptures).toHaveLength(0);
  });

  it("dedupes a repeat run when claim returns no row (not retryable)", async () => {
    pushDefaultOverdueRow();
    claimResults.push([]);

    await checkOverdueMedications();
    expect(sentEmails).toHaveLength(0);
    expect(sentPushes).toHaveLength(0);
    expect(updateCaptures).toHaveLength(0);
  });

  it("marks status=sent when email succeeds and push fails", async () => {
    pushDefaultOverdueRow();
    emailResults.push({ ok: true, id: "msg" });
    pushResults.push({ ok: false, reason: "all_failed", message: "boom" });

    await checkOverdueMedications();

    expect(updateCaptures).toHaveLength(1);
    expect(updateCaptures[0].emailStatus).toBe("sent");
    expect(updateCaptures[0].pushStatus).toBe("failed");
    expect(updateCaptures[0].status).toBe("sent");
    expect(updateCaptures[0].lastError).toContain("push:all_failed");
  });

  it("marks status=failed when both email and push fail", async () => {
    pushDefaultOverdueRow();
    emailResults.push({ ok: false, reason: "provider_error", message: "smtp down" });
    pushResults.push({ ok: false, reason: "all_failed", message: "boom" });

    await checkOverdueMedications();

    expect(updateCaptures).toHaveLength(1);
    expect(updateCaptures[0].emailStatus).toBe("failed");
    expect(updateCaptures[0].pushStatus).toBe("failed");
    expect(updateCaptures[0].status).toBe("failed");
  });

  it("skips email channel for unverified users; push still attempted", async () => {
    const eightHoursAgo = new Date(Date.now() - 8 * 3600 * 1000);
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
      userEmailVerified: false,
      userTimezone: "UTC",
    });
    lastTakenRows.push({ medicationId: "med-A", lastTakenAt: eightHoursAgo });

    await checkOverdueMedications();

    expect(sentEmails).toHaveLength(0);
    expect(sentPushes).toHaveLength(1);
    expect(updateCaptures[0].emailStatus).toBe("not_configured");
    expect(updateCaptures[0].pushStatus).toBe("sent");
    expect(updateCaptures[0].status).toBe("sent");
  });

  it("does not call sendPushNotification when the user has no push subscriptions", async () => {
    pushSubscribersByUser = {};
    pushDefaultOverdueRow();

    await checkOverdueMedications();

    expect(sentPushes).toHaveLength(0);
    expect(updateCaptures[0].pushStatus).toBe("not_configured");
    expect(updateCaptures[0].emailStatus).toBe("sent");
    expect(updateCaptures[0].status).toBe("sent");
  });
});
