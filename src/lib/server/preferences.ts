import { eq } from "drizzle-orm";
import { db } from "$lib/server/db";
import { userPreferences } from "$lib/server/db/schema";
import type { UserPreferences } from "$lib/types";

export async function getOrCreatePreferences(
  userId: string,
): Promise<UserPreferences> {
  const [existing] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(userPreferences)
    .values({ userId })
    .returning();

  return created;
}

export async function updatePreferences(
  userId: string,
  updates: Partial<Omit<UserPreferences, "userId" | "updatedAt">>,
): Promise<UserPreferences> {
  const [updated] = await db
    .update(userPreferences)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(userPreferences.userId, userId))
    .returning();

  return updated;
}
