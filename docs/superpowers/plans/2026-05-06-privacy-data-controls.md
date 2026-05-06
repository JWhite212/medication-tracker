# P9 - Privacy and Data Controls

> **Status:** in progress
> **Branch:** `feat/privacy-data-controls`
> **Owner:** Jamie

**Goal:** A single `/settings/privacy` page that gives the user real control over their data: export, wipe specific slices, revoke device sessions, download the audit trail, plus a clear explanation of what is stored and what is not. Sensitive actions require password re-auth via the existing `confirmReauth` flow.

**Architecture:** Composes existing primitives instead of inventing new ones.

- Export: links straight to `/api/export?format=pdf|csv`.
- Account deletion: links to `/settings/data` where the existing dialog handles it.
- Wipe dose history / wipe archived medications: new page-server actions, each gated on `confirmReauth(userId, password, ...)`.
- Revoke other sessions: new action that calls `lucia.invalidateSession` for every session except the current one.
- Audit log download: new GET endpoint at `/api/audit` returning CSV with the same per-user rate-limit pattern as `/api/export`.

---

## File structure

- Modify: `src/lib/server/auth/reauth.ts` (extend `ReauthPurpose` with the 3 new purposes)
- New: `src/lib/server/audit-export.ts` (pure CSV generator over already-fetched audit rows)
- New: `src/routes/api/audit/+server.ts` (rate-limited GET → CSV)
- New: `src/routes/(app)/settings/privacy/+page.server.ts`
- New: `src/routes/(app)/settings/privacy/+page.svelte`
- Modify: `src/routes/(app)/settings/+page.svelte` (add a Privacy & Data row)
- New: `tests/unit/audit-export.test.ts`

## Reauth purposes

Add to `ReauthPurpose`:

- `wipe_dose_history`
- `wipe_archived_medications`

## Risks / notes

- Wipe actions are destructive but bounded: `dose_logs` rows for this user, or `medications` rows where `is_archived = true`. Schedules and doses cascade via FK on archived-medication delete.
- The page does not duplicate the account-deletion form (already on `/settings/data`). It links to it with a pointer so users discover both surfaces.
- The audit CSV endpoint follows the same rate-limit pattern as `/api/export` (10 / 15 minutes / user). It does not require an additional re-auth token because the data is already scoped to the user's own actions.
