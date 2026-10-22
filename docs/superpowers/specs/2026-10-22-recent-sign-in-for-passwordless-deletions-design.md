# Recent sign-in for password-less permanent deletions

Status: design, approved decisions marked **(decided)**. Builds on
`feat/status-colours` (spec `2026-10-16-status-colours-button-alert-design.md`),
which introduces `checkDestructiveGuard` and `ui/DestructiveConfirm.svelte`.

## Intent

MedTracker has four browser deletions nothing can undo: Privacy's _Delete dose
history_ and _Delete archived medications_ (`src/routes/(app)/settings/privacy`),
Data's _Delete account_ (`settings/data`) and Import's _Replace_ commit
(`settings/data/import`). All four go through one server gate,
`checkDestructiveGuard` in `src/lib/server/auth/destructive-guard.ts`.

Today that gate asks every account for a typed word (`DELETE` / `REPLACE`)
and, where the account has a password, also runs `confirmReauth`. An account
with no password (OAuth-only: Google or GitHub) passes on the word alone. A
stolen session cookie is therefore enough to wipe such an account: the word
is printed on the screen.

The user accepted that as an interim step and asked for this follow-up: **a
password-less account must have signed in recently before a permanent
deletion runs**, so a stolen cookie alone cannot wipe it.

**What "cannot wipe it" covers, precisely:** the four bulk deletions above.
It does not cover the per-dose delete. With only a cookie, any account,
password or not, can still erase doses one at a time: `/dashboard?/deleteDose`
with `forUndo=1` keeps no trash row (`src/lib/server/dose-actions.ts`), and an
ordinary delete's trash row is purged after the 10-minute Undo window. That
is a known gap, out of scope here, and every claim this change makes (guard
comment, CLAUDE.md, PR) must be the narrow one: "cannot run the four
permanent deletions", never "cannot erase anything".

## Goals

- A password-less account can run the four deletions only from a session
  whose sign-in happened within the last **10 minutes** (decided).
- When the sign-in is not recent, the UI says **"Sign in again to confirm"**
  and offers a link that re-runs the provider sign-in and returns the user to
  the page they were on.
- Password accounts are unchanged: word, then `confirmReauth`, exactly as now.
- The server is the gate. Posting the form directly skips nothing.

## Non-goals

- `/api/v1` wipes. They stay password-only (a password-minted reauth token,
  no word), as `docs/api-v1-contract.md` records. Do not route them through
  this change.
- Protecting against someone at the user's own unlocked computer. The
  provider may complete silently if the browser is still signed in there
  (decided: **allow the silent bounce**, no `prompt=` parameter). The threat
  this closes is a cookie used from another browser, which is not signed in
  to the user's Google/GitHub.
- Other password-gated actions that password-less accounts cannot use today
  (Privacy's _Revoke other sessions_ keeps its password-only
  `requirePassword`; its comment already calls that a separate follow-up).
- Ending the session that a re-sign-in replaces, a sessions-list UI, or any
  generic `?returnTo=` support on the login page.

## Anti-goals (would make this a failure even if it "works")

- A deploy that 500s signed-in pages because code reads a column production
  lacks (see Rollout). This has happened twice in this repo.
- An open redirect. The return path is an allowlist, never "any path that
  starts with `/`".
- Existing sessions quietly counting as fresh after deploy.
- A password account being asked to sign in again, or a password-less account
  being asked for a password.
- Two messages for one refusal (a red error Alert _and_ a sign-in prompt
  saying the same thing).

## Decisions taken with the user

| Question                            | Decision                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Window                              | **10 minutes**                                                                                                                                                |
| Sessions that exist when this ships | **Not recent.** Existing rows keep `NULL` and `NULL` counts as old, so each password-less user signs in again once, the first time they delete. Fails closed. |
| Provider step                       | **Allow silent bounce.** No `prompt=select_account`.                                                                                                          |
| Import Replace                      | **Tell them before they choose a file**, next to the mode picker; the dialog keeps the link as a fallback.                                                    |

