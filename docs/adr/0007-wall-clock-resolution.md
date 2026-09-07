# ADR 0007: One owner for wall-clock → instant resolution

- **Status**: Accepted
- **Date**: 2026-09-07
- **Deciders**: Jamie White

## Context

A medication schedule is written in wall-clock terms — "08:00", "23:30",
"Saturdays only" — and every timestamp is stored as UTC. Something has to
answer "which instant does 08:00 on this local date in this zone name?",
and the answer is not a function of the offset alone, because the offset
is what we are trying to find.

Three functions answered it independently, and all three were wrong.

`localTimeOnDateToUtc` (schedule projection) and `parseDateTimeLocal`
(the write path for `dose_logs.takenAt`) shared one algorithm: read the
wall clock _as if it were UTC_, sample the zone's offset at that instant,
subtract it. The sample is taken `|offset|` hours from the answer, so a
transition falling in that gap applies the wrong offset. Measured against
a two-pass reference over 78,840 wall-clock hours in nine DST zones: 93
conversions wrong, always by exactly an hour, and both functions returned
the identical wrong instant on every one of them.

`startOfDay` had a different bug and a worse one, and it was not about DST
at all. It anchored on `<dayKey>T12:00:00.000Z` and subtracted the local
time-of-day read there — but at UTC+12 and beyond, noon UTC is already the
_next_ civil day locally, so the value read back was 00:00, the correction
subtracted nothing, and the function returned tomorrow's midnight. Every
day of the year, in 18 zones. `getTodaysDoses` filters on
`takenAt >= dayStart`, so a New Zealand or Fiji account's dashboard listed
no doses at all and My Day projected tomorrow's slots. Its only test used
`"UTC"`, the single zone that can expose neither failure.

None of this was visible: the suite was green with the bugs and green
without them.

## Decision

**One resolver, `wallClockToInstant` in `src/lib/utils/time.ts`.**
`parseDateTimeLocal`, `startOfDay`, `endOfDay` and the fixed-time schedule
projection are delegates. `localTimeOnDateToUtc` is deleted rather than
kept as an alias, because a second name for one behaviour is how the two
copies diverged in the first place.

**Propose, then verify.** Compute a candidate from the zone's offset a day
before the requested wall clock, and accept it only if re-reading the
offset _at that candidate_ returns the offset used to compute it. If not,
try the offset a day after. The round-trip is what makes the result
verified rather than assumed.

**Gap (a wall clock that never happens): resolve forward, never throw,
never return null.** A dose logged at 02:30 on a spring-forward day is a
real dose. The two callers that would have to handle a null are the
reminder sweep and My Day's window, where "no answer" means a silently
skipped dose rather than a mistimed one. Forward also keeps `startOfDay`
on its own civil date in Santiago, Havana and Cairo, where local midnight
itself does not exist on some days.

**Overlap (a wall clock that happens twice): take the earlier instant, by
name.** See Consequences for why stability matters more than which one.

## Alternatives considered

**Iterate to a fixed point.** Does not converge. For a wall clock inside a
spring-forward gap, re-sampling oscillates with period 2 forever —
America/New_York 2026-03-08 02:30 goes 03:30 → 01:30 → 03:30 → … — so
`while (changed)` hangs, and a fixed-count loop returns an answer that
depends on whether the author wrote two passes or three. Those two
straddle the gap by an hour. The divergence set of two-pass versus
three-pass is exactly the gap set.

**Probe ±1h instead of ±24h.** Assumes a whole-hour shift.
Australia/Lord_Howe moves 30 minutes and Pacific/Chatham sits at +12:45,
so this was dead on arrival.

**Adopt a date library** (Luxon, date-fns-tz, or Temporal). Correct, and a
reasonable choice for a greenfield project. Rejected here because the
whole surface is one 40-line function plus two helpers, `Intl` already
ships the tz database the app needs, and the dependency policy in
`docs/dependency-policy.md` asks for a clear win over what the platform
provides. Revisit if Temporal reaches baseline availability.

