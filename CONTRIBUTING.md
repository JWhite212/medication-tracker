# Contributing to MedTracker

Thanks for your interest in contributing. MedTracker is primarily a personal
portfolio project, so external pull requests are welcome but are reviewed and
merged at the maintainer's discretion. Bug reports and small, well-tested PRs
are especially appreciated.

## Local setup

See the [README](./README.md#local-development) for full setup instructions
(Node version, environment variables, database migrations, dev server).

## Branches and commit conventions

- Branch off `main` using a descriptive prefix: `feat/`, `fix/`, `chore/`,
  `docs/`, `refactor/`, `test/`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
  `feat: …`, `fix: …`, `docs: …`, `chore: …`, `refactor: …`, `test: …`.
- Keep commits scoped and reviewable. Prefer multiple small commits over one
  large one.

## Pull request workflow

1. Fork or branch from `main`, then open a PR back into `main`.
2. Make sure CI is green — `npm run check`, `npm run lint`,
   `npm run format:check`, `npx vitest run`, and `npm run build` all pass.
3. Fill in the PR description with a short summary and a test plan.
4. Request review from the maintainer; expect feedback before merge.

## Coding standards

- TypeScript strict mode; no `any` escapes without justification.
- ESLint clean (`npm run lint`) and Prettier formatted
  (`npm run format:check`).
- Svelte 5 runes only — use `$props()`, `$state()`, `$derived()`, `$effect()`.
  No legacy `export let` syntax.
- Server logic lives under `src/lib/server/` and is never imported from
  client code. All DB queries are scoped by `user_id`.
- Validate every form action input through a Zod schema in
  `src/lib/utils/validation.ts`.

## Testing expectations

- Add unit tests under `tests/unit/` for any new logic, especially pure
  functions and server modules.
- CI runs `npm test` (Vitest). Tests that touch the database mock the `db`
  import — see `tests/unit/csv.test.ts` for the pattern.
- Critical user flows should have a Playwright spec under `tests/e2e/`.

## Reporting bugs

Please open a [GitHub issue](../../issues) using the
[bug report template](.github/ISSUE_TEMPLATE/bug_report.md) with reproduction
steps, expected vs. actual behaviour, and the affected browser / OS.

## Security issues

Do **not** open a public issue for security reports. See
[`SECURITY.md`](./SECURITY.md) for the private disclosure process.
