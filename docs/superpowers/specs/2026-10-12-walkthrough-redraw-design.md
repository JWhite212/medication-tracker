# Landing-Page Walkthrough Redraw — Design

Priority 3 of the 2026-09-24 design critique:

> Redesign the Quick Log pills as a capsule glyph plus text on a neutral surface. That fixes
> legibility and quiets the loudest element on the page.

**The in-app half already shipped in #170.** `QuickLogBar.svelte` is a row of neutral chips:
`bg-glass`, `text-text-primary` and a `border-strong` edge. The medication's colours appear only in an `aria-hidden` `MedicationGlyph` capsule, and the steppers carry no opacity.

**What is left is the public landing page.** The animated walkthrough (`src/lib/components/walkthrough/`) still draws the dashboard as it was before #170:

- coloured Quick Log pills, with the name over gradient, striped and two-tone fills;
- the dose and `+` at `opacity-70`;
- a "My Day" timeline grouped Morning to Night;
- a summary strip, with Refills near the top.

So the landing page advertises exactly what the critique called out. This spec redraws the walkthrough to the app as it ships and corrects everything else the video now says that is false.

## What is wrong, with evidence

Three readers audited `main` at ca5c1f2 on 2026-10-12, and the spec was then checked by three reviewers against the code.

**The dashboard and phone scenes depict the deleted dashboard.**

