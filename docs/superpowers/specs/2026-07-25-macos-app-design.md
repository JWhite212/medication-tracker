# MedTracker for Mac — Design Spec

**Date:** 2026-07-25
**Status:** Draft for review
**Author:** Jamie White (with senior-engineer analysis)
**Supersedes/complements:** the existing SvelteKit web app (`docs/superpowers/specs/2026-04-15-medication-tracker-design.md`)

---

## 1. Goal

Ship **MedTracker for Mac** — a native macOS app on the **Mac App Store** that does everything the existing web app does (full feature parity), adds **native local medication reminders**, and is secure, professionally built, and App-Review-ready. The current SvelteKit/Neon web app stays alive and useful as the owner's **mobile client** (accessed from an Android phone), sharing one account and one dataset with the Mac app. iOS is a possible future target but is **not** a personal requirement (the owner has no iOS device).

This is both a personal-use tool and a portfolio/certification milestone: the owner has just joined the Apple Developer Program and wants a complete, production-grade app on the Store.

### End state

| Surface                              | Role                                          | Notes                                                                  |
| ------------------------------------ | --------------------------------------------- | ---------------------------------------------------------------------- |
| **Web app** (SvelteKit/Neon)         | Canonical backend + **Android mobile client** | Stays as-is for browsing/logging on the go; gains a versioned JSON API |
| **`/api/v1`** (new, in the web repo) | Sync + command fabric                         | Bearer-auth, wraps existing domain functions — one source of truth     |
| **Mac app** (Swift 6 / SwiftUI)      | Native desktop client                         | Offline-capable local replica; native reminders; App Store deliverable |

---

## 2. Decisions locked in (from brainstorming)

These were decided with the owner before writing this spec.

1. **Client architecture: native Swift 6 / SwiftUI.** Not a Tauri/web wrapper. A wrapper draws "minimum functionality" scrutiny on a health app and forecloses a clean future-native path; native is the App-Review-clean, portfolio-grade artifact.
2. **Data fabric: shared backend from v1 (`native-plus-backend-sync`).** The Mac app is an **offline-capable client of the existing SvelteKit/Neon backend**, which gains a small versioned `/api/v1`. This is the decision that keeps the web app first-class: one account, one dataset, no diverging silos between the Mac (desk) and the web (Android phone).
3. **Reminders: native macOS local notifications only** (this project). `UNUserNotificationCenter`, scheduled on-device from synced schedule data. Web Push to Android is explicitly **out of scope** this round; the web app remains the owner's mobile client for _viewing and logging_, not for push reminders.
4. **Scope: full parity 1.0.** Everything the web app does ships in 1.0 — dashboard, medication CRUD, schedules, history, analytics, exports, notifications, app lock.
5. **openFDA drug-interaction checker: kept, default-off.** The app already needs the network entitlement for sync, so the marginal cost is low. Ships behind an off-by-default Settings toggle with the FDA cited and the existing "experimental" framing.
6. **Data migration: via sync, not an import wizard.** Because the Mac app is a client of the same backend, the owner's existing history flows to the Mac on **login + first sync** — no fragile CSV/JSON importer to build for the owner's own data. (A versioned JSON export is still built, but as a _backup / data-portability_ feature — see §12.)

### 2.1 Why `native-plus-backend-sync`, honestly

In the abstract multi-architecture comparison, this approach scored **lowest** (a fully standalone local-first app is a cleaner App Store story and less work). It wins **here** because of the owner's concrete situation:

- **Desktop Mac Mini + Android phone, no iOS device.** The Mac app's reminders and data only reach the owner _at the desk_. Their only portable client is the Android phone, which can only run the web app. A standalone Mac app would make the web app a separate, diverging data silo — the exact outcome the owner wants to avoid.
- **Accurate adherence history is the whole point.** Two silos (Mac vs web) means two disagreeing medication histories. A shared backend keeps one truth.

The trade we consciously accept for this: it's an **account-based health app**, which raises the App Review bar (privacy label becomes "data linked to you," Sign in with Apple becomes required, in-app account deletion required) and introduces sync-staleness and sync-correctness engineering. §7, §10, and §11 address each of these head-on. All are shippable; none is a blocker.

---

## 3. System architecture

```
┌─────────────────────────┐        ┌──────────────────────────────┐
│  Android phone (browser) │        │   Mac (SwiftUI native app)   │
│      = web app UI        │        │  ┌────────────────────────┐  │
└───────────┬─────────────┘        │  │ local SQLite replica    │  │
            │ HTTPS (SvelteKit)     │  │ (GRDB, offline truth)   │  │
            │                       │  │ + UNUserNotificationCtr │  │
            ▼                       │  └───────────┬────────────┘  │
┌─────────────────────────────────┐│              │ /api/v1 (bearer)
│   SvelteKit app on Vercel        ││              ▼
│  ┌───────────────────────────┐   ││   pull (cursor+tombstones)
│  │ existing form actions/UI  │   │◀─┤   push (idempotent commands)
│  │ + NEW /api/v1 endpoints   │◀──┼──┘
│  │   (wrap same domain fns)  │   │
│  └────────────┬──────────────┘   │
│               ▼                   │
│         Neon Postgres  ◀── canonical source of truth
└─────────────────────────────────┘
```

