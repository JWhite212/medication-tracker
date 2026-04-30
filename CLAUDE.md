# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
npm run dev          # Start dev server (port 5173)
npm run build        # Production build
npm run preview      # Preview production build
npx vitest run       # Run all unit tests
npx vitest run tests/unit/time.test.ts  # Run single test file
npx drizzle-kit generate  # Generate DB migration
npx drizzle-kit push      # Push schema to Neon
```

## Architecture

Server-first SvelteKit app (Svelte 5 runes). Pages load via `+page.server.ts`, mutations via form actions with `use:enhance`. No client-side data fetching libraries.

- **`src/lib/server/`** — All database queries and server logic. Never imported from client code.
- **`src/lib/server/db/schema.ts`** — Single file for all Drizzle table definitions.
- **`src/lib/server/auth/lucia.ts`** — Lucia v3 session management. Sessions stored in DB, validated in `hooks.server.ts`.
- **`src/routes/(app)/`** — Authenticated route group. Auth guard in `+layout.server.ts` redirects to `/auth/login`.
- **`src/lib/components/`** — Svelte 5 components using `$props()`, `$state()`, `$derived()`, `$effect()` runes. No legacy `export let` syntax.
- **`src/lib/utils/validation.ts`** — All Zod schemas. Every form action validates input through these.

## Key Patterns

- All timestamps stored UTC (`timestamp with tz`), displayed in user's timezone via `Intl.DateTimeFormat`
- Live "time since" counters: client-side `$effect` + `setInterval(60s)` + `visibilitychange` recalc. No WebSocket.
- All DB queries scoped by `user_id` — never trust client-provided user context
- Audit log (`src/lib/server/audit.ts`) records all create/update/delete with JSONB diffs
- Inventory auto-decrements on dose log, auto-restores on delete

## Gotchas

- Drizzle `numeric` columns return as **string** in JS, not number. `medications.scheduleIntervalHours` and `dosageAmount` must be `Number(...)` before arithmetic.
- `medications.inventoryCount` is in **doses**, not raw units. `dose_logs.quantity` defaults to 1; inventory decrements by `quantity` per log, restores on delete.
- `scheduleType` / `scheduleIntervalHours` columns are marked DEPRECATED in `schema.ts` but still populated and read — the canonical source is the `medication_schedules` table (phase 4d).
- "Days until refill" prefers the schedule rate (`24/intervalHours`) over the 30-day historical average for `scheduleType === "scheduled"`. PRN meds use the historical average.
- Tests that touch the database mock the `db` import (see `tests/unit/csv.test.ts`); CI runs with a placeholder `DATABASE_URL`.

## Styling

Tailwind CSS v4 with custom theme in `src/app.css`. Dark-mode-first. Key tokens: `glass`, `glass-border`, `surface`, `surface-raised`, `text-primary`, `text-secondary`, `accent`.
