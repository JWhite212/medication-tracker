import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "crypto";
import { env } from "$env/dynamic/private";

// AES-256-GCM symmetric encryption for sensitive at-rest secrets
// (currently TOTP shared secrets). Payload format:
//
//   v1:<base64url-iv>:<base64url-auth-tag>:<base64url-ciphertext>
//
// IV is 12 bytes, auth tag is 16 bytes, key is derived via SHA-256
// from the ENCRYPTION_KEY env var so any key length is accepted.
//
// decryptSecret() returns the input unchanged when no v1 prefix is
// present, so callers can transparently handle legacy plaintext rows
// during the one-shot migration period.

const VERSION = "v1";
const IV_LENGTH = 12;

function getKey(): Buffer {
  const raw = env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY env var is required for encryptSecret/decryptSecret",
    );
  }
  // SHA-256 always produces 32 bytes — the right size for AES-256.
  return createHash("sha256").update(raw).digest();
}

function toB64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64Url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${toB64Url(iv)}:${toB64Url(tag)}:${toB64Url(ct)}`;
}

export function decryptSecret(payload: string): string {
  if (!payload.startsWith(`${VERSION}:`)) {
    // Legacy plaintext — return as-is so callers keep working until the
    // migration script re-encrypts every row.
    return payload;
  }
  const parts = payload.split(":");
  if (parts.length !== 4) {
    throw new Error("Malformed encrypted payload");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const key = getKey();
  const iv = fromB64Url(ivB64);
  const tag = fromB64Url(tagB64);
  const ct = fromB64Url(ctB64);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plain.toString("utf8");
}

export function isEncrypted(payload: string): boolean {
  return payload.startsWith(`${VERSION}:`);
}
