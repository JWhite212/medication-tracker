# Phase 4d — `medication_schedules` refactor

This file is the self-contained execution plan for Phase 4d. After
`/clear`, a fresh session should be able to read this file and pick
up the work without further preamble.

## Decision (locked at end of Phase 4c)

- **Scope**: combine 4d-i (schema + migration) and 4d-ii (readers
  + form UI) into a single PR. Not a separate 4d-iii — days-of-week
  and PRN UI ship as part of this work too if scope allows; if not,
  they slip to a follow-up but the data model leaves room.
- **Branch**: `feat/phase-4d-schedules`. Base from latest `main`
  after Phase 4c merges.
- **Strategy**: keep the legacy `medications.scheduleType` and
  `medications.scheduleIntervalHours` columns alive for one PR cycle
  but stop reading from them. Drop columns in a follow-up after
  prod data has been migrated.

## Context loaded into Phase 4 already (do not redo)

Phases 1-3 plus 4a / 4b / 4c are merged to `main`. The relevant
state for this PR:

- `dose_logs.status` is the canonical taken/skipped/missed signal
  (Phase 1).
- Coverage thresholds in `vite.config.ts`: statements ≥ 13,
  branches ≥ 14, functions ≥ 9, lines ≥ 17. These won't move in
  this PR but the test suite must not regress below them.
- ESLint flat config + Prettier are in place. Run `npm run lint`,
  `npm run format:check`, `npm run check`, `npx vitest run`,
  `DATABASE_URL='postgresql://x:y@z/d?sslmode=require' npm run build`
  before pushing.
- Demo seed lives at `scripts/seed-demo.ts`. Update the seed to
  populate `medication_schedules` rows alongside (or instead of)
  the legacy fields.
- The fact-forcing gate hook fires on **every** Write / Edit / Bash.
  See "Hook etiquette" below.

## Hook etiquette (must follow on every tool call)

1. **Bash (destructive)** — quote the user's current instruction
   verbatim, list files modified, write a one-line rollback.
2. **Write (new file)** — name files calling it, glob to confirm
   no existing file serves the same purpose, list field names if
   it reads/writes data, quote the user's current instruction
   verbatim.
3. **Edit (existing file)** — list importers via Grep, name public
   functions affected, list data files touched, quote the user's
   current instruction verbatim.
4. The gate fires once and asks for facts. State them inline, then
   re-issue the same tool call — it succeeds the second time.

## What's in scope for this PR

### A. Schema (`src/lib/server/db/schema.ts`)

Add a `medication_schedules` table:

```ts
export const medicationSchedules = pgTable(
  "medication_schedules",
  {
    // Generated server-side via crypto.randomUUID() (or nanoid) before insert —
    // matches the id-generation pattern used for medications/dose_logs. There
    // is no DB-side default, so callers MUST set `id` explicitly.
    id: text("id").primaryKey(),
    medicationId: text("medication_id")
      .notNull()
      .references(() => medications.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scheduleKind: text("schedule_kind").notNull().$type<ScheduleKind>(),
    timeOfDay: text("time_of_day"), // 'HH:mm' for fixed_time
    intervalHours: numeric("interval_hours"),
    daysOfWeek: jsonb("days_of_week").$type<number[]>(), // 0=Sun..6=Sat
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("medication_schedules_med_idx").on(table.medicationId),
    index("medication_schedules_user_idx").on(table.userId),
  ],
);

export type ScheduleKind = "fixed_time" | "interval" | "prn";
```

Notes:

- A medication may have **multiple** schedule rows. Twice-daily at
  08:00 and 20:00 = two `fixed_time` rows.
- `interval` rows use `intervalHours` and ignore `timeOfDay`.
- `prn` rows ignore both `timeOfDay` and `intervalHours`. A
  medication marked `prn` is "as needed" — no scheduled slots, only
  user-initiated logs.
- `daysOfWeek` is null on every-day schedules; non-null restricts
  to specific weekdays.

### B. Migration (`drizzle/0006_phase_4d_schedules.sql`)

Generate via `npm run db:generate -- --name=phase_4d_schedules`,
then hand-augment with a backfill INSERT:

