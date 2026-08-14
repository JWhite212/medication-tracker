import { eq } from "drizzle-orm";
import { db } from "$lib/server/db";
import { userPreferences } from "$lib/server/db/schema";
import { logAudit, computeChanges } from "$lib/server/audit";
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

/**
 * The single audited write path for user preferences.
 *
 * Every door — the three settings forms and the `/api/v1` command
 * handler — goes through here, so none of them can change a preference
 * without leaving an audit row. The audit used to be the caller's job,
 * restated at each web door over a hand-picked field subset, and the API
 * door simply never did it.
 */
export async function updatePreferences(
  userId: string,
  updates: Partial<Omit<UserPreferences, "userId" | "updatedAt">>,
): Promise<UserPreferences> {
  // Doubles as the before-image and as the guarantee that the singleton
  // row exists: `.update()` matches nothing when it doesn't, which
  // returned undefined to every caller except the API door.
  const before = await getOrCreatePreferences(userId);

  const [updated] = await db
    .update(userPreferences)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(userPreferences.userId, userId))
    .returning();

  // Diff only the fields the caller submitted. computeChanges walks the
  // keys of its second argument, so narrowing the after-image keeps the
  // always-rewritten updatedAt out of the changes — a whole-row diff
  // would log a change on every save, which is what drove each door to
  // hand-roll its own subset in the first place.
  const submitted = Object.keys(updates);
  const row = updated as Record<string, unknown>;
  const changes = computeChanges(
    before,
    Object.fromEntries(submitted.map((key) => [key, row[key]])),
  );
  if (changes) await logAudit(userId, "user_preferences", userId, "update", changes);

  return updated;
}
