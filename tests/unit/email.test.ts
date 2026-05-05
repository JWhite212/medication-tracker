import { describe, it, expect, vi, beforeEach } from "vitest";

// Per-test mutable state for the mocked Resend client.
let nextSendResult: {
  data: { id: string } | null;
  error: { name: string; message: string } | null;
} | null = null;
let nextSendThrows: Error | null = null;

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async () => {
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
    const r = await sendReminderEmail("victim@example.test", "Aspirin", "yesterday");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).not.toContain("victim@example.test");
      expect(r.message).not.toContain("<p>");
    }
  });
});