```sql
-- DDL emitted by drizzle-kit (CREATE TABLE + indexes + FKs).

-- Backfill: every medication with scheduleType='scheduled' and a
-- non-null scheduleIntervalHours becomes a single interval row.
INSERT INTO "medication_schedules"
  (id, medication_id, user_id, schedule_kind, interval_hours, sort_order, created_at)
SELECT
  'sched_' || md5(id) AS id,
  id AS medication_id,
  user_id,
  'interval' AS schedule_kind,
  schedule_interval_hours,
  0 AS sort_order,
  now()
FROM medications
WHERE schedule_type = 'scheduled'
  AND schedule_interval_hours IS NOT NULL;

-- Backfill: as_needed becomes a prn row.
INSERT INTO "medication_schedules"
  (id, medication_id, user_id, schedule_kind, sort_order, created_at)
SELECT
  'sched_' || md5(id) AS id,
  id, user_id, 'prn', 0, now()
FROM medications
WHERE schedule_type = 'as_needed';
```

(`md5(id)` is deterministic so re-running the migration is idempotent
across replays. cuid2 wrapper would also work but the SQL approach
keeps the migration pure.)

### C. Reader rewrite

#### `src/lib/utils/schedule.ts`

Current: `computeScheduleSlots(medications, doses, lastDoseByMed,
dayStart, dayEnd, timezone, now)` projects forward by
`scheduleIntervalHours`.

New: accept a `Map<medicationId, MedicationSchedule[]>` alongside
the medications. For each medication:

- **interval kind**: project from `lastDoseByMed[medId]` (or
  `dayStart`) by `intervalHours`. Same as today.
- **fixed_time kind**: produce one slot per `timeOfDay` per day in
  range, respecting `daysOfWeek` if set. Time-of-day in the user's
  timezone, converted to UTC for storage/comparison.
- **prn kind**: produce zero slots.

A medication may have multiple rows; emit slots for each.

Output `ScheduleSlot` shape stays the same so `MyDayTimeline.svelte`
and `+page.server.ts` consumers don't need to change.

#### `src/lib/server/medications.ts` (or new `src/lib/server/schedules.ts`)

Add helpers:

- `getSchedulesForUser(userId)` — fetches every schedule row for
  the user, returns the `Map<medicationId, MedicationSchedule[]>`.
- `getSchedulesForMedication(medicationId, userId)` — single-med
  fetch (used by edit page).
- `replaceSchedulesForMedication(medicationId, userId, schedules)` —
  delete-then-insert in a transaction; used by both create and
  update flows so a single code path owns schedule writes.

#### `src/routes/(app)/dashboard/+page.server.ts`

Already calls `computeScheduleSlots`. Update the call site to also
load schedules: `const schedulesMap = await getSchedulesForUser(...)`,
then pass it through.

#### `src/lib/server/reminders.ts`

Currently reads `m.scheduleIntervalHours` to compute `nextDueAt`.
Switch to per-schedule: for each medication, walk every
`MedicationSchedule` and compute `nextDueAt`; the dedupe key
already includes `nextDueAt.toISOString()` so multi-schedule
fire correctly without code changes.

#### `src/lib/server/analytics.ts:getPerMedicationStats`

Currently computes `expectedPerDay = 24 / scheduleIntervalHours`.
Replace with per-schedule sum:

```ts
function expectedPerDayForSchedules(schedules: MedicationSchedule[]): number {
  let perDay = 0;
  for (const s of schedules) {
    if (s.scheduleKind === "prn") continue;
    if (s.scheduleKind === "interval" && s.intervalHours) {
      perDay += 24 / Number(s.intervalHours);
    } else if (s.scheduleKind === "fixed_time" && s.timeOfDay) {
      const dayFraction = s.daysOfWeek?.length ? s.daysOfWeek.length / 7 : 1;
      perDay += 1 * dayFraction;
    }
  }
  return perDay;
}
```

### D. Form UI (`src/lib/components/MedicationForm.svelte`)

Replace the current schedule type / interval-hours inputs with a
new editor:

- Radio group for `scheduleKind`: Interval / Fixed time / As needed.
- **Interval mode**: existing `intervalHours` input (rename UI label
  to "Every N hours"). One row only.
- **Fixed-time mode**: dynamic list of time-of-day inputs with
  Add/Remove buttons. Each row: `<input type="time">` + delete
  button. Optional days-of-week multi-select (Mon Tue Wed ... Sun)
  applies to ALL fixed-time rows for this medication.
- **PRN mode**: just a note explaining "log when you need it; no
  reminders". No further inputs.

State shape kept on the client and submitted as a JSON string in a
hidden field, e.g. `name="schedules"` containing
`JSON.stringify(scheduleRows)`. Server parses with a Zod schema.

