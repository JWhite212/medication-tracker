# Medication Tracker — Design Spec

## Overview

A web-based personal medication tracker that lets users log doses of pre-configured medications and view a live timeline of what they've taken. Dual-purpose: daily personal use and portfolio showcase piece.

**Core interaction:** Tap a medication to log a dose instantly. The timeline shows each dose with the time taken and a live "time since" counter that ticks up in real time.

## Tech Stack

| Layer      | Technology                                |
| ---------- | ----------------------------------------- |
| Framework  | SvelteKit (Svelte 5) + TypeScript         |
| Styling    | Tailwind CSS v4                           |
| Database   | PostgreSQL via Neon (serverless)          |
| ORM        | Drizzle ORM + Neon serverless driver      |
| Auth       | Lucia v3 + Arctic (Google & GitHub OAuth) |
| Hosting    | Vercel                                    |
| Email      | Resend                                    |
| Validation | Zod                                       |

## Architecture

**Server-first with targeted reactivity.** Pages load data via `+page.server.ts` loaders, mutations go through SvelteKit form actions. Live "time since" counters run client-side using Svelte's `$effect` + `setInterval` — pure clock math from server-provided timestamps. No WebSockets.

## Data Model

### User

| Column             | Type              | Notes                       |
| ------------------ | ----------------- | --------------------------- |
| id                 | text (CUID2)      | PK                          |
| email              | text              | unique, not null            |
| name               | text              | not null                    |
| password_hash      | text              | nullable (OAuth-only users) |
| avatar_url         | text              | nullable                    |
| timezone           | text              | default 'UTC'               |
| totp_secret        | text              | nullable, encrypted at rest |
| two_factor_enabled | boolean           | default false               |
| email_verified     | boolean           | default false               |
| created_at         | timestamp with tz | default now()               |
| updated_at         | timestamp with tz | default now()               |

### Session (Lucia-managed)

| Column     | Type              | Notes     |
| ---------- | ----------------- | --------- |
| id         | text              | PK        |
| user_id    | text              | FK → User |
| expires_at | timestamp with tz | not null  |

### OAuthAccount

| Column           | Type | Notes                            |
| ---------------- | ---- | -------------------------------- |
| provider         | text | 'google' or 'github'             |
| provider_user_id | text | not null                         |
| user_id          | text | FK → User                        |
|                  |      | PK: (provider, provider_user_id) |

### Medication

| Column                    | Type              | Notes                                              |
| ------------------------- | ----------------- | -------------------------------------------------- |
| id                        | text (CUID2)      | PK                                                 |
| user_id                   | text              | FK → User, not null                                |
| name                      | text              | not null                                           |
| dosage_amount             | numeric           | not null (e.g. 200)                                |
| dosage_unit               | text              | not null (mg, IU, ml, mcg, etc.)                   |
| form                      | text              | not null (tablet, capsule, liquid, softgel, etc.)  |
| category                  | text              | not null (prescription, otc, supplement)           |
| colour                    | text              | not null, hex code (e.g. '#6366f1')                |
| notes                     | text              | nullable                                           |
| schedule_interval_hours   | numeric           | nullable (e.g. 8 = every 8 hours, 24 = once daily) |
| inventory_count           | integer           | nullable                                           |
| inventory_alert_threshold | integer           | nullable                                           |
| sort_order                | integer           | default 0                                          |
| is_archived               | boolean           | default false                                      |
| created_at                | timestamp with tz | default now()                                      |
| updated_at                | timestamp with tz | default now()                                      |

### DoseLog

| Column        | Type              | Notes                                             |
| ------------- | ----------------- | ------------------------------------------------- |
| id            | text (CUID2)      | PK                                                |
| user_id       | text              | FK → User, not null                               |
| medication_id | text              | FK → Medication, not null                         |
| quantity      | integer           | not null, default 1                               |
| taken_at      | timestamp with tz | not null (when dose was actually taken)           |
| logged_at     | timestamp with tz | not null, default now() (when button was pressed) |
| notes         | text              | nullable                                          |

### AuditLog

| Column      | Type              | Notes                                       |
| ----------- | ----------------- | ------------------------------------------- |
| id          | text (CUID2)      | PK                                          |
| user_id     | text              | FK → User, not null                         |
| entity_type | text              | not null ('medication', 'dose_log', 'user') |
| entity_id   | text              | not null                                    |
| action      | text              | not null ('create', 'update', 'delete')     |
| changes     | jsonb             | nullable (old/new value diff)               |
| created_at  | timestamp with tz | default now()                               |

**Indexes:**

- DoseLog: (user_id, taken_at DESC) — primary query pattern
- DoseLog: (medication_id, taken_at DESC) — per-medication history
- Medication: (user_id, is_archived) — active medication list
- AuditLog: (user_id, created_at DESC) — audit history

## Page Structure