## Design

### 1. Data: `sessions.authenticated_at`

Add to `sessions` in `src/lib/server/db/schema.ts`:

```ts
authenticatedAt: timestamp("authenticated_at", { withTimezone: true }),
```

**Nullable and with no default — both are load-bearing.** Production schema
is applied by `drizzle-kit push` on every production build
(`scripts/vercel-build.mjs`, `docs/DEPLOYMENT.md` §9), and push applies the
DDL that `schema.ts` implies and skips any hand-written backfill. A column
with `DEFAULT now()` would make Postgres fill every existing row with the
deploy instant, so every live session, stolen ones included, would count as
freshly signed in for ten minutes. A nullable column with no default leaves
existing rows `NULL`, which is the "not recent" decision, and push and
`migrate` produce the same result.

Generate the migration with `npx drizzle-kit generate` (it will be `0022_*`);
expect a single `ALTER TABLE "sessions" ADD COLUMN "authenticated_at"
timestamp with time zone;` and nothing else. If generate emits anything
else, stop and find out why before going on.

The column means **"when this session's holder last proved who they are"**,
not "when the row was inserted". Today the two coincide because every session
is minted by a sign-in; naming it for the meaning keeps that honest if a
session is ever re-minted without one.

### 2. Stamping it at every session creation

Register the attribute with Lucia in `src/lib/server/auth/lucia.ts`:

- `DatabaseSessionAttributes: { authenticatedAt: Date }` in the `Register`
  block, which makes the attribute **required** in `lucia.createSession(userId,
attributes)`. The compiler then finds every caller, and none can forget.
- `getSessionAttributes: (a) => ({ authenticatedAt: a.authenticatedAt ?? null })`
  so `locals.session.authenticatedAt` is `Date | null`. The `?? null` is not
  decoration: rows created before this change read `NULL` from the database
  even though the registered type says `Date`.

The Drizzle adapter (`@lucia-auth/adapter-drizzle` 1.1.0) already does the
rest: `setSession` spreads attributes into the insert, and
`getSessionAndUser` selects the whole session table and passes every column
other than `id`/`userId`/`expiresAt` through as attributes. Lucia's sliding
expiry (`updateSessionExpiration`) writes `expiresAt` only, so the sign-in
time survives a session being extended. No extra query is needed in the
guard.

Every current caller is a sign-in and stamps `new Date()`, the app's clock.
The guard compares against the same clock, so there is one clock either side
of the subtraction (the low-inventory gotcha in CLAUDE.md is the cautionary
tale). The callers, as of `feat/status-colours`:

- `src/routes/auth/login/+page.server.ts` (password)
- `src/routes/auth/register/+page.server.ts`
- `src/routes/auth/2fa/+page.server.ts`
- `src/routes/auth/callback/[provider]/+server.ts` (two: linked account, new account)
- `src/routes/(app)/settings/security/+page.server.ts` (password change re-mints after `confirmReauth`)
- `src/routes/api/v1/auth/login/+server.ts`, `api/v1/auth/2fa/+server.ts`,
  `api/v1/auth/apple/+server.ts` (two). API sessions are stamped too: they are
  sign-ins, and the column costs nothing there. Nothing on `/api/v1` reads it.

Whether to write `{ authenticatedAt: new Date() }` at each site or add a small
helper is the builder's call.

### 3. One rule for "recent", one message for refusing

In `src/lib/utils/destructive-confirm.ts` (client-safe, no imports, which is
why it already holds `DestructiveWord`):

- `RECENT_SIGN_IN_WINDOW_MS = 10 * 60 * 1000`
- `RECENT_SIGN_IN_MESSAGE = "Sign in again to confirm."` (the exact copy the
  user asked for; the dialog and the server both read it, the way
  `RESTORE_GONE_MESSAGE` in `utils/dose-undo.ts` is shared).

