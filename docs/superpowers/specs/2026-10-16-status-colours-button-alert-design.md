# Status colours, `Button` and `Alert` — design

Design-critique priority 4. The critique said: "Extract `Button` and `Alert` components and a single status-colour map. Most of the consistency table goes away as a side effect, including green 42% adherence and amber meaning eight things."

Branch `feat/status-colours`, cut from `main` at `e9ebd6e` (2026-10-16).

## Intent

Status colour in MedTracker should tell you, at a glance and without reading, whether something needs you, has gone wrong, or simply happened.

Today it doesn't. The user's words were "amber meaning everything". A map of today's `main` found about 20 meanings carried by amber in the signed-in app. No component asks a shared helper which colour to use; each one decides for itself. So:

- **The same status is coloured differently on different pages.**

  | Status  | Dashboard | Log   | Analytics |
  | ------- | --------- | ----- | --------- |
  | Skipped | grey      | amber | amber     |
  | Missed  | grey      | red   | red       |

- **One colour means unrelated things on the same page.** On Analytics, amber means skipped doses, the total-dose count, side-effect frequency and warning insights, all at once.
- **Colour states the opposite of the truth.** A 35% average adherence prints green.
- **Red is used for "turn it off".** Sign Out, Disable push and Archive (which can be undone) use the same red as permanently deleting your data.

Buttons and banners are where most of those colours live, so the critique bundled them in. There is no `Button` and no `Alert` component; the map found about 30 hand-written button recipes and about 40 hand-written banners.

## Goals

1. **One meaning per status colour, everywhere in the signed-in app.** The rules are in "The colour rules" below.
2. **One owner of the status-to-colour decision.** A new screen must not be able to invent its own amber, and a test enforces this.
3. **A `Button` primitive**, plus `IconButton` and `Toggle`, that every non-dose button uses. Each has fixed heights, a visible focus ring and a pending state.
4. **An `Alert` primitive** that every banner uses, with four tones, an icon, a headline, and correct screen-reader announcement.
5. **One guarded confirmation for every permanent, unrecoverable deletion.**
6. **The landing-page walkthrough follows.** Where it draws a surface this changes, it draws the new version, so the landing page doesn't advertise the old colours. This is the lesson of #170 and #174.

## Non-goals

- **Dose controls change colour only.** Their markup, size, behaviour and write path stay exactly as they are; see "The fence".
- **The heatmap's teal scale and each medication's own colours are untouched.** These are identity and intensity, not status. The rest of the critique's "chart colour" row is not in scope.
- **Not in scope from other critique rows:**
  - form inputs (`Input` adoption, border tokens on fields);
  - headings;
  - icons app-wide;
  - layout width;
  - `GlassCard` adoption;
  - the radius scale.
- **Toast is unchanged.** Its colours already obey the rules: success is green, including the Undo offer after a removal, and errors are red. Its markup is pinned by tests.
- **Field-level error lines stay as they are.** The `<p id="{name}-error" role="alert">` under a field is already red text with a word. There are 20 copies; folding them into a `FieldError` primitive is a separate, later cleanup.
- **Tap-target sizes outside the buttons migrated here belong to priority 5**, for example the 16px tooltip "i" and the onboarding step dots.

## Anti-goals

These would make this a failure even if everything else worked. The first is the user's own words.

- **"If dose buttons change size or stop working."** Any change to a dose control's size, focus behaviour, write lock or submit path is a failure. The tests that pin them stay green, unedited except where a colour class is asserted.
- **Reintroducing a status colour by hand at a call site** after the owner exists.
- **Colour as the only signal.** Every amber, red or green thing also carries a word or an icon.
- **A permanent deletion that can run without the guard**, whether through the UI or by posting the form directly.

## The colour rules

The user decided these three rules:

- **Amber means "this needs you".** Something you should act on.
- **Red means "something's gone wrong, or this can't be undone".**
- **Green only confirms that something happened.** It never judges a number as good.

The user approved the rest in playback and in the two mockups:

- **Neutral is everything else:** counts, percentages, trends, informational notes, and reversible "turn it off" actions.
- **The accent colour** keeps its current job: due now, selected or current state, and the page's main action. It is not a status colour beyond "due now".
- **The `info` colour retires as a status colour.** Its hue is nearly the accent's, so the "watch" refill tier and "selected" looked identical.
- **Colour is never the only signal.**

### Every status, and its tone

This table is the specification. The owner module (next section) encodes it.

