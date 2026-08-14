import { describe, it, expect, vi, beforeEach } from "vitest";

// Two query results: the schedule/medication outer query, and the
// last-taken-per-medication aggregate. Tests push rows into these
// arrays before invoking the function.
const scheduleRows: Array<Record<string, unknown>> = [];
const lastEventRows: Array<{ medicationId: string; lastEventAt: Date | null }> = [];
let selectCallIndex = 0;

// Queue of return values for db.insert(...).returning() calls (the
// claim step). Default per call: [{ id: "evt", attemptCount: 1 }].
// Push [] for "row exists but is not retryable".
const claimResults: Array<Array<{ id: string; attemptCount: number }>> = [];

// Number of claimReminderSlot attempts (db.insert calls) this test made.
let claimCallCount = 0;

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

// The WHERE predicate handed to each select, indexed by call order. The mock
// does not evaluate predicates — it returns whatever rows a test pushed — so
// a behavioural test alone cannot tell taken-only from taken-or-skipped.
// Capturing the predicate is what actually pins the status filter.
const whereArgsByCall: unknown[][] = [];

/**
 * Drizzle builds predicates as SQL objects whose column nodes hold a
 * back-pointer to their table, so a plain JSON.stringify blows up. Same
 * circular-safe walk reminders-dispatch.test.ts uses.
 */
function chunksContain(sqlObj: unknown, needle: string): boolean {
  const seen = new WeakSet<object>();
  const json = JSON.stringify(sqlObj, (_key, value) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return undefined;
      seen.add(value);
    }
    return value;
  });
  return json.includes(needle);
}

