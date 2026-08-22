# Runbook

Incident response and rollback for the production deployment at
<https://medication-tracker.jamiewhite.site>.

`DEPLOYMENT.md` covers how to _set the app up_ and how to rotate secrets.
This file covers what to do when it is already running and something is
wrong.

## 0. What this app is, for triage purposes

Single maintainer, no on-call rota, no paging. Saying so explicitly
matters: it means **detection is the weak link, not response**. The
CRON_SECRET outage in 2026 was unnoticed for four months not because
nobody could fix it but because nothing was watching. Prioritise
monitoring over process here.

It also means the honest escalation path is short — see §5.

## 1. Severity

Severity is set by _harm to a user's medication schedule_, not by how
broken the system looks.

| Sev      | Meaning                                                 | Examples                                                                                           |
| -------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **SEV1** | Data loss, or wrong medical information shown to a user | Dose history missing or truncated; inventory or adherence showing another user's data; auth bypass |
| **SEV2** | Reminders silently not delivered                        | Cron 500s or times out; Resend/VAPID rejecting; `reminder_events` stops accruing rows              |
| **SEV3** | App degraded but data intact and reminders flowing      | Analytics page erroring; slow TTFB; a settings form failing to save                                |
| **SEV4** | Cosmetic                                                | Layout break, wrong icon, copy error                                                               |

A silent reminder failure is **SEV2, not SEV3**. The user experience of a
missed reminder is indistinguishable from "no dose was due", so it does
not self-report — unlike a visibly broken page, which does.

## 2. First 15 minutes

Run these in order. Each is cheap and eliminates a whole class of cause.

```bash
# 1. Is it up at all, and is the edge or the function failing?
curl -sS -D - -o /dev/null https://medication-tracker.jamiewhite.site/

# 2. Is the app serving? NOTE: this makes no database calls, so a
#    200 here does not clear Neon. Step 4 is what proves the database.
curl -fsS https://medication-tracker.jamiewhite.site/api/health

# 3. Is the cron endpoint still authenticating?
curl -i https://medication-tracker.jamiewhite.site/api/cron/reminders
#    → expect 401. A 500 here means CRON_SECRET is unset in Vercel
#      Production, which fails *before* any reminder work happens.

# 4. Does it run with the secret? (this actually sends reminders)
curl -i -H "Authorization: Bearer $CRON_SECRET" \
  https://medication-tracker.jamiewhite.site/api/cron/reminders
```

Then check, in the Vercel dashboard: **Deployments** (did something ship
just before this started?) → **Logs** → **Cron Jobs** (last run status).

On Hobby, runtime logs are retained for roughly an hour and are not
drainable. If an incident is worth diagnosing, **copy the logs out
before you do anything else** — they will be gone by the time you have a
fix.

## 3. Rollback

### The normal case

Vercel → **Deployments** → pick the last known-good one → **Instant
Rollback**. This re-points the alias at an already-built output. It does
not rebuild, so it is fast and cannot fail on a build error.

Equivalent from the CLI:

```bash
vercel rollback <deployment-url>
```

### The trap: code rolls back, the database does not

Production builds with `MIGRATE_ON_BUILD=true`, so every deploy runs
`drizzle-kit push` against the live database _during the build_
(`scripts/vercel-build.mjs`). Rolling the deployment back does **not**
undo that.

What this means in practice:

- **Additive changes are safe to roll back.** A new nullable column or a
  new table is ignored by the older code. This is the overwhelming
  majority of changes and needs no special handling.
- **Destructive changes are not.** If a migration dropped or renamed a
  column the old code still selects, rolling back gives you a deployment
  that immediately errors on that query.

`drizzle-kit push` aborts on destructive changes in non-TTY mode, which
is why this has not bitten yet — the safety property is doing real work.
Treat any build where you overrode that as un-rollbackable, and fix
forward instead.

**Before rolling back across a schema change**, check what the rolled-back
code expects:

```bash
git diff <good-sha>..<bad-sha> -- src/lib/server/db/schema.ts drizzle/
```

If that diff is empty, roll back freely.

### Fixing forward

Preferred for anything schema-adjacent. Push a fix to `main`; Vercel
auto-deploys. If the build itself is broken, roll back first to stop the
bleeding, then fix forward at your own pace.

## 4. Known failure modes

Ordered by how often they have actually happened.