**Principle: the server stays canonical; every transactional invariant lives in exactly one place.** The `/api/v1` command endpoints call the _same_ server domain functions the web form actions already call (`logDose`, `refillMedication`, `updateMedicationWithSchedules`, …), so inventory clamping, signed inventory-event ledgers, audit diffs, and schedule replacement can never fork between web and Mac. The Mac app keeps a full local replica for offline reads/writes and schedules notifications locally, but writes replay as server-side **commands** so the server resolves inventory.

### 3.1 Repository structure — DECIDED: separate repo

The Mac app lives in its **own new GitHub repository** in a **new local folder alongside `medication-tracker`** (a sibling directory one level above the current project folder, i.e. under `…/Projects/`). The work therefore spans **two repositories**:

```
…/Projects/
  medication-tracker/     # EXISTING web repo — gains the /api/v1 backend, migrations, Sign in with Apple
  medtracker-mac/         # NEW repo — Xcode workspace + SPM packages (the Swift app)
```

The new repo documents the `/api/v1` contract it consumes (a checked-in OpenAPI/JSON-schema file kept in sync by hand or generated from the web repo). Trade vs a monorepo: two repos to coordinate on contract changes, in exchange for zero churn to the existing web app's layout and a clean, independently-versioned Swift codebase. The new repo is created fresh; the current `worktree-macos-app-design` branch on the web repo only carries this spec and the `/api/v1` backend work.

---

## 4. The web app's evolving role (the dilemma, answered)

The owner's constraint — _"the web app must stay useful because it's my only mobile client"_ — is satisfied structurally:

- The web app is **unchanged for end users**. Every existing screen, login, and feature keeps working on the Android phone's browser.
- It becomes the **canonical data hub**: whatever the owner logs on the phone (web) appears on the Mac after sync, and vice-versa.
- The only additions to the web app are **server-side and invisible to the existing UI**: the `/api/v1` endpoints, a bearer-token validation path, `updated_at`/tombstone columns for sync, and a Sign in with Apple provider.

**Reminder coverage, stated plainly:** with Web Push out of scope this round, reminders fire on the **Mac only** (native notifications at the desk). The web app remains the mobile client for _viewing and logging_, not for push alerts on Android. If the owner later wants reminders on the phone too, the web app's existing (but unconfigured) Web Push stack — `push_subscriptions`, `service-worker.ts`, `/api/push/subscribe`, VAPID keys — is ~90% built and can be finished as a follow-on; it is deliberately **not** in this project's scope.

---

## 5. Backend: `/api/v1` (additions to the SvelteKit app)

A small, strictly-versioned JSON API. **Every mutation endpoint wraps an existing domain function** — no business logic is reimplemented.

### 5.1 Auth

- `POST /api/v1/auth/login` — email + password; if `twoFactorEnabled`, a second step consumes a TOTP code via the existing atomic verify-and-consume. Returns the Lucia session id as a **bearer token**.
- Bearer validation reuses the existing `validateSession` (30-day sliding). The Mac client stores the token in the **data-protection Keychain** (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, never synced), treats `401` as re-login.
- **Sign in with Apple** added server-side (via `arctic`, same pattern as Google/GitHub) — required by **Guideline 4.8** because the backend already offers third-party OAuth, and it lets OAuth-only web accounts authenticate natively.
- **Proactive token refresh** on background sync so an app used mostly via notifications doesn't silently fall to a dead session (a named risk — §16).

### 5.2 Sync (pull)

- `GET /api/v1/sync?cursor=` — returns changed rows per table since the caller's `updated_at` watermark.
- **Migrations required:** add `updated_at` to `dose_logs` and `medication_schedules` (medications/preferences already have it); add a **`sync_tombstones`** table written in the _same transaction_ as any delete (the audit log almost serves as an oplog but misses cascaded child deletes, so tombstones are explicit).

### 5.3 Commands (push)

- `POST /api/v1/commands` — a batch of idempotent commands with client-generated cuid2 entity ids and **idempotency keys** stored server-side. Command set mirrors the web's mutations: `log_dose`, `skip_dose`, `edit_dose`, `delete_dose`, `refill`, `adjust_inventory`, `upsert_medication_with_schedules`, `archive`/`unarchive`, `reorder`, preference updates, and the destructive wipes.
- Each command executes the existing transactional server function. The client **re-pulls after every push** so local state reflects the server's resolution (inventory converges because the server serializes the ledger).

### 5.4 Conflict policy

- **Last-writer-wins on `updated_at`** for field edits (acceptable for a single user across devices).
- **Command replay** for event-like writes (dose log/skip/refill/adjust) — the server, not the client, resolves inventory.
- Append-only ledgers (`dose_logs`, `inventory_events`, `audit_logs`) merge as insert-only sets; `inventory_count` is treated as **derived from the ledger** on the server, never as an independently-synced counter.

### 5.5 Versioning discipline

- Strictly version `/api/v1`; **tolerant decoding** on the client; never make a breaking change without `/api/v2`. A contract change must never break a shipped Mac client. Endpoints only ever wrap existing domain functions — hold that line or the "one source of truth" property erodes.

---

## 6. Mac app architecture

**Swift 6.2** (strict concurrency), **SwiftUI-only**, **Xcode 26.x**, minimum deployment **macOS 15 (Sequoia)** with availability-gated adoption of macOS 26 materials. One Xcode workspace, an app target, and four local SPM packages:

1. **`MedTrackerCore`** — pure domain, zero Apple deps beyond Foundation. Schedule-slot computation, timing status, refill forecasting, adherence/insights, streak/trend math, lifecycle clamping, sparkline geometry, WCAG contrast picker, CSV escaping, formatters. **Ported 1:1 from the web's TypeScript; its unit tests are transcribed as the parity contract** (§8).
2. **`MedTrackerData`** — GRDB 7 / SQLite persistence: schema, `DatabaseMigrator` migrations, repositories, the sync engine (pull, outbox, reconciliation), and the local audit/reminder-event ledgers.
3. **`MedTrackerServices`** — `NotificationPlanner`, app-lock (`LocalAuthentication`), export (PDFKit/Core Graphics + CSV), openFDA client.
4. **`MedTrackerAPI`** — `URLSession` + `Codable` client for `/api/v1` (async/await, no third-party networking).

**Third-party deps kept to two:** GRDB (ships its own privacy manifest) and `swift-snapshot-testing` (test-only). Charts are custom `Canvas`/`Path` (Swift Charts deliberately skipped — the four visuals are simple and exactly specified).

### 6.1 Why GRDB, not SwiftData

This app is **aggregation-heavy**: daily dose counts bucketed by user-timezone local date, `extract(hour)`/`extract(dow)` distributions, 14-day quantity-sum sparklines, 30-day taken-quantity refill signal, side-effect JSON filters, partial indexes, and a 3-way `CHECK`-constrained schedule union. SwiftData has no real `GROUP BY`/aggregation story, weak migration control, and a history of macOS bugs. GRDB gives real SQL, `DatabaseMigrator` versioned migrations, `DatabasePool`/WAL, `ValueObservation` for live UI (replacing SvelteKit load-invalidation), and **real transactions** — which lets us wrap each load-bearing atomic unit (dose+decrement+event; delete+restore+event; med+schedules+audit) in one SQLite transaction.

Timezone-correct SQL aggregation is solved with a registered Swift `DatabaseFunction localDate(epochSeconds, tzIdentifier)` backed by a cached `Calendar`, so `GROUP BY` stays in SQL and honours the **user's profile timezone** — which also fixes the web heatmap's device-tz/user-tz mismatch (§15).

---

## 7. Notifications — the headline feature

**Model inversion:** the web app _polls_ "is anything overdue?" from a once-daily 09:00-UTC cron. The Mac app **pre-schedules `UNUserNotificationCenter` requests at the true dose instants** — a genuine UX upgrade (dose-time alarms, not a daily digest), and exactly what the owner asked for. Documented as an intentional improvement, not a parity break.

### 7.1 The planner

A single **`NotificationPlanner` actor** is the only scheduling writer. It is **declarative and idempotent** (reconciliation, not event-only rescheduling):

