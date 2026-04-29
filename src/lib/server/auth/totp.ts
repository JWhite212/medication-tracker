import { createTOTPKeyURI, verifyTOTP } from "@oslojs/otp";
import { encodeBase32UpperCase, decodeBase32 } from "@oslojs/encoding";
import QRCode from "qrcode";
import { encryptSecret, decryptSecret } from "./crypto";

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
  return createTOTPKeyURI("MedTracker", email, decoded, 30, 6);
}

export async function generateQRDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri);
}

// `storedSecret` may be encrypted (v1:...) or legacy plaintext during
// the migration window. decryptSecret() handles both transparently.
export function verifyTOTPCode(storedSecret: string, code: string): boolean {
  const plaintext = decryptSecret(storedSecret);
  const decoded = decodeBase32(plaintext);
  return verifyTOTP(decoded, 30, 6, code);
}
