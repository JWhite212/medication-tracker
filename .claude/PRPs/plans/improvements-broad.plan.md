## Executive verdict

This is already a strong portfolio project. It has a real product domain, full-stack architecture, authentication, database modelling, analytics, exports, reminders, push notification infrastructure, and a coherent UI direction. The app is not just a CRUD demo.

However, I would **not present it as portfolio-final yet**. The next step should be **hardening, correctness, testing, and documentation**, not adding more features. For a high-level professional portfolio project, the goal is to show that you can build software that is maintainable, secure, testable, and honest about its limitations.

Your best positioning is:

> **MedTracker is a full-stack SvelteKit medication tracking application focused on fast dose logging, medication management, adherence analytics, reminders, and exportable personal medication history.**

---

# 1. Highest-priority fixes

## 1. Fix medication ownership validation in dose logging

This is the most important issue I found.

`logDose` currently accepts a `userId` and `medicationId`, inserts a dose log, and only uses `userId` when decrementing inventory. It does **not** first verify that the medication belongs to the current user. The same applies to `logSkippedDose`.

That creates a data isolation risk. If a user somehow obtains another user’s medication ID, they may be able to create a dose log linked to that medication under their own `userId`. Later dose queries join `dose_logs` to `medications`, so this could leak medication metadata.

### Recommended fix

Add an ownership check before inserting any dose log.

```ts
async function assertMedicationBelongsToUser(userId: string, medicationId: string): Promise<void> {
  const [medication] = await db
    .select({ id: medications.id })
    .from(medications)
    .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)))
    .limit(1);

  if (!medication) {
    throw new Error("Medication not found");
  }
}
```

Then call it from:

- `logDose`
- `logSkippedDose`
- Any future bulk-log or import actions

For a stronger database-level fix, consider a composite relationship where `dose_logs` references both `medication_id` and `user_id`, but the application-level check is the fastest essential fix.

---

## 2. Replace `quantity: 0` skipped doses with an explicit status

Skipped doses are currently represented as `quantity: 0` with `notes: "Skipped"`.

That is brittle. Analytics functions currently use `count(*)`, so skipped entries can inflate activity, streaks, dose counts, and adherence calculations.

### Recommended schema change

Add a proper status field:

```ts
status: text("status").notNull().default("taken"),
```

Use values such as:

```ts
type DoseLogStatus = "taken" | "skipped" | "missed";
```

Then update analytics queries to count only actual taken doses:

```ts
.where(
  and(
    eq(doseLogs.userId, userId),
    eq(doseLogs.status, "taken"),
    gte(doseLogs.takenAt, since),
  ),
)
```

This will make your data model far more professional and easier to explain in interviews.

---

## 3. Add reminder deduplication

The reminder job checks for overdue medications and sends email/push notifications when a medication is overdue. The cron endpoint runs those reminder checks behind a `CRON_SECRET`.

The issue: I did not see a persisted “last reminder sent” or reminder event state. That means a scheduled cron could repeatedly notify the user for the same overdue medication.

### Recommended fix

Add a table such as:

```ts
export const reminderEvents = pgTable("reminder_events", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  medicationId: text("medication_id")
    .notNull()
    .references(() => medications.id, { onDelete: "cascade" }),
  reminderType: text("reminder_type").notNull(), // overdue | low_inventory
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  dedupeKey: text("dedupe_key").notNull().unique(),
});
```

A dedupe key could be:

```ts
`${userId}:${medicationId}:overdue:${nextDueAt.toISOString()}`;
```

This gives you a strong portfolio talking point: **idempotent notification design**.

---

## 4. Make analytics medically and behaviourally accurate

The analytics layer is a strong feature, but it needs correctness tightening.

Current analytics includes:

- Daily dose counts
- Streaks
- Adherence
- Hourly distribution
- Day-of-week distribution
- Side-effect stats
- Trend comparison

However:

