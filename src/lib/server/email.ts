import { Resend } from "resend";
import { env } from "$env/dynamic/private";
// SvelteKit's $env/dynamic/private excludes any variable that starts
// with the PUBLIC_ prefix, so PUBLIC_BASE_URL must come from the
// public module. The value is genuinely public anyway (the site's
// own URL).
import { env as publicEnv } from "$env/dynamic/public";
import { dev } from "$app/environment";

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

export async function sendVerificationEmail(email: string, token: string) {
  const verifyUrl = `${getBaseUrl()}/auth/verify?token=${encodeURIComponent(token)}`;
  await getResend().emails.send({
    from: env.EMAIL_FROM ?? "MedTracker <noreply@jamiewhite.site>",
    to: email,
    subject: "Verify your email",
    html: `<p>Click <a href="${verifyUrl}">here</a> to verify your email address.</p>
           <p>This link expires in 24 hours.</p>`,
  });
}

export async function sendPasswordResetEmail(email: string, token: string) {
  const resetUrl = `${getBaseUrl()}/auth/reset-password?token=${encodeURIComponent(token)}`;
  await getResend().emails.send({
    from: env.EMAIL_FROM ?? "MedTracker <noreply@jamiewhite.site>",
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
) {
  await getResend().emails.send({
    from: env.EMAIL_FROM ?? "MedTracker <noreply@jamiewhite.site>",
    to: email,
    subject: `Low inventory: ${medicationName}`,
    html: `<p><strong>${escHtml(medicationName)}</strong> has ${count} doses remaining (threshold: ${threshold}).</p>
           <p>Consider refilling soon.</p>`,
  });
}

export async function sendReminderEmail(email: string, medicationName: string, lastTaken: string) {
  await getResend().emails.send({
    from: env.EMAIL_FROM ?? "MedTracker <noreply@jamiewhite.site>",
    to: email,
    subject: `Reminder: ${medicationName}`,
    html: `<p>You haven't taken <strong>${escHtml(medicationName)}</strong> since ${escHtml(lastTaken)}.</p>
           <p>Log in to record your dose.</p>`,
  });
}