### E. Validation (`src/lib/utils/validation.ts`)

Add a Zod schema:

```ts
export const scheduleRowSchema = z.discriminatedUnion("scheduleKind", [
  z.object({
    scheduleKind: z.literal("interval"),
    intervalHours: z.coerce.number().positive().max(72),
  }),
  z.object({
    scheduleKind: z.literal("fixed_time"),
    timeOfDay: z.string().regex(/^\d{2}:\d{2}$/),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).nullable(),
  }),
  z.object({
    scheduleKind: z.literal("prn"),
  }),
]);

export const schedulesSchema = z.array(scheduleRowSchema).min(1);
```

Threaded through the medication create + update form action zod
validation.

### F. Server action wiring

In `src/routes/(app)/medications/new/+page.server.ts` and
`src/routes/(app)/medications/[id]/+page.server.ts`:

- Parse `formData.schedules` (JSON string) → `schedulesSchema`.
- After medication insert/update, call
  `replaceSchedulesForMedication()` inside the same logical unit.
- Continue writing legacy `scheduleType` and `scheduleIntervalHours`
  for one PR cycle (see Compatibility below). For multi-schedule or
  fixed-time rows, set `scheduleType='scheduled'` and
  `scheduleIntervalHours=null` — readers won't use them anyway.

### G. Compatibility shim

Don't drop `medications.scheduleType` / `scheduleIntervalHours` in
this PR. Keep them populated for the simple-case path
(single-interval row) so a rollback to the previous main release
keeps working. Add a comment in `schema.ts`:

```ts
// DEPRECATED — read from `medication_schedules` instead. Will be
// removed in a follow-up after one prod cycle.
scheduleType: text("schedule_type").notNull().default("scheduled"),
scheduleIntervalHours: numeric("schedule_interval_hours"),
```

### H. Demo seed update (`scripts/seed-demo.ts`)

After creating each medication, also insert a `medication_schedules`
row. For variety, change one of the seed meds (e.g., Lisinopril) to
a fixed-time `08:00` schedule so screenshots show the new feature.

### I. Tests

#### `tests/unit/schedule.test.ts`

Already exists and tests `computeScheduleSlots`. Update fixtures
to construct schedules and update assertions for the new behaviour.
At minimum:

- Interval kind produces correct slot list.
- Fixed-time kind produces exactly N slots per day for N rows.
- Fixed-time + daysOfWeek=[1,3,5] only produces slots on those days.
- PRN kind produces 0 slots.
- Multi-schedule medication produces the union.

#### New `tests/unit/schedules-server.test.ts`

Mock the db chain (or use the same `select-from-where` mock
pattern from `tests/unit/interactions.test.ts`) and cover:

- `replaceSchedulesForMedication` deletes old + inserts new in a
  transaction.
- `getSchedulesForUser` returns the right shape.

#### `tests/unit/analytics.test.ts`

Update / extend if you change the `getPerMedicationStats` shape.
The pure helpers (`calculateAdherence`, `calculateOveruse`) shouldn't
change.

### J. Documentation updates

- `docs/database.md` — add the new table to the table reference,
  update the dose_logs / medications section to point at the
  schedules table.
- `README.md` — flip the Feature Status row from "Interval-based
  today; planned richer model" to "Fixed-time, interval, PRN".
- `docs/case-study.md` §6 — strike "Schedule model" from "What I
  would improve next" since it'll now be done.
- New ADR `docs/adr/0006-medication-schedules.md` recording the
  multi-row schedule decision.

## Files touched (estimated)