In `src/lib/server/auth/destructive-guard.ts`, a pure function the guard and
the page loads both call, so the dialog and the gate cannot disagree:

```ts
export function signedInRecently(authenticatedAt: Date | null, now: Date): boolean;
// true iff authenticatedAt !== null && now - authenticatedAt < RECENT_SIGN_IN_WINDOW_MS
```

Strictly less than. Exactly 10:00 after sign-in is **not** recent. A
timestamp up to one minute in the future (clock drift between serverless
instances) counts as recent: only the server writes this column, so a small
future value is drift, not an attack. Anything further ahead is **not**
recent (added after review): it can only be a mis-stamp, such as a caller
passing `expiresAt`, which would otherwise read as recent for 30 days.

### 4. The guard

`checkDestructiveGuard` needs the session's sign-in time, which it does not
receive today. Change its first argument from `userId: string` to the
signed-in identity, e.g. `{ userId, authenticatedAt }`, built from
`locals.user.id` and `locals.session.authenticatedAt` at each of the four
call sites. (Every caller already checked `locals.user` for the 401; in this
app `locals.user` and `locals.session` are set together in `hooks.server.ts`,
so a caller may use `locals.session!`. The exact parameter shape, and whether
`now` is a parameter for testability, is the builder's call.)

Order, unchanged where it already exists:

1. The word. Wrong or missing → `Type ${word} to confirm.` (reads nothing,
   spends no reauth attempt).
2. `accountHasPassword(userId)`. If **true**: the existing password branch,
   byte-for-byte. Freshness is never consulted for a password account.
3. If **false**: `signedInRecently(authenticatedAt, now)`; if not, refuse
   with `{ ok: false, error: RECENT_SIGN_IN_MESSAGE }`. Otherwise `{ ok: true }`.

The four actions keep returning `fail(400, { error: guard.error })`, the
shape `actionErrorMessage` reads. No new failure shape and no new field: the
dialog recognises the refusal by its message (§6), so CLAUDE.md's "never
re-read `result.data` at a call site" still holds.

No rate limit is added: freshness is not a secret anyone can guess at.

Update every place that says a password-less account deletes "on the word
alone" to say "on the word and a sign-in within the last 10 minutes":

- the guard's doc comment;
- the CLAUDE.md bullet for `checkDestructiveGuard` (added by
  `feat/status-colours`); keep its `/api/v1 differs on purpose` sentence;
- `docs/api-v1-contract.md`, twice: the `POST /auth/reauth` 401 paragraph
  (~line 155) and the wipes paragraph (~line 529). The API's own behaviour
  is unchanged; only the description of the browser side moves.
- the comments in the three page loads and `tests/unit/destructive-actions.test.ts`'s
  header that say the same.

### 5. What each page load provides

Today the three loads (`settings/privacy`, `settings/data`,
`settings/data/import`) each return `hasPassword` from
`accountHasPassword(userId)`. Replace that with one server helper beside the
guard — so the answer keeps a single owner — returning what the dialog needs
to describe the gate:

```ts
type DestructiveConfirmation =
  | { kind: "password" }
  | { kind: "recentSignIn"; recent: boolean; providers: WebProvider[] };
type WebProvider = "google" | "github";
```

- `recent` is `signedInRecently(locals.session.authenticatedAt, new Date())`
  at load time.
- `providers` are the user's `oauth_accounts` rows whose provider has a web
  sign-in **and is configured** (`getGoogle()` / `getGitHub()` non-null in
  `src/lib/server/auth/oauth.ts`). `apple` is excluded: it exists only on
  `/api/v1` and has no web flow. In display order Google, then GitHub.
- The names (`DestructiveConfirmation`, `kind`, …) are the builder's call; the
  information is not.

`recent` can go stale while the page sits open (load at 9:59, submit at
10:01). That is expected and handled: the server refuses with
`RECENT_SIGN_IN_MESSAGE` and the dialog switches to the sign-in prompt (§6).
Do not add a client-side countdown: it would need the server-relative clock
machinery the dashboard has, for no gain over the refusal.

### 6. The dialog: `ui/DestructiveConfirm.svelte`

Replace the `hasPassword: boolean` prop with the `DestructiveConfirmation`
value plus the `returnTo` path for the page hosting it. Behaviour:

- `kind: "password"`: exactly as now (word + password field).
- `kind: "recentSignIn"` and the sign-in is needed — that is, `recent` is
  false **or** the dialog's `error === RECENT_SIGN_IN_MESSAGE`:
  - Render one block, not two: an `Alert` with title **"Sign in again to
    confirm"**, `tone="needs-you"` (amber in the status-colours spec: the
    user must act, nothing is wrong yet), saying that deleting needs a
    sign-in in the last 10 minutes, followed by one link per provider:
    "Sign in again with Google" → `/auth/callback/google?returnTo=<path>`,
    likewise GitHub. When the refusal message is what triggered this, it
    replaces the red error Alert rather than appearing beside it.
  - The danger button stays `aria-disabled` (not ready) while sign-in is
    needed. The word field stays, so the user can see what they will type
    when they come back.
  - Links are full-page navigations (`data-sveltekit-reload`, or whatever the
    login page's provider links rely on — the target is a `+server.ts`
    redirect, not a page).
  - If `providers` is empty (a misconfiguration: a password-less web session
    whose provider has since been removed), signing out would lock the user
    out, so never suggest it on its own. Say instead that this account has
    no way to sign in again here, and that setting a password with **Forgot
    password** on the sign-in page (signed out) makes the deletion
    available. No link: `/auth/reset-password` redirects a signed-in user
    to `/dashboard`. Password reset works for a password-less account
    (`auth/reset-password/+page.server.ts` looks the user up by email), and
    afterwards the account is a password account and gets the password
    dialog.
