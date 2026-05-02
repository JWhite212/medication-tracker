# Master Implementation Plan: Themes E + A + F

## Overview

Combined execution plan for the remaining 3 themes, ordered by dependency and risk (smallest first). Theme C (Code Quality) was already implemented.

**Total scope**: ~36 files, 17 tasks across 3 themes.

---

## Execution Order

### Phase 1: Theme E — Unfinished Features (9 tasks)

**Why first**: Completes half-built infrastructure that A and F depend on. Inventory alerts use the cron. Sort order is foundational. Email verification and 2FA are security features that should be in place early.

| #   | Task                                           | Complexity | Files                                              |
| --- | ---------------------------------------------- | ---------- | -------------------------------------------------- |
| E1  | Low inventory email alerts                     | Small      | reminders.ts, email.ts, cron endpoint              |
| E2  | Medication sort order UI                       | Small      | medications.ts, medications page (svelte + server) |
| E3  | Email verification — schema + send on register | Medium     | schema.ts, register server                         |
| E4  | Email verification — verify endpoint           | Small      | auth/verify (server + svelte)                      |
| E5  | Install 2FA dependencies                       | Trivial    | package.json                                       |
| E6  | TOTP utility module                            | Small      | auth/totp.ts                                       |
| E7  | 2FA server actions                             | Medium     | security page server                               |
| E8  | 2FA settings UI                                | Medium     | security page svelte                               |
| E9  | 2FA login verification                         | Medium     | login server, auth/2fa (server + svelte)           |

**Checkpoint**: `npm test` passes, `npx drizzle-kit generate && push` for email verification tokens table.

### Phase 2: Theme A — Missing Product Features (3 tasks)

**Why second**: Adds user-facing features on stable infrastructure. Unarchive, skip, and interactions are independent of each other.

| #   | Task                             | Complexity | Files                                                                           |
| --- | -------------------------------- | ---------- | ------------------------------------------------------------------------------- |
| A1  | Unarchive medications            | Small      | medications.ts, [id] page (server + svelte), medications page (server + svelte) |
| A2  | Skip/dismiss overdue doses       | Small      | doses.ts, dashboard (server + svelte)                                           |
| A3  | Drug interaction check (OpenFDA) | Medium     | interactions.ts (new), MedicationForm, medications/new server                   |

**Checkpoint**: `npm test` passes, type-check clean.

### Phase 3: Theme F — Analytics & Insights (5 tasks)

**Why last**: Builds on all prior work. Side effects from doses logged via A2 skip feature. Analytics benefits from the full feature set being in place.

| #   | Task                                  | Complexity | Files                            |
| --- | ------------------------------------- | ---------- | -------------------------------- |
| F1  | Custom date range picker on analytics | Small      | analytics page (server + svelte) |
| F2  | Side effect analytics functions       | Medium     | analytics.ts                     |
| F3  | Side effect UI section                | Small      | analytics page svelte            |
| F4  | Enhanced PDF export with side effects | Small      | export-pdf.ts                    |
| F5  | Enhanced CSV export with side effects | Small      | export-csv.ts, export API        |

**Checkpoint**: `npm test` passes, type-check clean, export files include side effects.

---

## Dependencies Between Phases

```
Phase 1 (E) --> Phase 2 (A) --> Phase 3 (F)
  |                                    |
  +- email verification tokens table   +- side effect data from logged doses
  +- cron infrastructure for alerts    +- DateRange already supported
  +- 2FA must be before new features   +- export functions extended
```

- E1 (inventory alerts) must complete before A3 (interactions) since both touch server modules
- E3-E4 (email verification) creates the token pattern reused conceptually in 2FA
- A2 (skip doses) creates quantity=0 entries that F2 (side effect analytics) should handle
- F1-F5 are independent of each other but all depend on E and A being stable

---

## New Dependencies to Install

| Phase | Package         | Type          | Purpose                          |
| ----- | --------------- | ------------- | -------------------------------- |
| E5    | `@oslojs/otp`   | dependency    | TOTP generation and verification |
| E5    | `qrcode`        | dependency    | QR code data URL for 2FA setup   |
| E5    | `@types/qrcode` | devDependency | TypeScript types for qrcode      |

---

## Database Migrations Required

| Phase | Table                       | Action                                               |
| ----- | --------------------------- | ---------------------------------------------------- |
| E3    | `email_verification_tokens` | CREATE — id, userId, tokenHash, expiresAt, createdAt |

No other schema changes needed — all other features use existing columns.

---

## Files Changed (Complete List)

### Theme E (18 files)

