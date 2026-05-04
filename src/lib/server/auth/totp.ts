import { createTOTPKeyURI, verifyTOTP } from "@oslojs/otp";
import { encodeBase32UpperCase, decodeBase32 } from "@oslojs/encoding";
import QRCode from "qrcode";
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
// The compare-and-set is a single conditional UPDATE so concurrent
// attempts on the same step lose the race deterministically — at most
// one returns true.
export async function verifyAndConsumeTOTPCode(userId: string, code: string): Promise<boolean> {
  const [row] = await db
    .select({ totpSecret: users.totpSecret })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row?.totpSecret) return false;

  if (!verifyTOTPCode(row.totpSecret, code)) return false;

  const step = currentTOTPStep();
  const updated = await db
    .update(users)
    .set({ totpLastCounter: step })
    .where(
      and(eq(users.id, userId), or(isNull(users.totpLastCounter), lt(users.totpLastCounter, step))),
    )
    .returning({ id: users.id });

  return updated.length === 1;
}
