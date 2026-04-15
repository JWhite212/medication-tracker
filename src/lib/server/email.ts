import { Resend } from "resend";
import { env } from "$env/dynamic/private";

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

function getBaseUrl(requestOrigin?: string): string {
  return env.PUBLIC_BASE_URL ?? requestOrigin ?? "http://localhost:5173";
}

export async function sendVerificationEmail(
  email: string,
  token: string,
  requestOrigin: string,
) {
  const verifyUrl = `${getBaseUrl(requestOrigin)}/auth/verify?token=${encodeURIComponent(token)}`;
  await getResend().emails.send({
    from: env.EMAIL_FROM ?? "MedTracker <noreply@yourdomain.com>",
    to: email,
    subject: "Verify your email",
    html: `<p>Click <a href="${verifyUrl}">here</a> to verify your email address.</p>
           <p>This link expires in 24 hours.</p>`,
  });
}

export async function sendPasswordResetEmail(
  email: string,
  token: string,
  requestOrigin: string,
) {
  const resetUrl = `${getBaseUrl(requestOrigin)}/auth/reset-password?token=${encodeURIComponent(token)}`;
  await getResend().emails.send({
    from: env.EMAIL_FROM ?? "MedTracker <noreply@yourdomain.com>",
    to: email,
    subject: "Reset your password",
    html: `<p>Click <a href="${resetUrl}">here</a> to reset your password.</p>
           <p>This link expires in 1 hour.</p>`,
  });
}

export async function sendReminderEmail(
  email: string,
  medicationName: string,
  lastTaken: string,
) {
  await getResend().emails.send({
    from: env.EMAIL_FROM ?? "MedTracker <noreply@yourdomain.com>",
    to: email,
    subject: `Reminder: ${medicationName}`,
    html: `<p>You haven't taken <strong>${escHtml(medicationName)}</strong> since ${escHtml(lastTaken)}.</p>
           <p>Log in to record your dose.</p>`,
  });
}