- `kind: "recentSignIn"` with `recent: true` and no refusal: word only, as the
  password-less dialog behaves today.

Readiness keeps mirroring the server: `ready` is false while sign-in is
needed.

Each page passes its own path as `returnTo`: `/settings/privacy` (both
dialogs), `/settings/data`, `/settings/data/import`.

### 7. Import: say it before the file is chosen (decided)

On `settings/data/import/+page.svelte`, when `mode === "replace"` and the
confirmation is `recentSignIn` with `recent: false`, show the same "Sign in
again to confirm" block (same component or a shared snippet — builder's
call) directly under the Replace radio, as decided ("next to the mode").

**Do not reorder the page's cards.** The "Choose a file" card currently sits
above the "How to import" card that holds the radios, so a user may already
have picked a file when they select Replace and see the notice. The round
trip then costs them a re-pick of the file — before any preview, upload or
commit, which is what the decision protects. Moving the mode card above the
file card would be a layout change nobody asked for. The dialog
still shows the block as a fallback for the stale-at-submit case; in that
case the user will have to choose the file again, and the block there should
say so ("You'll need to choose the file again.") — only on Import.

After the round trip the page loads in its default (Merge) mode. Restoring
Replace automatically is not required.

### 8. The return trip

**Allowlist.** One owner, server-side: a function that accepts a candidate and
returns it only if it is exactly one of `/settings/privacy`, `/settings/data`,
`/settings/data/import`, else `null`. Exact string match: no query, no
fragment, no trailing slash, no prefix matching, no decoding. This is what
makes an open redirect impossible by construction.

**Start leg** (`GET /auth/callback/[provider]` with no `code`): if
`url.searchParams.get("returnTo")` passes the allowlist, set a cookie
`auth_return_to` with the same options as `oauth_state` (httpOnly, `secure:
!dev`, `sameSite: "lax"`, `path: "/"`, `maxAge: 600`). If it does not pass,
delete any existing `auth_return_to`, so an abandoned earlier attempt cannot
steer this one.

