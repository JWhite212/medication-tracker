import { createTOTPKeyURI, verifyTOTP } from "@oslojs/otp";
import { encodeBase32UpperCase, decodeBase32 } from "@oslojs/encoding";
import QRCode from "qrcode";

export function generateTOTPSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return encodeBase32UpperCase(bytes);
}

export function getTOTPUri(secret: string, email: string): string {
  const decoded = decodeBase32(secret);
  return createTOTPKeyURI("MedTracker", email, decoded, 30, 6);
}

export async function generateQRDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri);
}

export function verifyTOTPCode(secret: string, code: string): boolean {
  const decoded = decodeBase32(secret);
  return verifyTOTP(decoded, 30, 6, code);
}
