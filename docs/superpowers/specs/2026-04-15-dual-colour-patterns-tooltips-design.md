# Dual-Colour System, Patterns & Tooltips — Design Spec

**Date:** 2026-04-15
**Status:** Approved

## Overview

Three features for the medication customisation experience:

1. **Dual-colour system** — optional secondary colour per medication
2. **Pattern selection** — 8 CSS patterns applied using the 1-2 colours
3. **Hoverable tooltips** — contextual help on non-obvious form fields

## 1. Dual-Colour System

### Data Model

Add two columns to `medications` table:

| Column             | Type   | Default   | Notes                                 |
| ------------------ | ------ | --------- | ------------------------------------- |
| `colour_secondary` | `text` | `null`    | Hex colour. Null = single-colour mode |
| `pattern`          | `text` | `'solid'` | Pattern identifier string             |

Backward-compatible: existing medications have `colour_secondary = null`, `pattern = 'solid'` and render identically to before.

### Validation

- `colourSecondary`: optional, same `^#[0-9a-fA-F]{6}$` regex as primary
- `pattern`: enum of the 8 pattern IDs listed below

### Form UX — Inline Expand

The existing colour palette row gets a dashed "+" circle at the end.

**Single-colour state (default):**

- 10 preset colour circles + "+" button
- Hidden input `colour` holds selected hex
- No pattern selector visible, pattern defaults to `'solid'`

**Dual-colour state (after clicking "+"):**

- "Primary" label + 10 preset circles (current selection highlighted)
- "Secondary" label + 10 preset circles + "x" remove button
- Pattern grid appears below (8 swatches rendered with both colours)
- Live preview row: card square (40px), timeline dot (12px), pill button shape
- Hidden inputs: `colour`, `colourSecondary`, `pattern`

**Removing secondary colour:**

- Click "x" next to secondary row
- Secondary row and pattern grid disappear
- `colourSecondary` set to empty, `pattern` reset to `'solid'`

## 2. Pattern System

### Pattern Definitions (8 total)

| ID             | Name               | CSS Background                                                                 | Requires 2nd colour |
| -------------- | ------------------ | ------------------------------------------------------------------------------ | ------------------- |
| `solid`        | Solid              | `{c1}`                                                                         | No                  |
| `split`        | Split              | `linear-gradient(90deg, {c1} 50%, {c2} 50%)`                                   | Yes                 |
| `gradient`     | Gradient           | `linear-gradient(135deg, {c1}, {c2})`                                          | Yes                 |
| `stripes`      | Diagonal Stripes   | `repeating-linear-gradient(45deg, {c1}, {c1} 4px, {c2} 4px, {c2} 8px)`         | Yes                 |
| `h-stripes`    | Horizontal Stripes | `repeating-linear-gradient(0deg, {c1}, {c1} 4px, {c2} 4px, {c2} 8px)`          | Yes                 |
| `dots`         | Polka Dots         | `radial-gradient(circle 3px, {c2} 100%, transparent 100%) 0 0/10px 10px, {c1}` | Yes                 |
| `checkerboard` | Checkerboard       | `conic-gradient({c1} 25%, {c2} 25% 50%, {c1} 50% 75%, {c2} 75%) 0 0/14px 14px` | Yes                 |
| `radial`       | Radial             | `radial-gradient(circle at 30% 30%, {c2}, {c1})`                               | Yes                 |

### Rendering Utility

File: `src/lib/utils/medication-style.ts`

```ts
function getMedicationBackground(
  colour: string,
  colourSecondary: string | null,
  pattern: string,
): string;
```

Returns the CSS `background` value. Used in all display locations.

### Display Locations & Size Handling

| Location         | Element size            | Rendering                                                            |
| ---------------- | ----------------------- | -------------------------------------------------------------------- |
| `MedicationCard` | 40x40px `rounded-lg`    | Full pattern via `background` property                               |
| `QuickLogBar`    | Pill button (~120x32px) | Full pattern via `background` property                               |
| `TimelineEntry`  | 12x12px `rounded-full`  | Smart fallback: geometric patterns render as `gradient` at this size |
| Form preview     | All three sizes         | Shows exactly how each location will look                            |

**Smart fallback rule:** For surfaces < 20px, geometric patterns (`stripes`, `h-stripes`, `dots`, `checkerboard`) fall back to `gradient` rendering. `solid`, `split`, `gradient`, and `radial` render at any size.

## 3. Tooltip Component

### Implementation

File: `src/lib/components/ui/Tooltip.svelte`

Props: `{ text: string }`

Renders a small info icon (circle-i) inline. On hover (desktop) or tap (mobile), shows a positioned tooltip above the icon with the explanation text.

### Styling

- Background: `bg-surface-overlay`
- Text: `text-text-primary`, `text-xs`
- Border: `border-glass-border`
- Shape: `rounded-lg`, small arrow pointing down
- Z-index: `z-30`
- Max-width: 250px
- Position: above icon by default, flips below if near viewport top

### Fields With Tooltips

| Field                     | Location              | Tooltip Text                                                                                                                                                   |
| ------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schedule Type             | Medication form       | Scheduled medications have a regular interval (e.g. every 8 hours). As-needed (PRN) medications are taken only when required and won't count toward adherence. |
| Schedule Interval         | Medication form       | How many hours between doses. Used to calculate adherence and send overdue reminders.                                                                          |
| Inventory Count           | Medication form       | Track how many doses you have left. Automatically decreases when you log a dose.                                                                               |
| Low Stock Alert Threshold | Medication form       | You'll see a warning when your remaining inventory drops to this number.                                                                                       |
| Colour & Pattern          | Medication form       | Choose how this medication appears across the app — on cards, pills, and timeline entries.                                                                     |
| UI Density                | Settings > Appearance | Compact mode reduces spacing throughout the app to show more content on screen.                                                                                |
| Reduced Motion            | Settings > Appearance | Disables animations and transitions for accessibility or personal preference.                                                                                  |

### Usage Pattern

Placed inline after label text:

```svelte
<label>Schedule Interval (hours) <Tooltip text="How many hours..." /></label>
```

## Files to Create

- `src/lib/utils/medication-style.ts` — pattern rendering utility
- `src/lib/components/ui/Tooltip.svelte` — reusable tooltip component

## Files to Modify

- `src/lib/server/db/schema.ts` — add `colourSecondary` and `pattern` columns
- `src/lib/utils/validation.ts` — add `colourSecondary` and `pattern` to medication schema
- `src/lib/components/MedicationForm.svelte` — dual-colour picker, pattern grid, preview, tooltips
- `src/lib/components/MedicationCard.svelte` — use `getMedicationBackground()`
- `src/lib/components/QuickLogBar.svelte` — use `getMedicationBackground()`
- `src/lib/components/TimelineEntry.svelte` — use `getMedicationBackground()`
- `src/routes/(app)/settings/appearance/+page.svelte` — add tooltips to density/motion fields

## Migration

- `npx drizzle-kit generate` then `npx drizzle-kit push`
- Existing rows get `colour_secondary = null`, `pattern = 'solid'` — zero visual change
