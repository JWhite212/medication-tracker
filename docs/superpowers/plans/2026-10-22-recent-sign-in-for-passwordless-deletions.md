# Recent sign-in for password-less deletions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A password-less account can run the four permanent browser deletions only from a session signed in within the last 10 minutes, and the UI offers a provider sign-in that returns to the page.

**Architecture:** A nullable `sessions.authenticated_at`, stamped at every `lucia.createSession` and surfaced on `locals.session` through Lucia's session attributes. `checkDestructiveGuard` refuses a password-less account whose stamp is not recent; the page loads describe the same rule to `DestructiveConfirm` through one helper. The OAuth start leg remembers an allowlisted return path in a cookie that the callback and `/auth/2fa` redeem.

**Tech Stack:** SvelteKit 2 / Svelte 5 runes, Lucia 3.2.2 + `@lucia-auth/adapter-drizzle` 1.1.0, Drizzle (Postgres), Vitest with fake-db and PGlite.

**Spec:** `docs/superpowers/specs/2026-10-22-recent-sign-in-for-passwordless-deletions-design.md`

## Global Constraints

- Window: `RECENT_SIGN_IN_WINDOW_MS = 10 * 60 * 1000`; recent iff `authenticatedAt !== null && now − authenticatedAt < window` (strict `<`; a future stamp is recent).
- Refusal copy, shared by server and dialog: `RECENT_SIGN_IN_MESSAGE = "Sign in again to confirm."`
- Column: `authenticated_at timestamp with time zone`, **nullable, no default**. Migration is exactly one `ALTER TABLE "sessions" ADD COLUMN "authenticated_at" timestamp with time zone;`.
- Return paths: exactly `/settings/privacy`, `/settings/data`, `/settings/data/import`. Exact string match, nothing else.
- Return cookie `auth_return_to`: `{ path: "/", httpOnly: true, secure: !dev, maxAge: 600, sameSite: "lax" }` (the `oauth_state` options).
- Password accounts: guard behaviour byte-for-byte unchanged. `/api/v1` wipes: unchanged.
- Failures stay `fail(400, { error })`; `actionErrorMessage` remains the only reader.
- Claims say "the four permanent deletions", never "cannot erase anything" (the per-dose delete is a known gap).
- No `git add -A`: the tree holds untracked `.claude/settings.json` and `.claude/hooks/` from main.
- Each new test is proved by mutation before its task is committed (break the line, watch the named test fail, restore).

## Review Focus

1. **The href the dialog builds must survive the server's allowlist.** `encodeURIComponent` on the client, `searchParams.get` on the server — a mismatch makes every link silently return to `/dashboard`. Pinned in Task 3 (`round-trips every return path through a built href`).
2. **A page loaded while recent and submitted after the window** gets one sign-in block, not a red Alert beside it, and the danger button goes not-ready. Pinned in Task 4 (`swaps a sign-in refusal for the sign-in block`).
3. **A 2FA-enabled OAuth user** keeps the return path across `/auth/callback` → `/auth/2fa`. Pinned in Task 3 (callback leaves the cookie; 2FA redeems it).
4. **An unconfigured or Apple-only provider** is never offered as a link; an empty list shows the Forgot-password text, never "sign out". Pinned in Task 4 (`destructiveConfirmation` provider tests; dialog empty-providers test).
5. **The block appearing after a refusal is announced** to a screen reader: it renders inside a `role="status"` wrapper that exists before the block does. Pinned in Task 4 (`announces the sign-in block through a persistent status region`).

---

### Task 1: Stamp every session with its sign-in time

**Files:**

- Modify: `src/lib/server/db/schema.ts:39-49` (sessions)
- Create: `drizzle/0022_*.sql` + `drizzle/meta/*` (generated)
- Modify: `src/lib/server/auth/lucia.ts`
- Modify (stamp `{ authenticatedAt: new Date() }`): `src/routes/auth/login/+page.server.ts`, `src/routes/auth/register/+page.server.ts`, `src/routes/auth/2fa/+page.server.ts`, `src/routes/auth/callback/[provider]/+server.ts` (×2), `src/routes/(app)/settings/security/+page.server.ts`, `src/routes/api/v1/auth/login/+server.ts`, `src/routes/api/v1/auth/2fa/+server.ts`, `src/routes/api/v1/auth/apple/+server.ts` (×2)
- Create test: `tests/unit/pg/session-authenticated-at.test.ts`
- Modify tests: `tests/unit/auth-oauth-callback.test.ts:124`, `auth-2fa-action.test.ts:155`, `api/login.test.ts:202`, `api/apple-route.test.ts:117,184`, `api/2fa.test.ts:157`

