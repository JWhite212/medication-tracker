# P3 - Split Notification Preferences

> **Status:** in progress
> **Branch:** `feat/split-notification-prefs`
> **Owner:** Jamie

**Goal:** Replace the two coarse `emailReminders` / `lowInventoryAlerts` toggles with four channel-specific preferences. After this PR, "email off, push on" and the reverse both work as expected, and overdue and low-inventory are independently configurable.

**Architecture:** Add four boolean columns on `user_preferences`. Backfill from the legacy columns so existing users keep their current behaviour. Validation schema, settings UI, and reminder dispatch all switch to the new columns. The legacy columns stay in the schema marked DEPRECATED for one prod cycle so we can roll back without losing any reads.

---

## Schema additions

```sql
ALTER TABLE user_preferences
  ADD COLUMN overdue_email_reminders boolean NOT NULL DEFAULT true,
  ADD COLUMN overdue_push_reminders boolean NOT NULL DEFAULT true,
  ADD COLUMN low_inventory_email_alerts boolean NOT NULL DEFAULT true,
  ADD COLUMN low_inventory_push_alerts boolean NOT NULL DEFAULT false;

UPDATE user_preferences
  SET overdue_email_reminders = email_reminders,
      low_inventory_email_alerts = low_inventory_alerts,
      overdue_push_reminders = true,
      low_inventory_push_alerts = false;
```

- `overduePushReminders` defaults true on backfill: push was always-on for users with subscriptions before this PR, preserving behaviour.
- `lowInventoryPushAlerts` defaults false on backfill: low-inventory has never sent push, and we should not start without consent.

## File Structure

- Modify: `src/lib/server/db/schema.ts` (add 4 columns; mark legacy 2 DEPRECATED)
- New: `drizzle/0011_phase_3_split_notification_prefs.sql`
- Modify: `src/lib/utils/validation.ts` (`notificationSchema` replaces 2 fields with 4)
- Modify: `src/routes/(app)/settings/notifications/+page.server.ts` (audit-changes uses new fields; load surfaces them)
- Modify: `src/routes/(app)/settings/notifications/+page.svelte` (4 toggles organised by reminder type; verify-email hint gated on either email pref being true)
- Modify: `src/lib/server/reminders.ts` (filter rows where ANY relevant pref is on; per-row per-channel gates use the new fields)
- Modify: `scripts/seed-demo.ts`, `scripts/seed-e2e.ts` (write the 4 new fields)
- Modify: `tests/unit/reminders.test.ts` (mock fixtures gain the 4 fields; new cases for email-off+push-on and push-off+email-on)

## Risks / notes

- Legacy columns are KEPT in this PR. A follow-up can drop them after one prod cycle; CLAUDE.md already documents this pattern from `medications.scheduleType`.
- For the cron filter, "any of the 4 prefs is true" replaces the current `emailReminders=true` predicate. The dispatcher then gates each channel on its specific pref inside the loop, so a user with all 4 prefs off costs zero work past the SQL filter.
- Push for low-inventory is a NEW capability. The dispatcher gains a push send for that loop; existing reminders.ts only sent push for overdue.
