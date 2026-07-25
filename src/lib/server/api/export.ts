// GET /api/v1/export/full — full-account JSON backup for the native
// (macOS) client and general data portability. Reuses buildSyncResponse's
// full-resync path (since=null) rather than re-querying the DB, so the
// export always reflects the exact same account snapshot the sync
// endpoint would hand a client rebuilding from scratch.
import { buildSyncResponse } from "$lib/server/api/sync";

export type FullExport = {
  version: 1;
  exportedAt: string;
  profile: Awaited<ReturnType<typeof buildSyncResponse>>["profile"];
  preferences: Awaited<ReturnType<typeof buildSyncResponse>>["preferences"];
  medications: Awaited<ReturnType<typeof buildSyncResponse>>["medications"];
  doseLogs: Awaited<ReturnType<typeof buildSyncResponse>>["doseLogs"];
  inventoryEvents: Awaited<ReturnType<typeof buildSyncResponse>>["inventoryEvents"];
  auditLogs: Awaited<ReturnType<typeof buildSyncResponse>>["auditLogs"];
};

export async function buildFullExport(userId: string): Promise<FullExport> {
  const snap = await buildSyncResponse(userId, null, 0);
  return {
    version: 1,
    exportedAt: snap.serverTime,
    profile: snap.profile,
    preferences: snap.preferences,
    medications: snap.medications,
    doseLogs: snap.doseLogs,
    inventoryEvents: snap.inventoryEvents,
    auditLogs: snap.auditLogs,
  };
}