- `DashboardScene.svelte` and `PhoneScene.svelte` are built from `MyDaySection`, `SummaryAndRefills`, `StatusMark` and demo-data `DAY_GROUPS`. 0b8c95f (#170) edited only comments in `MyDaySection`, `SummaryAndRefills` and demo-data, to say "has not been redrawn". 4e7988e left both scenes "for the dashboard rebuild".
- **The desktop scene, as drawn:**
  - a "Dashboard" title and a "2 doses today" strip;
  - Refills second;
  - My Day, with emoji groups;
  - coloured Quick Log pills with a pulsing "Due now" label and a "Due in 1h 3m" label;
  - a green flash ring on log;
  - a plain "Lisinopril logged" toast that fades after 5s.
- **The real dashboard, top to bottom:**
  - the `DashboardHeader`: a date eyebrow, "Today", a status sentence and a supporting line;
  - Due cards: a capsule over a status marker, a 48px filled **Log now**, then Took it at and Skip;
  - Done today;
  - Later today;
  - "Log something else", with neutral chips;
  - Refills last;
  - one Undo offer in the toast stack, with no 5-second timer.
- **The phone** shows the same old column, where a fingertip taps a 40×20 "Log" text link.

**False captions.** `LOWER_THIRDS` (`timeline.ts`) also builds the screen-reader text, an sr-only `<figcaption>`.

- **01:** "My Day — Today's doses, grouped by time of day." No such grouping exists.
- **02:** "Quick Log — Log a dose with a single tap." The title names the chip bar, but the primary log action is now Log now on a Due card.
- **04:** "Live timers — Last taken and next due for every medication." No page has shown a next-due time since 0b8c95f.
- **10 (tech line):** "Web Push via Vercel Cron". The driver is the GitHub Actions `reminder-tick`: every 30 minutes from 06:00 to 22:59 UTC, with Vercel Cron as a daily backstop.
- **The landing copy** says "Forty seconds, ten features" (`src/routes/+page.svelte:99`). The loop is 43.5s.

**Other false details.**

- **Analytics status bar.** It labels every untaken expected dose "Skipped" and shows "Missed 0", which is the bug CLAUDE.md records as fixed in #150. It also charges today as 3 doses (`8×89+3`, `demo-data.ts:162`), while the per-medication rows use `perDay × 90`.
- **History.** Yesterday lists Magnesium 22:05 above Ibuprofen 22:14 (`demo-data.ts:282-283`). The real page sorts by `desc(takenAt)`.
- **Security.** Session expiry is hard-coded as "22/10/2026" (`SecurityScene.svelte:9`). The app renders "22 Oct 2026" through `formatUserDate`.
- **Accent.** The stage defaults to `#6366f1` (`WalkthroughVideo.svelte:23`). New accounts get `#4f46e5` (`schema.ts:316`, since 2026-09-06), and `+page.svelte:102` renders `<WalkthroughVideo />` with no props, so the default is what ships.

**A production bug.** The phone scene's banner already shows the intended copy, "Last logged 1d ago", but production does not send it.

- Overdue reminders read "Last logged 1d ago ago", or "Last logged just now ago". `formatTimeSince` (`utils/time.ts:1-13`) already ends in "ago" or returns "just now", and two templates append another " ago":
  - the push body (`reminders.ts:202`);
  - the email (`email.ts:171`, "last logged … ago").
- `push-payload.test.ts:102-107` tests a hand-written payload. `reminders.test.ts` mocks the email module away and records only the push's `tag` and `renotify`. `email.test.ts` passes a hand-picked label and discards what is sent. So nothing could catch it.

**The engine fails silently.**

- `computeFrame` reads 28 mark keys by string. A missing or renamed mark sends the camera to the WIDE shot and the cursor to the window centre (`timeline.ts:112,341`), with no error.
- `walkthrough-timeline.test.ts` feeds a hand-written `MEASURED` fixture, so it cannot notice a scene that lost a mark.
- No test mounts the stage.
- Marks are measured once, at mount, when T is between 0 and 1.2s (`WalkthroughVideo.svelte:110-130`). So any element that appears only later is never measured.

## Decisions

The user's choices on 2026-10-12, and the defaults they approved section by section.

- **D1 Scope.** Redraw the dashboard and phone scenes. Fix everything else that is false:
  - captions 01, 02, 04 and 10, and the landing copy;
  - the Analytics bar, the History order and the Security dates;
  - the accent colour and the push and email copy.

  No new beats elsewhere, and no fidelity work beyond "false".

- **D2 Structure.** Keep 12 scenes, their durations and the 43.5s loop. Rename the scene `MyDay` to `Today` and `QuickLog` to `LogNow`.
- **D3 Desktop log beat.** The cursor taps the Lisinopril Due card's **Log now**, the page's primary action. The neutral chips appear in the overview shot and are not tapped.
- **D4 Undo offer.** It appears after the log and stays for the rest of the LogNow shot. It is gone, exactly, at the hard cut to Medications, which implies time has passed. Nobody presses Undo.
- **D5 Phone clock.** 10:12, so Vitamin D (09:05) is genuinely overdue and matches the push's word "overdue".
- **D6 Approach.** Scene-only parts, drawn with spans, reusing the real pure leaves: `MedicationGlyph`, `StatusMarker`, and the copy functions in `utils/dashboard-copy.ts` and `utils/time.ts`.
  - The real dashboard components are never mounted in the stage. The stage adds no controls, headings or landmarks (`AppShell.svelte:3-5`).
  - `DueCard`, `DoseActionForm` and `QuickLogBar` are focusable, and need the write lock, the clock, `use:enhance` and `$app/state`.
  - `DashboardHeader`, `DoneList` and `LaterList` render `h1`/`h2`/`section`/`ul`, fixed ids, and `tabindex="-1"` targets that would be duplicated across the desktop and the phone.
- **D7 Fidelity.** One test checks the scene against the app. It runs the real `composeDashboardPageData` at each story moment, asserts that the scene's dashboard data equals it, and renders the scenes to assert their visible text equals the real helpers' output.
- **D8 Marks.** `timeline.ts` exports `REQUIRED_MARKS`. The tests fail if:
  - `computeFrame` reads a key that is not listed;
  - a listed mark is not registered at the moment production measures;
  - the registered set changes with T;
  - a key is registered on two elements;
  - a key sits under the wrong root;
  - the stage contains anything focusable.
- **D9 Push and email copy.** Fixed in this PR, through one helper that takes an explicit `now`.
- **D10 Verification.** Visual verification in the built-in browser, using a gitignored throwaway `.env` that is deleted afterwards.

## Section 1 — Story, timing and captions

**Clocks.** The story is Thursday 24 September 2026, with times in UTC (`demo-data.ts` header).

- **Desktop:** `DESKTOP_NOW` is 08:02.
- **Phone:** `PHONE_NOW` is 10:12. The phone's status bar changes from "9:41" to "10:12" (`PhoneScene.svelte:38`).

**Scenes.** `SCENES` keeps its order and durations:

- Title 2.5s;
- **Today** 3.5s (was MyDay);
- **LogNow** 4s (was QuickLog);
- Medications 3.5s;
- Timers 3.5s;
- AddMedication 4s;
- History 3.5s;
- Analytics 4s;
- Security 3.5s;
- Export 3.5s;
- Reminders 5s;
- Outro 3s.

`CUES` and `TOTAL_DURATION` (43.5s) are derived from it as now. The renames ripple through `SceneName`, every `c.MyDay`/`c.QuickLog` use, `LOWER_THIRDS.scene`/`until` and the tests. That churn is accepted because the names should say what the scene shows.

**Today (3.5s).**

- The shot opens on the header ("1 dose due" / "2 of 8 done today") and Lisinopril's due-now card.
- It then pans down through Done today and Later today to "Log something else".
- The neutral chips, the priority-3 point, are on screen and readable there, but not tapped.
- The easings are unchanged: `MOTION.drift` into the first frame, then `MOTION.move` for the pan.

**LogNow (4s).** `tLog = CUES.LogNow + 1.45`, the same offset as today's pill tap.

- **The tap.** The cursor travels to Lisinopril's **Log now** and clicks at `tLog`.
- **`pending`, on [tLog, tLog + 0.4).** Log now shows its spinner and "Logging…", keeping its width as `DoseActionForm` does. The spinner's rotation is a function of T, never a CSS animation.
- **`logged`, rising 0→1 over [tLog + 0.4, tLog + 0.7].** The update lands:
  - **The Due card and the whole Due section** collapse. The height is drawn as `(1 − logged) × measured`, not removed.
  - **The header** crossfades: the old text at opacity `1 − logged`, the new at `logged`. The new text is "All caught up" / "Next: Vitamin D 1000IU at 09:05 · in 1 hour".
  - **Done today** gains a Lisinopril 10mg row at 08:02, with a second line "for 08:00". The row's wrapper height is `logged × row height`.
- **`offer`, from tLog + 0.5 over 0.3s.** The Undo offer appears:
  - its message, "Lisinopril 10mg logged at 08:02 — counted for your 08:00 dose";
  - an underlined "Undo" and "×".

  It is exactly 1 from tLog + 0.8, which is 1.75s fully visible, and exactly 0 at `CUES.Medications`.

- **Camera.** It frames for the tap and the update, then moves to the offer:
  - **For the tap and the update** it holds `fitCamera(unionRects(R(header), R(Due section), R(Done section)), 28, 2.0)`, all measured in the before-log layout. The collapse only moves content up, and the new Done row (+52px) is shorter than the Due section it replaces (about −146px), so the whole change happens inside the frame.
  - **From tLog + 0.7** it moves (`MOTION.move`, 0.6s) to `fitCamera(R("o.offer"), 40, 2.0)` and drifts there until the cut.
  - **Why the framing changes.** Framing the header and the offer together is wider than the WIDE shot (s ≈ 0.80): text-sm would render at about 6px in the 1024px landing container. So the shot changes framing instead.
- **Removed:** the green flash ring, the pulsing "Due now" label, the chip labels and the count. The app does none of them.
- **Story continuity is unchanged:** Lisinopril logged at 08:02 is what Medications ("just now") and History's Today rows already assume.

**Captions** (`LOWER_THIRDS`). Each also feeds the sr-only figcaption.

| #   | Title       | Line                                                 | Tech                                                                 |
| --- | ----------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| 01  | Today       | What's due now, what's done and what's next.         | Every row on the page decided by one matcher, on the server          |
| 02  | Log now     | One tap to log, and Undo for ten minutes.            | Single-fire writes, re-checked under a row lock on the server        |
| 04  | Live timers | When each medication was last taken, always current. | (unchanged)                                                          |
| 10  | Reminders   | (unchanged)                                          | Web Push on a half-hourly daytime sweep, with idempotent dedupe keys |

- **The tech lines are claims about the code.**
  - **01 is narrow on purpose.** The matcher decides every dashboard row, not every slot: the reminder sweep and Analytics answer independently, per CLAUDE.md.
  - **02 avoids the trash table.** The Undo shown on screen is a create's Undo, which skips the trash (D8 of the undo design).
- **Unchanged:** captions 03 and 05–09 were spot-checked and are true.

**Landing copy** (`+page.svelte:99`): "Forty seconds, ten features, …" becomes "Under a minute, ten features, …", and the rest of the sentence is kept.

## Section 2 — The desktop dashboard scene

**New scene-only parts** go in `walkthrough/parts/dashboard/`. Each copies its real component's static layout classes.

- **No controls.** No part contains a button, link, input, heading, landmark or any `tabindex`.
- **No animation classes.** No part copies an `animate-*` or `transition-*` class: motion comes only from Frame values.
- **Attribute variants become plain classes.** A state variant the real control gets from an attribute (`aria-disabled:`, `hover:`) is written out as a plain class. For example, the chip's `−` at quantity 1 is drawn `text-text-muted`.

| Part                   | Mirrors                  | Anatomy                                                                                                                                                                                                                                                                                                              |
| ---------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `StageDashboardHeader` | `DashboardHeader.svelte` | Date eyebrow; "Today" as a styled `<p>`; status sentence; supporting line                                                                                                                                                                                                                                            |
| `StageDueCard`         | `DueCard.svelte`         | `md` `MedicationGlyph` above a `StatusMarker`; name (semibold) and dose; status line. Filled 48px **Log now** if `row.logNow`, with the spinner when `pending`. Bordered **Took it at HH:MM** if `row.tookItAt !== null`. Quiet **Skip** if `row.skipAt !== null`. This is the same rule as `DueCard.svelte:124-153` |
| `StageDoneList`        | `DoneList.svelte`        | One glass card of divided rows. Each row: time, check marker, `sm` glyph, name and dose (×n), a covers line ("for 08:00") underneath, and a bordered **Edit**                                                                                                                                                        |
| `StageLaterList`       | `LaterList.svelte`       | 40px read-only lines: time, hollow ring marker, `sm` glyph, name and dose, "in 6 hours"                                                                                                                                                                                                                              |
| `StageChips`           | `QuickLogBar.svelte`     | "Log something else" eyebrow; 44px neutral chips: `−` \| `sm` glyph and "Lisinopril 10mg" \| `+`                                                                                                                                                                                                                     |
| `StageRefills`         | `RefillsCard.svelte`     | Last on the page, with the existing refill row anatomy                                                                                                                                                                                                                                                               |
| `StageUndoOffer`       | the `Toast.svelte` offer | Message, underlined **Undo**, **×**. It replaces `StageToast`                                                                                                                                                                                                                                                        |

**Every visible string comes from a real helper.** The parts import the real `MedicationGlyph.svelte` and `StatusMarker.svelte`, which are pure: no context, no controls, `role="img"` only. The strings come from these helpers:

- the header: `dashboardHeaderCopy`;
- the due status line ("Due 08:00 · 2 minutes ago"): `rowStatusLine`;
- slot times: `formatSlotTime`;
- dose labels: `formatDoseLabel`;
- Done's time column: `formatUserTime`;
- the offer: `logToastFromReload` (`dose-toasts.ts`), the function the real Log now path calls.

**Five strings move into `utils/dashboard-copy.ts`.** The real components compose them inline today, so this PR moves them, and the real component and its stage part both call the new helper:

| Helper                                       | String                                                         | Moves out of                   |
| -------------------------------------------- | -------------------------------------------------------------- | ------------------------------ |
| `headerEyebrow(serverNow, tz, dateFormat)`   | The date eyebrow (`formatUserDate` with weekday, without year) | `DashboardHeader.svelte:22-24` |
| `laterUntil(expectedTime, serverNow)`        | "in 6 hours"                                                   | `LaterList.svelte:24-27`       |
| `doneCoversLine(covers, todayStart, tz, tf)` | "for 08:00"                                                    | `DoneList.svelte:68-70`        |
| `doneDoseText(dose)`                         | "10mg ×2"                                                      | `DoneList.svelte:59-61, 74`    |
| `tookItAtLabel(time)`                        | "Took it at 09:05"                                             | `DueCard.svelte:144`           |

Each move is behaviour-neutral. The real components' existing tests pin their output and must stay green without being edited.

**One demo state.** A new `walkthrough/demo-dashboard.ts` defines a narrow view type and four moments of it:

```ts
type StageMoment = {
  now: Date;
  todayStart: Date;
  status: DashboardStatus;
  earlier: StageCard[]; // DueCard with its full DueRow[] rows
  today: StageCard[];
  done: StageDone[]; // Pick<DoneRow, "key" | "covers" | "dayLabel">, plus a dose
  // picked to { id, medicationId, takenAt, quantity, status } and the medication label fields
  later: LaterRow[];
  medications: Pick<
    Medication,
    "id" | "name" | "dosageAmount" | "dosageUnit" | "colour" | "colourSecondary" | "pattern"
  >[];
};
```

- **The four moments** are `DESKTOP_BEFORE` (08:02), `DESKTOP_AFTER` (08:02, with the Lisinopril dose), `PHONE_BEFORE` (10:12) and `PHONE_AFTER` (10:12, with the Vitamin D dose). Scenes read only these fields.
- **Rows across a before/after pair** are matched by medication and instant:
  - a row only in AFTER grows with `logged`;
  - a row only in BEFORE collapses with it;
  - a row in both is identical.

**One dose list.** `demo-data.ts` gains `DEMO_DOSES`, the single list of instants.

- **What it holds:**
  - LOG_ALL's Today and Yesterday groups;
  - each interval medication's previous dose before the dashboard window: Vitamin D on 23 Sep at 09:05, and Magnesium on 23 Sep at 22:05;
  - the two beat doses: Lisinopril on 24 Sep at 08:02, and Vitamin D on 24 Sep at 10:12.
- **The anchors it must include.** Every interval medication's projection depends on its last dose. Without Magnesium's 22:05 anchor, an overdue 00:00 card appears. Today's 06:10 Ibuprofen and 07:48 Metformin are the remaining anchors.
- **Schedules.** `DemoMedication` gains a `schedule` matching `scripts/seed-demo.ts`:
  - Vitamin D: interval 24h;
  - Lisinopril: fixed at 08:00;
  - Metformin: interval 12h;
  - Ibuprofen: interval 8h;
  - Magnesium Glycinate: interval 24h.
- **Lifecycle dates.** Each medication has `startedAt` and `createdAt` (and each schedule `effectiveFrom`) at `DEMO_STARTED_AT`, 90 days before `DESKTOP_NOW` and at or before the analytics window's start. Later dates would let the lifecycle and schedule-edit clips drop slots.

**The fidelity test (D7)** lives in `tests/unit/walkthrough-dashboard-fidelity.test.ts`, under `// @vitest-environment node`. `page-data.ts` imports only types and `utils/schedule`, so no database is needed.

_Inputs, per moment:_

- **`doses`:** `DEMO_DOSES` filtered to `takenAt <= now` and to `dashboardWindow(now, "UTC")`'s `[doseFetchFrom, doseFetchTo]`, with `loggedAt = takenAt`. The two BEFORE moments exclude the dose their beat logs. Each AFTER moment is its BEFORE input plus exactly that dose (quantity 1, status taken).
- **`lastDoses`:** computed from the same filtered list by `getLastDosePerMedication`'s rule, through one helper in the test file:
  - `lastTakenAt` is the maximum `takenAt` over taken doses;
  - `lastEventAt` is the maximum over taken or skipped doses;
  - a medication with neither is omitted.
- **`medications`:** built the way `dashboard-page-data.test.ts`'s `makeMed` builds them. `sortOrder` is the `MEDICATIONS` index, and `isArchived` is false. The schedules come from `DemoMedication.schedule`.
- **`timezone`:** `"UTC"`.

_Data assertions:_

- A single `toStageMoment(payload)` projection maps the composer's output to the `StageMoment` shape.
- For each moment, `expect(moment).toEqual(toStageMoment(payload))`. That compares whole ordered arrays, with `earlier` and `today` compared separately.

_Render assertions:_

- **What it renders.** The same file SSR-renders `DashboardScene` with the before and after Frame slices, and `PhoneScene` with both of its slices.
- **Reading the output.** It reads `render(...).body`: Svelte 5.57's `svelte/server` `render()` is lazy, and a render whose body is never read asserts nothing. It parses the body with `ssrDocument`/`textOf`, as `later-list-ssr.test.ts` does.
- **Section markers.** Each stage section carries `data-stage-section`: `header`, `due`, `done`, `later`, `chips` or `offer`.
- **What each section must equal.** Each section's text must equal the helpers' output over the composer's payload, called with the moment's `now`, `todayStart`, `"UTC"` and the stage's `timeFormat`:
  - **Header:** `dashboardHeaderCopy` and `headerEyebrow`.
  - **Due:** `rowStatusLine` and `tookItAtLabel` for each Due row.
  - **Done:** `formatUserTime`, `doneDoseText` and `doneCoversLine` for each Done row.
  - **Later:** `formatSlotTime` and `laterUntil` for each Later row.
  - **Chips:** `formatDoseLabel` for each chip, in medication order.
- **Row counts:** each section's row count must equal the composer's.
- **The offer text** must equal `logToastFromReload(afterPayload, loggedDoseId, { label, quantity: 1, takenAt, todayStart }, "UTC", tf)`. That is the production path, and it reads the Done row's `covers`.
- **The phone banner** must equal `lastLoggedPhrase(<Vitamin D's last event in the 10:12 input>, PHONE_NOW)` (Section 3).

_The phone's Later list:_ the phone moments hold the composer's full Later list. `PhoneScene` shows `later.slice(0, PHONE_LATER_ROWS)`, and the render check asserts the shown rows are exactly that prefix.

**The helpers are the authority.**

- **Where this spec disagrees with them, they win.** Every quoted string and time in this spec is illustrative: the composer and the copy helpers decide. The plan records any corrected value.
- **No test pins a literal from this spec.** Tests compare against helper output.
- **Any literal time a test does pin tolerates ICU's optional leading zero** (`/^0?8:02$/`), as `walkthrough-timeline.test.ts` already does. On this repo's Node ICU, en-GB numeric hours print as "8:02".

**Values the composer returned in the spec review** (illustrative, not pins):

- **08:02:** status "1 dose due" / "2 of 8 done today".
  - Lisinopril is due now. It shows Log now and Skip, with Took it at hidden by the due-now rule.
  - Done: Ibuprofen 06:10, Metformin 07:48.
  - Later: Vitamin D 09:05, Ibuprofen 14:10, Metformin 19:48, Magnesium 22:05, Ibuprofen 22:10.
- **After the log:** "All caught up" / "Next: Vitamin D 1000IU at 09:05 · in 1 hour". Lisinopril's covers are [08:00].
- **10:12:** "1 dose due" / "3 of 8 done today". Vitamin D is overdue, "Due 09:05 · 1 hour ago", and shows Log now, Took it at 09:05 and Skip.
- **After the tap:**
  - The status reads "All caught up" / "Next: Ibuprofen 200mg at 14:10 · in 3 hours". `formatDuration` floors 3h58m to 3 hours.
  - Done gains a Vitamin D 10:12 row with **no covers line**, because the interval schedule re-anchors to the new dose.
  - The offer has **no** "counted for" clause.

**Retired** (deleted, not left behind):

- `MyDaySection.svelte`;
- `StatusMark.svelte`;
- `SummaryAndRefills.svelte` (Refills becomes `StageRefills`);
- `StageToast.svelte`;
- demo-data's `DAY_GROUPS`/`daySlots`;
- `DashboardScene.svelte`'s Quick Log label map;
- the `formatDueIn` import.

`formatDueIn` (`utils/time.ts:708`) then has no caller in `src/`. It is deleted along with its tests (`time.test.ts:190-217`); `formatDuration`'s own day-unit tests keep the coverage. `formatDuration`'s doc comment (`time.ts:656`) drops its reference to `formatDueIn`.

## Section 3 — The phone scene and the push copy

**Content at 10:12.** The phone uses the same parts as the desktop, at 402px. The mobile header (menu button, brand, avatar) already matches `MobileHeader` and is unchanged. Before the tap:

- **Header:** "1 dose due" / "3 of 8 done today".
- **Vitamin D's overdue Due card:**
  - an amber `border-warning/50` and the "!" marker;
  - its status line, "Due 09:05 · 1 hour ago";
  - **Log now**, **Took it at 09:05** and **Skip**.
- **Done today:** Ibuprofen 06:10, Metformin 07:48, and Lisinopril 08:02 with "for 08:00".
- **Later today:** `later.slice(0, PHONE_LATER_ROWS)`.

The content box is 732px (820 − 72 − 16), and the home indicator covers its bottom 34px. The phone-before screenshot (Section 5) proves that Log now lies wholly inside the box and above the indicator, and that no visible row is cut through its text. `PHONE_LATER_ROWS` is chosen to make that true.

**The beat.** It uses the desktop offsets, measured from the existing `tTap`:

- **The banner.** It slides in and out as now: "Vitamin D overdue", with the body rendered by `lastLoggedPhrase(<Vitamin D 23 Sep 09:05>, PHONE_NOW)`, which is "Last logged 1d ago".
- **The tap.** The fingertip taps the card's **Log now** at `tTap`. `p.vitdLog` moves from the old text link to that span.
- **`pending`** on `[tTap, tTap + 0.4)`.
- **`logged`** rises 0→1 over `[tTap + 0.4, tTap + 0.7]`:
  - the card collapses;
  - the header crossfades to "All caught up" / "Next: Ibuprofen 200mg at 14:10 · in 3 hours";
  - Done grows the 10:12 Vitamin D row.
- **`offer`** rises from `tTap + 0.5` over 0.3s and is 1 from `tTap + 0.8` until the Outro cut, where it is exactly 0. The offer reads "Vitamin D 1000IU logged at 10:12", rendered at the bottom of the phone screen.

**Marks.**

- **Measured against the phone.** Phone keys keep the `p.` prefix, which measures them against `PHONE_ROOT`.
- **Keys passed as props.** A part shared by the desktop and the phone takes its mark keys as props, so a key is never registered on two elements (`marks.ts:36` overwrites silently).

**The push and email copy fix (D9).**

- **A shared helper.** `formatTimeSince(date, now = new Date())` gains an optional `now`; the default keeps today's callers unchanged. A new `lastLoggedPhrase(lastEventAt: Date | null, now: Date): string` sits beside it in `src/lib/utils/time.ts`, which is client-safe. It returns:
  - "Last logged 5m ago", "Last logged 2h 3m ago" or "Last logged 1d ago";
  - "Last logged just now";
  - "Not yet logged" when there is no event.
- **The push** (`reminders.ts:198-208`). The body uses `lastLoggedPhrase(row.lastEventAt, now)`, with the sweep's own tick `now` (one clock per tick, as CLAUDE.md requires).
- **The email.**
  - `sendReminderEmail(email, medicationName, lastEventAt: Date | null, now: Date)` builds its clause from `lastLoggedPhrase`, with the first letter lower-cased.
  - The `"never"` sentinel and `reminders.ts:170`'s `sinceLabel` are deleted.
  - The no-event email therefore changes from "is due — not logged yet." to "is due — not yet logged.", which is accepted.
- **Wire format.** The push fields (`title`/`body`/`url`/`tag`) are unchanged. Only the body text changes, which the frozen wire format allows.

**Tests for the copy fix:**

- **`reminders.test.ts`'s push mock records `title` and `body`.** Each case drives the real sweep, so it tests the real template. There is one case per `formatTimeSince` branch, with `now` explicit at 30s, 5m, 2h 3m and 25h, plus a null `lastEventAt`. The bodies must be:
  - "Last logged just now";
  - "Last logged 5m ago";
  - "Last logged 2h 3m ago";
  - "Last logged 1d ago";
  - "Not yet logged".
- **The email mock records the new arguments.** It records `lastEventAt`/`now` instead of `sinceLabel`, and the pin at `reminders.test.ts:363` changes with a stated reason.
- **The bespoke fake stays.** `reminders.test.ts` keeps it, which is CLAUDE.md's named exception, and it is not moved to fake-db.
- **`email.test.ts`'s Resend mock captures the `send` argument** and asserts the `html` for the same five inputs.
- **`lastLoggedPhrase`'s own tests** pass `now` explicitly at the boundaries: 59s/60s, 59m/60m and 23h59m/24h.
- **Mutations:**
  - restore the extra " ago" in `reminders.ts` and the push test fails;
  - restore it in `email.ts` and the email test fails.

## Section 4 — Corrections in the other scenes

Only things that are false are corrected. Nothing is added.

**Analytics status bar** (`AnalyticsScene.svelte`, `demo-data.ts`).

- **The window.** It is `getPerMedicationStats`' default: `[DESKTOP_NOW − 90 × 86_400_000, DESKTOP_NOW]` (`analytics.ts:203-204`). Every demo medication's `startedAt` is `DEMO_STARTED_AT`, at or before the window's start, so `clampEffectiveDays` returns 90.
- **Real meanings:**
  - "Skipped" counts explicit skips only, which is 0 in the demo history.
  - Untaken expected doses are "Missed", drawn as a red `bg-danger` segment.
  - Missed is summed per medication as `max(0, expected − taken − skipped)`.
  - Adherence takes a numerator capped per medication.
- **What changes on the shot.**
  - The bar becomes Taken 602 · Skipped 0 · Missed 118 · 720 expected, where it now shows 715 expected, Skipped 113 and Missed 0.
  - The `+3` partial-day term goes.
  - The per-medication rows and their adherence already use `perDay × 90`, and do not move.
- **No arithmetic in the scene.**
  - `demo-data.ts` exports `STATUS_BREAKDOWN = { takenEvents, skippedEvents, missedEvents, expectedTotal, adherencePercent }`. The scene renders those fields and does no arithmetic of its own; `AnalyticsScene.svelte:24-25,175-181` computes today.
  - Segment widths use `StatusBreakdownBar`'s formula, or the scene renders `StatusBreakdownBar` itself if it is a pure leaf with nothing focusable.
- **The real fold becomes callable from a test.** The per-medication fold inside `getDoseStatusBreakdown` (`analytics.ts:373-397`) moves, unchanged, into an exported pure `foldDoseStatusBreakdown(stats)` in a module with no database import. `getDoseStatusBreakdown` calls it, and its existing tests stay green unedited.
- **A node test checks the demo against the real code.** It computes each medication's expected total as `perDay × clampEffectiveDays(...)` over the window above, feeds `foldDoseStatusBreakdown` the demo's per-medication figures, and asserts `STATUS_BREAKDOWN` equals its output.
- **Mutations:**
  - pool missed as `Σexpected − Σtaken`;
  - restore "Missed 0".

**History** (`demo-data.ts`). Every day group is newest first, like the real page, so Ibuprofen 22:14 sits above Magnesium 22:05.

**Security** (`SecurityScene.svelte`). Session expiry dates come from a demo-data export and are rendered with `formatUserDate(date, "UTC", "DD/MM/YYYY")`, giving "22 Oct 2026".

**The demo facts agree with the one list.** A node test asserts:

- LOG_ALL's Today and Yesterday groups equal `DEMO_DOSES` cut at `DESKTOP_NOW`, grouped by UTC day key, newest first (medication id and `formatUserTime`);
- each `MEDICATIONS[].lastTaken` equals `formatTimeSince(<that medication's latest taken dose ≤ DESKTOP_NOW>, DESKTOP_NOW)`;
- the Security expiry text equals `formatUserDate` over the demo-data dates.

Mutations:

- swap two Yesterday rows;
- restore "22/10/2026".

**Accent.**

- `WalkthroughVideo.svelte`'s default becomes `#4f46e5`. The comment above it, "the app's default accent", becomes true without editing.
- **The test.** A node test SSR-renders `WalkthroughVideo` with no props, using `render` from `svelte/server`, and reads `.body`. It asserts the theme style contains the accent value `userPreferences.accentColor.default`, the Drizzle column default. It also asserts that `src/routes/+page.svelte` passes no `accent` prop.
- **Mutation:** restore `#6366f1` as the prop default.

## Section 5 — Engine, tests and verification

**Frame state.**

- **Removed:**
  - from `Frame.dashboard`: `count`, `lisinoprilDone`, `labelGone`, `entry`, `pillHover`, `pillPress`, `flash` and `pulse`;
  - the top-level `toast`;
  - from `Frame.phone`: `vitaminDDone` and `toast`.
- **Added:** `Frame.dashboard` and `Frame.phone` each get three values, all pure functions of T:
  - `pending`: `null`, or the spinner's angle in degrees, `360 × (T − tLog) / 0.75`;
  - `logged`: 0..1;
  - `offer`: 0..1.

  The phone keeps `bannerY`, `touch` and `scale`.

- **Scenes stay stateless** renderers of their Frame slice.

**Measured geometry must not depend on T.**

- **Measured in the before-log layout.** Production measures at T between 0 and 1.2s (Title scene), so every rect `computeFrame` reads describes the before-log layout.
- **Every marked element is mounted at every T.** The collapse, the new Done row and the offer are drawn with height, opacity or transform, never with an `{#if}` around a marked element.
- **The post-log framing** (Section 1) uses only before-log rects, so it is correct by construction.

**`REQUIRED_MARKS` (D8).** `timeline.ts` exports `REQUIRED_MARKS: readonly string[]`.

- **Reads are recorded, not grepped.** `walkthrough-timeline.test.ts` wraps the measurements in a `Proxy` that records every key read. It runs `computeFrame` over the whole loop in 20ms samples and asserts that the recorded set equals `REQUIRED_MARKS`. A source regex would miss keys built at runtime.
- **The fixture follows the list.** The test also asserts that `Object.keys(MEASURED)` equals `REQUIRED_MARKS`.
- **Mutation:** add an `R("d.new")` read without listing it.

**The stage mount test** is a new `tests/unit/walkthrough-stage.svelte.test.ts`.

- **Mounting.**
  - `marks.ts` exports its context key as `MARKS_CONTEXT`, as `dose-write-lock` exports `DOSE_WRITE_LOCK`.
  - The test mounts `WalkthroughStage` directly, with `full: true`, `frame: computeFrame(T, {})`, `time: T`, `timeFormat: "24h"`, and `context: new Map([[MARKS_CONTEXT, registry]])`.
  - It calls `flushSync()` before any assertion, because actions run only on flush.
  - `registry` is a test-only `Map` subclass whose `set` records every (key, element) pair.
- **The moments it checks:** T = 0, which is when production measures, then `CUES.Today + 1`, `tLog − 0.1`, `tLog + 0.2`, `tLog + 1.0`, `CUES.Reminders + 1` and `tTap + 0.5`.
- **Assertions, in one `it`, so an empty registry cannot pass them:**
  - the registered key set is the same at every T, and equals `REQUIRED_MARKS ∪ {SHELL_ROOT, PHONE_ROOT}` plus any unread keys listed explicitly in the test;
  - no key is recorded against two distinct elements;
  - every `p.` key's element is contained by the `PHONE_ROOT` element, and every other non-root key's element by `SHELL_ROOT` (`root.contains(el)`);
  - the stage contains no element matching `a[href], area[href], button, input, select, textarea, summary, details, iframe, audio[controls], video[controls], [contenteditable], [tabindex]`.
- **jsdom has no layout**, so this test checks presence and structure only. Geometry is the browser check's job.
- **Mutations:**
  - wrap the new Done row's mark in `{#if logged}`;
  - give the phone's card the desktop card's key;
  - pass a `d.` key to a phone part;
  - add a `<button>` to `StageChips`;
  - remove `use:mark` from Log now.

**Reduced motion.** A jsdom mount of `WalkthroughVideo` stubs `matchMedia` to return `reduce`, and stubs `IntersectionObserver`. It asserts that the title frame shows, the player does not play, and the button offers to play the walkthrough.

**Timeline pins change deliberately, never loosen.**

- Scene names, caption text and numbering, the cursor-per-scene table, and any pinned history or analytics totals Section 4 moves. Each changed pin says why in its commit.
- The old dashboard-state assertions are replaced by:
  - `pending` is non-null exactly on `[tLog, tLog + 0.4)`;
  - `logged` is 0 before `tLog + 0.4` and 1 from `tLog + 0.7`;
  - `offer` is 1 on `[tLog + 0.8, CUES.Medications)`, which is asserted to be at least 1.5s, and exactly 0 at `CUES.Medications` and every later sample;
  - the same three for the phone around `tTap`, with `offer` 0 at `CUES.Outro`.
- **Mutation:** end the offer at `tLog + 5.2`, today's toast timing.

**New tests, summarised:**

- the dashboard fidelity test, covering both data and render (Section 2);
- the push and email copy tests (Section 3);
- the Analytics fold check, the demo-facts check and the accent check (Section 4);
- `REQUIRED_MARKS`, the stage mount test and reduced motion (above).

Every new test is proven by mutation: break the production line it guards and watch it fail.

**Visual verification (D10).** The work is visual, and the landing page is public and signed out.

- **Environment.**
  - Write a gitignored `.env` in the worktree with two throwaway values: any `ENCRYPTION_KEY`, and CI's placeholder `DATABASE_URL` (`ci.yml:59`). Delete it afterwards.
  - Signed-out `/` with no session cookie runs no query (`hooks.server.ts:21-26`), and `neon()` is lazy.
  - Do not edit the tracked `.claude/launch.json`.
  - Load `/` with no session cookie.
- **Seeking.** Before the stage scrolls into view, stub `performance.now` and `requestAnimationFrame` from the browser console (`javascript_tool`), so each screenshot's T is chosen exactly. Nothing is added to `src/`.
- **Screenshots:**
  - the Today opening;
  - the pan's end, with the chips;
  - just before the tap;
  - the spinner;
  - just after the update;
  - the offer framing;
  - the Medications cut, with the offer gone;
  - the phone before and after the tap;
  - the Analytics bar;
  - the History Yesterday group;
  - Security's dates.

  Each is checked for legibility at a 1024px container and at 375px. The browser check confirms each framing; it does not choose one.

- **The pause button** is checked too. Reduced motion is covered by the jsdom test, because the browser pane cannot emulate it.

**Gates.**

- `npx vitest run`, run twice, naming any failing test;
- `npm run check`: 0 errors, warnings not above the baseline;
- `npm run lint`: 0 errors, warnings not above the baseline;
- `npm run format:check`;
- `npm run build`, with CI's placeholder `DATABASE_URL`.

## Rollout

- No migration, no schema change and no API change.
- The landing page is prerendered, so the redraw ships with the next deploy.
- The push and email body change applies to the next reminder sent. The wire format is unchanged, so older service workers render it as before.

## Out of scope

- The Analytics Insights card.
- Add Medication's colour swatches below Category.
- Security's Sign Out card.
- The Data scene's Danger Zone.
- New Undo or delete beats.
- A visible transcript or a reduced-motion poster frame.
- Unifying the CX/CY constants duplicated across `timeline.ts`, `WalkthroughStage.svelte` and the test.

## Follow-ups

- **The landing hero image** is brand art of a schedule view the app no longer has: a bottom tab bar, time-of-day icons and an "All done!" banner. It sits beside the corrected walkthrough.
- **An axe or e2e run over `/`.** No test visits the landing page today.
- **A visible text alternative** for the walkthrough, beyond the sr-only list.

## Docs to update in the same PR

- **CLAUDE.md**, one bullet under Reusable Components:
  - The walkthrough's dashboard state and visible text are checked against the real composer and copy helpers (`walkthrough-dashboard-fidelity.test.ts`).
  - Every mark the timeline reads must be registered from mount, at every T, under its root (`REQUIRED_MARKS`, `walkthrough-stage.svelte.test.ts`).
  - Real components with controls or landmarks are never mounted in the stage.
- **CHANGELOG** `[Unreleased]`:
  - the landing-page walkthrough shows the current dashboard;
  - reminder push and email copy no longer reads "ago ago".
