import { eq } from "drizzle-orm";
import { db } from "$lib/server/db";
import { userPreferences } from "$lib/server/db/schema";
import type { UserPreferences } from "$lib/types";

export async function getOrCreatePreferences(userId: string): Promise<UserPreferences> {
  const [existing] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  if (existing) return existing;

  // Two concurrent first-touches (e.g. a page load racing an import)
  // would both miss the select and both insert, and the second would
  // fail the primary-key constraint. onConflictDoNothing makes the loser
  // return no row instead of throwing; it then re-reads the winner's.
  const [created] = await db
    .insert(userPreferences)
    .values({ userId })
    .onConflictDoNothing()
    .returning();

  if (created) return created;

  const [raced] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  return raced;
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