**Interfaces:**

- Produces: `sessions.authenticatedAt` (Drizzle column, `Date | null`); `locals.session.authenticatedAt: Date | null`; `lucia.createSession(userId, { authenticatedAt: Date })` (attribute required by type).

- [ ] **Step 1: Write the failing PGlite test** `tests/unit/pg/session-authenticated-at.test.ts`
      Header: `// @vitest-environment node`; mock `$lib/server/db` with `../helpers/pg-db`'s `dbMock`, `$app/environment` with `{ dev: true }`; `vi.useFakeTimers({ toFake: ["Date"] })` at `2026-10-22T09:00:00Z`; `await pgDb.reset()` + `pgDb.seedUser({ id: "u1" })` in `beforeEach`; import the real `lucia` from `src/lib/server/auth/lucia`. Cases:
  - `stores the sign-in time it was given and returns it on the session`: `createSession("u1", { authenticatedAt: T })`, then `validateSession(id)` → `session.authenticatedAt` equals `T` (`toEqual(new Date(T))`).
  - `keeps the sign-in time when the session's expiry slides`: create at T, `setSystemTime(T + 16 days)`, `validateSession` → `session.fresh === true` and `authenticatedAt` still `T`; the row's `expires_at` moved.
  - `reads a session created before the column existed as null`: insert a `sessions` row via `pgDb.db.insert(sessions).values({ id: "old", userId: "u1", expiresAt: T + 1 day })` (no `authenticatedAt`), `validateSession("old")` → `authenticatedAt` is `null` (not `undefined`).
  - `adds the column with no default`: `SELECT column_default, is_nullable FROM information_schema.columns WHERE table_name='sessions' AND column_name='authenticated_at'` → `{ column_default: null, is_nullable: "YES" }`.

- [ ] **Step 2: Run to verify it fails**
      Run: `npx vitest run tests/unit/pg/session-authenticated-at.test.ts`
      Expected: FAIL (type error / column missing / `authenticatedAt` undefined).

- [ ] **Step 3: Add the column and generate the migration**
      In `sessions`: `authenticatedAt: timestamp("authenticated_at", { withTimezone: true }),` (no `.notNull()`, no `.defaultNow()`), with a comment saying why both are absent (push would backfill existing rows with the deploy instant; `NULL` means "not recent").
      Run: `DATABASE_URL=postgres://unused npx drizzle-kit generate`
      Expected: one new `drizzle/0022_*.sql` containing only the `ALTER TABLE … ADD COLUMN "authenticated_at" timestamp with time zone;` line, plus snapshot/journal updates. Anything else → stop.

- [ ] **Step 4: Register the attribute with Lucia** in `lucia.ts`
      `getSessionAttributes: (attributes) => ({ authenticatedAt: attributes.authenticatedAt ?? null })` with a comment that pre-column rows read `NULL` though the registered type says `Date`; `DatabaseSessionAttributes: { authenticatedAt: Date }` in `Register`.

- [ ] **Step 5: Stamp every caller**
      Run `npm run check`; each `lucia.createSession(x, {})` is now a type error. Change each to `lucia.createSession(x, { authenticatedAt: new Date() })`. `npm run check` → no new errors.

- [ ] **Step 6: Update the six `createSession` assertions** to `toHaveBeenCalledWith(<id>, { authenticatedAt: expect.any(Date) })`.

- [ ] **Step 7: Run tests**
      Run: `npx vitest run tests/unit/pg/session-authenticated-at.test.ts tests/unit/auth-oauth-callback.test.ts tests/unit/auth-2fa-action.test.ts tests/unit/api/`
      Expected: PASS. Mutation-prove: drop `?? null` → the null case fails; add `.defaultNow()` → the default case fails. Restore.

