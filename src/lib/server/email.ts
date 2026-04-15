import { Resend } from "resend";
import { env } from "$env/dynamic/private";

const resend = new Resend(env.RESEND_API_KEY);

export async function sendVerificationEmail(
  email: string,
  token: string,
  baseUrl: string,
) {
  const verifyUrl = `${baseUrl}/auth/verify?token=${token}`;
  await resend.emails.send({
    from: "MedTracker <noreply@yourdomain.com>",
    to: email,
    subject: "Verify your email",
    html: `<p>Click <a href="${verifyUrl}">here</a> to verify your email address.</p>
           <p>This link expires in 24 hours.</p>`,
  });
}

export async function sendPasswordResetEmail(
  email: string,
  token: string,
  baseUrl: string,
) {
  const resetUrl = `${baseUrl}/auth/reset-password?token=${token}`;
  await resend.emails.send({
    from: "MedTracker <noreply@yourdomain.com>",
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
  await resend.emails.send({
    from: "MedTracker <noreply@yourdomain.com>",
    to: email,
    subject: `Reminder: ${medicationName}`,
    html: `<p>You haven't taken <strong>${medicationName}</strong> since ${lastTaken}.</p>
           <p>Log in to record your dose.</p>`,
  });
}
