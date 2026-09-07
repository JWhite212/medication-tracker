import { createTOTPKeyURI, verifyHOTP, verifyTOTP } from "@oslojs/otp";
import { encodeBase32UpperCase, decodeBase32 } from "@oslojs/encoding";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { encryptSecret, decryptSecret } from "./crypto";
import { db } from "$lib/server/db";
import { users } from "$lib/server/db/schema";

const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;

export function generateTOTPSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return encodeBase32UpperCase(bytes);
}

// Wrap the plaintext base32 secret in AES-256-GCM before persisting it
// to users.totp_secret. Callers should pass the result to the DB.
export function encryptTOTPSecret(secret: string): string {
  return encryptSecret(secret);
}

export function getTOTPUri(secret: string, email: string): string {
  const decoded = decodeBase32(secret);
  return createTOTPKeyURI("MedTracker", email, decoded, TOTP_PERIOD_SECONDS, TOTP_DIGITS);
}

export async function generateQRDataUrl(uri: string): Promise<string> {
  // Lazy so the qrcode package is only loaded on the 2FA-setup path,
  // not on every request that touches the auth module graph.
  const { default: QRCode } = await import("qrcode");
  return QRCode.toDataURL(uri);
}

// `storedSecret` may be encrypted (v1:...) or legacy plaintext during
// the migration window. decryptSecret() handles both transparently.
//
// This function is intentionally side-effect-free. Replay protection
// lives in verifyAndConsumeTOTPCode() — callers that authenticate a
// user via TOTP MUST use that function, otherwise the same 6-digit
// code can be replayed within its 30-second window.
export function verifyTOTPCode(storedSecret: string, code: string): boolean {
  const plaintext = decryptSecret(storedSecret);
  const decoded = decodeBase32(plaintext);
  return verifyTOTP(decoded, TOTP_PERIOD_SECONDS, TOTP_DIGITS, code);
}

// Current TOTP step (RFC 6238 T = floor(unix / period)). Exposed for tests.
export function currentTOTPStep(): number {
  return Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS);
}

// Verify a TOTP code AND consume it atomically against
// users.totp_last_counter so the same step can never be accepted twice
// for the same user (RFC 6238 §5.2).
//
// Verify and consume must reference the *same* step. We compute it
// once up-front and verify the code as an HOTP value against that
// counter — if we used verifyTOTP() (which calls Date.now() internally)
// alongside a separately-computed step for the UPDATE, a request that
// crossed a 30-second boundary between the two calls could verify
// against step N and stamp step N+1, falsely rejecting the user's
// next legitimate code as a replay.
//
// The compare-and-set itself is a single conditional UPDATE so two
// concurrent attempts on the same step lose the race deterministically
// — at most one returns true.
export async function verifyAndConsumeTOTPCode(userId: string, code: string): Promise<boolean> {
  return verifyAndConsume(userId, code, false);
}

/**
 * The same verify-and-consume, plus the one check a LOGIN door needs and
 * the enrolment door must not have: that the account has actually turned
 * 2FA on.
 *
 * `verifyAndConsumeTOTPCode` deliberately does not check
 * `twoFactorEnabled`, because `verifyTwoFactor` calls it to confirm the
 * very enrolment that sets the flag. That made the check easy to omit at
 * the doors that mint a session — and both of them omitted it.
 *
 * It matters because `setupTwoFactor` persists `totpSecret` when the QR
 * code is generated, BEFORE the user confirms, and nothing clears it if
 * they abandon the flow. An account with `twoFactorEnabled = false` can
 * therefore be holding a live TOTP credential — one that was displayed on
 * screen in plaintext base32 next to the QR — and without this check a
 * code derived from it was accepted as a complete login.
 */
export async function verifySecondFactorForLogin(userId: string, code: string): Promise<boolean> {
  return verifyAndConsume(userId, code, true);
}

async function verifyAndConsume(
  userId: string,
  code: string,
  requireEnabled: boolean,
): Promise<boolean> {
  const [row] = await db
    .select({ totpSecret: users.totpSecret, twoFactorEnabled: users.twoFactorEnabled })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row?.totpSecret) return false;
  if (requireEnabled && !row.twoFactorEnabled) return false;

  const step = currentTOTPStep();
  const decoded = decodeBase32(decryptSecret(row.totpSecret));
  if (!verifyHOTP(decoded, BigInt(step), TOTP_DIGITS, code)) return false;

  const updated = await db
    .update(users)
    .set({ totpLastCounter: step })
    .where(
      and(eq(users.id, userId), or(isNull(users.totpLastCounter), lt(users.totpLastCounter, step))),
    )
    .returning({ id: users.id });

  return updated.length === 1;
}
