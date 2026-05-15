# Dependency policy

The long-form companion to the
[Dependency policy](../README.md#dependency-policy) section of the
README. This document is the source of truth for how MedTracker
treats third-party packages: which versions it tracks, how often
they are reviewed, and how security advisories are triaged.

## Purpose

A small portfolio app is easy to leave on a stale lockfile and
then collect surprise breakage during a major version jump six
months later. The aim of this policy is:

1. **Predictable upgrade cadence** — packages are reviewed on a
   schedule, not when something breaks. The quarterly review is
   the forcing function.
2. **Security posture** — known advisories are patched on a
   defined SLA, and the security-critical runtime surface
   (auth, transport, crypto) is pinned tighter than the rest.
3. **No surprise breakage** — major-version bumps go through CI
   and a manual E2E smoke run before merge. Nothing is absorbed
   silently by `^` resolution.

## Categories

Dependencies are grouped by the consequence of a regression, not
by alphabetical order. Each category has its own pinning rule
and review tempo.

### Security-critical runtime

These touch authentication, cryptography, or outbound network
transport. A silent regression is a security regression.

- `@node-rs/argon2` — password hashing.
- `lucia` and `@lucia-auth/adapter-drizzle` — session management.
- `web-push` — Web Push notification dispatch.
- `resend` — transactional email.
- `@neondatabase/serverless` — Postgres driver.
- `drizzle-orm` — query layer; treated as security-critical
  because SQL escaping correctness is in scope.

Rules:

- Pin with tilde (`~x.y.z`) or exact, not caret.
- Patch releases applied within 14 days of upstream publication.
- Minor releases require a manual review of the changelog before
  the lockfile is bumped.
- Major releases require a dedicated PR with risk notes.

### Core framework

The framework backbone of the app.

- `svelte`
- `@sveltejs/kit`
- `@sveltejs/vite-plugin-svelte`
- `@sveltejs/adapter-vercel`
- `vite`

Rules:

- Caret ranges (`^x.y.z`).
- Hold one minor after a release so the ecosystem (adapters,
  ESLint plugin, type definitions) has time to catch up.
- Major bumps follow the major-version process below.

### Styling

- `tailwindcss`
- `@tailwindcss/vite`
- `prettier-plugin-tailwindcss`

Rules:

- Caret ranges.
- Track minor releases as they ship; Tailwind tends to land
  feature improvements rather than breakage.

### Tooling

Build, test, and lint infrastructure. A regression here breaks
the developer experience, not user-facing behaviour.

- `eslint`, `eslint-plugin-svelte`, `typescript-eslint`
- `prettier`, `prettier-plugin-svelte`
- `typescript`, `svelte-check`
- `vitest`, `@vitest/coverage-v8`
- `playwright`, `@playwright/test`, `@axe-core/playwright`
- `husky`, `lint-staged`
- `drizzle-kit`, `tsx`

Rules:

- Caret ranges.
- Upgrade in the quarterly review window unless a specific
  release fixes something blocking.

### Type-only

`@types/*` packages declare types for libraries that ship plain
JavaScript. They cannot introduce runtime behaviour.

Rules:

- Caret ranges.
- Auto-merge in bulk if CI is green; no manual review needed.

## Process

### Quarterly review

On the first business day of each calendar quarter:

1. Run `npm outdated` and capture the output.
2. Triage by category. Type-only and tooling updates are batched
   together; framework and security-critical updates each get
   their own PR.
3. For each PR, run `npm test`, `npm run check`, `npm run lint`,
   `npm run build`. For framework or security-critical PRs, also
   run the Playwright suite locally.
4. Merge in order: type-only → tooling → styling → framework →
   security-critical. The narrower the blast radius, the earlier
   it lands.

### Major-version bumps

Majors get extra ceremony because they tend to ship breaking
changes that the type-checker cannot fully catch.

1. Open a branch named `deps/<package>-<major>`.
2. Bump the version in `package.json`, run `npm install`, and
   resolve any peer-dependency warnings.
3. Run the full test matrix: `npm test`, `npm run check`,
   `npm run lint`, `npm run format:check`, `npm run build`,
   `npm run test:e2e`.
4. Smoke-test the auth flow, dose-logging flow, analytics page,
   and reminder dispatch by hand against a Neon test branch.
5. Open the PR with explicit risk notes: what changed upstream,
   which files in this repo were touched, and what the smoke
   test exercised.

### Documenting the upgrade

If a `CHANGELOG.md` is present at the repo root, add an entry
under the next release header. Otherwise the PR body is the
record — keep it descriptive enough to grep for later.

## Security advisories

- `npm audit` is run weekly (locally or via the CI job).
- **High or critical** advisories are patched within seven days.
  If a patch is not yet available upstream, document the
  deferral in the PR body or in a short note appended to the
  related GitHub Security tab entry.
- **Moderate** advisories are batched into the next quarterly
  review.
- **Low** advisories are tracked but not actioned unless they
  combine with another vector.
- Gitleaks runs in CI on every PR; a secret-scan failure blocks
  merge regardless of advisory level.

## Floor versions

The current floor versions and the reason MedTracker is on each.

| Dependency | Floor | Why                                                                                                   |
| ---------- | ----- | ----------------------------------------------------------------------------------------------------- |
| Node       | 22    | Active LTS; matches the Vercel runtime and the `actions/setup-node` step in CI.                       |
| Svelte     | 5.55  | Runes API (`$state`, `$derived`, `$effect`) is stable; legacy `export let` syntax retired.            |
| SvelteKit  | 2.57  | Form actions, server hooks, and adapter-vercel v6 are aligned. Named-action rule honoured.            |
| Vite       | 8.0   | Tracking current major; Tailwind v4 plugin and Vitest 4 both target this line.                        |
| Tailwind   | 4.2   | Vite plugin variant; native CSS-first config in `src/app.css`.                                        |
| TypeScript | 6.0   | Strict mode on across the workspace.                                                                  |
| Vitest     | 4.1   | v8 coverage provider; coverage thresholds wired into `vite.config.ts`.                                |
| Drizzle    | 0.45  | Migration tooling stable on `drizzle-kit ^0.31`; `numeric`-returns-string behaviour known.            |
| Lucia      | 3.2   | Session table model; v3 is the supported line.                                                        |
| Argon2     | 2.0   | `@node-rs/argon2` v2 matches the OWASP-recommended cost parameters used in `password.ts`.             |
| web-push   | 3.6   | VAPID payload format unchanged since 3.0; tracking the current minor.                                 |
| Resend     | 6.11  | Typed `EmailResult` discriminated union mapped through `mapResendError` in `src/lib/server/email.ts`. |
| Neon       | 1.0   | Serverless HTTP driver; transactions limitation documented in the README known-limitations.           |

When the floor moves, both this table and the floor-versions
table in `README.md` are updated together — they should never
disagree.