| Symptom                                              | Likely cause                                                                                              | Fix                                                                             |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| No reminders at all, cron returns 500                | `CRON_SECRET` unset in Vercel **Production** specifically                                                 | Set it in Production scope, redeploy                                            |
| Reminders arrive for some meds, never the later ones | Cron hit the function time limit mid-loop; the loop is sequential and ordered                             | Confirm `maxDuration` is still set on the cron route; check for a slow provider |
| Cron works when triggered manually, not on schedule  | Vercel Hobby allows one cron run per day; the 30-min cadence comes from the `reminder-tick` GitHub Action | Check the Action is enabled and its secret matches                              |
| Push silent, email fine                              | VAPID key rotated, or subscription expired (410)                                                          | 410s self-prune on the next tick; otherwise re-subscribe in Settings            |
| First request after idle very slow                   | Neon compute auto-suspended                                                                               | Expected on the free tier; ~500ms–2s                                            |
| `too many connections`                               | Using the unpooled Neon host                                                                              | Use the `-pooler` host in `DATABASE_URL`                                        |

## 5. Escalation and communication

Be realistic about the shape of this project rather than inventing a
process that will not be followed.

- **Escalation** is to the maintainer. There is no second line. The
  practical substitute for a rota is making failures loud (§6).
- **Third parties** own several failure modes outright, and the status
  pages are the fastest way to rule them in or out:
  - Vercel — <https://www.vercel-status.com>
  - Neon — <https://neonstatus.com>
  - Resend — <https://resend-status.com>
- **User communication.** For a SEV1 or a prolonged SEV2, users cannot be
  reached in-app if the app is down, and there is no announcement
  channel. If this app ever takes on users beyond the maintainer, that
  gap needs closing before launch, not after — a medication reminder
  service that fails silently and cannot tell anyone is the worst
  combination of the two.

## 6. Detection

Two layers, because neither one alone is sufficient. Together they are
the substitute for the Log Drains and alerting Vercel gates behind Pro.

### Layer 1 — liveness (`.github/workflows/uptime.yml`)

Probes `/api/health` every 15 minutes and fails the workflow after three
consecutive bad probes, which emails the repository owner.

**`/api/health` makes no database calls.** It is a pure liveness probe by
design, and that is a feature, not an oversight: polling it around the
clock cannot hold the Neon compute awake, so it does not undo the
overnight scale-to-zero that `reminder-tick.yml` preserves.

The consequence has to be stated plainly, because it is the thing most
likely to give false comfort: **a green uptime run does not mean the
database is up.** It means the app is serving. Depth is layer 2's job.

The probe asserts on `"ok":true` in the body rather than the status code
alone — a deploy serving an error page at that path would satisfy a
naive 200 check.

### Layer 2 — the heartbeat (`src/lib/server/heartbeat.ts`)

The reminder tick pings `HEARTBEAT_URL` as its last action, only on the
success path. Reaching that line proves the database is reachable and
writable and that both reminder sweeps completed — the strongest health
signal the system produces.

This is a **dead-man switch**: the receiving service alerts when a ping
_fails to arrive_. That inversion is the entire point. A cron that stops
running raises no error to alert on, and an uptime check cannot see it
either, since it can only observe requests that happen. That is exactly
how CRON_SECRET being unset went unnoticed for four months.

To set it up: create a check on any dead-man-switch provider
(Healthchecks.io, Better Stack, Cronitor, Uptime Kuma), set its period to
roughly 1 hour with a grace period, and put the ping URL in the Vercel
**Production** environment as `HEARTBEAT_URL`. Leave it unset in Preview
and Development — a preview deployment pinging production's switch would
hold it green and mask a real outage.

Verify with a manual run; the response body reports the outcome:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://medication-tracker.jamiewhite.site/api/cron/reminders
# → {"ok":true,"heartbeat":"sent"}      configured and reaching the provider
# → {"ok":true,"heartbeat":"disabled"}  HEARTBEAT_URL not set
```

A ping failure never fails the tick. Sending medication reminders is the
job; monitoring is not allowed to interfere with it.

### What still has no coverage

Both layers depend on GitHub's scheduler, which disables scheduled
workflows in repositories dormant for 60 days. The heartbeat is what
catches the uptime workflow going quiet; nothing catches the heartbeat
provider itself failing. That residual gap is accepted.

### Spend Management

Vercel dashboard → Usage → set a spend cap and an alert threshold. On
Hobby the practical risk is not a bill but hitting the free ceiling and
having the project paused with no notice.

## 7. After an incident

Keep it proportional — a paragraph, not a template:

1. What the user-visible impact was, and for how long.
2. Why it was not detected sooner. This is usually the real finding.
3. The one change that would have caught it, and whether it is worth
   making.

Record it in `CHANGELOG.md` if it changed behaviour, or as an ADR under
`docs/adr/` if it changed a decision.