- It counts rows, not necessarily taken doses.
- It does not distinguish skipped/missed/taken.
- It counts dose logs rather than summing `quantity`.
- Adherence may exceed 100 percent if a user logs more doses than expected.
- Expected dose counts are based on the selected period, not necessarily the medication’s active date range.

### Recommended changes

Use separate metrics:

| Metric             | Meaning                                                   |
| ------------------ | --------------------------------------------------------- |
| `takenDoseEvents`  | Number of dose log events with `status = "taken"`         |
| `takenQuantity`    | Sum of actual quantity taken                              |
| `skippedCount`     | Number of skipped scheduled doses                         |
| `missedCount`      | Number of expected but unresolved doses                   |
| `adherencePercent` | Taken scheduled doses divided by expected scheduled doses |
| `overusePercent`   | Taken doses above expected, if relevant                   |

For display, cap adherence visually at 100 percent, but show overuse separately if needed.

---

# 2. Authentication and security improvements

## 5. Use environment-aware secure cookies

OAuth callback cookies currently use `secure: true`. The pending 2FA cookie also uses `secure: true`.

That is correct for production HTTPS, but it can break local development over plain HTTP.

Lucia already handles this properly using `secure: !dev`.

### Recommended fix

Use the same pattern:

```ts
import { dev } from "$app/environment";

const cookieOpts = {
  path: "/",
  httpOnly: true,
  secure: !dev,
  maxAge: 600,
  sameSite: "lax" as const,
};
```

Apply this to:

- OAuth state cookies
- Google code verifier cookie
- Pending 2FA cookie

---

## 6. Encrypt TOTP secrets at rest

The schema has `totpSecret` as plain text. The `.env.example` includes `ENCRYPTION_KEY`, but the TOTP implementation stores and verifies the raw secret directly.

For a health-adjacent app, this is worth fixing.

### Recommendation

Add a small encryption utility using Node’s `crypto` module and AES-GCM.

Store:

- encrypted secret
- IV
- auth tag

Or store a single encoded payload.

This gives you another strong talking point: **sensitive secret handling and encryption at rest**.

---

## 7. Require re-authentication for sensitive actions

The README/design claims sensitive operations require re-authentication, but implementation is inconsistent. Password change requires the current password, which is good. But enabling 2FA does not appear to require recent password confirmation.

### Recommended sensitive actions

Require recent re-authentication for:

- Enabling 2FA
- Disabling 2FA
- Changing password
- Deleting account
- Exporting full medication history
- Revoking all sessions

Implement this using a `reauthenticated_at` signed cookie or a short-lived server-side token.

---

## 8. Invalidate sessions after password reset

The password reset flow updates the user’s password and deletes the reset token.

It should also invalidate existing sessions for that user. Otherwise, a compromised session may remain valid after a password reset.

### Recommended fix

After updating the password:

```ts
await db.delete(sessions).where(eq(sessions.userId, record.userId));
```

Or use Lucia session invalidation if preferred.

---

# 3. Product and domain improvements

## 9. Improve scheduling beyond “every N hours”

The current scheduling model is interval-based, using `scheduleIntervalHours`. Schedule slots are computed by projecting forward from the last dose or day start.

That is useful for some medications, but many real medication schedules are fixed-time based:

- Once daily at 08:00
- Twice daily at 08:00 and 20:00
- With food
- Before bed
- Specific days of week
- PRN/as needed

### Recommended model

Add a `medication_schedules` table:

```ts
export const medicationSchedules = pgTable("medication_schedules", {
  id: text("id").primaryKey(),
  medicationId: text("medication_id")
    .notNull()
    .references(() => medications.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  scheduleKind: text("schedule_kind").notNull(), // fixed_time | interval | prn
  timeOfDay: text("time_of_day"), // HH:mm for fixed_time
  intervalHours: numeric("interval_hours"),
  daysOfWeek: jsonb("days_of_week").$type<number[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

This would significantly increase the real-world quality of the app.

---

## 10. Add a clear medical safety disclaimer

The app deals with medication tracking. It should clearly state that it is a tracking tool, not medical advice.

The interaction warning already uses an advisory disclaimer in the medication form. Expand that principle across the application.

Add a disclaimer to:

- Landing page
- Register/onboarding flow
- Medication creation screen
- Analytics/export pages
- README

Suggested wording:

> MedTracker is a personal tracking tool. It does not provide medical advice, dosage recommendations, diagnosis, or emergency guidance. Always follow advice from a qualified healthcare professional.

This protects the project and makes it look more professionally considered.

---

## 11. Make drug interaction checks clearly experimental

The app has an `/api/interactions` endpoint that checks against OpenFDA and compares returned interaction text against existing medication names.

This is a good idea, but it is not clinically reliable enough to present as a safety feature.

### Recommendation

Rename it in the UI to something like:

> Experimental interaction notice

And add:

> This check may miss interactions and may produce false positives. It is not a substitute for professional medical advice.

Also add:

- Timeout with `AbortController`
- Basic caching
- URL construction using `URLSearchParams`
- Tests for unavailable OpenFDA responses
- A feature flag to disable it

---

# 4. Performance and reliability improvements

## 12. Tighten dashboard query correctness

The dashboard currently uses `Promise.all` to load medications, today’s doses, and last dose per medication, which is good.

However, `getLastDosePerMedication` currently considers all dose logs, including skipped logs if represented as `quantity: 0`.

Once you add `status`, filter it:

```ts
.where(
  and(
    eq(doseLogs.userId, userId),
    eq(doseLogs.status, "taken"),
  ),
)
```

---

## 13. Improve export safety

The export route supports PDF and CSV and validates the date range.

The CSV generator escapes commas and quotes, but should also handle:

- Newlines
- Formula injection cells beginning with `=`, `+`, `-`, or `@`
- Consistent timezone/date formatting
- User’s preferred date/time format

Current CSV export builds rows manually.

### Recommended CSV escaping

```ts
function escapeCsvCell(value: unknown): string {
  const raw = String(value ?? "");
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  const escaped = safe.replace(/"/g, '""');

  if (/[",\n\r]/.test(escaped)) {
    return `"${escaped}"`;
  }

  return escaped;
}
```

This is the type of small security detail that stands out in a portfolio review.

---

## 14. Improve PDF reports

The PDF export is functional but basic. It creates a simple report title and dose log.

For portfolio quality, improve the report to include:

- User name
- Date range in the user’s timezone
- Medication summary
- Dose log table
- Adherence summary
- Side-effect summary
- Generated-at timestamp
- Medical disclaimer
- Better layout and pagination

This would make the export feature feel genuinely finished.

---

## 15. Respect user time-format preferences everywhere

Preferences include `timeFormat`, `dateFormat`, `uiDensity`, reduced motion, reminder settings, page size, heatmap period, and export format.

But `formatTime` currently hardcodes `en-US` and `hour12: true`.

### Recommendation

Create one formatting layer:

```ts
export function formatUserTime(date: Date, timezone: string, timeFormat: "12h" | "24h"): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: timeFormat === "12h",
    timeZone: timezone,
  }).format(date);
}
```

Use it across:

- Dashboard
- Timeline
- History
- Analytics
- PDF export
- CSV export
- Reminder emails

---

# 5. Testing improvements

## Current state

Testing is present, which is good. `package.json` includes Vitest and Playwright scripts.

Existing unit tests cover:

- Time utilities and timing status
- Analytics calculation helpers
- Medication style utilities
- Validation schemas

That is a good foundation, but it is not enough for a professional-grade portfolio project.

## Add these tests next

| Priority | Test type            | What to cover                                                   |
| -------- | -------------------- | --------------------------------------------------------------- |
| High     | Server unit tests    | `logDose`, `deleteDose`, `updateDose`, ownership checks         |
| High     | Analytics tests      | Skipped vs taken doses, quantity handling, adherence edge cases |
| High     | Auth tests           | Register, login, password reset token expiry, 2FA verification  |
| High     | E2E tests            | Register, add medication, log dose, edit dose, export CSV       |
| Medium   | Component tests      | `MedicationForm`, `QuickLogBar`, `TimelineEntry`                |
| Medium   | Accessibility tests  | Keyboard navigation, modal focus trap, colour contrast          |
| Medium   | Service worker tests | Offline fallback and push click behaviour                       |

For portfolio presentation, add coverage reporting. You do not need 100 percent coverage. Aim for **70 to 80 percent meaningful coverage** and highlight the critical tested paths.

---

# 6. Repository quality and CI/CD

## 16. Add CI immediately

I did not see evidence of a GitHub Actions workflow. You already have scripts for checking, unit testing, and E2E testing in `package.json`.

Add `.github/workflows/ci.yml`:

```yml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Svelte check
        run: npm run check

      - name: Unit tests
        run: npm test

      - name: Build
        run: npm run build
