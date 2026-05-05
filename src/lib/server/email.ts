import { Resend } from "resend";
import { env } from "$env/dynamic/private";
// SvelteKit's $env/dynamic/private excludes any variable that starts
// with the PUBLIC_ prefix, so PUBLIC_BASE_URL must come from the
// public module. The value is genuinely public anyway (the site's
// own URL).
import { env as publicEnv } from "$env/dynamic/public";
import { dev } from "$app/environment";

export type EmailErrorReason =
  | "not_configured"
  | "provider_error"
  | "invalid_sender_domain"
  | "rate_limited";

export type EmailResult =
  | { ok: true; id?: string }
  | { ok: false; reason: EmailErrorReason; message: string };

const PLACEHOLDER_FROM = /noreply@example\.com/i;

/**
 * True when both RESEND_API_KEY and a non-placeholder EMAIL_FROM are
 * set. Use this in feature paths that need to know whether to gate UI
 * affordances or skip work entirely (e.g. "Verify your email" hints).
 */
export function isEmailConfigured(): boolean {
  const apiKey = env.RESEND_API_KEY ?? "";
  const from = env.EMAIL_FROM ?? "";
  if (apiKey.length === 0) return false;
  if (from.length === 0) return false;
  if (PLACEHOLDER_FROM.test(from)) return false;
  return true;
}

function getResend() {
  return new Resend(env.RESEND_API_KEY);
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Always derive the public base URL from PUBLIC_BASE_URL, never from
// the inbound request. Email links must NOT be influenced by Host or
// Origin headers — both are attacker-controlled and would otherwise
// enable token-leak account takeover.
//
// env.ts already enforces PUBLIC_BASE_URL in production. In dev we fall
// back to localhost so the dev server works without extra config.
function getBaseUrl(): string {
  const raw = (publicEnv.PUBLIC_BASE_URL ?? "") as string;
  if (raw.length > 0) return raw.replace(/\/$/, "");
  if (dev) return "http://localhost:5173";
  throw new Error("PUBLIC_BASE_URL is not configured. Outbound emails cannot build a safe link.");
}

// Map Resend's published error codes onto our smaller reason set.
// Anything we don't recognise becomes provider_error so callers don't
// have to know the underlying SDK's vocabulary.
function mapResendError(error: { name?: string; message?: string } | null): {
  reason: EmailErrorReason;
  message: string;
} {
  const name = error?.name ?? "";
  const message = error?.message ?? "Unknown email provider error";
  switch (name) {
    case "missing_api_key":
    case "restricted_api_key":
    case "invalid_api_key":
      return { reason: "not_configured", message };
    case "invalid_from_address":
      return { reason: "invalid_sender_domain", message };
    case "rate_limit_exceeded":
    case "monthly_quota_exceeded":
    case "daily_quota_exceeded":
      return { reason: "rate_limited", message };
    default:
      return { reason: "provider_error", message };
  }
}

type ResendSendArgs = Parameters<ReturnType<typeof getResend>["emails"]["send"]>[0];

async function safeSend(payload: ResendSendArgs): Promise<EmailResult> {
  if (!isEmailConfigured()) {
    return {
      ok: false,
      reason: "not_configured",
      message: "Email is not configured (RESEND_API_KEY or EMAIL_FROM unset).",
    };
  }
  try {
    const { data, error } = await getResend().emails.send(payload);
    if (error) {
      return { ok: false, ...mapResendError(error) };
    }
    return { ok: true, id: data?.id };
  } catch (err) {
    // Network errors, malformed payloads, etc. Keep the message but
    // never include the raw payload (would echo recipient addresses
    // and HTML bodies into logs).
    return {
      ok: false,
      reason: "provider_error",
      message: err instanceof Error ? err.message : "Email send threw a non-Error",
    };
  }
}

const FROM_FALLBACK = "MedTracker <noreply@jamiewhite.site>";

export async function sendVerificationEmail(email: string, token: string): Promise<EmailResult> {
  const verifyUrl = `${getBaseUrl()}/auth/verify?token=${encodeURIComponent(token)}`;
  return safeSend({
    from: env.EMAIL_FROM ?? FROM_FALLBACK,
    to: email,
    subject: "Verify your email",
    html: `<p>Click <a href="${verifyUrl}">here</a> to verify your email address.</p>
           <p>This link expires in 24 hours.</p>`,
  });
}

export async function sendPasswordResetEmail(email: string, token: string): Promise<EmailResult> {
  const resetUrl = `${getBaseUrl()}/auth/reset-password?token=${encodeURIComponent(token)}`;
  return safeSend({
    from: env.EMAIL_FROM ?? FROM_FALLBACK,
    to: email,
    subject: "Reset your password",
    html: `<p>Click <a href="${resetUrl}">here</a> to reset your password.</p>
           <p>This link expires in 1 hour.</p>`,
  });
}

export async function sendLowInventoryEmail(
  email: string,
  medicationName: string,
  count: number,
  threshold: number,
): Promise<EmailResult> {
  return safeSend({
    from: env.EMAIL_FROM ?? FROM_FALLBACK,
    to: email,
    subject: `Low inventory: ${medicationName}`,
    html: `<p><strong>${escHtml(medicationName)}</strong> has ${count} doses remaining (threshold: ${threshold}).</p>
           <p>Consider refilling soon.</p>`,
  });
}

export async function sendReminderEmail(
  email: string,
  medicationName: string,
  lastTaken: string,
): Promise<EmailResult> {
  return safeSend({
    from: env.EMAIL_FROM ?? FROM_FALLBACK,
    to: email,
    subject: `Reminder: ${medicationName}`,
    html: `<p>You haven't taken <strong>${escHtml(medicationName)}</strong> since ${escHtml(lastTaken)}.</p>
           <p>Log in to record your dose.</p>`,
  });
}