| File                                                 | Action                                |
| ---------------------------------------------------- | ------------------------------------- |
| `src/lib/server/reminders.ts`                        | UPDATE — checkLowInventoryMedications |
| `src/lib/server/email.ts`                            | UPDATE — sendLowInventoryEmail        |
| `src/routes/api/cron/reminders/+server.ts`           | UPDATE — call inventory check         |
| `src/routes/(app)/medications/+page.svelte`          | UPDATE — sort buttons                 |
| `src/routes/(app)/medications/+page.server.ts`       | UPDATE — reorder action               |
| `src/lib/server/medications.ts`                      | UPDATE — swapSortOrder                |
| `src/lib/server/db/schema.ts`                        | UPDATE — emailVerificationTokens      |
| `src/routes/auth/register/+page.server.ts`           | UPDATE — send verification            |
| `src/routes/auth/verify/+page.server.ts`             | CREATE                                |
| `src/routes/auth/verify/+page.svelte`                | CREATE                                |
| `src/lib/server/auth/totp.ts`                        | CREATE                                |
| `src/routes/(app)/settings/security/+page.server.ts` | UPDATE — 2FA actions                  |
| `src/routes/(app)/settings/security/+page.svelte`    | UPDATE — 2FA UI                       |
| `src/routes/auth/2fa/+page.server.ts`                | CREATE                                |
| `src/routes/auth/2fa/+page.svelte`                   | CREATE                                |
| `src/routes/auth/login/+page.server.ts`              | UPDATE — 2FA redirect                 |
| `src/lib/utils/validation.ts`                        | UPDATE — totpCodeSchema               |
| `package.json`                                       | UPDATE — 2FA deps                     |

### Theme A (10 files)

| File                                                | Action                           |
| --------------------------------------------------- | -------------------------------- |
| `src/lib/server/medications.ts`                     | UPDATE — unarchive + getArchived |
| `src/routes/(app)/medications/[id]/+page.server.ts` | UPDATE — unarchive action        |
| `src/routes/(app)/medications/[id]/+page.svelte`    | UPDATE — unarchive button        |
| `src/routes/(app)/medications/+page.svelte`         | UPDATE — archived section        |
| `src/routes/(app)/medications/+page.server.ts`      | UPDATE — load archived           |
| `src/routes/(app)/dashboard/+page.svelte`           | UPDATE — skip button             |
| `src/routes/(app)/dashboard/+page.server.ts`        | UPDATE — skipDose action         |
| `src/lib/server/doses.ts`                           | UPDATE — logSkippedDose          |
| `src/lib/server/interactions.ts`                    | CREATE                           |
| `src/lib/components/MedicationForm.svelte`          | UPDATE — interaction warnings    |

### Theme F (8 files)

| File                                          | Action                                   |
| --------------------------------------------- | ---------------------------------------- |
| `src/routes/(app)/analytics/+page.svelte`     | UPDATE — date picker + side effects      |
| `src/routes/(app)/analytics/+page.server.ts`  | UPDATE — custom range + side effect data |
| `src/lib/server/analytics.ts`                 | UPDATE — getSideEffectStats              |
| `src/lib/server/export-pdf.ts`                | UPDATE — side effects column             |
| `src/lib/server/export-csv.ts`                | UPDATE — side effects column             |
| `src/routes/api/export/+server.ts`            | UPDATE — pass side effects               |
| `src/lib/server/doses.ts`                     | UPDATE — getDosesWithSideEffects         |
| `src/routes/(app)/settings/data/+page.svelte` | UPDATE — date range inputs               |

---

## Validation Strategy

After each phase:

1. `npm test` — all 101+ tests pass
2. `npx svelte-check` — zero new type errors
3. Manual smoke test of the features added

After all phases: 4. `npx drizzle-kit generate && npx drizzle-kit push` — migration applied 5. Full E2E smoke test 6. Code review

---

## Risk Summary

| Risk                         | Phase | Mitigation                                     |
| ---------------------------- | ----- | ---------------------------------------------- |
| @oslojs/otp API mismatch     | E6    | Verify during implementation, adjust imports   |
| OpenFDA rate limiting        | A3    | Graceful degradation, try/catch                |
| Inventory alert spam         | E1    | Document; add "last alerted" timestamp later   |
| 2FA cookie handoff timing    | E9    | 5-minute TTL, user can retry                   |
| JSONB processing performance | F2    | JS processing is fast for typical data volumes |

---

## Source Plans

- Theme E: `.claude/PRPs/plans/unfinished-features.plan.md`
- Theme A: `.claude/PRPs/plans/missing-product-features.plan.md`
- Theme F: `.claude/PRPs/plans/analytics-insights.plan.md`