```

This is one of the quickest ways to make the project look professional.

---

## 17. Add linting and formatting

The project has strict TypeScript enabled. That is good.

But for portfolio quality, add:

- ESLint
- Prettier
- Prettier Svelte plugin
- `lint` script
- `format` script
- `format:check` script

Suggested scripts:

```json
{
  "scripts": {
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  }
}
```

Then run all of these in CI:

```yml
- name: Lint
  run: npm run lint

- name: Format check
  run: npm run format:check
```

---

## 18. Add database migrations to the repo

The Drizzle config points to `./drizzle` as the migration output directory.

For a serious project, version-controlled migrations matter. Avoid relying only on `drizzle-kit push` long-term.

Recommended scripts:

```json
{
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:push": "drizzle-kit push",
    "db:studio": "drizzle-kit studio"
  }
}
```

Also add a short `docs/database.md` explaining:

- Tables
- Relationships
- Indexes
- Migration workflow
- Local setup
- Seed data

---

# 7. UX and accessibility recommendations

## 19. Fix keyboard shortcuts

`KeyboardShortcuts.svelte` supports quick logging medications by number, but `(app)/+layout.svelte` renders it without passing medications.

That means the `1-9` quick-log shortcut likely does nothing unless medications are passed elsewhere.

### Recommendation

Either:

1. Move `KeyboardShortcuts` into the dashboard and pass `data.medications`, or
2. Use Svelte context/shared state for dashboard-specific shortcuts, or
3. Remove the `1-9` shortcut from the global help overlay.

Do not advertise a shortcut that does not work.

---

## 20. Add proper empty-state assets

You already generated relevant assets. Use them in:

- No medications state
- No dose history state
- No analytics data state
- Export empty result state
- Reminder setup onboarding

The current dashboard empty medication state uses `OnboardingWelcome`, and no-dose state is plain text. You can make this feel much more polished by using the generated illustrations.

---

## 21. Add accessibility audits

The design system has reduced motion and high contrast support, which is good.

Next steps:

- Add `axe-core` or Playwright accessibility checks.
- Ensure modal focus trapping.
- Ensure Escape closes modals.
- Ensure colour-coded medication indicators always have text labels.
- Ensure all icon-only buttons have `aria-label`.
- Test keyboard-only dose logging.
- Test reduced motion mode.

This is especially important for a medication app, where accessibility is not optional.

---

# 8. Documentation and portfolio presentation

## 22. Make the README more honest and more impressive

The README is already comprehensive. It describes features, stack, architecture, setup, testing, project structure, design system, deployment, and roadmap.

The risk is that it may read as if every listed feature is fully production-ready. For a portfolio project, honesty is better.

### Recommended README structure

Use this structure:

```md
# MedTracker

## Overview

## Live Demo

## Screenshots

## Core Features

## Technical Highlights

## Architecture

## Security and Privacy

## Database Design