**Finish leg, linked account without 2FA**: after creating the session,
read `auth_return_to`, delete it, re-check it against the allowlist (cookies
are user-controlled), and redirect there; otherwise `/dashboard` as now. The
new-account branch does the same (harmless, and keeps one code path).

**Finish leg, linked account with 2FA**: the callback leaves `auth_return_to`
alone and redirects to `/auth/2fa` as now. `/auth/2fa`'s success path, after
creating the session, reads, deletes, re-checks and redirects the same way;
otherwise `/dashboard`. The password login also passes through `/auth/2fa`;
a leftover cookie there can only send a just-signed-in user to one of three
of their own settings pages within 10 minutes, which is acceptable.

The error redirects (`oauth_email_unverified`, `oauth_email_conflict`) are
unchanged and leave the cookie to expire.

A re-sign-in that picks a **different** Google/GitHub identity signs in as
that account, as any sign-in does, and lands on the settings page as that
user. Nothing is deleted without that user typing the word. No special
handling.

### 9. Tests (CLAUDE.md's fake-db vs PGlite rule)

Nothing here is decided by a database predicate except the column's
round-trip through Lucia's real adapter, so:

- **`tests/unit/destructive-guard.test.ts` (fake-db)**, extended:
  - password-less + sign-in 1ms ago → ok; + exactly `RECENT_SIGN_IN_WINDOW_MS`
    ago → refused with `RECENT_SIGN_IN_MESSAGE`; + window − 1ms → ok (the two
    boundary probes pin `<` vs `<=`); + `null` → refused.
  - password account with a `null` / stale sign-in and a correct password →
    ok, `confirmReauth` called: freshness never applies to it.
  - the word is still checked first for a stale password-less session (wrong
    word → the word message, not the sign-in message).
  - `signedInRecently` directly, including a future timestamp → true.
- **Return-path allowlist (pure unit test)**: the three paths accepted;
  rejected: `/dashboard`, `//evil.example`, `/\evil.example`,
  `https://evil.example/settings/privacy`, `/settings/privacy?x=1`,
  `/settings/privacy/`, `/settings/privacy#x`, `/settings/data/import/../..`,
  percent-encoded variants, empty, `null`.
- **`tests/unit/auth-oauth-callback.test.ts` (existing, fake-db)**, extended:
  start leg sets `auth_return_to` for an allowlisted `returnTo` and clears it
  for anything else; finish leg redirects to an allowlisted cookie value and
  deletes it, falls back to `/dashboard` for a tampered value, and leaves it
  in place on the 2FA branch; `createSession` receives an `authenticatedAt`
  Date.
- **`/auth/2fa` success path**: redirects to the cookie's allowlisted value and
  deletes it; `/dashboard` without one. Extend `tests/unit/auth-2fa-action.test.ts`.
- **PGlite, new file in `tests/unit/pg/`**: the real `lucia` instance from
  `lucia.ts` over `pgDb` (mock `$lib/server/db` with pg-db's `dbMock`, as
  `pg/auth-totp.test.ts` does). Proves: migration 0022 applies;
  `createSession(u, { authenticatedAt })` stores it; `validateSession`
  returns it as `session.authenticatedAt`; after the clock passes the
  half-life so `validateSession` extends the session (`fresh: true`),
  `authenticatedAt` is unchanged; a row inserted with no
  `authenticated_at` reads back `null`. Follow the pg rules: `// @vitest-environment node`,
  `vi.useFakeTimers({ toFake: ["Date"] })` only, `pgDb.seedUser` first.
- **`tests/unit/pg/dose-trash-wipe.test.ts`** (~line 260) runs the real
  `deleteAccount` for a password-less user with `locals.session = { id: "s1" }`.
  Give that session a recent `authenticatedAt`, or the new guard refuses it
  and the test fails for the wrong reason.
