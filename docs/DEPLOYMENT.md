# Deployment

End-to-end runbook for deploying MedTracker to Vercel + Neon. Pairs
with [`.env.example`](../.env.example), [`vercel.json`](../vercel.json),
[`svelte.config.js`](../svelte.config.js), and [`docs/case-study.md`](./case-study.md).

## 1. Prerequisites

- **Node.js 22.x** (matches `adapter-vercel` runtime in `svelte.config.js`)
- **npm 10+**
- A **GitHub** repo (fork/clone of `JWhite212/medication-tracker`)
- A **Vercel** account linked to that repo
- A **Neon** account for managed Postgres
- _Optional_: [Vercel CLI](https://vercel.com/docs/cli) (`npm i -g vercel`) for local pulls + ad-hoc deploys

## 2. Provision the database (Neon)

1. In the [Neon console](https://console.neon.tech) create a new project
   (region close to your Vercel deployment region).
2. From the project dashboard, copy the **pooled** connection string
   (the one with `-pooler` in the host). Append `?sslmode=require` if
   it isn't already there.

```bash
# Example — yours will differ
export DATABASE_URL='postgresql://user:pass@ep-xxxx-pooler.region.aws.neon.tech/neondb?sslmode=require'
```

Use the pooled endpoint — Vercel's serverless functions open a fresh
connection per invocation and the unpooled endpoint will exhaust
connection limits under load.

## 3. Run migrations against Neon

Drizzle migrations live in `drizzle/` and are checked into the repo.
Apply them once before the first deploy, then again whenever schema
changes ship.

```bash
npm install
DATABASE_URL="$DATABASE_URL" npm run db:migrate
```

## 4. Generate secrets

```bash
# Encryption key — used to AES-256-GCM-encrypt TOTP secrets at rest.
# MUST stay stable across deploys; rotating it invalidates 2FA for
# every user (see section 10).
openssl rand -base64 48

# Cron shared secret — Vercel Cron sends this in the Authorization
# header when invoking /api/cron/reminders.
openssl rand -base64 32

# VAPID keys — for browser Web Push. Stable across deploys.
npx web-push generate-vapid-keys
```

Keep these in a password manager. You'll paste them into Vercel next.

## 5. Configure Vercel

1. **Import the repo** — `vercel.com/new` → pick your fork → framework
   auto-detects as SvelteKit.
2. **Set environment variables** (Project → Settings → Environment
   Variables). Use the same keys as `.env.example`:

   | Variable                       | Required         | Notes                                                      |
   | ------------------------------ | ---------------- | ---------------------------------------------------------- |
   | `DATABASE_URL`                 | Yes              | Pooled Neon URL with `?sslmode=require`                    |
   | `ENCRYPTION_KEY`               | Yes (prod)       | `openssl rand -base64 48` output                           |
   | `CRON_SECRET`                  | Yes for cron     | Random 32+ char string                                     |
   | `PUBLIC_BASE_URL`              | Yes (prod)       | e.g. `https://your-app.vercel.app`                         |
   | `RESEND_API_KEY`               | For email        | From [resend.com](https://resend.com) dashboard            |
   | `EMAIL_FROM`                   | For email        | `MedTracker <noreply@yourdomain.tld>` (verified in Resend) |
   | `VAPID_PUBLIC_KEY`             | For push         | Output of `web-push generate-vapid-keys`                   |
   | `VAPID_PRIVATE_KEY`            | For push         | Same                                                       |
   | `VAPID_EMAIL`                  | For push         | `mailto:you@yourdomain.tld`                                |
   | `GOOGLE_CLIENT_ID` / `_SECRET` | For Google OAuth | Optional                                                   |
   | `GITHUB_CLIENT_ID` / `_SECRET` | For GitHub OAuth | Optional                                                   |
   | `INTERACTIONS_ENABLED`         | Optional         | `true` to enable experimental drug-interaction checks      |

3. **Node runtime** — already pinned to `nodejs22.x` in
   `svelte.config.js`. No dashboard change needed.

## 6. Cron

`vercel.json` already wires the daily reminder cron:

```json
{
  "crons": [{ "path": "/api/cron/reminders", "schedule": "0 9 * * *" }]
}
```

After the first deploy, confirm it appears under **Project → Settings →
Cron Jobs**. The endpoint rejects any request whose
`Authorization: Bearer <token>` doesn't match `CRON_SECRET`.

## 7. First deploy

```bash
git push origin main
```

Vercel auto-builds. Watch the build logs in the dashboard. A successful
build runs `vite build` via `@sveltejs/adapter-vercel` and emits
serverless functions under `.vercel/output/`.

## 8. Post-deploy verification

Replace `https://your-app.vercel.app` with your deployment URL.

```bash
# Health check (added in audit unit 16 — see /api/health)
curl -fsS https://your-app.vercel.app/api/health

# Cron endpoint refuses unauthenticated traffic
curl -i https://your-app.vercel.app/api/cron/reminders
# → 401 Unauthorized

# Cron endpoint accepts the shared secret
curl -i -H "Authorization: Bearer $CRON_SECRET" \
  https://your-app.vercel.app/api/cron/reminders
# → 200 OK
```

Then:

1. Visit the site, register a user, log in.
2. _(Optional)_ Run `npm run seed:demo` against the production DB
   locally to create a demo account; sign in with the printed
   credentials.
3. Add a medication, log a dose, view `/analytics` — adherence and the
   sparkline should render.
4. Trigger a manual reminder cron run from the Vercel dashboard
   (Cron Jobs → Run now) and check Resend / push delivery.

## 9. Updating

```bash
git push origin main           # Vercel auto-deploys
```

For schema changes:

```bash
npx drizzle-kit generate                          # locally, commits new SQL
DATABASE_URL="$DATABASE_URL" npm run db:migrate   # run against Neon
git push origin main                              # ship the code that uses it
```

Always ship the migration before (or atomically with) the code that
depends on it — Vercel does not gate deploys on migrations.

## 10. Rotating secrets

- **`CRON_SECRET`** — update in Vercel env vars, redeploy. Zero user
  impact.
- **`VAPID_*`** — rotating invalidates every existing push subscription.
  Users will re-subscribe on next visit. Update env vars, redeploy.
- **`RESEND_API_KEY`** — rotate in Resend, paste into Vercel, redeploy.
- **`ENCRYPTION_KEY`** — _destructive_. Rotating it makes existing
  encrypted TOTP secrets unreadable. The current path is a one-shot
  manual re-encryption script:

  ```bash
  # 1. With OLD key still set, dump or decrypt secrets locally.
  # 2. Set NEW ENCRYPTION_KEY in Vercel + locally.
  # 3. Re-run the encryption migration:
  DATABASE_URL="$DATABASE_URL" ENCRYPTION_KEY="$NEW_KEY" \
    npm run encrypt:totp
  ```

  An online rotation flow (decrypt-with-old, re-encrypt-with-new in a
  single pass) is on the backlog. Until it lands, treat `ENCRYPTION_KEY`
  as effectively immutable.

## 11. Troubleshooting

- **`ECONNRESET` / `too many connections`** — you're using the unpooled
  Neon endpoint. Switch to the host with `-pooler` in it.
- **`SSL connection required`** — append `?sslmode=require` to
  `DATABASE_URL`.
- **First request after idle is slow** — Neon compute auto-suspends.
  Cold start is ~500 ms-2 s. Enable Neon's "always-on" tier or accept
  the cold-start trade-off.
- **`Invalid CRON_SECRET`** — env var present in Preview but not
  Production (or vice versa). Vercel scopes per environment; set it in
  all three (Production, Preview, Development) if you want parity.
- **Push notifications silent** — check `VAPID_EMAIL` is `mailto:` not
  a bare address; check the browser actually granted permission; check
  Vercel function logs for 410 (subscription expired — auto-pruned on
  next cron) vs 4xx (config issue).
- **Build fails with `DATABASE_URL is not defined`** — set it as a
  build-time env var too. The schema validator runs at module load.