## Testing Strategy

## Local Development

## Environment Variables

## Known Limitations

## Roadmap

## What I Learned
```

Add a **Feature Status** table:

| Feature             | Status                                                  |
| ------------------- | ------------------------------------------------------- |
| Email/password auth | Complete                                                |
| OAuth               | Implemented, needs production callback verification     |
| 2FA                 | Implemented, encryption/re-auth improvements planned    |
| Dose logging        | Complete, ownership hardening required                  |
| Analytics           | Implemented, skipped-dose accuracy improvements planned |
| Reminders           | Implemented, deduplication planned                      |
| PDF/CSV export      | Implemented, formatting/security improvements planned   |
| Push notifications  | Implemented, UX/unsubscribe flow planned                |

That looks more professional than pretending everything is finished.

---

## 23. Add architecture decision records

Create:

```txt
docs/adr/
  0001-use-sveltekit.md
  0002-use-drizzle-and-postgres.md
  0003-server-first-form-actions.md
  0004-lucia-auth.md
  0005-reminder-deduplication.md
```

Each ADR should explain:

- Context
- Decision
- Alternatives considered
- Consequences

This is a high-impact portfolio improvement because it shows engineering judgement.

---

## 24. Add a portfolio case study page

Your portfolio page should not just say “I built a medication tracker”.

Structure it like this:

1. **Problem**
   - People need a quick way to log and review medication usage.

2. **Solution**
   - Server-first SvelteKit app with medication CRUD, quick logging, analytics, reminders, and exports.

3. **Technical challenges**
   - Authentication
   - User-scoped data
   - Timezone-safe scheduling
   - Reminder deduplication
   - Export generation

4. **Architecture**
   - SvelteKit loaders/actions
   - Drizzle ORM
   - Postgres schema
   - Lucia sessions

5. **Quality**
   - TypeScript strict mode
   - Unit tests
   - E2E tests
   - CI

6. **What I would improve next**
   - Native mobile wrapper
   - More advanced scheduling
   - Better medical safety checks

This is exactly the kind of narrative employers like.

---

# 9. Suggested implementation roadmap

## Phase 1: Hardening, 1 to 2 days

Do these first:

1. Add medication ownership checks in dose logging.
2. Add dose `status`.
3. Update analytics to ignore skipped/missed entries.
4. Add reminder deduplication.
5. Fix secure cookies for local development.
6. Update README feature status.

## Phase 2: Professional repository quality, 1 day

1. Add GitHub Actions CI.
2. Add ESLint and Prettier.
3. Add coverage reporting.
4. Add database migration scripts.
5. Add `.env.example` missing values such as `EMAIL_FROM` and `PUBLIC_BASE_URL`.

The email module uses `EMAIL_FROM` and `PUBLIC_BASE_URL`, but `.env.example` does not document both of these clearly.

## Phase 3: Testing, 2 to 4 days

1. Add server tests for `doses.ts`.
2. Add analytics tests for skipped/taken/missed behaviour.
3. Add Playwright E2E tests:
   - Register
   - Add medication
   - Log dose
   - Edit dose
   - View analytics
   - Export CSV

4. Add accessibility tests.

## Phase 4: Portfolio polish, 1 to 2 days

1. Add polished screenshots.
2. Add generated app icons and empty-state assets.
3. Add case study.
4. Add architecture diagram.
5. Add demo account or seed script.
6. Add deployment notes.

---

# 10. Strong recommendation

Do **not** add major new features yet.

The project already has enough scope. Adding more features before fixing correctness and documentation will make it look less professional, not more professional.

Your highest-value portfolio improvements are:

1. **Data isolation and security hardening**
2. **Accurate medication/dose modelling**
3. **Reminder deduplication**
4. **CI, linting, formatting, and tests**
5. **Clear README and case study**
6. **Polished screenshots and live demo**

Once those are done, this becomes a genuinely strong full-stack portfolio project rather than just a promising app.
