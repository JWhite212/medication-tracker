# ADR 0001: SvelteKit as the application framework

- **Status**: Accepted
- **Date**: 2026-04-15
- **Deciders**: Jamie White

## Context

MedTracker is a personal medication tracker that needs to ship fast,
feel snappy, and work both as a website and a PWA. Most pages are
data-driven (medications list, dose log, analytics) with form-heavy
mutations (log dose, edit dose, change settings). The app is intended
as a portfolio piece, so the framework choice should also showcase
modern full-stack patterns that an interviewer can recognise.

## Decision

Use **SvelteKit 2.x with Svelte 5 runes** as the application
framework. Pages load via `+page.server.ts` loaders; mutations go
through SvelteKit form actions with `use:enhance`. There is no
client-side data-fetching library (no SWR, no TanStack Query).

## Alternatives considered

- **Next.js (App Router)** — bigger ecosystem and well-trodden path,
  but the heavier client runtime, the React Server Component model,
  and TypeScript-throughout-but-not-quite ergonomics felt like
  overkill for a single-author app.
- **Remix / React Router 7** — server-first ergonomics are similar to
  SvelteKit, but the React component model adds rerender ceremony I
  didn't need for a UI this size.
- **Astro + islands** — great for content-heavy sites; less natural
  for a stateful tracking app where almost every page is interactive.

## Consequences

**Positive**

- Form actions + loaders keep the data flow obvious. Most pages have
  no client-side state at all; the few that do (TimeSince ticking,
  push subscription toggle) are localised.
- Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`) make
  reactive code feel like plain TypeScript — no boilerplate ref
  unwrapping or memoisation.
- The `$lib/server` boundary stops server code leaking into bundles
  and the build complains loudly if it does.

**Negative**

- Smaller ecosystem than React. A few component categories (rich
  charts, design-system kits) are thinner; we hand-roll instead.
- Svelte 5 runes are still relatively new — recruiters may need to
  ask what `$state` does. The tradeoff is worth it for the cleaner
  reactive model.
