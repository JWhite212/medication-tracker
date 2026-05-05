import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the values, conflict config, and where clauses that the
// claim helper builds so tests can assert the SQL is shaped the way
// we expect.
type ClaimCall = {
  values: Record<string, unknown>;
  conflict: Record<string, unknown> | null;
};
const claimCalls: ClaimCall[] = [];
let nextClaimReturning: Array<{ id: string; attemptCount: number }> = [
  { id: "evt-1", attemptCount: 1 },
];

const updateCalls: Array<{ payload: Record<string, unknown> }> = [];

vi.mock("$lib/server/db", () => ({
  db: {
    insert: () => {
      const captured: Partial<ClaimCall> = {};
      const chain: Record<string, unknown> = {};
      chain.values = (v: Record<string, unknown>) => {
        captured.values = v;
        return chain;
      };
      chain.onConflictDoUpdate = (c: Record<string, unknown>) => {
        captured.conflict = c;
        return chain;
      };
      chain.returning = () => {
        claimCalls.push({ values: captured.values ?? {}, conflict: captured.conflict ?? null });
        return Promise.resolve(nextClaimReturning);
      };
      return chain;
    },
    update: () => {
      let captured: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {};
      chain.set = (payload: Record<string, unknown>) => {
        captured = payload;
        return chain;
      };
      chain.where = () => {
        updateCalls.push({ payload: captured });
        return Promise.resolve();
      };
      return chain;
    },
  },
}));

const { claimReminderSlot, completeReminder, deriveOverallStatus, MAX_ATTEMPTS, RETRY_DELAY_MS } =
  await import("../../src/lib/server/reminders/dispatch");

beforeEach(() => {
  claimCalls.length = 0;
  updateCalls.length = 0;
  nextClaimReturning = [{ id: "evt-1", attemptCount: 1 }];
});

describe("claimReminderSlot", () => {
  it("issues an INSERT with status=pending and a retryable setWhere predicate", async () => {
    const claim = await claimReminderSlot({
      userId: "u1",
      medicationId: "med-A",
      reminderType: "overdue",
      dedupeKey: "key-1",
    });

    expect(claim).toEqual({ id: "evt-1", attemptCount: 1 });
    expect(claimCalls).toHaveLength(1);
    expect(claimCalls[0].values.dedupeKey).toBe("key-1");
    expect(claimCalls[0].values.status).toBe("pending");
    expect(claimCalls[0].values.attemptCount).toBe(1);
    expect(claimCalls[0].conflict).not.toBeNull();
    expect(claimCalls[0].conflict?.target).toBeDefined();
    expect(claimCalls[0].conflict?.set).toBeDefined();
    expect(claimCalls[0].conflict?.setWhere).toBeDefined();
  });

  it("returns null when the database refused the upsert (row exists, not retryable)", async () => {
    nextClaimReturning = [];
    const claim = await claimReminderSlot({
      userId: "u1",
      medicationId: "med-A",
      reminderType: "overdue",
      dedupeKey: "key-2",
    });
    expect(claim).toBeNull();
  });

  it("exposes the retry policy constants so tests pin the expected values", () => {
    expect(MAX_ATTEMPTS).toBe(3);
    expect(RETRY_DELAY_MS).toBe(30 * 60 * 1000);
  });
});

describe("completeReminder", () => {
  it("writes the derived overall status plus channel statuses", async () => {
    await completeReminder("evt-1", {
      emailStatus: "sent",
      pushStatus: "failed",
      lastError: "push:all_failed=boom",
    });
    expect(updateCalls).toHaveLength(1);
    const payload = updateCalls[0].payload;
    expect(payload.status).toBe("sent");
    expect(payload.emailStatus).toBe("sent");
    expect(payload.pushStatus).toBe("failed");
    expect(payload.lastError).toBe("push:all_failed=boom");
    expect(payload.lastAttemptAt).toBeInstanceOf(Date);
  });

  it("derives status=failed when every configured channel failed", async () => {
    await completeReminder("evt-1", {
      emailStatus: "failed",
      pushStatus: "failed",
      lastError: "all channels failed",
    });
    expect(updateCalls[0].payload.status).toBe("failed");
  });

  it("derives status=sent when both channels are not_configured (nothing to retry)", async () => {
    await completeReminder("evt-1", {
      emailStatus: "not_configured",
      pushStatus: "not_configured",
      lastError: null,
    });
    expect(updateCalls[0].payload.status).toBe("sent");
  });
});

describe("deriveOverallStatus", () => {
  it.each([
    ["sent", "not_configured", "sent"],
    ["not_configured", "sent", "sent"],
    ["sent", "failed", "sent"],
    ["failed", "sent", "sent"],
    ["failed", "failed", "failed"],
    ["failed", "not_configured", "failed"],
    ["not_configured", "failed", "failed"],
    ["not_configured", "not_configured", "sent"],
  ])("emailStatus=%s pushStatus=%s -> %s", (email, push, expected) => {
    expect(
      deriveOverallStatus(
        email as Parameters<typeof deriveOverallStatus>[0],
        push as Parameters<typeof deriveOverallStatus>[1],
      ),
    ).toBe(expected);
  });
});