**Throw or return null on a gap.** Pushes an unrepresentable state onto
every caller, and the two most important callers cannot do anything useful
with it.

## Consequences

**A returned instant does not carry a civil day, and callers must never
infer one from it.** Forward resolution can legitimately roll into the
next date: America/Godthab springs forward at 23:00 local, so all 60
minutes of that band are missing on 2026-03-28 and a 23:30 dose
necessarily becomes the 29th. An earlier draft of this work justified
forward resolution with "it never leaves the requested civil day". That is
false, and unsatisfiable rather than merely unmet. It is pinned as a named
counterexample in `tests/unit/dst-wall-clock.test.ts`, and it must not be
restated as a guarantee anywhere.

The direct consequence is that day-of-week filters read the requested
**day key**, via `dayOfWeekForDayKey`, and never the resolved instant.
Otherwise a Saturday-only medication resolves to a Sunday and its slot
disappears from both the timeline and the reminder sweep.

**Fixing the resolver alone would have been a regression** — which is why
the cascade landed in the same commit. `dayEnd` was `dayStart + 24h`, and
a civil day is 23, 24, 24.5 or 25 hours. On Europe/London 2026-10-25 the
old code showed 08:00 / 22:30 / 23:30 and dropped 00:15; the resolver
without the window fix would have shown 00:15 / 08:00 / 22:30 and dropped
23:30. The invisible hour moves from 00:00–00:59 onto 23:00–23:59, the
most common bedtime-medication slot there is.

**This interacts with [ADR 0005](./0005-reminder-deduplication.md).**
`buildOverdueDedupeKey` embeds `nextDueAt.toISOString()`, and
`claimReminderSlot` is an `INSERT … ON CONFLICT`, so a changed slot
instant is a new key is a new send. Two things follow. First, the overlap
policy has to be _stable_ rather than merely defensible — the shipped code
picked the earlier instant in New York and the later one in London, purely
as an emergent property, and a choice that can wobble mints a fresh key
and re-sends a reminder the user already received. Second, **deploying
this change moves the resolved slot for any fixed-time medication within
`|offset|` hours of a transition**, which costs duplicate notifications if
it lands on or beside a transition day. Deploy inside a clear window; the
same constraint applies to a rollback. `OVERDUE_LOOKBACK_DAYS = 1`, so the
blackout is transition day ±1.

The cost is **one** duplicate only where `notifyRepeatEveryMinutes` is
null. With repeats configured, moving the slot re-bases the whole nag
series: `computeNagIndex` derives its ordinal from `slot + offsetMinutes`,
so every `…:nK` key in the series is fresh, not just the base one. The
extra sends are `offset shift ÷ tick interval`, capped at `maxRepeats + 1`
— with the 30-minute `reminder-tick` cadence and a one-hour shift that is
two, and it was measured at two by simulating both branches' real
`computeOverdueSlot` / `computeNagIndex` / `buildOverdueDedupeKey` across
America/New_York 2026-11-01 and Australia/Sydney 2026-10-04 (five
notifications in steady state, seven across the deploy).

**Two things this does not repair.** Doses already written on a transition
day by the old `parseDateTimeLocal` are an hour out and stay that way
unless corrected by hand; the recoverable population is whatever
`audit_logs` holds for dose updates carrying a `takenAt` diff, since bulk
CSV import bypasses `logDose` and leaves no before-image at all.
Separately, the CSV export writes a local date and a local time with no
offset, so on a fall-back day two genuinely distinct doses an hour apart
serialise identically and the importer's minute-precision dedupe drops the
second. That is a property of the file format, not of this resolver — do
not "fix" the ambiguity policy to chase it.

**Tests carry both retired algorithms inline.** The suite could not tell
the two apart before, so `tests/unit/dst-wall-clock.test.ts` keeps
`legacySinglePass` and `legacyStartOfDay` verbatim and asserts they
disagree. A future simplification back to sample-and-trust cannot pass.