```
/                         → Landing page (marketing/portfolio showcase)
/(app)/dashboard          → Main timeline dashboard
/(app)/medications        → Manage configured medications
/(app)/medications/new    → Add new medication
/(app)/medications/[id]   → Edit medication
/(app)/log                → Full dose history (paginated, filterable)
/(app)/analytics          → Adherence charts, streaks, patterns
/(app)/settings           → Profile, timezone, notification prefs, export
/(app)/settings/security  → Password, 2FA, active sessions
/auth/login               → Login (email/password + OAuth)
/auth/register            → Registration
/auth/callback/[provider] → OAuth callback
```

The `(app)` route group shares a layout with navigation and enforces authentication via `+layout.server.ts`.

## Dashboard — Core Screen

Three stacked zones:

### 1. Summary Strip (top)

Compact bar showing: "N doses today" and current streak badge.

### 2. Quick-Log Bar

Horizontal row of pill-shaped buttons, one per active medication. Colour-coded with the medication's assigned colour. Shows name and dosage. Tap to log instantly.

### 3. Today's Timeline

Reverse-chronological list of today's doses. Each entry shows:

- Colour dot (medication colour)
- Medication name, dosage, quantity
- Time taken (e.g. "2:30 PM")
- Live "time since" counter (e.g. "2h 34m ago")
- Edit/delete actions on hover

### Logging Interaction

- **Quick tap** → instant log at current time. Success toast with undo (5 seconds). Inventory decrements.
- **Expand** (long press or icon) → inline form: adjust quantity, backdate time, add note.
- **Undo** → toast action deletes the dose log entry and restores inventory.

### Live Counter Implementation

- Server provides `taken_at` timestamps at page load
- Client `$effect` computes `Date.now() - taken_at` and formats as relative time
- Re-renders every 60 seconds via `setInterval`
- Recalculates immediately on `visibilitychange` (tab/sleep recovery)

## Visual Design

**Style:** Bold & modern with glassmorphism effects.

- High contrast colour palette
- Strong colour-coding per medication (user-assigned hex colours)
- Glass-effect cards with backdrop blur
- Rounded corners, subtle shadows
- Smooth transitions and micro-animations (Svelte transitions)
- Responsive: mobile-first, works on all screen sizes

**Accessibility (WCAG 2.1 AA):**

- All colour-coded elements have text labels (never colour-only)
- Minimum 4.5:1 contrast ratio for text
- Focus indicators on all interactive elements
- Keyboard navigable
- Screen reader compatible (proper ARIA labels, semantic HTML)
- Reduced motion support via `prefers-reduced-motion`

## Authentication & Security

### Auth Flows

- **Registration:** email + password (Argon2id hash). Email verification token sent via Resend.
- **Login:** email/password or OAuth (Google, GitHub). Rate-limited: 5 attempts per 15 min per IP.
- **OAuth:** links to existing account if email matches, otherwise creates new account.
- **2FA (optional):** TOTP via authenticator app. QR code + backup codes on setup. Required after password on login once enabled.
- **Password reset:** time-limited token via email.
- **Re-authentication:** sensitive ops (password change, 2FA, account deletion) require password entry within last 5 minutes.

### Security Measures

- CSRF: SvelteKit origin checking on form actions
- Sessions: httpOnly, secure, sameSite=lax cookies. Server-side session storage in DB (revocable).
- Passwords: minimum 8 chars, checked against HaveIBeenPwned k-anonymity API
- Data isolation: all queries scoped by `user_id` at the query layer
- Input validation: Zod schemas on every server endpoint
- CSP headers in `svelte.config.js`
- Rate limiting on auth routes
- TOTP secrets encrypted at rest in database

## Features

### Adherence Analytics

- Weekly/monthly calendar heatmap (colour intensity = doses per day)
- Per-medication adherence percentage (taken vs expected from schedule)
- Current streak and longest streak per medication
- Time-of-day distribution chart
- Charts via Layercake (Svelte-native) or Chart.js

### Smart Reminders

- Configurable per medication: "remind if not taken by X" or "every N hours"
- Vercel Cron job runs every 15 minutes, checks for overdue doses
- Email delivery via Resend
- Notification preferences in settings

### Export / Sharing

- PDF report for a configurable date range
- Contents: medication list, dose log, adherence summary
- Server-side PDF generation
- Download only, no third-party sharing

### Inventory Tracking

- Optional per medication: current count + alert threshold
- Each logged dose decrements count
- Dashboard warning badge when below threshold
- Projected run-out date on analytics page based on usage rate

### Multi-Timezone

- User sets timezone in settings
- All timestamps stored UTC, displayed in user's timezone
- Timezone changes apply to new logs; existing logs display correctly
- Uses `Intl.DateTimeFormat` — no external date library

### Audit Trail

- Records all create/update/delete on medications and dose logs
- JSONB diff: old value → new value
- Viewable in settings or filtered on the log page
- Shows: entity, action, changes, timestamp

## Out of Scope (for now)

- Medication interaction checker
- Push notifications (email only initially)
- Mobile native app
- Multi-user / household sharing
- Real-time cross-device sync (manual refresh sufficient)