- [ ] **Step 8: Commit**
      `git add src/lib/server/db/schema.ts drizzle/ src/lib/server/auth/lucia.ts src/routes tests/unit` (only the files above) — `feat(auth): stamp every session with the time its holder signed in`.

---

### Task 2: The guard refuses a stale password-less session

**Files:**

- Modify: `src/lib/utils/destructive-confirm.ts` (constants)
- Modify: `src/lib/server/auth/destructive-guard.ts`
- Modify: `src/routes/(app)/settings/privacy/+page.server.ts`, `settings/data/+page.server.ts`, `settings/data/import/+page.server.ts` (the four call sites + comments)
- Modify: `CLAUDE.md` (the `checkDestructiveGuard` bullet), `docs/api-v1-contract.md` (~155, ~529)
- Test: `tests/unit/destructive-guard.test.ts`, `tests/unit/destructive-actions.test.ts`, `tests/unit/pg/dose-trash-wipe.test.ts:~264`

**Interfaces:**

- Consumes: `locals.session.authenticatedAt: Date | null` (Task 1).
- Produces, in `src/lib/utils/destructive-confirm.ts`: `RECENT_SIGN_IN_WINDOW_MS: number`, `RECENT_SIGN_IN_MESSAGE: string`.
- Produces, in `destructive-guard.ts`:
  - `signedInRecently(authenticatedAt: Date | null, now: Date): boolean`
  - `type SignedIn = { userId: string; authenticatedAt: Date | null }`
  - `checkDestructiveGuard(who: SignedIn, formData: FormData, opts: { word: DestructiveWord; purpose: ReauthPurpose; now?: Date }): Promise<{ ok: true } | { ok: false; error: string }>` (`now` defaults to `new Date()`).
  - Call sites pass `{ userId: locals.user.id, authenticatedAt: locals.session!.authenticatedAt }`.

- [ ] **Step 1: Write the failing guard tests** (fake-db; switch existing calls from `"u1"` to `{ userId: "u1", authenticatedAt: RECENT }` where `NOW = new Date("2026-10-22T09:00:00Z")`, `RECENT = NOW − 1ms`, and pass `now: NOW`):
  - `passes a password-less account signed in a moment ago` → `{ ok: true }`.
  - `passes a password-less account signed in one millisecond inside the window` (`NOW − (WINDOW − 1)`) → ok.
  - `refuses a password-less account signed in exactly one window ago` (`NOW − WINDOW`) → `{ ok: false, error: RECENT_SIGN_IN_MESSAGE }`.
  - `refuses a password-less session with no recorded sign-in` (`null`) → same refusal.
  - `checks the word before the sign-in time` (stale + `"delete"`) → `"Type DELETE to confirm."`.
  - `never asks a password account about its sign-in time` (`authenticatedAt: null`, password, `confirmReauth` → ok) → `{ ok: true }`, `confirmReauth` called with `("u1", "hunter2", "wipe_dose_history")`.
  - `describe("signedInRecently")`: null → false; `NOW − WINDOW` → false; `NOW − WINDOW + 1` → true; `NOW + 5_000` → true.
  - Rename `passes an account with no password on the word alone…` to say "on the word and a recent sign-in".

- [ ] **Step 2: Run to verify they fail**
      Run: `npx vitest run tests/unit/destructive-guard.test.ts` → FAIL.

- [ ] **Step 3: Implement** the constants, `signedInRecently`, and the guard's third branch (word → `accountHasPassword` → password branch unchanged | `signedInRecently` else `RECENT_SIGN_IN_MESSAGE`). Rewrite the guard's doc comment: password-less accounts run the four "on the word and a sign-in within the last 10 minutes"; name the per-dose delete as outside this gate.

- [ ] **Step 4: Update the four call sites** and the load/action comments that say "the word alone".

- [ ] **Step 5: Action-level tests** in `destructive-actions.test.ts`: `call()`'s `locals.session` becomes `{ id: "s1", authenticatedAt: new Date() }` by default with an override param. Add, for each of the four actions (inside the existing `describe.each` for privacy, plus data and import): `refuses an account with no password whose sign-in is not recent, deleting nothing` → `{ status: 400, data: { error: RECENT_SIGN_IN_MESSAGE } }` and the wipe / `db.delete(users)` / `applyImport` not called. Rename the "on the word alone" tests. Update the file header comment.
      In `pg/dose-trash-wipe.test.ts`, give the `deleteAccount` call's session `authenticatedAt: new Date()`.

