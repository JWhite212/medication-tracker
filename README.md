# MedTracker

A personal medication tracking web application built with SvelteKit, designed for quick dose logging, live timers, adherence analytics, and inventory management. Server-first architecture with a dark-mode glassmorphism UI.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%3E%3D20-brightgreen)](https://nodejs.org)
[![SvelteKit](https://img.shields.io/badge/SvelteKit-2-FF3E00?logo=svelte&logoColor=white)](https://svelte.dev)
[![Deploy](https://img.shields.io/badge/Vercel-deployed-black?logo=vercel)](https://vercel.com)

[Features](#features) · [Tech Stack](#tech-stack) · [Architecture](#architecture) · [Getting Started](#getting-started) · [Testing](#testing) · [Project Structure](#project-structure) · [Design System](#design-system) · [Deployment](#deployment) · [Roadmap](#roadmap) · [Author](#author) · [License](#license)

![MedTracker dashboard](docs/screenshots/hero-dashboard.png)

## Screenshots

|                                                  |                                                        |
| ------------------------------------------------ | ------------------------------------------------------ |
| ![Medications](docs/screenshots/medications.png) | ![Add Medication](docs/screenshots/add-medication.png) |
| _Medications_                                    | _Add Medication_                                       |
| ![History](docs/screenshots/history.png)         | ![Analytics](docs/screenshots/analytics.png)           |
| _History_                                        | _Analytics_                                            |

## Features

### Dose Logging

- **Quick Log** — one-tap dose logging from the dashboard for any active medication
- **Dose timeline** — chronological feed of today's doses with live "time since" counters (client-side intervals, no WebSocket)
- **Dose editing** — edit or delete logged doses via modal, with quantity tracking
- **Multi-quantity** — log multiple doses at once (e.g. 2 tablets)

### Medication Management

- **Full CRUD** — create, view, edit, and archive medications
- **Rich metadata** — name, dosage amount/unit, form (tablet, capsule, liquid, etc.), category (prescription, OTC, supplement)
- **Dual-colour system** — primary + optional secondary colour per medication with 8 visual patterns (solid, split, gradient, diagonal stripes, horizontal stripes, polka dots, checkerboard, radial)
- **Live preview** — see how colour/pattern combinations render as cards, dots, and pills before saving
- **Schedule types** — scheduled (with configurable interval in hours) or as-needed (PRN)
- **Inventory tracking** — current stock count with low-stock alert thresholds, auto-decrements on dose log
- **Sort ordering and archival** — organise active medications, archive inactive ones

### Analytics

- **Streak tracking** — consecutive days with at least one logged dose
- **Per-medication adherence** — calculates expected vs actual doses over 30 days for scheduled medications
- **Activity heatmap** — 90-day dose activity visualisation
- **Time-of-day distribution** — hourly bar chart showing when doses are typically taken
- All analytics respect the user's configured timezone

### Settings

- **Profile** — display name and timezone (full IANA timezone list)
- **Appearance** — accent colour, time format (12h/24h), display density (comfortable/compact), reduced motion toggle
- **Notifications** — email reminders for overdue doses and low inventory alerts (via Resend)
- **Data management** — export dose history as PDF or CSV, account deletion with confirmation
- **Security** — password changes, active session management with revocation, sign out

### Authentication

- **Email/password** — registration with email verification, password reset flow
- **OAuth** — optional Google and GitHub sign-in (via Arctic)
- **Session management** — Lucia v3 with database-backed sessions, secure cookies
- **Rate limiting** — built-in rate limiting on auth endpoints

### Data Integrity

- **Audit logging** — all create/update/delete operations recorded with JSONB diffs
- **Input validation** — every form action validated through Zod schemas
- **User scoping** — all database queries scoped by `user_id`
- **UTC timestamps** — stored with timezone, displayed in user's local timezone via `Intl.DateTimeFormat`

## Tech Stack

| Layer            | Technology                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------- |
| Framework        | [SvelteKit](https://svelte.dev/docs/kit) with Svelte 5 runes                                  |
| Styling          | [Tailwind CSS v4](https://tailwindcss.com) — dark-mode-first, glassmorphism design system     |
| Database         | [PostgreSQL](https://www.postgresql.org) via [Neon](https://neon.tech) serverless driver      |
| ORM              | [Drizzle ORM](https://orm.drizzle.team) with type-safe schema                                 |
| Auth             | [Lucia v3](https://lucia-auth.com) + [Arctic](https://arcticjs.dev) for OAuth                 |
| Validation       | [Zod](https://zod.dev)                                                                        |
| Email            | [Resend](https://resend.com)                                                                  |
| PDF Export       | [PDFKit](http://pdfkit.org)                                                                   |
| Password Hashing | [Argon2](https://github.com/nicolo-ribaudo/tc39-proposal-secure-argon2) via `@node-rs/argon2` |
| Testing          | [Vitest](https://vitest.dev) + [Playwright](https://playwright.dev)                           |
| Deployment       | [Vercel](https://vercel.com) (via `@sveltejs/adapter-vercel`)                                 |

## Architecture

```mermaid
flowchart LR
  U[User browser<br/>Svelte 5 runes] -->|form actions<br/>use:enhance| SK[SvelteKit<br/>+page.server.ts]
  SK -->|session check| LU[Lucia v3<br/>hooks.server.ts]
  SK -->|typed queries| DR[Drizzle ORM]
  DR --> PG[(Neon Postgres<br/>users · medications<br/>doseLogs · sessions<br/>auditLogs)]
  SK -->|OAuth| AR[Arctic<br/>Google / GitHub]
  SK -->|verification<br/>password reset| RS[Resend email]
  VC[Vercel Cron<br/>09:00 daily] -->|Bearer CRON_SECRET| SK
  SK -->|overdue alerts| RS
  SK -->|PDF / CSV<br/>/api/export| U
```

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) >= 20
- A [Neon](https://neon.tech) PostgreSQL database (or any PostgreSQL instance)
- (Optional) [Resend](https://resend.com) account for email features
- (Optional) Google and/or GitHub OAuth credentials

### Installation

```bash
git clone https://github.com/JWhite212/medication-tracker.git
cd medication-tracker
npm install
```

### Environment Variables

Create a `.env` file in the project root:

```env
# Required
DATABASE_URL=postgresql://user:password@host/database?sslmode=require

# Email (required for verification, password reset, and reminders)
RESEND_API_KEY=re_xxxxxxxxxxxxx
EMAIL_FROM="MedTracker <noreply@yourdomain.com>"

# OAuth (optional — app works with email/password only)
GOOGLE_CLIENT_ID=xxxxxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxx
GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxxx
GITHUB_CLIENT_SECRET=xxxxxxxxxxxxx

# Cron endpoint protection (required if using scheduled reminders)
CRON_SECRET=a-random-secret-string
```

### Database Setup

Push the schema to your database:

```bash
npx drizzle-kit push
```

To generate migration files (for version-controlled migrations):

```bash
npx drizzle-kit generate
```

### Development

```bash
npm run dev
```

The app runs at [http://localhost:5173](http://localhost:5173).

### Production Build

```bash
npm run build
npm run preview   # preview locally
```

## Testing

```bash
# Run all unit tests
npx vitest run

# Run a specific test file
npx vitest run tests/unit/time.test.ts

# Run in watch mode
npx vitest
```

## Project Structure

```
src/
├── routes/
│   ├── +page.svelte                  # Landing page
│   ├── auth/                         # Login, register, password reset, OAuth callbacks
│   ├── (app)/                        # Authenticated route group (auth guard in layout)
│   │   ├── dashboard/                # Main dashboard with quick log + timeline
│   │   ├── medications/              # Medication list, detail, create/edit
│   │   ├── log/                      # Full dose history with pagination + filters
│   │   ├── analytics/                # Streaks, adherence, heatmap, hourly chart
│   │   └── settings/                 # Profile, appearance, notifications, data, security
│   └── api/
│       └── export/                   # PDF/CSV export endpoint
├── lib/
│   ├── server/                       # Server-only code (never imported from client)
│   │   ├── db/schema.ts              # Drizzle table definitions
│   │   ├── auth/                     # Lucia setup, OAuth providers
│   │   ├── analytics.ts              # Streak, adherence, heatmap, hourly queries
│   │   ├── doses.ts                  # Dose query helpers
│   │   ├── audit.ts                  # Audit log with JSONB diff tracking
│   │   ├── email.ts                  # Resend email helpers
│   │   ├── export-csv.ts             # CSV export generation
│   │   └── preferences.ts            # User preferences CRUD
│   ├── components/                   # Svelte 5 components (runes syntax)
│   │   ├── ui/                       # Reusable primitives (GlassCard, Input, Modal, Toast, Tooltip)
│   │   ├── MedicationForm.svelte     # Dual-colour picker, pattern grid, tooltips
│   │   ├── MedicationCard.svelte     # Medication list item with pattern rendering
│   │   ├── QuickLogBar.svelte        # One-tap dose logging strip
│   │   ├── TimelineEntry.svelte      # Dose timeline item with live timer
│   │   ├── Heatmap.svelte            # 90-day activity heatmap
│   │   └── AdherenceChart.svelte     # Per-medication adherence bars
│   ├── utils/
│   │   ├── validation.ts             # All Zod schemas
│   │   ├── medication-style.ts       # Pattern rendering utility (CSS backgrounds)
│   │   └── time.ts                   # Time formatting helpers
│   └── types.ts                      # Shared TypeScript types
└── app.css                           # Tailwind v4 theme + design tokens
```

## Design System

The UI uses a dark-mode glassmorphism design system built with Tailwind CSS v4 custom theme tokens:

- `glass` / `glass-border` / `glass-hover` — frosted glass surfaces with backdrop blur
- `surface` / `surface-raised` / `surface-overlay` — layered surface elevation
- `text-primary` / `text-secondary` / `text-muted` — typographic hierarchy
- `accent` / `success` / `warning` / `danger` — semantic colour palette

All components use Svelte 5 runes (`$props()`, `$state()`, `$derived()`, `$effect()`).

## Deployment

The app is configured for Vercel deployment via `@sveltejs/adapter-vercel`. Set all environment variables in your Vercel project settings.

For scheduled medication reminders, configure a Vercel Cron Job pointing to `/api/cron/reminders` with the `CRON_SECRET` header.

## Roadmap

- [ ] Full 2FA / TOTP flow (schema fields + settings UI skeleton are already in place)
- [ ] Drug-drug interaction warnings
- [ ] Weight-based and renal-impairment dosing support
- [ ] Real-time multi-device dose sync (WebSocket / Server-Sent Events)
- [ ] Recurring per-dose reminders (not just daily overdue digests)
- [ ] Native push notifications via PWA / web push
- [ ] Refill-projection improvements (learning per-medication usage)
- [ ] Caregiver shared-access mode (read-only delegated accounts)
- [ ] Mobile wrapper (Capacitor) for App Store / Play Store distribution
- [ ] Medication photo recognition for faster add-medication flow

## Author

**Jamie White** — early-career software engineer (UK).

- GitHub: [@JWhite212](https://github.com/JWhite212)
- Email: [jamiecs@live.co.uk](mailto:jamiecs@live.co.uk)
- Portfolio: [jamie-white-portfolio.vercel.app](https://jamie-white-portfolio.vercel.app)
- Case study: [jamie-white-portfolio.vercel.app/projects/medication-tracker](https://jamie-white-portfolio.vercel.app/projects/medication-tracker)

## License

MIT
