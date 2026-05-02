# Local Review: transactions spike (stash@{0} on `feat/phase-2-transactions`)

**Reviewed**: 2026-05-01
**Branch**: `feat/phase-2-transactions` (uncommitted, in stash)
**Base**: `d23ab41 feat: persist reminder_events dedupe and gate inventory on dose status`
**Decision**: **APPROVE WITH COMMENTS** — pending Vercel cold-start benchmark before merge

**Update (post-review)**: H1 and H2 comment fixes have been applied directly to `stash@{0}`. Tests still 247/247 green after the edits. The remaining open item before merge is the cold-start benchmark (M1).

## Summary

Replaces the pre-existing fake-atomicity (`Promise.all`) on three dose-write paths and the schedule-replace path with real Postgres transactions via a new websocket-driver `dbTx` export. Diff is correct, tightly scoped, well-tested, and the dual-driver split (HTTP for reads, WS-Pool only for transactional writes) keeps cold-start cost off the read path. Two stale/misleading comments need fixing (now done — see post-review note above); otherwise no functional concerns. Cold-start of the first transactional write is the open trade-off the user already flagged.

## Findings

### CRITICAL

None.

### HIGH

**H1. Stale comment in `src/lib/server/schedules.ts:53-55` contradicts new behavior**

```
// Delete-then-insert. Neon HTTP driver does not support real
// transactions, so this is best-effort atomic — the window between
// the delete and the insert is one HTTP round-trip.
```

This comment describes the OLD behavior. The function now wraps both ops in `dbTx.transaction(...)` (line 91), so the race window is closed. Future readers will be misled about correctness guarantees.

**Fix**: Delete the comment, or replace with a one-liner like `// Delete-then-insert wrapped in a transaction below — atomic.`

**Status**: Fixed in `stash@{0}` — comment now reads "Delete-then-insert wrapped in a transaction (below) so a failed insert rolls back the delete and the original schedule rows survive."

---

**H2. Misleading comment in `src/lib/server/doses.ts:73-75` about audit-on-rollback semantics**

```
// Insert + inventory decrement in a single transaction — partial
// failure rolls back both. Audit log stays outside so it survives a
// rollback (we want the audit trail of attempted writes too).
```

The intent stated ("audit survives rollback") is the opposite of what the code does. When `dbTx.transaction(...)` throws, the function throws on line 76 and `await logAudit(...)` on line 108 is never reached. The companion test (`tests/unit/doses-inventory.test.ts:188-205`) explicitly asserts `auditCalls === []` after a rollback — i.e. audit is SKIPPED.

This is the conventional pattern (audit-on-success-only), and the test documents that behavior — but the comment claims otherwise. Either:
- (preferred) Fix the comment to describe actual behavior: `// Audit log runs after the tx commits; a rollback throws and skips the audit (we don't audit attempted-but-rolled-back writes).`
- Or genuinely audit attempted writes by wrapping in try/catch and logging on both paths (with a status field) — but that's a design change, not a comment fix.

(Initial review claimed the same misleading comment appeared in `deleteDose` and `updateDose`. Re-reading the diff, only `logDose` had the contradictory wording — the other two functions just describe the transaction itself without making the audit-survives-rollback claim. Scope of H2 is `logDose` only.)

**Status**: Fixed in `stash@{0}` — comment now reads "Audit log runs after the tx commits; a rollback throws past it, so rolled-back writes are not audited."

### MEDIUM

**M1. Cold-start latency for first transactional write per Vercel instance**

`new Pool({ connectionString })` is module-scoped and lazy (the comment at `db/index.ts:14-16` is correct), so reads pay nothing. But the FIRST `logDose`/`updateDose`/`deleteDose`/`replaceSchedulesForMedication` call after a cold start pays the websocket handshake — typically 100-300ms over a fresh TCP connection to Neon.

User already flagged this as the open question pending benchmark. **Don't merge before measuring.**

Suggestion: Add a `vercel.json` or hooks-based warm-up that runs a no-op tx on cold start, OR explicitly accept the latency hit and document it. A benchmark target in the PR description would help reviewers calibrate.

---

**M2. Tests mock the transaction wrapper itself — real rollback semantics not verified**

