import { describe, it, expect, vi, beforeEach } from "vitest";

// Per-test mutable state for the mocked Resend client.
let nextSendResult: {
  data: { id: string } | null;
  error: { name: string; message: string } | null;
} | null = null;
let nextSendThrows: Error | null = null;
// Every payload handed to `resend.emails.send`, so a test can read the html
// the recipient would actually get rather than only the result.
const sentPayloads: Array<{ to: string; subject: string; html: string }> = [];

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (payload: { to: string; subject: string; html: string }) => {
        sentPayloads.push(payload);
        if (nextSendThrows) throw nextSendThrows;
        return nextSendResult;
      },
    };
  },
}));

vi.mock("$env/dynamic/private", () => ({
  env: { RESEND_API_KEY: "re_test", EMAIL_FROM: "MedTracker <noreply@example.test>" },
}));

vi.mock("$env/dynamic/public", () => ({
  env: { PUBLIC_BASE_URL: "https://example.test" },
}));

vi.mock("$app/environment", () => ({ dev: false }));

const {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendLowInventoryEmail,
  sendReminderEmail,
  isEmailConfigured,
} = await import("../../src/lib/server/email");

beforeEach(() => {
  nextSendResult = null;
  nextSendThrows = null;
  sentPayloads.length = 0;
});

describe("isEmailConfigured", () => {
  it("returns true when both RESEND_API_KEY and a non-placeholder EMAIL_FROM are set", () => {
    expect(isEmailConfigured()).toBe(true);
  });
});

describe("EmailResult mapping", () => {
  it("returns ok with id on success", async () => {
    nextSendResult = { data: { id: "msg_123" }, error: null };
    const r = await sendVerificationEmail("u@example.test", "tok");
    expect(r).toEqual({ ok: true, id: "msg_123" });
  });

  it.each([
    ["missing_api_key", "not_configured"],
    ["restricted_api_key", "not_configured"],
    ["invalid_api_key", "not_configured"],
    ["invalid_from_address", "invalid_sender_domain"],
    ["rate_limit_exceeded", "rate_limited"],
    ["monthly_quota_exceeded", "rate_limited"],
    ["daily_quota_exceeded", "rate_limited"],
    ["validation_error", "provider_error"],
    ["internal_server_error", "provider_error"],
  ])("maps Resend error name %s -> reason %s", async (name, reason) => {
    nextSendResult = { data: null, error: { name, message: `boom: ${name}` } };
    const r = await sendPasswordResetEmail("u@example.test", "tok");
    expect(r).toEqual({ ok: false, reason, message: `boom: ${name}` });
  });

  it("folds runtime exceptions into provider_error and never throws", async () => {
    nextSendThrows = new Error("connect ECONNREFUSED");
    const r = await sendLowInventoryEmail("u@example.test", "Med", 5, 7);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("provider_error");
      expect(r.message).toContain("ECONNREFUSED");
    }
  });

  it("does not echo the recipient or HTML payload in the error message", async () => {
    nextSendResult = {
      data: null,
      error: { name: "validation_error", message: "Invalid recipient" },
    };
    const r = await sendReminderEmail(
      "victim@example.test",
      "Aspirin",
      new Date("2026-09-23T10:12:00.000Z"),
      new Date("2026-09-24T10:12:00.000Z"),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).not.toContain("victim@example.test");
      expect(r.message).not.toContain("<p>");
    }
  });
});

describe("sendReminderEmail copy", () => {
  // The clause is `lastLoggedPhrase` with its first letter lower-cased. These
  // read the html actually handed to Resend: the template once added its own
  // " ago" to a label that already ended in one.
  const NOW = new Date("2026-09-24T10:12:00.000Z");
  const MINUTE = 60_000;

  it.each([
    { gap: "30 seconds", ms: 30_000, clause: "last logged just now" },
    { gap: "5 minutes", ms: 5 * MINUTE, clause: "last logged 5m ago" },
    { gap: "2 hours 3 minutes", ms: (2 * 60 + 3) * MINUTE, clause: "last logged 2h 3m ago" },
    { gap: "25 hours", ms: 25 * 60 * MINUTE, clause: "last logged 1d ago" },
  ])("$gap after the last event says $clause", async ({ ms, clause }) => {
    nextSendResult = { data: { id: "msg_r" }, error: null };

    const r = await sendReminderEmail(
      "u@example.test",
      "Ibuprofen",
      new Date(NOW.getTime() - ms),
      NOW,
    );

    expect(r).toEqual({ ok: true, id: "msg_r" });
    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0].to).toBe("u@example.test");
    // The whole first paragraph, full stop included, so nothing can follow
    // the clause.
    expect(sentPayloads[0].html).toContain(`<p><strong>Ibuprofen</strong> is due — ${clause}.</p>`);
  });

  it('says "not yet logged" when nothing has ever been logged', async () => {
    nextSendResult = { data: { id: "msg_r" }, error: null };

    await sendReminderEmail("u@example.test", "Ibuprofen", null, NOW);

    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0].html).toContain(
      "<p><strong>Ibuprofen</strong> is due — not yet logged.</p>",
    );
  });
});
