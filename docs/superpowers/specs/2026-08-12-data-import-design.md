# Data Import — Design

Counterpart to the existing export surface: let a user restore an account from a
MedTracker backup, or move data between accounts.

## Why the obvious implementation is wrong

Reusing the per-row write helpers (`createMedicationWithSchedules`, `logDose`,
`recordInventoryEvent`) looks like the respectful thing to do. It breaks four ways:

1. **`startedAt` / `endedAt` / `effectiveFrom` / `effectiveTo` are never written by
   any existing function.** Every imported medication would get `startedAt = now()`.
   Analytics treats days outside `[startedAt, endedAt]` as "not expected", so the
   entire imported back-catalogue is judged as "this medication did not exist yet" —
   adherence %, expected-dose counts and the heatmap all silently wrong.
2. **Inventory double-decrement.** A backup already carries the post-decrement
   `inventoryCount`. Replaying dose logs through `logDose` decrements it a second time.
3. **`status: "missed"` has no write path.** `logDose` writes `taken`,
   `logSkippedDose` writes `skipped`. Missed doses cannot round-trip.
4. **One `dbTx.transaction` per row**, plus one `audit_logs` row per record. A
   2000-dose import means 2000 websocket transactions (Vercel timeout) and 2000 audit
   rows drowning the user's real history.

So import gets a **dedicated bulk-insert path inside a single transaction**, not reuse
of the per-row helpers.

## Scope

Accepted formats:

| Format        | Source                                                | Fidelity                                           |
| ------------- | ----------------------------------------------------- | -------------------------------------------------- |
| `backup-json` | `GET /api/v1/export/full`, new `GET /api/export/full` | Lossless. `version: 1` envelope.                   |
| `dose-csv`    | `GET /api/export?format=csv`                          | Lossy. Names only, minute precision, no schedules. |

Not importable, by design:

- **PDF** — a rendered report, not data.
- **Audit CSV** — importing it would fabricate a tamper-evident history. Import writes
  exactly one `data_import` audit row describing what came in.

**Prerequisite:** the only lossless export is bearer-auth only (`/api/v1/export/full`),
reachable by the macOS client but not the web UI. Without a web-reachable download there
is no file to import, so this adds `GET /api/export/full` (session auth, same builder).

## Modes

- **Merge** (default, non-destructive) — adds what isn't already there, skips duplicates,
  **never mutates or deletes an existing row**.
- **Replace** (opt-in) — wipes medications (cascading to schedules, doses, inventory
  events) and restores the file verbatim. Gated on password, or on typing `REPLACE`
  exactly for OAuth-only accounts that have no password hash.

### Duplicate detection (merge)

- **Medications** — matched on `trim().toLowerCase()` of name, across active _and_
  archived. A match means _reuse the existing medication_, never update it.
- **Doses** — key is `medicationId | stamp | status | quantity`, where the precision of
  `stamp` depends on the source format. Exact milliseconds for a JSON backup: bucketing
  those to the minute would silently drop two genuinely distinct doses logged seconds
  apart (a split dose, a quick correction). Minutes for the dose CSV, whose `Time` column
  is only `HH:mm` — keying on exact ms there would never match, so every re-import would
  duplicate the lot. The snapshot carries both precisions so either can be matched.
- **Inventory counts and events are only written for medications the import creates.**
  An existing medication keeps its own count and ledger. This is what stops inventory
  drift, which is the main way an import could quietly corrupt a working account.

## Architecture

Pure core, DB-free, so tests run without `DATABASE_URL` — the same split that lets
`audit-csv.ts` be tested apart from `audit-export.ts`:

```
src/lib/server/import/
  types.ts      ImportBundle / ImportPlan / ImportResult
  detect.ts     sniff format (pure)
  backup.ts     v1 envelope -> ImportBundle (pure)
  csv.ts        RFC4180 parser + inverse formula guard -> ImportBundle (pure)
  plan.ts       bundle + account snapshot -> ImportPlan (pure)
  snapshot.ts   read existing account state (DB, read-only)
  apply.ts      plan -> writes (the ONLY module that mutates)
```

Zod schemas live in `src/lib/utils/validation.ts` per the project convention.

## Flow

