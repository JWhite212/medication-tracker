import { sha256 } from "@oslojs/crypto/sha2";
import { encodeHexLowerCase } from "@oslojs/encoding";
import { checkRateLimit } from "$lib/server/auth/rate-limit";
import { db } from "$lib/server/db";
import { users, emailVerificationTokens } from "$lib/server/db/schema";
import { eq, and, gte } from "drizzle-orm";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, getClientAddress }) => {
  const ip = getClientAddress();
  const { allowed } = await checkRateLimit(`email-verify:${ip}`, 20, 15 * 60 * 1000);
  if (!allowed) {
    return { verified: false, error: "Unable to verify right now. Please try again later." };
  }

  const token = url.searchParams.get("token");
  if (!token) return { verified: false, error: "Missing token" };

  const tokenHash = encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
  const [record] = await db
    .select()
    .from(emailVerificationTokens)
    .where(
      and(
        eq(emailVerificationTokens.tokenHash, tokenHash),
        gte(emailVerificationTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!record) return { verified: false, error: "Invalid or expired token" };

  await db.update(users).set({ emailVerified: true }).where(eq(users.id, record.userId));
  await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.id, record.id));

  return { verified: true };
};