vi.mock("$lib/server/db", () => ({
  db: {
    select: () => {
      const callIndex = selectCallIndex++;
      const rowsForCall = () => (callIndex === 0 ? [...scheduleRows] : [...lastEventRows]);
      const chain: Record<string, unknown> = {};
      const resolver = () => Promise.resolve(rowsForCall());
      const passthrough = () => chain;
      chain.from = passthrough;
      chain.innerJoin = passthrough;
      chain.where = (...args: unknown[]) => {
        whereArgsByCall[callIndex] = args;
        return {
          ...chain,
          groupBy: resolver,
          then: (onFulfilled: (v: unknown) => unknown) => resolver().then(onFulfilled),
        };
      };
      chain.groupBy = resolver;
      return chain;
    },
    insert: () => {
      claimCallCount++;
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
// Tests opt into throwing behaviour by setting this to an Error.
let nextLowInventoryEmailThrows: Error | null = null;

vi.mock("$lib/server/email", () => ({
  sendReminderEmail: async (to: string, medicationName: string, sinceLabel: string) => {
    sentEmails.push({ to, medicationName, sinceLabel });
    return emailResults.shift() ?? { ok: true, id: "msg-r" };
  },
  sendLowInventoryEmail: async () => {
    if (nextLowInventoryEmailThrows) {
      const err = nextLowInventoryEmailThrows;
      nextLowInventoryEmailThrows = null;
      throw err;
    }
    return emailResults.shift() ?? { ok: true, id: "msg-l" };
  },
  isEmailConfigured: () => true,
}));

// Push mocks. Per test, push the desired result; default is success.
const pushResults: Array<
  { ok: true; deliveredCount: number } | { ok: false; reason: string; message: string }
> = [];
const sentPushes: Array<{ userId: string; tag: string }> = [];
let pushSubscribersByUser: Record<string, boolean> = {};
// Tests opt into throwing behaviour by setting these to an Error.
let nextPushSubsThrows: Error | null = null;
let nextSendPushThrows: Error | null = null;

vi.mock("$lib/server/push", () => ({
  sendPushNotification: async (userId: string, payload: { tag: string }) => {
    if (nextSendPushThrows) {
      const err = nextSendPushThrows;
      nextSendPushThrows = null;
      throw err;
    }
    sentPushes.push({ userId, tag: payload.tag });
    return pushResults.shift() ?? { ok: true, deliveredCount: 1 };
  },
  hasPushSubscriptions: async (userId: string) => {
    if (nextPushSubsThrows) {
      const err = nextPushSubsThrows;
      nextPushSubsThrows = null;
      throw err;
    }
    return Boolean(pushSubscribersByUser[userId]);
  },
}));

const { checkOverdueMedications, checkLowInventoryMedications } =
  await import("../../src/lib/server/reminders");

beforeEach(() => {
  scheduleRows.length = 0;
  lastEventRows.length = 0;
  sentEmails.length = 0;
  sentPushes.length = 0;
  emailResults.length = 0;
  pushResults.length = 0;
  claimResults.length = 0;
  updateCaptures.length = 0;
  whereArgsByCall.length = 0;
  selectCallIndex = 0;
  pushSubscribersByUser = { u1: true };
  nextPushSubsThrows = null;
  nextSendPushThrows = null;
  claimCallCount = 0;
  nextLowInventoryEmailThrows = null;
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
    userOverdueEmailReminders: true,
    userOverduePushReminders: true,
  });
  lastEventRows.push({ medicationId: "med-A", lastEventAt: eightHoursAgo });
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
    lastEventRows.push({ medicationId: "med-A", lastEventAt: oneHourAgo });

    await checkOverdueMedications();
    expect(sentEmails).toHaveLength(0);
    expect(sentPushes).toHaveLength(0);
    expect(updateCaptures).toHaveLength(0);
  });

  it("does not remind for a dose the user deliberately skipped", async () => {
    // The defect being fixed. The anchor aggregate counts taken AND skipped,
    // so a skip an hour ago resolves the slot and nothing is claimed or sent.
    // Filtering to `taken` alone is what let the dashboard badge clear while
    // a push still went out — doses.ts has documented the intended rule all
    // along; this scan just never honoured it.
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
      userOverdueEmailReminders: true,
      userOverduePushReminders: true,
    });
    // Supplied by the taken-or-skipped aggregate, so a skip reaches this map.
    lastEventRows.push({ medicationId: "med-A", lastEventAt: oneHourAgo });

    await checkOverdueMedications();

    expect(sentEmails).toHaveLength(0);
    expect(sentPushes).toHaveLength(0);
    expect(updateCaptures).toHaveLength(0);
  });

  it("anchors on taken AND skipped doses, not taken alone", async () => {
    // This is the actual fix. The behavioural test above cannot prove it: the
    // db mock returns whatever rows a test pushed and never evaluates the
    // predicate, so it would pass on the old taken-only query too. Asserting
    // the predicate itself is what fails if the filter regresses.
    pushDefaultOverdueRow();

    await checkOverdueMedications();

    const aggregatePredicate = whereArgsByCall[1];
    expect(aggregatePredicate).toBeDefined();
    expect(chunksContain(aggregatePredicate, "skipped")).toBe(true);
    expect(chunksContain(aggregatePredicate, "taken")).toBe(true);
    // `missed` must never resolve a slot — it records a dose NOT consumed.
    expect(chunksContain(aggregatePredicate, "missed")).toBe(false);
  });

  it("still reminds when the last handled dose is older than the interval", async () => {
    // The other half of the rule: including skips must not make the scan
    // silent in general. Without this, the test above would pass even if the
    // aggregate stopped returning anything at all.
    pushDefaultOverdueRow();

    await checkOverdueMedications();

    expect(sentEmails).toHaveLength(1);
    expect(sentPushes).toHaveLength(1);
    expect(sentEmails[0].sinceLabel).not.toBe("never");
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
      userOverdueEmailReminders: true,
      userOverduePushReminders: true,
    });
    lastEventRows.push({ medicationId: "med-A", lastEventAt: eightHoursAgo });

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

  it("still calls completeReminder when hasPushSubscriptions throws", async () => {
    pushDefaultOverdueRow();
    nextPushSubsThrows = new Error("transient db error");

    await checkOverdueMedications();

    expect(updateCaptures).toHaveLength(1);
    // Email succeeded before the throw — keep its sent status.
    expect(updateCaptures[0].emailStatus).toBe("sent");
    // The user opted into push, so a probe-time throw is treated as
    // a delivery failure (not "not_configured"). That keeps the row
    // retryable instead of consuming the dedupe slot.
    expect(updateCaptures[0].pushStatus).toBe("failed");
    expect(updateCaptures[0].status).toBe("sent");
    expect(updateCaptures[0].lastError).toContain("transient db error");
  });

  it("still calls completeReminder when sendPushNotification throws after hasPushSubscriptions=true", async () => {
    pushDefaultOverdueRow();
    nextSendPushThrows = new Error("push transport down");

    await checkOverdueMedications();

    expect(updateCaptures).toHaveLength(1);
    expect(updateCaptures[0].emailStatus).toBe("sent");
    // We knew push was configured (probe returned true), so the throw
    // counts as a delivery failure for that channel.
    expect(updateCaptures[0].pushStatus).toBe("failed");
    expect(updateCaptures[0].status).toBe("sent");
    expect(updateCaptures[0].lastError).toContain("push transport down");
  });

  it("respects overdueEmailReminders=false: push fires, email skipped", async () => {
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
      userOverdueEmailReminders: false,
      userOverduePushReminders: true,
    });
    lastEventRows.push({ medicationId: "med-A", lastEventAt: eightHoursAgo });

    await checkOverdueMedications();

    expect(sentEmails).toHaveLength(0);
    expect(sentPushes).toHaveLength(1);
    expect(updateCaptures[0].emailStatus).toBe("not_configured");
    expect(updateCaptures[0].pushStatus).toBe("sent");
    expect(updateCaptures[0].status).toBe("sent");
  });

  it("marks push as failed (not not_configured) when probe throws on a push-only row", async () => {
    // Push-only configuration: emailReminders off, push opted in.
    // If hasPushSubscriptions itself throws, the catch block must
    // promote push to failed using the opt-in intent so the slot is
    // retryable. Earlier code used the post-probe pushConfigured
    // flag, which is still false in this path, leaving push at
    // not_configured and the slot consumed without delivery.
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
      userOverdueEmailReminders: false,
      userOverduePushReminders: true,
    });
    lastEventRows.push({ medicationId: "med-A", lastEventAt: eightHoursAgo });
    nextPushSubsThrows = new Error("transient db error");

    await checkOverdueMedications();

    expect(updateCaptures).toHaveLength(1);
    expect(updateCaptures[0].emailStatus).toBe("not_configured");
    expect(updateCaptures[0].pushStatus).toBe("failed");
    expect(updateCaptures[0].status).toBe("failed");
    expect(updateCaptures[0].lastError).toContain("transient db error");
  });

  it("respects overduePushReminders=false: email fires, push skipped", async () => {
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
      userOverdueEmailReminders: true,
      userOverduePushReminders: false,
    });
    lastEventRows.push({ medicationId: "med-A", lastEventAt: eightHoursAgo });

    await checkOverdueMedications();

    expect(sentEmails).toHaveLength(1);
    expect(sentPushes).toHaveLength(0);
    expect(updateCaptures[0].emailStatus).toBe("sent");
    expect(updateCaptures[0].pushStatus).toBe("not_configured");
    expect(updateCaptures[0].status).toBe("sent");
  });
});