Upload → parse + plan, **writes nothing** → preview ("12 medications created, 430 doses
added, 82 skipped as duplicates") → confirm re-uploads the same file and re-parses
server-side.

The confirm step re-parses rather than trusting a client round-trip, so there is no
staging table, no TTL sweeper, and no path where client-supplied JSON reaches the writer.

## Security invariants

- `userId` is always re-derived from `locals.user.id`. Every `id` is regenerated with
  `createId()`. File-supplied IDs are used **only** to resolve references within the
  file, never written. (`recordInventoryEvent` has no ownership check — handing it a
  file-supplied `medicationId` would write into another user's account.)
- Never imported: `email`, `passwordHash`, `totpSecret`, `twoFactorEnabled`,
  `emailVerified`, `syncEpoch`, sessions, OAuth links, push subscriptions, tokens,
  rate limits, `api_commands`, tombstones. Profile import is name + timezone only, and
  the timezone is validated against `Intl.supportedValuesOf("timeZone")`.
- Transport is a **multipart form action**. A cookie-authenticated JSON `POST` is not
  covered by SvelteKit's origin check; multipart is.
- Caps: 4 MB upload rejected from `content-length` before the body is buffered; per-array
  `.max()` in Zod; a row cap applied _during_ CSV parsing rather than after; `maxDuration:
60`; inserts chunked at 500 rows to stay under the Postgres parameter limit.
- Rate limits: `import-preview` 20/15m, `import-attempt` 20/15m (covers parse cost, spent
  on every commit attempt), `import-commit` 5/60m (spent only immediately before a real
  write, so a mistyped replace password doesn't burn one).
- Timestamps bounded to `[1900-01-01, now + 1 year]`. The upper bound is generous on
  purpose: `doseLogSchema` puts no ceiling on `takenAt`, so the app can store a future
  dose, and a tighter window would make its own backup unimportable.
- Both actions check `locals.user` themselves — form actions run _before_ layout load
  functions, so the `(app)` group's auth guard has not executed yet.
- Preferences and profile default to **off**. Both overwrite settings the account already
  has, which would contradict the promise that merging never overwrites.
- Unknown keys are stripped, not rejected, so a future `version: 2` export degrades
  gracefully; an unrecognised `version` is a hard reject with a clear message.

### The failure mode that matters most

`planIsEmpty` deliberately ignores pending deletions. Counting a replace-mode wipe as
"something happening" means a file that parsed to zero rows still passes the caller's
not-empty check — and replace then deletes every medication (cascading to schedules,
doses and inventory events) and inserts nothing.

This needs no malice to reach: export the dose CSV, open it in Excel, save (Excel
rewrites `2026-08-01` as `01/08/2026`), re-import in replace mode. Every row fails the
strict date check, the file parses to nothing, and the account is gone.

Row-level tolerance matters for the same reason from the other direction: one malformed
dose must not make a 5000-dose backup unimportable. Dose and inventory rows are validated
individually and skipped with a count; medications stay strict, because dropping one
would silently orphan all of its dose history.

## Correctness details

- `startedAt` is back-dated to the medication's earliest imported dose;
  `effectiveFrom` likewise. This is what keeps adherence and the heatmap honest.
- Deprecated `scheduleType` / `scheduleIntervalHours` are dual-written, matching
  `createMedicationWithSchedules`, so refill forecasting and due badges keep working.
- `dosageAmount` / `intervalHours` are Drizzle `numeric` — they arrive and are written
  as **strings**. Coercing to number would change the wire shape.
- `users.syncEpoch` is bumped on every successful import, so the macOS client forces a
  full resync instead of sitting on a stale delta.
- The JSON export has no `ORDER BY`, so array order is non-deterministic. Round-trip
  tests compare sets, not sequences.
- The CSV formula-injection guard is one-way: `escapeCsvCell` prepends `'` to any cell
  starting with `= + - @ \t \r`. The inverse strips a leading `'` **only** when the next
  character is one of those — an exact inverse, ambiguous only for a genuine cell like
  `'-foo`.
- CSV `Date`/`Time` are timezone-less local minutes. They are read as wall-clock in the
  **importing user's** timezone via the existing `parseDateTimeLocal`, and the UI states
  which timezone is being assumed.

## Adjacent fixes (in scope)

- `settings/privacy` re-implements the wipes inline and never bumps `syncEpoch`, so the
  macOS client keeps deleted rows forever. Route it through the existing, already-correct
  `src/lib/server/api/wipe.ts`. That module's epoch bump is this codebase's documented
  mechanism for bulk deletes — per-row tombstones for a 50k-row wipe would be the wrong
  shape.
- `getOrCreatePreferences` has no `onConflictDoNothing()`, so two concurrent first-touches
  race into a PK violation. Import touches preferences, which makes it reachable.

## Testing

Pure modules get direct unit tests; `apply.ts` uses the chainable-mock pattern from
`tests/unit/doses-inventory.test.ts`. The load-bearing test is a **round trip**:
export fixture → import → re-export → compare as sets.

Explicit hostile-input coverage: embedded `userId` ignored, prototype-pollution keys,
oversized arrays, bad dates, malformed CSV quoting, formula-guard round trip.