1. Compute the desired set of `(identifier, content, trigger)` from schedules + last-event anchors + prefs over a **rolling 7-day horizon, hard-capped at 60 requests** (under iOS's documented 64-pending limit, for future portability; free to design to it now).
2. Diff against `getPendingNotificationRequests()` and add/remove only the delta.

So a crash or missed trigger **self-heals** on next run instead of silently killing a reminder.

**Replan triggers:** every dose log/skip/edit/delete, schedule change, archive/unarchive, med delete, pref toggle, app launch/foreground, **`NSWorkspace.didWakeNotification`**, **`NSSystemTimeZoneDidChange`**, and **sync completion** (remote changes from the phone!).

### 7.2 Trigger mapping (exact)

- **`fixed_time`** → repeating `UNCalendarNotificationTrigger` with `DateComponents(hour:minute:)` in the profile timezone, **one trigger per selected weekday**, with the explicit **`0=Sunday…6=Saturday` → `Calendar.weekday 1…7` (+1)** conversion. Natively DST-correct — replaces the web's manual offset math.
- **`interval`** → one-shot trigger at `lastTakenAt + intervalHours`, re-anchored on every taken/skipped event (**skip advances the clock, missed does not** — ported exactly). Pre-schedule 2–3 projected occurrences within the horizon so a quit app still nags.
- **`prn`** and **archived meds** schedule nothing. Iterate **per schedule row**, not per medication (a multi-rule med produces independent reminders).

### 7.3 Identifiers & suppression (parity)

- **Identifiers reuse the web's dedupe-key strings verbatim** — `userId:medId:overdue:scheduleKind:scheduleId:slotISO` and `userId:medId:low_inventory:count`. Re-registering an identifier replaces it, reproducing the web's `ON CONFLICT` idempotency for free.
- A **taken dose within ±60 min** of a fixed-time slot cancels that pending request (`removePendingNotificationRequests`).
- **Interval meds never remind before the first logged dose** (web quirk — kept deliberately, documented; see §15 for the keep/fix decision).
- **Low-inventory inverts to event-driven:** checked after _every_ inventory mutation, in the same code path as the ledger write, fired immediately (`nil` trigger), deduped by `(medId, count)` in the local `reminder_event` table. **Improvement over the web:** suppression **resets when a refill raises the count above threshold** (the web suppresses a given count forever).

### 7.4 Actions & content

- `UNNotificationCategory` with **Log dose / Skip / Snooze 10 min**. The delegate's `didReceive` runs the same local transaction (log/skip writes the dose row, adjusts inventory, appends the event, enqueues the outbox command) and triggers a replan — without opening a window. Snooze schedules a one-shot with a `:snooze:n` identifier suffix so dedupe holds.
- **Exact copy** from the web: `"{name} overdue"`, `"Last taken {h}h {m}m ago"` / `"Not yet taken"`, `"Low inventory: {name}"`, `"{count} doses remaining (threshold {threshold})."` `threadIdentifier` per medication for grouping. Note: an interval slot's "last taken" phrase is exactly `"{interval}h 0m ago"` at the trigger instant — compose content at schedule time accordingly.

### 7.5 Entitlements & honest macOS limits

- **`com.apple.developer.usernotifications.time-sensitive`** — dose reminders marked `.timeSensitive` to break through Focus. Medication reminders are Apple's canonical example; include a one-sentence justification in Review notes. **Never use the word "alarm" in App Store metadata** — macOS cannot deliver true alarm semantics and reviewers of med apps notice overpromising.
- **Critical alerts** (`…critical-alerts`, breaks through mute/Focus) require **discretionary Apple approval**. Filed **in parallel, strictly additive** — launch never blocks on it.
- **No AlarmKit on native macOS** (iOS/iPadOS 26+ only). Time-sensitive notifications are the ceiling on the Mac; AlarmKit is the right tool _if_ iOS is ever built, behind the same planner protocol.
- **App-quit behavior, stated honestly:** the system delivers scheduled notifications even when the app has quit; repeating fixed-time triggers keep firing indefinitely. But **interval chains and inventory checks need code execution** — an interval reminder can't re-chain after firing until next launch. Mitigations: horizon pre-scheduling, `NSBackgroundActivityScheduler` refresh while running, and an **opt-in launch-at-login menu-bar agent** (`SMAppService` + `LSUIElement`) surfaced as a first-class onboarding step, that keeps the planner resident.

### 7.6 Sync-staleness (the backend-sync tax on reminders)

A dose logged on the phone (web) leaves the Mac's pending notifications stale until the next sync — a false "overdue" alert is a 1-star generator on a health app. Mitigations, in order:

1. **`NSBackgroundActivityScheduler` periodic pulls** (~15 min) while running, each triggering a replan on sync completion.
2. **Replan on every sync completion and on app foreground.**
3. A committed **v1.1 item** (not this project): APNs silent "sync nudge" push on server-side mutation so other devices replan promptly.

### 7.7 Dropped from the web (remote-channel compensation only)

The claim/complete retry state machine (`MAX_ATTEMPTS=3`, 30-min cooldown, stale-lease recovery), Resend email channel, VAPID/push-subscription tables, service worker, and CRON*SECRET endpoint all exist to compensate for unreliable \_remote* channels and at-least-once cron. Local `UNUserNotificationCenter` delivery doesn't fail that way — dropped. We keep a **local `reminder_event` delivery ledger** (identifier, slot, delivered/suppressed) purely for a "why didn't I get a reminder?" audit trail.

---

## 8. Domain parity contract

`MedTrackerCore` ports the web's **already-pure** functions 1:1, and the **existing ~28 vitest suites (~358 cases) are transcribed into Swift Testing as the behavioral spec**. This is the single highest-leverage, most de-risking work in the project. **Write the DST/timezone parity tests first, before any UI.**

### 8.1 Constants that must carry over verbatim

| Rule                             | Value                                                                                                                                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Dose→slot match tolerance        | **±1 hour** (`MATCH_TOLERANCE_MS = 3_600_000`); greedy, one dose per slot, ascending slot order                                                                                                                                                                     |
| Timing status windows            | overdue ≤ **−60s**; due_now within **±60s**; due_soon ≤ **1h**; else ok; never-handled → overdue, `minutesUntilDue = −1`                                                                                                                                            |
| Refill severity                  | **critical ≤3d, warning ≤7d, watch ≤14d**, else ok; `days = floor(inventory / dailyRate)`                                                                                                                                                                           |
| Daily-rate selection order       | (1) schedule rows if `expectedPerDay > 0`; (2) legacy `24/intervalHours` for `scheduleType='scheduled'`; (3) `thirtyDayTakenQuantity / 30`                                                                                                                          |
| Expected doses/day               | interval `24/hrs`; fixed_time `daysOfWeek.length/7` (or 1 if every day); prn `0`                                                                                                                                                                                    |
| Adherence %                      | `min(100, round(taken/expected * 1000)/10)` (1-decimal); overuse = `round((taken−expected)/expected * 1000)/10` when taken > expected                                                                                                                               |
| Stat windows                     | weekly = 7×24h; avg-daily = 30-day row-count ÷ 30 (list view); refill signal = 30-day **taken-quantity** sum                                                                                                                                                        |
| Time-of-day buckets (local hour) | morning [5,12) ☀️, afternoon [12,17) 🌤️, evening [17,21) 🌅, night otherwise 🌙                                                                                                                                                                                     |
| Streak                           | 0 unless today (en-CA date, user tz) has a taken dose; then count consecutive days with gap == 1                                                                                                                                                                    |
| Insights                         | 7 rules, thresholds: **≥5pp** trend, **<80%** lowest-adherence, **0.7×** worst-day (≥7 events), **30%** peak-hour (≥5 events), **≥3** side effects, **≥3-day** streak; sorted warning→positive→info; **max 5**; exact strings incl. the em dash; never prescriptive |
| Lifecycle clamp                  | `clampEffectiveDays` = rounded-day intersection of range and `[startedAt, endedAt]`; <12h overlap → 0 days                                                                                                                                                          |
| Contrast picker                  | WCAG relative luminance, candidates `#111111`/`#ffffff`, pick greater worst-case ratio (tie → dark), 4-direction 1px text outline                                                                                                                                   |
| Schedule validation              | interval `0 < h ≤ 72`; `timeOfDay` `^([01]\d                                                                                                                                                                                                                        | 2[0-3]):[0-5]\d$`; `daysOfWeek` ints 0–6 ≤7; **1–20 rows** per med |
| Dose validation                  | quantity int ≥1 (create), **1–10** (edit); notes ≤500; side effects ≤20 of `{name 1–100, severity ∈ mild/moderate/severe}`                                                                                                                                          |
| Medication validation            | name 1–200; `dosageAmount` `^\d+(\.\d+)?$`; unit 1–20; notes ≤1000; form/category/pattern enums as listed                                                                                                                                                           |
| Export CSV                       | formula-injection apostrophe guard (`^[=+\-@\t\r]`), RFC-4180 quoting, CRLF; dose CSV in **user tz**, audit CSV in **UTC**                                                                                                                                          |
| PDF                              | title 20pt `#0a93cf`; sections Header / Adherence summary / Medications (incl. archived) / Dose log (newest-first, `[SKIPPED]`) / Side-effect frequency / Footer; **verbatim medical disclaimer**                                                                   |

### 8.2 Data-shape notes for Swift

- Model `dosageAmount`, `intervalHours` as **`Decimal`/`Double`** (the Drizzle numeric-as-string quirk vanishes in Swift; only the importer/sync-decoder must parse string numerics defensively).
- `inventoryCount` and `quantity` are in **doses**, not raw units.
- `daysOfWeek` uses **0=Sunday**; convert at the `Calendar.weekday` (1=Sunday) boundary.
- All timestamps stored **UTC epoch**; day boundaries/buckets computed in the **user profile timezone**.
- **`missed` status exists in the enum, is rendered (slot "overdue"), but is never written per-row** — it's inferred at aggregate level as `max(0, expected − taken − skipped)`.

---

## 9. Local data model (SQLite / GRDB)

Mirror of the canonical schema, **sync-ready by construction**:

- Tables: `medication`, `medication_schedule` (with the 3-way `CHECK` constraints ported verbatim), `dose_log`, `inventory_event`, `audit_log`, `reminder_event` (local delivery ledger), `profile`, `settings`.
- **Local-only tables:** `outbox` (queued commands + idempotency keys), `sync_state` (per-table `updated_at` cursor).
- **IDs stay cuid2 `TEXT`** (a small Swift cuid2 port) and `user_id` columns are retained, so every row round-trips to Postgres without an id-mapping layer.
- `foreign_keys = ON`, `ON DELETE CASCADE`, WAL mode.
- **Transactions are load-bearing:** dose+decrement+event, delete+restore+event, edit+diff+event, refill/adjust+event, med+schedules+audit each = one SQLite transaction; the audit row is written **after commit** where the web app does. Preserve the subtlety that the recorded inventory-event delta is the **clamped** actual change (`newCount − previousCount`), and that delete-restore is intentionally **unclamped**.
- Preferences live in a **1-row `settings` table** (not `UserDefaults`) so they join the same backup/sync/audit story. Keep web defaults verbatim: accent `#6366f1`, 12h time, comfortable density, page size 20, heatmap 90d, PDF export.

---

## 10. Screen map (SwiftUI)

`NavigationSplitView` with 5 destinations mirroring the web Sidebar. Every web `use:enhance` form becomes a **local GRDB write + `ValueObservation` refresh + outbox enqueue**, preserving the same success side-effects (toast text, 700ms flash, sheet close) and the same validation messages.

| Web screen            | Mac screen        | Key behaviors to preserve                                                                                                                                                                                                                              |
| --------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dashboard             | Dashboard         | SummaryStrip, RefillsCard, **My Day timeline** (time-of-day groups), **QuickLogBar** pills (pattern backgrounds + contrast text, qty 1–10, success flash), Today feed with overdue rows + Skip, TimeSince live counters, onboarding wizard when 0 meds |
| Medications list      | Medications       | MedicationCard (pattern swatch, refill/low chips, adherence mini-bar, 14-day sparkline), reorder, archived `<details>` group                                                                                                                           |
| Medication new/[id]   | Med form + detail | MedicationForm (identity/dosage/form/category/**StylePicker**/**ScheduleSection**/inventory), interaction probe (default-off), inventory ops (refill/adjust) + event history, archive/unarchive                                                        |
| History (`/log`)      | History           | Filter bar (med/status/date/notes-search/side-effects), local-date grouping (Today/Yesterday/…), pagination, TimelineEntry with edit sheet + delete                                                                                                    |
| Analytics             | Analytics         | InsightsCard, period control 7/30/90/1y + custom range, stat cards + sparklines, **Heatmap**, AdherenceChart, StatusBreakdownBar, day-of-week + time-of-day distributions (scheduled-hour ▼ markers), side-effects                                     |
| Settings + 5 subpages | Settings          | Profile (name, timezone), Appearance (accent/date-format/12-24h/density/reduce-motion), **Notifications** (redesigned — §10.1), Data (export, delete all data), Privacy (live counts, exports, wipe slices)                                            |

### 10.1 Settings changes vs the web

- **Notifications** collapses the web's four channel booleans + email-verification + Web Push card into: **"Overdue dose reminders"** and **"Low inventory alerts"** toggles, plus the OS notification-permission state and the launch-at-login agent opt-in. Requesting `UNAuthorizationOptions([.alert,.sound,.badge])` on toggle-enable, denial handled gracefully (toast + pref stays off), mirroring the web UX.
- **Security** replaces password-change / 2FA / session-list with an **optional app lock** (`LocalAuthentication`) and re-auth gates (§11). The _account's_ password/2FA still exist server-side and are managed via the web app.
- **Keyboard shortcuts** → macOS `.keyboardShortcut`: ⌘1–9 quick-log Nth med, `n` new med, `/` focus filter, `?` help; suppressed while text-editing (responder chain handles this).

### 10.2 Design language

Dark-only theme. Glass panels → `.ultraThinMaterial`/`.thinMaterial` over a near-black surface (or literal white-8%/white-12% fills, radius 12–16pt). Token palette (surface `#0a0a0f`, raised `#12121a`, text `#f0f0f5`/`#8888a0`, success `#10b981`, warning `#f59e0b`, danger `#ef4444`, default accent `#6366f1`) as asset-catalog colors; accent user-selectable from the 10 presets and recomputing a readable foreground. **8 medication patterns** reimplemented as SwiftUI fills (`LinearGradient`/`RadialGradient`/`AngularGradient`/`Canvas`) with the exact geometry and the `<20pt → gradient` degradation; `getReadableTextColor` ported verbatim. Custom charts via `Canvas`/`Path` (port `buildSparklineShape` 1:1). Full accessibility parity: Dynamic Type, VoiceOver labels reusing the exact aria-label strings on every icon button/chart bar/heatmap cell, reduce-motion honored from **both** system setting and in-app pref, WCAG-contrast foreground on arbitrary user colours.

---

## 11. Security model

**Hybrid: the account stays server-protected; the device is OS-protected.**

- **Account auth stays on the server** — Lucia sessions, OAuth, TOTP 2FA, HIBP breach check, IP rate limits, host-poisoning defenses all remain (they protect the internet-reachable account and the web app). The Mac app authenticates via a **bearer token** (Lucia session id) in the **data-protection Keychain**; server-side keys never touch the client.
- **App Sandbox ON** (mandatory for MAS). Minimal entitlements: `app-sandbox`; `network.client` (API + openFDA); `usernotifications.time-sensitive`; `files.user-selected.read-write` (via `NSSavePanel`/`NSOpenPanel` powerbox — no broad file access). Critical-alerts and CloudKit only if/when pursued. **Hardened Runtime** enabled.
- **App lock:** `LocalAuthentication` `LAPolicy.deviceOwnerAuthentication` (Touch ID / Apple Watch / password fallback — the "no-biometrics" case, learned from the web's OAuth-only exemption) optionally gating launch and return-from-background after a grace period. The web's **8 re-auth purposes** map to fresh `LAContext` evaluations immediately before each destructive action (delete all data, wipe dose history, wipe archived meds, export, change lock settings), with `touchIDAuthenticationAllowableReuseDuration` mirroring the web's 5-minute reuse window. **Keep the type-`DELETE`+auth gate** on account deletion.
- **Data at rest:** the SQLite replica lives in the sandbox container under FileVault; since the server holds the canonical copy, **SQLCipher is deferred** (documented decision) with an optional "Encrypt my data" setting available later, keyed via CryptoKit + data-protection Keychain.
- **Audit parity:** app-lock success/failure and destructive confirmations write local `audit_log` rows mirroring the web's `(entity, action, JSON diff)` pattern, sentinel ids `*`/`n/a` included.
- **No third-party analytics or crash SDKs** — `MetricKit` only, consistent with the web app's "no analytics on dose data" promise.

---

## 12. Data migration & backup/durability

- **Migration = login + sync.** The owner's existing history is in Neon and flows to the Mac on first sign-in. No import wizard needed for the owner's own data — a real simplification the shared-backend choice buys us.
- **Versioned JSON export (backup / portability), still built.** A `GET /api/v1/export/full` (and a local "Export backup" in the Mac app) producing a versioned, round-trippable JSON of the complete account (meds + schedules + dose logs + inventory events + audit + preferences + lifecycle columns). Purpose: (1) satisfy the App Store "export my data" expectation and the existing Settings "Data Management" card that already advertises export; (2) defend against local-replica corruption; (3) future-proof a possible standalone/other-tool path. This subsumes the earlier "add JSON export first" decision — it's a backup feature now, not the migration mechanism.
- **Backup/restore & durability** (the web app has _no_ backup story — durability was silently delegated to Neon): the Mac app's local replica is reconstructible from the server (destructive re-sync is the escape hatch), plus Time Machine covers the sandbox container, plus the versioned JSON export gives a user-controlled snapshot. Document corrupt-store recovery (re-sync from server) explicitly.
- Keep the existing export **parity**: dose CSV (exact columns, user-tz, formula-injection guard), audit CSV (UTC), PDF (PDFKit, verbatim disclaimer), filenames `medtracker-report-YYYY-MM-DD.{pdf,csv}` / `medtracker-audit-YYYY-MM-DD.csv`, delivered via `NSSavePanel`.

---

## 13. App Store compliance (health app)

| Guideline                                      | Posture                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1.4.1 (physical harm)**                      | Personal tracker, not a dosage calculator/diagnostic. Carry the **verbatim medical disclaimer** on first run, medication form, analytics, and exports. Insights engine never emits prescriptive wording. openFDA checker **default-off**, FDA cited, "experimental / may miss / may produce false positives" framing; keep it out of screenshots. Replicate the web's **registration consent gate** (`disclaimerAcknowledged`) as a first-run consent step. |
| **5.1.1(v) account deletion**                  | Required (account-based app). Backend flow exists; expose it natively behind the type-`DELETE` + auth gate.                                                                                                                                                                                                                                                                                                                                                 |
| **5.1.3 (health data)**                        | No ads, no analytics on health data, no third-party sharing — trivially true.                                                                                                                                                                                                                                                                                                                                                                               |
| **4.8 (login services)**                       | Backend offers Google/GitHub → **Sign in with Apple** required; added server-side.                                                                                                                                                                                                                                                                                                                                                                          |
| **Privacy nutrition label**                    | Honest answer for a server-backed account app: **Health & Fitness data + email/name/user-id "collected, linked to identity, not used for tracking."** (Not "Data Not Collected" — that was the standalone path we didn't take.) Privacy policy URL mandatory.                                                                                                                                                                                               |
| **Privacy manifest** (`PrivacyInfo.xcprivacy`) | `NSPrivacyTracking=false`, no tracking domains, declared collected types, required-reason APIs (`UserDefaults CA92.1`; file-timestamp `C617.1` if used). GRDB bundles its own.                                                                                                                                                                                                                                                                              |
| **Housekeeping**                               | Category **Health & Fitness** (not Medical — same defensibility, less scrutiny), `ITSAppUsesNonExemptEncryption` set (standard encryption only), age rating per medical questionnaire, **seed "Load sample data"** affordance (reuse `seed:demo`) so App Review sees a populated app in under a minute. Budget **one rejection round-trip**.                                                                                                                |

---

## 14. Testing & quality

- **Parity suite first:** transcribe the ~28 vitest suites into Swift Testing; **DST/timezone cases before any UI** — spring-forward gap (02:30 fixed_time slots), fall-back ambiguity, the `0..6 → weekday 1..7` conversion, JS `Math.round` vs Swift rounding, profile-tz vs device-tz divergence, clock/tz change while quit.
- **Sync-correctness integration tests** against a Neon branch: inventory convergence, edit/delete races, idempotent replay, re-pull-after-push, expired-session handling. (Highest-severity risk class — §16.)
- **Notification QA matrix** (largely manual): asleep, quit-for-days, tz change, DST boundary, horizon exhaustion, action round-trips into a SQLite transaction.
- **XCUITest** mirroring the Playwright journeys against a deterministic seeded store (reuse `seed:e2e` shape: 3 meds / 14 days).
- **CI:** GitHub Actions macOS runner (or Xcode Cloud) running `xcodebuild test` with **coverage floors at measured baselines** (the repo's regression-floor philosophy), **SwiftLint + SwiftFormat** replacing ESLint/Prettier. Backend gains `/api/v1` Vitest coverage.
- **Accessibility audit** (Accessibility Inspector + XCUITest) replacing the axe-core serious/critical CI gate.

---

## 15. Inherited-quirks register (explicit keep/fix)

The critic flagged that silently "fixing" these changes user-visible numbers. Each gets a conscious decision:

| Quirk                                                                                                                                 | Decision                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| List-view `avgDailyConsumption` counts **rows of any status** (incl. skipped) ÷30, while refill forecast sums **taken quantity** only | **Fix** — unify on the forecast (single source of truth per CLAUDE.md); the list view was inconsistent. Flag in changelog. |
| Same medication card shows **legacy-computed** "~Nd supply left" next to **schedule-aware** severity chip (can contradict)            | **Fix** — both from the schedule-aware `getRefillForecast`.                                                                |
| Interval meds **never remind until first dose logged** (no baseline)                                                                  | **Keep** for v1 parity; revisit as a "schedule-creation anchor" improvement later. Documented in-app.                      |
| Low-inventory count, once alerted, **suppressed forever**                                                                             | **Fix** — reset suppression when a refill raises count above threshold (the improvement noted in §7.3).                    |
| Heatmap keyed by **device-local** date but counts by **user-tz** date                                                                 | **Fix** — unify on profile tz (§6.1).                                                                                      |
| Interaction check includes **archived** meds                                                                                          | **Keep, documented** (DECIDED) — same behavior as the web; note it in the interaction-notice copy.                         |
| `missed` status **never written** per-row (aggregate-inferred only)                                                                   | **Keep** — same inference.                                                                                                 |
| `dateFormat` preference is **write-only dead code** on the web (stored, never read)                                                   | **Implement** it on the Mac (wire it into `DateFormatter`) — it should do what it says.                                    |
| Dose quantity **unbounded on create**, 1–10 on edit                                                                                   | **Fix** — apply the 1–10 bound consistently.                                                                               |
| `fixed_time`-only meds get **no timing badge** (badges are legacy-column-driven)                                                      | **Fix** — derive timing/next-dose from schedule rows so fixed-time meds get badges too.                                    |

---

## 16. Risks & mitigations

| Risk                                                                                                                | Mitigation                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DST/timezone parity divergence** (Foundation `Calendar` vs JS `Intl` resolve DST-gap/ambiguous hours differently) | Dedicated spring-forward/fall-back parity tests **before UI**; pin `Calendar` behavior against the TS math. Highest-leverage de-risking work.                                                      |
| **Sync-correctness bugs** corrupting inventory/dose history across devices                                          | Writes replay as **server-side commands** (server resolves inventory), idempotency keys, re-pull-after-push, dedicated integration test rig against a Neon branch.                                 |
| **Stale on-device notifications** after cross-device logging → false "overdue"                                      | Background sync (~15 min) + replan on sync/foreground now; APNs silent push committed for v1.1.                                                                                                    |
| **Lucia session silently expires** for a notification-only app → dead sync channel                                  | Proactive token refresh on background sync; graceful degrade to re-login.                                                                                                                          |
| **App Review friction** on health framing / openFDA / 4.8                                                           | Verbatim disclaimer everywhere, openFDA default-off, Sign in with Apple, in-app account deletion, demo seed, thorough review notes; budget one rejection round-trip.                               |
| **Critical-alerts entitlement refused**                                                                             | Strictly additive; never load-bearing.                                                                                                                                                             |
| **64-pending budget overflow** with many meds × multi-time schedules                                                | Planner prioritizes chronologically, per-med fair-share; `log()` any dropped tail (no silent truncation).                                                                                          |
| **Solo-dev estimate risk** (SwiftUI polish + accessibility routinely 1.5×)                                          | If the ceiling breaks, cut the openFDA checker and menu-bar agent, **never** the parity tests, notification QA, or accessibility pass. De-scope pixel-perfect charts to "faithful, not identical." |
| **Ecosystem drift** (AlarmKit, SwiftData, macOS 27 policies)                                                        | Protocol-isolated planner + repository layers; re-validate APIs each WWDC.                                                                                                                         |

---

## 17. Effort & phased roadmap

Solo senior dev, strong in TypeScript, newer to Swift; FTE weeks, quality over speed.

| Phase                   | Scope                                                                                                                                                                                                                                                                                                                            | Est.                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **0 — Backend API**     | Bearer auth (incl. TOTP step) + Sign in with Apple; `updated_at` + `sync_tombstones` migrations; delta-sync endpoint; idempotent command endpoint wrapping existing domain fns; full-JSON export; Vitest coverage                                                                                                                | 2.5–3.5 wk                      |
| **1 — Mac core**        | **New `medtracker-mac` repo + local folder;** Xcode workspace + 4 SPM packages; GRDB schema + migrator; cuid2 port; **`MedTrackerCore` + parity tests** (budget 1.5–2 wk — this is the contract); Keychain/auth/login UI; **sync engine** (pull, outbox, reconciliation); Dashboard, Medications CRUD + schedule editor, History | 6–8 wk                          |
| **2 — Differentiators** | **Notification engine** (planner, actions, suppression, tz/wake/sync triggers, menu-bar agent, QA matrix); Analytics + insights; CSV/PDF export via `NSSavePanel`; Settings; app lock                                                                                                                                            | 4–6 wk                          |
| **3 — Ship**            | Accessibility pass; privacy manifest + nutrition label; screenshots; demo seed; TestFlight-for-Mac soak; App Review + one rejection round-trip                                                                                                                                                                                   | 2–3 wk                          |
| **Total**               |                                                                                                                                                                                                                                                                                                                                  | **~15–20 FTE wk (≈4–5 months)** |

**Phase 0 go/no-go spike (do first):** a sandboxed, Apple-Distribution-signed build proving (a) a scheduled `UNNotificationRequest` fires with the app fully quit, (b) a notification action launches the app and reaches the handler, (c) the time-sensitive entitlement is granted, (d) a bearer-auth `/api/v1` round-trip works. If the notification legs fail, the whole premise needs rework before investing months.

**iOS follow-on (not committed):** ~4–6 wk from the shared codebase — the API client, sync engine, `MedTrackerCore`, and notification logic all carry over, and AlarmKit slots into the same slot-math for alarm-grade reminders. Only relevant if the owner acquires an Apple mobile device.

---

## 18. Out of scope (this project)

- Web Push reminders to Android (the web app's Web Push stack stays unconfigured; noted as a cheap future follow-on).
- CloudKit / iCloud sync (the backend is the sync fabric; no CloudKit lock-in).
- iOS/iPadOS app.
- HealthKit integration.
- Any redesign of the web app's user-facing UI.

---

## 19. Decisions resolved (were open)

All five confirmed with the owner on 2026-07-25:

1. **Repo layout — separate repo + separate local folder.** New `medtracker-mac` GitHub repo in a new sibling folder alongside `medication-tracker` (one level above the current project dir, under `…/Projects/`). The `/api/v1` backend work stays in the existing web repo. See §3.1.
2. **Minimum macOS version — 15 (Sequoia).** Confirmed acceptable.
3. **openFDA interaction check — keep archived meds included, documented.** Same behavior as the web; noted in the interaction-notice copy. See §15.
4. **Expose the currently-hidden prefs — yes.** Surface `doseLogPageSize` (history page size) and `heatmapPeriod` (default analytics window) in Settings → Appearance/History rather than leaving them defaulted.
5. **Sign in with Apple — yes, added server-side.** Welcome feature; also satisfies Guideline 4.8 for the account-based app.
