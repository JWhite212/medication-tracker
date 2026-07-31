import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "$env/dynamic/private";

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export interface PreAuthClaims {
  userId: string;
  // Single-use id: the 2FA endpoint burns it on successful verification
  // so a captured token cannot mint a second session within its TTL.
  jti: string;
  exp: number;
}

function key(): string {
  if (!env.ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY is not set");
  return env.ENCRYPTION_KEY;
}
const b64u = (b: Buffer) => b.toString("base64url");

function sign(payloadB64: string): string {
  return createHmac("sha256", key()).update(payloadB64).digest("base64url");
}

export function signPreAuthToken(userId: string, ttlMs: number = DEFAULT_TTL_MS): string {
  const claims = { userId, jti: randomBytes(16).toString("base64url"), exp: Date.now() + ttlMs };
  const payload = b64u(Buffer.from(JSON.stringify(claims)));
  return `${payload}.${sign(payload)}`;
}

export function verifyPreAuthToken(token: string): PreAuthClaims | null {
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { userId, jti, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (
      typeof userId !== "string" ||
      typeof jti !== "string" ||
      jti.length === 0 ||
      typeof exp !== "number" ||
      Date.now() > exp
    )
      return null;
    return { userId, jti, exp };
  } catch {
    return null;
  }
}
