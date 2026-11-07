# Deep-refactor audit and cleanup train — 2026-11-06/07

**Tree audited:** `c790efa` (main, 2026-11-06). **Method:** the `deep-refactor` skill: audit, report, ticket, drain.

- **Audit:** four read-only area audits (server domain; client libs; routes and components; build, deps, config and tests).
- **Verification:** every defect got an adversarial skeptic told to refute it. Most also got a reproducer, which wrote a failing test in an isolated worktree.
- **Re-sweeps:** fresh-lens sweeps were repeated (four rounds) until the share of new candidates that survived verification fell to a small low-severity tail. That stopping point is a judgement call; the last round still produced confirmed findings, and they are listed below as the open tail.
- **Review:** every PR written by an implementer agent got an independent adversarial review before merge. The review blocked two of them on real regressions (#210, #229), and both were fixed on the branch.

Every count below is a measurement with its command and the commit it was taken at.

## Baseline and end state

| Gate                         | `c790efa` (start)         | `d40067d` (end, all cars merged)               | Command                 |
| ---------------------------- | ------------------------- | ---------------------------------------------- | ----------------------- |
| unit tests                   | 4192 passed / 247 files   | 4441 passed / 293 files                        | `npx vitest run`        |
| type check                   | 0 errors, 26 warnings     | 0 errors, 21 warnings                          | `npm run check`         |
| lint                         | 0 errors, 98 warnings     | 0 errors, 74 warnings                          | `npm run lint`          |
| format                       | clean                     | clean                                          | `npm run format:check`  |
| build                        | —                         | succeeds (needs `DATABASE_URL`; see CLAUDE.md) | `npm run build`         |
| coverage (st / br / fn / ln) | 94.8 / 84.6 / 91.3 / 95.3 | 95.2 / 85.4 / 93.1 / 95.8                      | `npm run test:coverage` |

Coverage floors were raised from 30/25/25.5/30 to 90/80/87/90 in #207. Sizes at the start (`git show c790efa:<f> | wc -l`): `server/doses.ts` 1129, `utils/schedule.ts` 835, `utils/time.ts` 793, `utils/validation.ts` 782, `server/analytics.ts` 768.

## Architecture verdict

**Sound.** The app is server-first SvelteKit with a clean dependency direction. Client-reachable code reaches `$lib/server` only through `import type` (`grep -rn '\$lib/server' src/lib/{components,utils,dashboard,appearance,medications}`). The single-owner modules are real, and source-scan tests guard them.

The debt is not structural. It is drift between doors that answer the same question: timezone validity, lifecycle clipping, audit coverage, rate-limit constants, quantity bounds, session rotation. On top of that, a handful of writes did not draw their transaction around the whole change. No file split was justified by the evidence, so **the train has no structural ticket**.

## Deliberate — do not fix

These come from `CLAUDE.md` or in-code notes, and the verifiers re-confirmed each one:

- the single-owner source-scan guards;
- the verbatim legacy slot-matcher oracle;
- the bespoke fake in `reminders.test.ts`;
- the `appearance/` registry/schema split;
- the dashboard-vs-analytics divergence;
- `adherence.ts`'s 1/day fallback;
- `legacyRate`;
- `analytics/page-data.ts`'s own `dateParamSchema`;
- `computeOverdueSlot`'s own look-back;
- the `state_referenced_locally` warnings, which are deliberate seeds (re-found and rejected three times);
- the per-guard `walk()` copies;
- W1, the analytics window.

## Ledger — Done (merged, CI `validate` green, reviewed)

| PR   | IDs                        | What changed                                                                                                       |
| ---- | -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| #193 | UT-1                       | Heatmap anchor built from parts, not en-CA `format()` (a reordering browser ICU threw a RangeError)                |
| #194 | RTE-2                      | Default `UTC` accepted by every timezone door, owned by `utils/timezones.ts`                                       |
| #195 | SRV-2/RTE-3, SRV-3         | Archive/unarchive are idempotent transitions with the audit row in the same transaction                            |
| #196 | SRV-1, RTE-4               | Reorder renumbers tied rows under lock, scoped by user; the action refuses no-op moves                             |
| #197 | SRV-4                      | Overdue reminders clip slots to `startedAt`/`endedAt` (2 fixture files enumerated)                                 |
| #198 | SRV-5                      | Headline adherence averages only medications that expected doses                                                   |
| #199 | SRV-7                      | Imported doses record `inventoryApplied = 0` (a delete used to mint stock)                                         |
| #200 | SRV-9                      | One medication's failure no longer cancels the rest of the reminder tick                                           |
| #201 | RTE-13                     | Malformed push JSON returns 400 through `readJson`                                                                 |
| #202 | R1                         | **OAuth redirect URI is absolute, from `PUBLIC_BASE_URL`; before this, OAuth sign-in could never complete**        |
| #203 | RTE-1                      | 2FA setup is refused while 2FA is on                                                                               |
| #204 | N8                         | Expired sessions are no longer listed as active, and retention purges them                                         |
| #205 | SRV-13                     | One owner for the CSV cell escaper                                                                                 |
| #206 | RTE-7, INFRA-6/7/8, SRV-12 | Dead rate-limit constants and unused re-exports removed                                                            |
| #207 | INFRA-2/3/5                | Dependabot config is real; `.env.example` and docs tell the truth; coverage floors raised                          |
| #208 | SRV-6, N20                 | Daily adherence is aggregated per medication; presets end on today                                                 |
| #209 | SRV-8                      | `medications.updatedAt` is bumped on stock changes and reorders, so delta sync sees them                           |
| #210 | N30                        | Command failures are logged and redacted; the review fix gives `MedicationOwnershipError` a `name`, plus a guard   |
| #211 | N7                         | A wrong 2FA code keeps the QR                                                                                      |
| #212 | N13                        | Push endpoint allowlist matches on the parsed host                                                                 |
| #214 | UT-2                       | Unrepresentable schedules are shown read-only and round-trip unchanged                                             |
| #215 | R14, R15                   | Notification timing selects keep custom values; toggling keeps in-visit choices                                    |
| #216 | R19                        | Toasts clear the sticky edit toolbar                                                                               |
| #217 | UT-3                       | Logged dose quantity capped at 10                                                                                  |
| #218 | R9                         | OAuth re-sign-in ends the previous session (replaces #213, squashed for gitleaks)                                  |
| #227 | N9, N28                    | /log offers archived medications; distinct "No more doses" state past the last page                                |
| #228 | N10–N12                    | Onboarding h1 and focus; the analytics filter's Clear keeps focus                                                  |
| #229 | R16, R18, R20              | Schedule-row focus and names, "?" closes the shortcuts overlay, single side-effects group (review fix: a held "?") |
| #230 | N19                        | A manual adjustment can start tracking at 0                                                                        |
| #231 | N21–N23, RTE-11            | Export times and windows in civil time                                                                             |
| #232 | N27                        | Analytics custom From/To range is labelled honestly                                                                |
| #233 | N25, N26                   | Push "active" is judged by the server; the card refreshes after a change                                           |
| #234 | R5                         | A reset link opened while signed in is forwarded                                                                   |
| #235 | R11–R13, N29               | A backup re-imports into the account that made it                                                                  |
| #244 | N1–N3                      | Dose audit diffs redact note text and drop `updatedAt`; the medication before-image is read under lock             |
| #245 | N5, N17                    | /api/v1 wipe redeems the reauth token inside the wipe transaction; commands route gets `maxDuration`               |
| #246 | N6                         | Bulk medication deletes lock in ascending id                                                                       |
| #247 | R4, R9 (2FA door)          | Cancelling OAuth consent no longer loops; 2FA completion rotates the session                                       |
| #248 | RTE-9                      | One owner for medication-form parsing                                                                              |
| #249 | UT-5/7/9, SRV-11/14        | Dead code and false comments removed                                                                               |
| #250 | INFRA-1/4/12/13/14, N16    | E2E db helper, dependency policy, dead script, database and API docs, test leftovers                               |
| #251 | UT-6, INFRA-10             | Binding test from the dashboard composer to the proven matcher; phantom deps declared                              |

## Ledger — not shipped, with reason

| ID                                                                                                                    | Status                         | Reason                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RTE-5 (audit all 10 sign-in doors)                                                                                    | Rejected by owner (2026-11-07) | Auth change not approved in the escalation batch                                                                                                                           |
| R6, R7, R8, R3 (2FA and password hardening, raw session ids)                                                          | Rejected by owner              | Not approved                                                                                                                                                               |
| N24 (unsubscribe push on sign-out)                                                                                    | Rejected by owner              | Not approved                                                                                                                                                               |
| N14 (purge `api_commands`)                                                                                            | Rejected by owner              | Documented idempotency window; not approved                                                                                                                                |
| N31 (sync cursor stamping)                                                                                            | Rejected by owner              | Documented `/api/v1` cursor semantics; not approved                                                                                                                        |
| R2 (case-insensitive email)                                                                                           | Rejected by owner              | Needs a data migration and collision resolution                                                                                                                            |
| R10 (backups outgrow the 4 MiB import cap)                                                                            | Blocked                        | Changing the export format is a wire change and needs a decision                                                                                                           |
| Legacy `takenAt` Skip removal (UT-4/RTE-6/SRV-10/INFRA-9)                                                             | Blocked                        | 7 tests pin it, and plain deletion would silently make a takenAt-only POST mean "skip at now"; needs a test-edit-sanctioned ticket                                         |
| INFRA-11 (template Neon branch workflow)                                                                              | Proposed, owner decision       | Fails every PR (422) once the branch quota fills; non-required and its output is unused                                                                                    |
| RTE-8 (hand-written 429 bodies), RTE-10 (email-token minting written twice), UT-8 (value domains written three times) | Proposed                       | Safe refactors not drained this pass                                                                                                                                       |
| Review follow-ups                                                                                                     | Proposed                       | Medication `notes` are still diffed verbatim (#244); the account-deletion cascade lock order is unverified (#246); no guard yet that every (app) page renders an h1 (#228) |
| N15, N18, R17, R21–R26, and the earlier rejects                                                                       | Rejected                       | Refuted by verification (wire shape documented, overwrite semantics, unmeasured perf)                                                                                      |

## Open tail (confirmed in round 4, not yet ticketed)

These are low severity unless marked.

- `handleError` logs 404s as crashes.
- The public demo account has no write guard and no automated reset (product/security; needs an owner decision).
- The `peekLimit` comment overstates the lockout protection.
- `notificationclick` matches clients by substring.
- `safeNotificationUrl` accepts `/\evil.com`.
- The analytics scrubber misses reset and verify tokens in the URL.
- The OG image is an SVG.
- Light-scheme `theme-color`.
- Account deletion's audit row is cascaded away.
- `revokeOtherSessions` makes N round trips.
- Presets doc comment.

## Lessons

- **A test that runs only on the server's ICU cannot catch a locale defect in client code.** Stub `Intl.DateTimeFormat` with a conforming subclass that reorders fields.
- **`Intl.supportedValuesOf("timeZone")` omits `UTC`, so it is not a validator.**
- **A frozen-clock PGlite fixture with `startedAt = now()` means "started this instant".** Lifecycle-aware code then clips every earlier slot.
- **An allowlist keyed on `e.name` needs every listed class to set `this.name`.** Guard it by constructing each class.
- **gitleaks scans every commit in a PR.** A flagged fixture string cannot be fixed by a later commit without a force-push, so open a squashed branch instead.
- **Independent review of agent-written PRs pays.** 2 of 26 had real regressions that their own mutation-proven tests did not cover.
