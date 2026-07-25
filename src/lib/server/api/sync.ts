// GET /api/v1/sync — delta pull for the native (macOS) client. Returns
// every row changed since `sinceIso` per table, plus deletion
// tombstones, so the client can merge incrementally instead of
// re-downloading its whole library on every launch.
//
// Cursor rule: `updatedAt > since` for medications/dose_logs (rows
// that get edited in place); `createdAt > since` for the append-only
// inventory_events/audit_logs; `deletedAt > since` for tombstones.
// `medication_schedules` has no `updated_at` column by design — each
// medication instead carries its FULL current schedule set as a
// `schedules` child array (see getSchedulesForUser), which sidesteps
// needing a cursor column on that table entirely.
//
// `users` and `user_preferences` are singleton rows per user, so they
// are always fetched and returned in full on every sync response
// regardless of `since` — there's nothing to page for a single row.
//
// Epoch: `users.syncEpoch` is bumped on destructive server-side
// operations that fall outside normal per-row updatedAt tracking. If
// the client's last-synced epoch is behind the server's, `since` is
// ignored and every row is returned (fullResync), rather than trying
// to reconcile a delta against state the client may have partially
// missed.
import { db } from "$lib/server/db";
import {
  medications,
  doseLogs,
  inventoryEvents,
  auditLogs,
  userPreferences,
  users,
  syncTombstones,
} from "$lib/server/db/schema";
import { and, eq, gt } from "drizzle-orm";
import { getSchedulesForUser } from "$lib/server/schedules";
import * as s from "$lib/server/api/serialize";

export type SyncResponse = {
  epoch: number;
  fullResync: boolean;
  serverTime: string;
  cursor: string;
  medications: (ReturnType<typeof s.serializeMedication> & {
    schedules: ReturnType<typeof s.serializeSchedule>[];
  })[];
  doseLogs: ReturnType<typeof s.serializeDoseLog>[];
  inventoryEvents: ReturnType<typeof s.serializeInventoryEvent>[];
  auditLogs: ReturnType<typeof s.serializeAuditLog>[];
  tombstones: ReturnType<typeof s.serializeTombstone>[];
  preferences: ReturnType<typeof s.serializePreferences> | null;
  profile: ReturnType<typeof s.toSessionUser> | null;
};

export async function buildSyncResponse(
  userId: string,
  sinceIso: string | null,
  clientEpoch: number,
): Promise<SyncResponse> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const fullResync = !sinceIso || clientEpoch < (user?.syncEpoch ?? 0);
  const since = fullResync ? null : new Date(sinceIso!);
  const serverTime = new Date().toISOString();

  const medRows = await db
    .select()
    .from(medications)
    .where(
      since
        ? and(eq(medications.userId, userId), gt(medications.updatedAt, since))
        : eq(medications.userId, userId),
    );
  const schedulesByMed = await getSchedulesForUser(userId);
  const meds = medRows.map((m) => ({
    ...s.serializeMedication(m),
    schedules: (schedulesByMed.get(m.id) ?? []).map(s.serializeSchedule),
  }));

  const doses = await db
    .select()
    .from(doseLogs)
    .where(
      since
        ? and(eq(doseLogs.userId, userId), gt(doseLogs.updatedAt, since))
        : eq(doseLogs.userId, userId),
    );
  const invEvents = await db
    .select()
    .from(inventoryEvents)
    .where(
      since
        ? and(eq(inventoryEvents.userId, userId), gt(inventoryEvents.createdAt, since))
        : eq(inventoryEvents.userId, userId),
    );
  const audits = await db
    .select()
    .from(auditLogs)
    .where(
      since
        ? and(eq(auditLogs.userId, userId), gt(auditLogs.createdAt, since))
        : eq(auditLogs.userId, userId),
    );
  const tombstones = since
    ? await db
        .select()
        .from(syncTombstones)
        .where(and(eq(syncTombstones.userId, userId), gt(syncTombstones.deletedAt, since)))
    : [];
  const [prefs] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  return {
    epoch: user?.syncEpoch ?? 0,
    fullResync,
    serverTime,
    cursor: serverTime,
    medications: meds,
    doseLogs: doses.map(s.serializeDoseLog),
    inventoryEvents: invEvents.map(s.serializeInventoryEvent),
    auditLogs: audits.map(s.serializeAuditLog),
    tombstones: tombstones.map(s.serializeTombstone),
    preferences: prefs ? s.serializePreferences(prefs) : null,
    profile: user ? s.toSessionUser(user) : null,
  };
}