`tests/unit/doses-inventory.test.ts:86-90` mocks `dbTx.transaction` as `(cb) => cb(buildChainable())`. This:
- Verifies that the audit log and downstream code are skipped when the callback throws ✅
- Does NOT verify that Postgres actually rolls back the dose-log INSERT when the inventory UPDATE fails ❌

The real rollback can only be validated against live Postgres. This is consistent with the project's mock-only test posture (CLAUDE.md: "tests that touch the database mock the `db` import"), so it's not a regression — but the spike's headline claim ("partial failure rolls back both") is uncovered by the unit tests.

Suggestion: Either (a) add a single integration test that runs against a real Postgres (Docker compose / Neon dev branch), OR (b) note in the PR description that rollback semantics are not unit-tested and rely on Postgres' transaction guarantees + Drizzle's `tx` API.

### LOW

**L1. `Pool` constructor uses defaults — no explicit `max`/`idleTimeoutMillis`**

`db/index.ts:17`: `const pool = new Pool({ connectionString: env.DATABASE_URL! });`

Neon's `@neondatabase/serverless` Pool default for `max` is 10. Under burst (e.g. cron-fanout dose logs across many users), one Vercel instance might saturate while other instances sit idle. Not a bug today; worth setting `max: 5` (or whatever Neon compute plan supports) to make the limit explicit.

---

**L2. No `pool.end()` lifecycle hook**

For Vercel serverless this is fine (platform tears down the instance), but for local `npm run dev` or scripts that import `dbTx`, the pool can keep the Node process alive past task completion. Low priority unless someone actually hits it.

---

**L3. CLAUDE.md not updated**

The "Key Patterns" section still says "Inventory auto-decrements on dose log, auto-restores on delete" without mentioning the new transactional guarantee. A one-line update ("...both ops are atomic via `dbTx.transaction`") would help future readers and assistants.

## Strengths

Worth calling out — the spike does several things right:

- **Dual-driver split is the right shape**: HTTP for ~95% of queries (cold-start friendly), WS only where transactions are required. Avoids the "force-everything-through-Pool" tax.
- **Audit log placement is correct**: outside the transaction, only on success. Matches conventional audit-log semantics. (Just fix the comments to say so.)
- **Schedule-replace race window closed**: this was a real correctness gap (delete-then-insert across two HTTP RTTs) and the fix is one-shot.
- **Status-aware inventory restore preserved through the rewrite**: skipped/missed doses still don't trigger restore, and `updateDose` still skips inventory diff for non-taken doses.
- **Tests for rollback observability are clever**: the `failOnUpdateOf` flag combined with the `auditCalls` mock gives a clean assertion that "throw inside the tx → audit not called" without needing a real DB.

## Validation Results

| Check | Result | Notes |
|---|---|---|
| Type check (`npm run check`) | **Pass** | 0 errors, 17 pre-existing warnings (Svelte runes + a11y, unrelated to diff) |
| Lint (`npm run lint`) | **Pass** | 0 errors, 83 pre-existing warnings (unrelated) |
| Tests (`npx vitest run`) | **Pass** | 247/247 across 20 test files |
| Build (`npm run build`) | **Pass** | Vercel adapter completes; pre-existing externalized-dep warnings only |

## Files Reviewed

| File | Change | Lines |
|---|---|---|
| `src/lib/server/db/index.ts` | Modified | +14 / -3 |
| `src/lib/server/doses.ts` | Modified | +57 / -56 |
| `src/lib/server/schedules.ts` | Modified | +27 / -22 |
| `tests/unit/doses-inventory.test.ts` | Modified | +93 / -27 |
| `tests/unit/schedules-server.test.ts` | Modified | +13 / -5 |

## Recommended Next Steps

1. ~~Apply the 2 comment fixes (H1 + H2)~~ — **done; both fixes applied to `stash@{0}` post-review.**
2. Run a Vercel cold-start benchmark on a preview deployment: time `POST /log` and `POST /medications/[id]` (the routes that hit `dbTx`) against the current main and against this branch. Target: ≤ +100ms p95 on cold-start.
3. Optionally: tighten `Pool({ max: 5 })` or whatever Neon compute plan supports.
4. Open as `--draft` PR with the benchmark numbers in the description; flip to ready once L1/L2/L3 are addressed or explicitly deferred.
5. After merge, update CLAUDE.md "Key Patterns" with the transactional guarantee.