describe("checkLowInventoryMedications — split prefs, mixed channels", () => {
  // The mock's first select() call returns scheduleRows regardless of
  // which function is under test, so push low-inventory-shaped rows
  // into the same array.
  function pushLowInventoryRow(overrides: Partial<Record<string, unknown>> = {}): void {
    scheduleRows.push({
      medicationId: "med-LI",
      medicationName: "Vitamin D",
      userId: "u1",
      inventoryCount: 3,
      inventoryAlertThreshold: 7,
      userEmail: "user@example.com",
      userEmailVerified: true,
      userLowInventoryEmailAlerts: true,
      userLowInventoryPushAlerts: false,
      ...overrides,
    });
  }

  it("respects lowInventoryEmailAlerts=false, push opt-in: push fires, email skipped", async () => {
    pushLowInventoryRow({
      userLowInventoryEmailAlerts: false,
      userLowInventoryPushAlerts: true,
    });

    await checkLowInventoryMedications();

    expect(sentEmails).toHaveLength(0);
    expect(sentPushes).toHaveLength(1);
    expect(sentPushes[0].tag).toBe("low-inventory-med-LI");
    expect(updateCaptures[0].emailStatus).toBe("not_configured");
    expect(updateCaptures[0].pushStatus).toBe("sent");
    expect(updateCaptures[0].status).toBe("sent");
  });

  it("respects lowInventoryPushAlerts=false: only email fires", async () => {
    pushLowInventoryRow({
      userLowInventoryEmailAlerts: true,
      userLowInventoryPushAlerts: false,
    });

    await checkLowInventoryMedications();

    expect(sentEmails).toHaveLength(0); // mock tracks reminder emails only
    expect(sentPushes).toHaveLength(0);
    expect(updateCaptures[0].emailStatus).toBe("sent");
    expect(updateCaptures[0].pushStatus).toBe("not_configured");
    expect(updateCaptures[0].status).toBe("sent");
  });

  it("skips claim entirely when push opt-in is true but no active subscriptions", async () => {
    pushSubscribersByUser = {}; // no subscriptions for u1
    pushLowInventoryRow({
      userLowInventoryEmailAlerts: false,
      userLowInventoryPushAlerts: true,
    });

    await checkLowInventoryMedications();

    // No claim, no dispatch, no completeReminder. The next cron tick
    // after the user subscribes will record + send.
    expect(sentEmails).toHaveLength(0);
    expect(sentPushes).toHaveLength(0);
    expect(updateCaptures).toHaveLength(0);
  });

  it("still reaches completeReminder when the low-inventory email sender throws", async () => {
    // The claim is already taken at this point, so the throw must not
    // escape without completing — a leaked row sits at status='pending'
    // and is only reclaimed after RETRY_DELAY_MS.
    pushLowInventoryRow({
      userLowInventoryEmailAlerts: true,
      userLowInventoryPushAlerts: false,
    });
    nextLowInventoryEmailThrows = new Error("resend exploded");

    await checkLowInventoryMedications();

    expect(updateCaptures).toHaveLength(1);
    expect(updateCaptures[0].emailStatus).toBe("failed");
    expect(updateCaptures[0].pushStatus).toBe("not_configured");
    expect(updateCaptures[0].status).toBe("failed");
    expect(updateCaptures[0].lastError).toContain("resend exploded");
  });

  it("claims nothing when the push probe throws", async () => {
    // Unlike the overdue path, the low-inventory probe runs BEFORE the
    // claim, so a probe failure must leave no row at all — the next
    // cron tick retries cleanly.
    //
    // Email is deliberately left ENABLED so the downstream "no enabled
    // channel can fire" gate cannot absorb a fall-through from the
    // probe's catch. With email off, a catch that merely set
    // pushWillFire = false would reach that gate and continue anyway,
    // which is indistinguishable from the correct behaviour — the test
    // would pass against broken code. With email on, only the probe's
    // own `continue` prevents the claim.
    pushLowInventoryRow({
      userLowInventoryEmailAlerts: true,
      userLowInventoryPushAlerts: true,
    });
    nextPushSubsThrows = new Error("transient db error");

    await checkLowInventoryMedications();

    expect(claimCallCount).toBe(0);
    expect(updateCaptures).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
    expect(sentPushes).toHaveLength(0);
  });

  it("claims nothing when email is opted in but unverified and push is off", async () => {
    // Neither channel can fire. Claiming here would consume the
    // (user, medication, inventoryCount) dedupe key and complete as
    // 'sent' with nothing delivered — and that key persists, so the
    // user fixing their setup later would still hit the suppressed key.
    pushLowInventoryRow({
      userEmailVerified: false,
      userLowInventoryEmailAlerts: true,
      userLowInventoryPushAlerts: false,
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await checkLowInventoryMedications();

      expect(claimCallCount).toBe(0);
      expect(updateCaptures).toHaveLength(0);
      // The console.warn is the only operator-visible signal that a
      // low-inventory alert was silently suppressed — pin it so a
      // regression that drops it can't go unnoticed.
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("no enabled channel can fire"));
    } finally {
      warnSpy.mockRestore();
    }
  });
});