- [ ] **Step 6: Docs.** CLAUDE.md bullet and both `api-v1-contract.md` paragraphs: "on the word alone" → "on the word and a sign-in within the last 10 minutes" (the API side is unchanged).

- [ ] **Step 7: Run**
      `npx vitest run tests/unit/destructive-guard.test.ts tests/unit/destructive-actions.test.ts tests/unit/pg/dose-trash-wipe.test.ts tests/unit/app-action-auth-guard.test.ts` → PASS; `npm run check` → no new errors. Mutation-prove: `<` → `<=` fails the "exactly one window" case; dropping the branch fails the four action refusals.

- [ ] **Step 8: Commit** — `feat(auth): a password-less account deletes only within ten minutes of signing in`.

---

### Task 3: Sign in again and come back

**Files:**

- Modify: `src/lib/utils/destructive-confirm.ts` (allowlist + href builder; still no imports)
- Create: `src/lib/server/auth/return-path.ts`
- Modify: `src/routes/auth/callback/[provider]/+server.ts`, `src/routes/auth/2fa/+page.server.ts`
- Test: create `tests/unit/return-path.test.ts`; extend `tests/unit/auth-oauth-callback.test.ts`, `tests/unit/auth-2fa-action.test.ts`

**Interfaces:**

- Produces, in `destructive-confirm.ts`:
  - `RETURN_PATHS = ["/settings/privacy", "/settings/data", "/settings/data/import"] as const`; `type ReturnPath`
  - `returnPathOrNull(candidate: string | null | undefined): ReturnPath | null`
  - `type WebProvider = "google" | "github"`
  - `signInAgainHref(provider: WebProvider, returnTo: ReturnPath): string` → `/auth/callback/${provider}?returnTo=${encodeURIComponent(returnTo)}`
- Produces, in `return-path.ts`: `RETURN_PATH_COOKIE = "auth_return_to"`; `rememberReturnPath(cookies: Cookies, candidate: string | null): void` (allowlisted → set with the Global Constraints options; otherwise delete); `takeReturnPath(cookies: Cookies): ReturnPath | null` (read, always delete, re-validate).

- [ ] **Step 1: Write failing pure tests** `tests/unit/return-path.test.ts`:
  - `accepts exactly the three deletion pages`.
  - `refuses everything else`: `"/dashboard"`, `"//evil.example"`, `"/\\evil.example"`, `"https://evil.example/settings/privacy"`, `"/settings/privacy?x=1"`, `"/settings/privacy/"`, `"/settings/privacy#x"`, `"/settings/data/import/../.."`, `"%2Fsettings%2Fprivacy"`, `"/Settings/Privacy"`, `""`, `null`, `undefined` → `null`.
  - `round-trips every return path through a built href`: for each provider × path, `returnPathOrNull(new URL(signInAgainHref(p, path), "http://x").searchParams.get("returnTo")) === path`, and the pathname is `/auth/callback/${p}`.
  - `rememberReturnPath sets the cookie with the oauth_state options for an allowed path, and deletes it otherwise`; `takeReturnPath deletes the cookie and refuses a tampered value`.

- [ ] **Step 2: Extend the callback test** (`auth-oauth-callback.test.ts`; `makeCookies` gains an initial-jar param):
  - start leg (`url` with no `code`, `?returnTo=/settings/privacy`): `cookies.set("auth_return_to", "/settings/privacy", objectContaining({ httpOnly: true, maxAge: 600, path: "/", sameSite: "lax" }))`, still 302 to GitHub.
  - start leg with `?returnTo=//evil.example`: `cookies.delete("auth_return_to", …)` called, no set.
  - finish leg, no 2FA, jar has `auth_return_to=/settings/data`: 302 to `/settings/data`, cookie deleted.
  - finish leg, jar has `auth_return_to=https://evil.example`: 302 to `/dashboard`.
  - finish leg, 2FA user, jar has a path: 302 to `/auth/2fa`, `auth_return_to` NOT deleted.

- [ ] **Step 3: Extend the 2FA test**: genuine token + `auth_return_to=/settings/data/import` → 302 to `/settings/data/import`, cookie deleted; without the cookie → `/dashboard` (existing case).