| Status                                                                                                         | Where it appears                                                                                                                                                                                          | Tone                                                                       | Also carried by                                                       |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Dose overdue, including yesterday's unresolved "Earlier" slot                                                  | Dashboard `DueCard`, `StatusMarker`                                                                                                                                                                       | amber (unchanged)                                                          | "!" marker, aria "Overdue"                                            |
| Dose due now                                                                                                   | Dashboard                                                                                                                                                                                                 | accent (unchanged)                                                         | ring marker                                                           |
| Dose taken                                                                                                     | Dashboard, Log, Analytics bar                                                                                                                                                                             | green                                                                      | ✓                                                                     |
| Dose skipped                                                                                                   | Dashboard `DoneList`, Log `TimelineEntry`, Analytics `StatusBreakdownBar`                                                                                                                                 | **neutral** everywhere                                                     | "–" marker, the word "Skipped"                                        |
| Dose missed                                                                                                    | Dashboard `DoneList`, Log, Analytics bar                                                                                                                                                                  | **red** everywhere, including the dashboard, which is grey today           | ✕ marker, the word "Missed"                                           |
| Refill tiers `critical` (≤3 days) and `warning` (≤7 days)                                                      | `RefillsCard`, `MedicationCard`, the refill insight                                                                                                                                                       | **amber**, both tiers                                                      | "Reorder soon" plus the days left                                     |
| Refill tier `watch` (8–14 days)                                                                                | `RefillsCard`, `MedicationCard`                                                                                                                                                                           | **neutral**                                                                | "N days left"                                                         |
| Stock at or below the user's own alert threshold (`inventoryAlertThreshold`)                                   | `MedicationCard`                                                                                                                                                                                          | amber, **the same chip** as the refill tiers, not a separate "Low: N" chip | "Reorder soon" plus days left, or doses left when there's no forecast |
| Side effect: mild or moderate                                                                                  | Log chips, `SideEffectPicker`                                                                                                                                                                             | neutral                                                                    | the word "Mild" / "Moderate"                                          |
| Side effect: severe                                                                                            | Log chips, `SideEffectPicker`                                                                                                                                                                             | red                                                                        | the word "Severe"                                                     |
| Side-effect frequency (a count)                                                                                | Analytics bars and chips                                                                                                                                                                                  | neutral                                                                    | —                                                                     |
| KPIs: day streak, average adherence, total doses                                                               | Analytics stat cards and their sparklines                                                                                                                                                                 | neutral (streak is accent today, adherence green, doses amber)             | —                                                                     |
| Up/down trends                                                                                                 | Analytics stat cards, `AdherenceChart`                                                                                                                                                                    | neutral                                                                    | ↑ / ↓ and the %                                                       |
| Insights: adherence rose or fell, highest or lowest adherence, worst day, peak hour, side-effect count, streak | `InsightsCard`                                                                                                                                                                                            | neutral                                                                    | a glyph (↑ ↓ •), not a colour-only dot                                |
| Insight: medications need a refill                                                                             | `InsightsCard`                                                                                                                                                                                            | amber, the one actionable insight                                          | "Reorder soon:" lead-in                                               |
| Inventory history ±N                                                                                           | Medication detail                                                                                                                                                                                         | neutral                                                                    | the sign                                                              |
| Things you need to do                                                                                          | email not verified; push notifications switched off for both preferences; a test push that wasn't confirmed; drug-interaction warnings; import-preview warnings; OAuth sign-in problems on the login page | amber, an `Alert` in the "needs you" tone                                  | text                                                                  |
| Push service not configured (server config the user can't fix)                                                 | Notifications                                                                                                                                                                                             | neutral                                                                    | text                                                                  |
| Form and action failures, error toast                                                                          | everywhere                                                                                                                                                                                                | red                                                                        | text, plus an icon in `Alert`                                         |
| Saved / done confirmations, success toast, the Undo offer                                                      | everywhere                                                                                                                                                                                                | green                                                                      | text, plus ✓ in `Alert`                                               |
| "Import complete"                                                                                              | Import page                                                                                                                                                                                               | green `Alert`, and it must now be announced                                | text                                                                  |
| Current states: 2FA "Enabled", "Push … active", "service configured"                                           | Settings                                                                                                                                                                                                  | neutral (green today)                                                      | text                                                                  |
| "Danger zone" headings                                                                                         | Privacy (amber today), Data (red today)                                                                                                                                                                   | neutral heading                                                            | —                                                                     |
| Relative "time since" on Log rows                                                                              | `TimelineEntry`                                                                                                                                                                                           | neutral (accent today)                                                     | —                                                                     |
| Selected or current state                                                                                      | chips, toggles, nav, "Current" session                                                                                                                                                                    | accent (unchanged)                                                         | `aria-pressed` / `aria-current`                                       |

Two notes on the table:

- **Refill thresholds keep their owner.** `classifyRefillSeverity` and `REFILL_THRESHOLDS` in `src/lib/server/inventory.ts` are unchanged. Only how the tiers are coloured and worded changes.
- **`MedicationCard` loses its hard-coded `daysUntilRefill <= 7` amber text.** It shows one chip, decided by one rule.

## One owner

A single module owns the mapping from status to tone, and from tone to the token classes for each kind of element: text, chip, marker, bar segment and `Alert`.

- **It must be client-reachable.** Components render it, so it can't live under `$lib/server`.
- **Every surface in the table reads it.** That includes `RefillsCard`'s exported `refillSeverityClass` / `refillSeverityLabel`, which the walkthrough also reuses.
- **A source-scan test fails the suite on a status token class written outside the owner and the primitives.** The status token classes are `warning`, `success`, `danger`, `danger-ink` and `info` with any prefix: `text-`, `bg-`, `border-`, `ring-`, `fill-`, `stroke-`, `from-` or `to-`, at any opacity suffix.
  - The test needs a short, explicit, two-way exemption list, in the style of `server-log.test.ts` and `begin-dose-write.test.ts`.
  - Likely exemptions: `app.css`, the theme tests, `Toast.svelte`, the fenced dose controls, and the field-error lines (see Non-goals).
  - A stale exemption must fail as loudly as a new offender.
- **Contrast is tested.** Every new tint combination goes into `tests/unit/theme-tokens.test.ts`'s chip/backdrop table, in **both themes**: the `/10` and `/5` banner fills, and the amber and red chips on the surfaces they actually sit on. Today the banner tints aren't covered at all.

## The approved mockups

The user approved two mockups. They are committed beside this spec in [`2026-10-16-status-colours-mockups/`](2026-10-16-status-colours-mockups/):

- `buttons-alerts.html` shows the `Button` variants, sizes and states, a before/after on two real pages, and the four `Alert` tones.
- `status-colours.html` shows a before/after of the Log rows, the dashboard's Done list, Analytics and a Medications card.

Both use the app's dark tokens. **They bind the look.** The text below binds the behaviour. These values are taken from the mockups:

- **Button:**
  - corner radius 10px (`rounded-lg` is close enough);
  - horizontal padding 16px at `md` and 12px at `sm`;
  - label 14px, weight 500.
  - **secondary** has no fill: a transparent background, a `border-strong` border and primary text.
  - **ghost** has no fill and no border, with secondary text.
  - **disabled** is drawn at about 50% opacity.
  - an icon sits before the label with an 8px gap.
- **Alert:**
  - corner radius 10px, padding about 11px × 14px;
  - an 18px icon on the left, top-aligned with the first line;
  - a bold headline, then optional body text in secondary text at 13px;
  - tints:

    | Tone      | Fill             | Border          |
    | --------- | ---------------- | --------------- |
    | success   | `success/10`     | `success/30`    |
    | error     | `danger/10`      | `danger-ink/35` |
    | needs-you | `warning/8`      | `warning/35`    |
    | neutral   | `surface-raised` | `glass-border`  |

    The builder may round these to the nearest token opacity that passes the contrast table.

- **Status chips:** 11.5px, weight 600, radius 6px, a word and a glyph inside the chip ("– Skipped", "✕ Missed", "▲ Reorder soon · 2 days left"), with a tinted fill and border. A neutral chip is transparent with a `border-strong` border.

## `Button`

Approved in the "Buttons and alerts" mockup.

- **Four variants:**
  - **primary:** accent fill, `accent-fg` text. The one main action on a form or page.
  - **secondary:** neutral, with a `border-strong` border (never the decorative `glass-border`). Everything else, including every reversible "turn it off" action: Archive, Unarchive, Sign out, Disable 2FA, Disable push, Revoke and Revoke other sessions, Adjust, and removing a schedule row.
  - **ghost:** no border, secondary text. Low emphasis: Cancel, Back, Clear filter, "Learn more first".
  - **danger:** solid `bg-danger` with `danger-fg`. **Used only inside the permanent-deletion confirmation** below. Nothing reversible is ever red.
- **Two sizes, both fixed heights:** `md` is 44px and `sm` is 36px. A fixed height means compact density can no longer make a "large" button shorter than a "small" one.
  - Today 25 buttons get their height from `py-2.5`. Compact density rewrites that padding, so "Save Changes" drops to 32px beside a 36px "Send test".
  - Prove the fix the way `timeline-entry-ssr.test.ts` does: compile the class against the real `app.css` with its `compiledRule()` helper, under compact density.
- **Renders as a link or a button.** It renders `<a>` when given `href` (26 button-styled links exist) and `<button>` otherwise, defaulting to `type="button"`.
- **Full width** when asked: the auth forms and the medication form use it.
- **Pending state:** a spinner plus a label such as "Saving…" (Unicode ellipsis). The width must not jump; follow `DoseActionForm`'s technique of putting the label and the pending label in one grid cell.
- **Disabled:** both a real `disabled` and an `aria-disabled` mode, because existing behaviour depends on each in different places. The migration keeps each site's current semantics. For example, `form-errors-enhance-callbacks.test.ts` checks that MedicationForm's submit has `.disabled === false` after a crash.
- **Focus:** a visible `focus-visible` ring (2px `accent-ink`, offset 2px) on every variant. Today no button has one.
- **Hover:** primary follows the app.css rule that accent buttons use `hover:opacity-90` inside the app.
- **The landing page's two hero CTAs** ("Start Tracking", "Try the demo") may stay bespoke. They are larger than `md` on purpose.

### `IconButton` and `Toggle`

Not drawn in the mockup; named to the user and not objected to.

- **`IconButton`:** square, `size-9` or `size-11`, with a required accessible name. Used for the mobile menu toggle, the sidebar close button, the keyboard-shortcuts close button (which today has no `type` and an unhidden svg), and the colour picker's + and ×.
- **`Toggle`** (pressed or not pressed, with `aria-pressed`), using the T1 recipe from the button map: accent-ink border and tint when on, neutral when off. Used for the schedule mode buttons, the weekday picker, the Analytics period buttons and the side-effect chips.
  - The side-effect picker's "remove custom name ×" chips currently borrow the **on** recipe but delete rather than toggle. They need a look that doesn't claim to be a pressed toggle.
  - The severity picker (Mild / Moderate / Severe) may stay bespoke, but its colours follow the table.
- **Stay bespoke:** the full-screen scrim, the avatar link, the onboarding step dots and the 16px tooltip "i" (the tooltip's target size is priority 5).

## `Alert`

Approved in the "Buttons and alerts" mockup.

- **Four tones:** success (green, ✓), error (red, a circled !), needs-you (amber, a triangle !) and neutral (no status colour, an info glyph). Each tone has its icon (`aria-hidden`), a headline, and optional body text and action, such as the "Resend" link on email verification.
- **Announcement:**
  - **Errors are assertive.** Every action-failure banner moves to the same choice; today seven are polite and five assertive.
  - **The other tones are polite.**
  - **Needs-you is never `role="alert"`.** `MedicationForm.svelte:155` falls back to `document.querySelector('[role="alert"]')` across the whole page. `InteractionWarningPanel` is a `role="alert"` and renders first, so the fallback can land on the warning rather than the actual error. Scope that lookup to the form, as `DoseEditForm` already does.
  - **Keep the persistent live-region pattern.** A `role="status"` wrapper that is always mounted and whose content changes is deliberate (the comment at `privacy/+page.svelte:99-102` explains why). An announcement only fires reliably when the region exists before the content.
- **Outcomes that must now be announced:** reset-password success, the notifications page's resend result, and "Import complete".
- **Alert owns no outer margin.** Today margins (`mb-2` / `mb-3` / `mb-4`) are baked into each banner; the call site's layout decides spacing.
- **Not migrated:** `MedicalDisclaimer` stays its own component, but its unused `panel` variant may be removed. Empty states stay `EmptyState`.

## Confirming permanent deletions

Approved in chat ("Substantial deletion of data or accounts should be guarded").

**The four deletions.** Each removes records outright: there is no trash and no Undo, so the data is gone from the server.

- **Delete dose history** (Privacy). Today it asks for the password and nothing else.
- **Delete archived medications** (Privacy). Today it asks for the password and nothing else.
- **Replace all data on import** (Import). Today it asks for the password, or a typed REPLACE for accounts without one.
- **Delete account** (Data). Today it uses a modal that asks for a typed DELETE plus the password.

**What they all share instead:**

- **One shared confirmation step**, a dialog built on the existing `Modal`. The entry button that opens it is a **secondary** button.
- **The dialog says exactly what will go, with counts.** For example: "This deletes 1,204 doses for 6 medications." The counts come from the server, in the page load or a fetch when the dialog opens.
- **You type a word:** DELETE, or REPLACE for the import.
- **If your account has a password, you also enter it.**
- **The dialog's single danger button stays disabled until both are filled in.** It shows a pending state while the request runs.
- **The server enforces the guard, not only the dialog.** The user decided this on 2026-10-16.
  - Every browser action checks the typed word for every account.
  - It also checks the password, through re-authentication as today, wherever the account has one.
  - So posting the form directly can't skip either check.
  - The import's replace mode changes too: today it checks only the password for accounts that have one, and now it checks both.
- **The `/api/v1` wipes stay as they are.** The user decided this on 2026-10-16.
  - `wipe_dose_history` and `wipe_archived_medications` in `src/lib/server/api/commands.ts` keep requiring a password-issued re-authentication token, and there is no typed word.
  - So accounts without a password still can't wipe through the API, and a stolen bearer token alone can never wipe anything.
  - Write this browser/API difference down where the API contract and `src/routes/api/v1/auth/reauth/+server.ts`'s comment describe it. That comment currently says the API matches the browser.
- **Accounts without a password must be able to use all four.** Today the two Privacy wipes and Delete account call `confirmReauth`, which always fails for an account with no password hash (`src/lib/server/auth/reauth.ts:93-108`). An OAuth-only user currently cannot run them at all. The user's decision ("if your account has a password, enter it") settles that the typed word alone is enough for them.
- **Keep the existing semantics:** reauth purposes, rate limits and audit rows stay as they are.

## The fence: dose controls

These keep their markup, size, focus behaviour, write lock and submit path. They only pick up the new colours.

- `src/lib/components/dose-writes/**`: the write path, which has no markup.
- `dashboard/DoseActionForm.svelte` and its callers:
  - the Due card's Log now, Took it at and Skip;
  - DoneList's Remove / Remove skip;
  - the edit dialog's "Remove this dose".
- DoneList's Edit (`DoneList.svelte:130`), which a test pins and the Modal returns focus to.
- `QuickLogBar` chips and steppers.
- The Medications card's Log button.
- The Log page's ✎ and × (`TimelineEntry`).
- Toast's Undo and Dismiss.
- `DoseEditForm`'s Save. (Its Cancel is outside the fence. Note that it is 34px today, beside a 44px Save.)
- The medications ↑/↓ reorder.

**Colour changes inside the fence:**

- **Removing a dose is undoable**, through the Undo offer and the trash. So "Remove this dose" and the Log page's × lose their red and become neutral.
  - `dose-action-form.test.ts:167` asserts `text-danger-ink` on the danger variant. That assertion changes; the size assertion (`min-h-11`) must not.
- **Missed rows in `DoneList` turn red.**

A `Button` must never call `beginDoseWrite(` or `lock.acquire(`; `begin-dose-write.test.ts` already scans `src/` for both.

## The walkthrough follows

The landing-page walkthrough (`src/lib/components/walkthrough/`) draws the dashboard and other pages without mounting them. Where it depicts a surface this work changes, it must depict the new version. Otherwise the public landing page goes on advertising the old colours, which is what happened after #170.

**What this touches:**

- **Refills.** `StageRefills` already reads `RefillsCard`'s exported rules, so it follows automatically. Its tests, and `STAGE_REFILLS`' severity checks in `walkthrough-demo-facts.test.ts`, may need updating.
- **History / Log rows** with skipped and missed.
- **The Analytics stat cards and breakdown bar.**
- **The Security and Data scenes' buttons**, which copy today's button recipes by hand.
- **The Medications scene.**

**Constraints:**

- **The stage must never import `Button`, `Alert` or any focusable primitive.** It may import the owner module's pure mapping functions, the way it reuses `RefillsCard`'s module exports today.
- **No `transition-*` or `animate-*` classes in the stage**, as the walkthrough tests require.

## Constraints from the codebase

- **Svelte 5 runes only.** Tailwind v4 tokens only, no raw palette colours. Accent roles per CLAUDE.md: `accent` is the fill, `accent-ink` is text, border and ring, and `accent-fg` sits on the fill. Interactive borders use `border-strong`.
- **Both themes:** everything is checked in light and dark. The user chose how on 2026-10-16. This machine has no working local app or test database, so the full e2e axe suite (`tests/e2e/accessibility.test.ts`) is not the gate. The gate is:
  1. **Every new colour pairing in the contrast table.** That means every tone × element × backdrop the owner module can produce, in both themes, in `tests/unit/theme-tokens.test.ts`. This is the real contrast guard, because it computes the ratios.
  2. **SSR axe on each migrated page or component**, using `tests/unit/helpers/axe-ssr.ts`, which `dashboard-header-ssr`, `landing-hero-ssr` and others already use. It checks structure, roles and names; jsdom can't measure contrast.
  3. **A pass in the browser on the PR's Vercel preview**, in light and dark, over the pages the e2e suite lists. The PR records it.
- **Tests that pin markup:** the migration keeps the property each one protects. It may update a regex only to the same strength. Known ones:
  - `log-pagination-ssr.test.ts`: Previous/Next use `border-strong`; the "Clear filters" label is the anchor's direct text.
  - `form-errors-aria-ssr.test.ts`: a `<div id="form-error" … role="alert">` with the message directly inside it. Putting an `Alert` icon there means changing these regexes deliberately.
  - `form-errors-enhance-callbacks.test.ts`: exactly one `[role=alert]` after a crash, and it is focused.
  - `appearance-page-ssr.test.ts`: exactly one `role="status"`, placed before the first form.
  - `medication-card-targets-ssr.test.ts`: the literal sr-only status paragraph.
  - `dashboard-chrome-copy.test.ts`: splits `Toast.svelte` on `"<button"`.
  - `tooltip-labelling.test.ts` and `input-id-uniqueness.test.ts`.
- **Retiring `--color-info`:** if no status uses it any more and nothing else reads it, remove it from `app.css` and from both `LIGHT_TOKENS` and `DARK_TOKENS` in `src/lib/appearance/theme-css.ts` (`theme-css.test.ts` asserts the two copies match). Also update CLAUDE.md's "`--color-info` is deliberately a separate token" bullet, and the theme tests.
- **CLAUDE.md:** add a bullet naming the owner module and the scan test, in the style of the existing single-owner bullets.

## Calls made without the user

The user didn't decide these explicitly. The author made them, and the user may overturn any of them:

- **Status tones:**
  - Both the `critical` and `warning` refill tiers are amber. Nothing has gone wrong yet; you need to reorder.
  - "Push service not configured" is neutral, because the user can't fix server configuration.
  - The 2FA "Enabled" chip and "Push … active" are neutral: they describe the current state, not something that just happened.
  - Inventory history ±N is neutral, including refills.
  - The relative "time since" on Log rows and the day-streak KPI lose the accent colour.
  - The "Danger zone" headings become neutral; red stays on the actions inside the confirmation.
- **Primitives:**
  - Two button sizes, 36px and 44px, with no `lg`. The landing hero CTAs stay bespoke.
  - `IconButton` and `Toggle` are in scope; the user was told and didn't object.
  - Field-error lines and Toast are out of scope.
- **Retiring `--color-info`** if nothing reads it after the migration.

## What's left to the builder

- **Names and file locations** for the owner module and the primitives. A likely home is `src/lib/components/ui/` for the primitives and `src/lib/utils/` for the mapping.
- **The prop API.** It may use Svelte 5's native `class={[…]}` arrays; there is no `clsx` and none is needed.
- **The icon shapes**, drawn as inline SVG at one stroke width.
- **The order of the migration.** Splitting it into several commits by page is expected.
- **The headline/body split for each banner.** Most of today's banners are one sentence. Where a message is one sentence, it is the headline and there is no body.
- **Whether `info` is removed or left unused.** It should be removed if it is unused.

## The site inventory

The two recon maps from 2026-10-16 (`main` at `e9ebd6e`) list every status-colour use, every button recipe (P1–P8, S1–S7, D1–D6, A1, G1–G2, L1–L3, T1–T4) and every banner, with file and line. They are in this session's transcript, not the repo. The builder should re-derive the inventory with a fresh sweep before starting, because line numbers drift.

Headline numbers:

- 87 buttons and button-styled links to migrate outside the fence;
- 12 fenced dose controls;
- about 40 banners;
- 20 field-error copies (not migrated);
- 5 permanent actions currently drawn with 3 recipes.