- **The four actions** (`tests/unit/destructive-actions.test.ts` and
  `app-action-auth-guard.test.ts`): update for the new guard argument; add at
  least one action-level case showing a stale password-less session gets
  `fail(400, { error: RECENT_SIGN_IN_MESSAGE })` and deletes nothing.
- **Dialog and pages** (`destructive-confirm.svelte.test.ts`,
  `destructive-pages-ssr.test.ts`, `destructive-pages-mount.svelte.test.ts`):
  the sign-in block renders for `recent: false`, renders in place of the red
  Alert when `error === RECENT_SIGN_IN_MESSAGE`, has one correctly built link
  per provider, keeps the danger button `aria-disabled`; nothing extra for a
  recent session; the password dialog is unchanged. Import shows the block
  under Replace only when Replace is selected and the sign-in is not recent.
- Prove each new test by mutation (memory: "Prove tests by mutation"): flip
  `<` to `<=`, drop the `?? null`, drop the allowlist check on the cookie
  read, and watch a named test fail.

### 10. Rollout

- **The column must exist before code that selects it ships.** Lucia's
  adapter selects every column `schema.ts` declares on `sessions`, so on a
  database without `authenticated_at` every request with a session cookie
  500s in `hooks.server.ts`, and every sign-in fails. Production builds run
  `drizzle-kit push` before building and abort unless push reports success,
  so production is covered — **provided push can run unattended**. Before
  merging, check that nothing else is pending in push's diff for production
  (CLAUDE.md memory: prod once held columns `0013` dropped, which made push
  refuse). The PR body must say this.
- Preview deployments skip push. A preview whose `DATABASE_URL` lacks the
  column will 500 for signed-in users until production push has run. Say so
  in the PR.
- Rolling back with Vercel's **Instant Rollback** (no rebuild) is safe at
  runtime (old code neither selects nor writes the nullable column), but it returns password-less accounts to word-only deletion until
  roll-forward; sessions created meanwhile have NULL and fail closed again
  afterwards. A revert-and-**rebuild**, or a hotfix cut from a branch without
  this change, is not a clean rollback: production push would plan dropping a
  column from a non-empty `sessions` table, which needs approval, so the build
  aborts. Roll forward instead.
- Every password-less user signs in again once, the first time they delete
  after deploy. Intended.

## Left to the builder

- Parameter shapes and names (§4, §5), whether `now` is injectable, and
  whether session stamping goes through a helper (§2).
- The Alert's exact body copy beyond its title "Sign in again to confirm" and
  the 10-minute statement, and the link text beyond "Sign in again with
  <Provider>".
- Whether the import notice reuses the dialog's block as a component or a
  snippet.
- Test file placement within the rules above.

## Calls made in writing this (not discussed with the user)

- Column named `authenticated_at` (meaning) rather than `created_at`
  (mechanics), nullable, no default — required by the "not recent" decision
  under `drizzle-kit push`.
- `DatabaseSessionAttributes.authenticatedAt` required, so the compiler finds
  every session creation; API sessions stamped too.
- Strict `<` at the boundary; a timestamp up to a minute in the future counts
  as recent, further ahead does not.
- The refusal is recognised by a shared message constant, not a new failure
  field, to keep `actionErrorMessage` the single reader.
- Exact-match allowlist of three paths instead of general `returnTo` support.
- `auth_return_to` survives the 2FA step via a cookie, and a non-allowlisted
  `returnTo` clears a stale one.
- The re-sign-in does not end the session it replaces (out of scope; a
  stolen copy of the old cookie can no longer delete anything, which is the
  goal).
- Providers offered are only linked **and** configured web providers; an empty
  list explains Forgot password instead of suggesting a sign-out that would
  lock the user out.
- The protection claim is the narrow one (the four bulk deletions); the
  per-dose delete is recorded as a known gap, not fixed here.
- Import's cards keep their order; the notice sits under Replace as decided.