- [ ] **Step 4: Run to verify failures**: `npx vitest run tests/unit/return-path.test.ts tests/unit/auth-oauth-callback.test.ts tests/unit/auth-2fa-action.test.ts` → FAIL.

- [ ] **Step 5: Implement** the utils functions, `return-path.ts`, `rememberReturnPath(cookies, url.searchParams.get("returnTo"))` at the top of the start leg, and `redirect(302, takeReturnPath(cookies) ?? "/dashboard")` at the callback's two session redirects and the 2FA success redirect. Leave the 2FA branch and error redirects untouched.

- [ ] **Step 6: Run** the three files → PASS. Mutation-prove: skip re-validation in `takeReturnPath` → the tampered case fails; drop `encodeURIComponent` → nothing should fail (record that it is defensive, not load-bearing) or the round-trip fails — note which in the commit message.

- [ ] **Step 7: Commit** — `feat(auth): signing in again returns to the deletion page it started from`.

---

### Task 4: Tell the user, before and inside the dialog

**Files:**

- Modify: `src/lib/utils/destructive-confirm.ts` (`DestructiveConfirmation` type)
- Modify: `src/lib/server/auth/oauth.ts` (`configuredWebProviders`)
- Modify: `src/lib/server/auth/destructive-guard.ts` (`destructiveConfirmation`)
- Create: `src/lib/components/ui/SignInAgain.svelte`
- Modify: `src/lib/components/ui/DestructiveConfirm.svelte`
- Modify: the three loads and `settings/privacy/+page.svelte`, `settings/data/+page.svelte`, `settings/data/import/+page.svelte`
- Test: `tests/unit/destructive-guard.test.ts`, `tests/unit/destructive-confirm.svelte.test.ts`, `tests/unit/destructive-pages-ssr.test.ts`, `tests/unit/destructive-pages-mount.svelte.test.ts`, `tests/unit/mobile-nav-link-names-ssr.test.ts`, `tests/unit/pg/destructive-counts.test.ts`

**Interfaces:**

- Consumes: `signedInRecently`, `RECENT_SIGN_IN_MESSAGE` (Task 2); `ReturnPath`, `WebProvider`, `signInAgainHref` (Task 3).
- Produces:
  - `type DestructiveConfirmation = { kind: "password" } | { kind: "recentSignIn"; recent: boolean; providers: WebProvider[] }` (utils)
  - `configuredWebProviders(): WebProvider[]` (oauth.ts; Google then GitHub, only when `getGoogle()`/`getGitHub()` is non-null)
  - `destructiveConfirmation(who: SignedIn, now?: Date): Promise<DestructiveConfirmation>`: password → `{ kind: "password" }`; else `recent: signedInRecently(...)`, `providers` = the user's `oauth_accounts.provider` values ∩ `configuredWebProviders()`, in `configuredWebProviders()` order.
  - Loads return `confirmation: DestructiveConfirmation` in place of `hasPassword`.
  - `SignInAgain.svelte` props: `{ providers: WebProvider[]; returnTo: ReturnPath; note?: string }` — an `Alert tone="needs-you" title={RECENT_SIGN_IN_MESSAGE}` whose body states deleting needs a sign-in in the last 10 minutes, then one link per provider ("Sign in again with Google" / "…GitHub", `href={signInAgainHref(p, returnTo)}`, ≥44px tall), then `note`; with no providers, the Forgot-password text (spec §6), no link.
  - `DestructiveConfirm` props: `hasPassword` → `confirmation: DestructiveConfirmation`, plus `returnTo: ReturnPath`, `signInNote?: string`. `needsSignIn = kind === "recentSignIn" && (!recent || error === RECENT_SIGN_IN_MESSAGE)`. Render a red `Alert` only for an error other than `RECENT_SIGN_IN_MESSAGE`; render `SignInAgain` inside a `role="status"` wrapper that is always in the dialog. `ready` is false while `needsSignIn`. The password field renders only for `kind === "password"`.