| File                                                   | Change                                                       | Risk                       |
| ------------------------------------------------------ | ------------------------------------------------------------ | -------------------------- |
| `src/lib/server/db/schema.ts`                          | New `medicationSchedules` export, deprecate two columns      | Low                        |
| `drizzle/0006_phase_4d_schedules.sql`                  | DDL + backfill                                               | Low (idempotent backfill)  |
| `drizzle/meta/0006_snapshot.json`                      | Generated                                                    | Low                        |
| `src/lib/server/schedules.ts`                          | New file                                                     | Low                        |
| `src/lib/server/medications.ts`                        | Use `replaceSchedulesForMedication` on create/update         | Med                        |
| `src/lib/server/reminders.ts`                          | Iterate schedules for nextDueAt                              | Med                        |
| `src/lib/server/analytics.ts`                          | New `expectedPerDayForSchedules` helper                      | Med                        |
| `src/lib/utils/schedule.ts`                            | Rewrite `computeScheduleSlots`                               | High — most logic          |
| `src/lib/utils/validation.ts`                          | Add `schedulesSchema` discriminated union                    | Low                        |
| `src/lib/components/MedicationForm.svelte`             | New schedule editor UI                                       | High — biggest UX change   |
| `src/routes/(app)/dashboard/+page.server.ts`           | Pass schedules to `computeScheduleSlots`                     | Low                        |
| `src/routes/(app)/medications/new/+page.server.ts`     | Validate + persist schedules                                 | Med                        |
| `src/routes/(app)/medications/[id]/+page.server.ts`    | Same on update                                               | Med                        |
| `tests/unit/schedule.test.ts`                          | New fixtures + assertions                                    | Med                        |
| `tests/unit/schedules-server.test.ts`                  | New file                                                     | Low                        |
| `scripts/seed-demo.ts`                                 | Insert schedules; vary one med to fixed-time                 | Low                        |
| `docs/database.md`                                     | Document new table                                           | Low                        |
| `docs/adr/0006-medication-schedules.md`                | New ADR                                                      | Low                        |
| `README.md`                                            | Update Feature Status table                                  | Low                        |
| `docs/case-study.md`                                   | Remove from "would improve next"                             | Low                        |

Total estimated diff: ~800-1,200 lines across ~20 files.

## Suggested commit sequence (one branch, multiple commits)

1. **schema + migration** — `feat(db): add medication_schedules table + backfill`
2. **server helpers** — `feat: schedules.ts read/write helpers`
3. **schedule logic** — `feat: computeScheduleSlots multi-schedule rewrite`
4. **reminders + analytics** — `feat: schedule-aware reminders and adherence`
5. **form UI** — `feat: schedule editor in MedicationForm`
6. **action wiring + validation** — `feat: validate + persist schedules on create/update`
7. **seed update** — `chore: seed-demo populates schedules`
8. **tests** — `test: unit tests for new schedule logic`
9. **docs + ADR** — `docs: ADR 0006 + database.md, README, case-study updates`

If iteration shows the rewrite is bigger than expected, commits 1-4
form a coherent **4d-i** that can ship independently (schema +
readers). Commits 5-9 form **4d-ii** (UI + tests + docs). Either
land both as one PR (preferred) or break at that boundary if
review pressure demands it.

## Validation checklist before push

```bash
# format
npx prettier --write . && npx prettier --check .

# lint
npx eslint .

# type check
npm run check

# tests (no DATABASE_URL — must work fully mocked)
env -u DATABASE_URL npx vitest run

# build (placeholder URL needed)
DATABASE_URL='postgresql://x:y@z/d?sslmode=require' npm run build
```

All five must be green. CI re-runs them.

## What this PR does NOT do (explicit out-of-scope)

- **Drop legacy columns** — `medications.scheduleType` and
  `scheduleIntervalHours` stay for now; a follow-up after a prod
  release cycle drops them.
- **Time-of-day reminders polish** — the cron will fire reminders
  on a fixed-time slot's `nextDueAt`, but we won't add per-slot
  preference UI for "send reminder N minutes before due" yet.
- **End-to-end Playwright journey** — defer to a follow-up.
- **Schedule history** — `medication_schedules` is current-state
  only. A future schedule_changes audit table is left for the
  history feature, not this PR.

## Rollback procedure

If the PR ships and something breaks:

1. Revert the merge commit on `main` — `git revert -m 1 <merge-sha>`.
2. The legacy columns are still populated, so the prior code path
   continues to work without further migration.
3. The new `medication_schedules` table can be left in place —
   it's a no-op for the previous code path. Drop only if needed
   (`DROP TABLE medication_schedules CASCADE`).
4. The seed script can re-run safely (idempotent).

## Pointers for the fresh session

- `improvements-broad.plan.md` §9 is the original recommendation
  for this work.
- `improvements-execution.plan.md` records the locked decisions
  (10 of them).
- `phase-4d-schedules.plan.md` (this file) is the execution plan
  for the work itself.
- Memory entries — none that conflict; project_next_implementation
  was about brand assets and is no longer current.

## Suggested kickoff prompt after `/clear`

> Read `.claude/PRPs/plans/phase-4d-schedules.plan.md` then begin
> Phase 4d. Create branch `feat/phase-4d-schedules` from latest
> main, do all of 4d-i + 4d-ii in one PR per the plan, and stop
> for review only at validation milestones.