- [ ] **Step 1: Failing server tests** in `destructive-guard.test.ts` (mock `$lib/server/auth/oauth`'s `configuredWebProviders`):
  - `describes a password account as a password confirmation` → `{ kind: "password" }`, no `oauth_accounts` read.
  - `offers only linked providers that are configured, Google first` (linked `github`, `google`, `apple`; configured `["google","github"]`) → `providers: ["google","github"]`.
  - `drops a linked provider that is not configured` (configured `["github"]`, linked google) → `providers: []`.
  - `reports recent from the session's sign-in time` (recent and stale cases).
  - In `pg/destructive-counts.test.ts`: the loads return `confirmation` (password and password-less users; seed an `oauth_accounts` row; `locals.session` carries `authenticatedAt`).

- [ ] **Step 2: Failing dialog tests** in `destructive-confirm.svelte.test.ts` (`Props` gets `confirmation`, `returnTo`, `signInNote?`; default `confirmation: { kind: "password" }` keeps every existing test meaning the same):
  - `shows the sign-in block and no password field for a stale password-less session`: links `Sign in again with Google` → `/auth/callback/google?returnTo=%2Fsettings%2Fprivacy`; danger button `aria-disabled="true"` even after typing `DELETE`.
  - `swaps a sign-in refusal for the sign-in block` (`recent: true`, then `error = RECENT_SIGN_IN_MESSAGE`): no `[role="alert"]`, block present, button not ready.
  - `announces the sign-in block through a persistent status region`: a `[role="status"]` exists in the open dialog before the refusal and contains the block after.
  - `keeps a different error as a red alert`.
  - `asks a recent password-less session for the word only`.
  - `explains Forgot password when no provider can sign in again`: text present, no `a[href^="/auth/callback"]`, no "Sign out" suggestion on its own.
  - `shows the import note under the links` (`signInNote` text present).

- [ ] **Step 3: Failing page tests**: `destructive-pages-ssr.test.ts` / `destructive-pages-mount.svelte.test.ts` fixtures move from `hasPassword` to `confirmation`; add: Import shows the sign-in block under Replace only when `mode === "replace"` and `recent: false` (mount: select Replace, assert block; select Merge, assert gone; `recent: true` → never); each page's links carry its own `returnTo`. Update `mobile-nav-link-names-ssr.test.ts` fixtures.

- [ ] **Step 4: Run to verify failures**: the five files → FAIL.

- [ ] **Step 5: Implement** the type, `configuredWebProviders`, `destructiveConfirmation`, `SignInAgain.svelte`, the `DestructiveConfirm` changes, the three loads (`destructiveConfirmation({ userId, authenticatedAt: locals.session!.authenticatedAt })`), and the pages: privacy passes `returnTo="/settings/privacy"` to both dialogs, data `"/settings/data"`, import `"/settings/data/import"` with `signInNote="You'll need to choose the file again."` and the under-Replace block (inside its own persistent `role="status"` wrapper). Keep the card order.

- [ ] **Step 6: Run** the five files plus `npx vitest run tests/unit/status-colour-owner.test.ts tests/unit/button-ssr.test.ts` (owner scans) → PASS; `npm run check` → no new errors. Mutation-prove: drop the `error === RECENT_SIGN_IN_MESSAGE` clause → the swap test fails; render the red Alert unconditionally → the swap test fails; remove the import `mode` condition → the Merge assertion fails.

- [ ] **Step 7: Commit** — `feat(settings): say "Sign in again to confirm" before a stale password-less deletion`.

---

### Task 5: Whole-branch verification and PR

- [ ] **Step 1:** `npm run check`, `npm run lint`, `npm run format:check`, `npx vitest run` — all green (compare `check` against the branch base if it has a pre-existing baseline; record any pre-existing failure in the PR, do not hide it).
- [ ] **Step 2:** Browser check if a dev server can run (`.env` may lack `ENCRYPTION_KEY`, per memory); if not, say so in the PR rather than claiming it.
- [ ] **Step 3:** Fresh whole-branch review (code-reviewer subagent) against the spec; fix findings.
- [ ] **Step 4:** If `feat/status-colours` has merged, rebase onto `origin/main`; otherwise push and open the PR noting the dependency. PR body: decisions with one-line rationale, "Decisions taken without input", rollout notes (spec §10: push must run unattended in production; previews skip push; rollback safe; every password-less user re-signs-in once), the per-dose gap. No AI attribution.
