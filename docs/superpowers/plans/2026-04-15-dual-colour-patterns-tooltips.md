# Dual-Colour, Patterns & Tooltips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional secondary colour + pattern selection to medications, and hoverable tooltips to non-obvious form fields.

**Architecture:** Two new columns on `medications` (`colour_secondary`, `pattern`). A pure utility `getMedicationBackground()` generates CSS background strings. A reusable `Tooltip.svelte` component. The `DoseLogWithMedication` type and its query projections gain the two new fields so display components can render patterns.

**Tech Stack:** SvelteKit, Svelte 5 runes, Tailwind CSS v4, Drizzle ORM, PostgreSQL (Neon), Zod

---

## File Structure

| File                                                | Action | Responsibility                                           |
| --------------------------------------------------- | ------ | -------------------------------------------------------- |
| `src/lib/utils/medication-style.ts`                 | Create | `getMedicationBackground()` utility                      |
| `src/lib/components/ui/Tooltip.svelte`              | Create | Reusable hover/tap tooltip                               |
| `src/lib/server/db/schema.ts`                       | Modify | Add `colourSecondary`, `pattern` columns                 |
| `src/lib/utils/validation.ts`                       | Modify | Add fields to `medicationSchema`                         |
| `src/lib/types.ts`                                  | Modify | Expand `DoseLogWithMedication` Pick                      |
| `src/lib/server/doses.ts`                           | Modify | Add new fields to select projections                     |
| `src/routes/(app)/log/+page.server.ts`              | Modify | Add new fields to select projection                      |
| `src/lib/components/MedicationForm.svelte`          | Modify | Dual-colour picker, pattern grid, preview, tooltips      |
| `src/lib/components/MedicationCard.svelte`          | Modify | Use `getMedicationBackground()`                          |
| `src/lib/components/QuickLogBar.svelte`             | Modify | Use `getMedicationBackground()`                          |
| `src/lib/components/TimelineEntry.svelte`           | Modify | Use `getMedicationBackground()` with small-size fallback |
| `src/routes/(app)/settings/appearance/+page.svelte` | Modify | Add tooltips to density/motion fields                    |

---

### Task 1: Schema + Validation + Types

**Files:**

- Modify: `src/lib/server/db/schema.ts:63-64` (after `colour` column)
- Modify: `src/lib/utils/validation.ts:31-32` (after `colour` field)
- Modify: `src/lib/types.ts:30-34` (`DoseLogWithMedication`)
- Modify: `src/lib/server/doses.ts:28-30` (getTodaysDoses select)
- Modify: `src/routes/(app)/log/+page.server.ts:34-35` (log page select)

- [ ] **Step 1: Add columns to schema**

In `src/lib/server/db/schema.ts`, after line 63 (`colour: text("colour").notNull()`), add:

```ts
    colourSecondary: text("colour_secondary"),
    pattern: text("pattern").notNull().default("solid"),
```

- [ ] **Step 2: Add fields to validation schema**

In `src/lib/utils/validation.ts`, after the `colour` field (line 31), add:

```ts
  colourSecondary: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .or(z.literal("")),
  pattern: z
    .enum([
      "solid",
      "split",
      "gradient",
      "stripes",
      "h-stripes",
      "dots",
      "checkerboard",
      "radial",
    ])
    .default("solid"),
```

- [ ] **Step 3: Expand DoseLogWithMedication type**

In `src/lib/types.ts`, change the `DoseLogWithMedication` Pick to include the new fields:

```ts
export type DoseLogWithMedication = DoseLog & {
  medication: Pick<
    Medication,
    | "name"
    | "dosageAmount"
    | "dosageUnit"
    | "form"
    | "colour"
    | "colourSecondary"
    | "pattern"
  >;
};
```

- [ ] **Step 4: Add fields to dose query projections**

In `src/lib/server/doses.ts`, in the `getTodaysDoses` select (around line 29), add after `colour: medications.colour`:

```ts
        colourSecondary: medications.colourSecondary,
        pattern: medications.pattern,
```

In `src/routes/(app)/log/+page.server.ts`, in the select (around line 38), add after `colour: medications.colour`:

```ts
        colourSecondary: medications.colourSecondary,
        pattern: medications.pattern,
```

- [ ] **Step 5: Generate and push migration**

```bash
npx drizzle-kit generate
npx drizzle-kit push
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/db/schema.ts src/lib/utils/validation.ts src/lib/types.ts src/lib/server/doses.ts "src/routes/(app)/log/+page.server.ts" drizzle/
git commit -m "feat: add colourSecondary and pattern columns to medications"
```

---

### Task 2: Pattern Rendering Utility

**Files:**

- Create: `src/lib/utils/medication-style.ts`

- [ ] **Step 1: Create the utility file**

Create `src/lib/utils/medication-style.ts`:

```ts
const GEOMETRIC_PATTERNS = new Set([
  "stripes",
  "h-stripes",
  "dots",
  "checkerboard",
]);

export function getMedicationBackground(
  colour: string,
  colourSecondary: string | null | undefined,
  pattern: string,
  small = false,
): string {
  const c1 = colour;
  const c2 = colourSecondary || colour;

  if (!colourSecondary || pattern === "solid") return c1;

  // Smart fallback: geometric patterns render as gradient at small sizes (<20px)
  const effectivePattern =
    small && GEOMETRIC_PATTERNS.has(pattern) ? "gradient" : pattern;

  switch (effectivePattern) {
    case "split":
      return `linear-gradient(90deg, ${c1} 50%, ${c2} 50%)`;
    case "gradient":
      return `linear-gradient(135deg, ${c1}, ${c2})`;
    case "stripes":
      return `repeating-linear-gradient(45deg, ${c1}, ${c1} 4px, ${c2} 4px, ${c2} 8px)`;
    case "h-stripes":
      return `repeating-linear-gradient(0deg, ${c1}, ${c1} 4px, ${c2} 4px, ${c2} 8px)`;
    case "dots":
      return `radial-gradient(circle 3px, ${c2} 100%, transparent 100%) 0 0/10px 10px, ${c1}`;
    case "checkerboard":
      return `conic-gradient(${c1} 25%, ${c2} 25% 50%, ${c1} 50% 75%, ${c2} 75%) 0 0/14px 14px`;
    case "radial":
      return `radial-gradient(circle at 30% 30%, ${c2}, ${c1})`;
    default:
      return c1;
  }
}

export const PATTERN_OPTIONS = [
  { id: "solid", name: "Solid" },
  { id: "split", name: "Split" },
  { id: "gradient", name: "Gradient" },
  { id: "stripes", name: "Diagonal Stripes" },
  { id: "h-stripes", name: "Horizontal Stripes" },
  { id: "dots", name: "Polka Dots" },
  { id: "checkerboard", name: "Checkerboard" },
  { id: "radial", name: "Radial" },
] as const;
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/utils/medication-style.ts
git commit -m "feat: add getMedicationBackground pattern rendering utility"
```

---

### Task 3: Tooltip Component

**Files:**

- Create: `src/lib/components/ui/Tooltip.svelte`

- [ ] **Step 1: Create the Tooltip component**

Create `src/lib/components/ui/Tooltip.svelte`:

```svelte
<script lang="ts">
  let { text }: { text: string } = $props();
  let visible = $state(false);
  let iconEl: HTMLButtonElement | undefined = $state();
  let above = $state(true);

  function show() {
    if (iconEl) {
      const rect = iconEl.getBoundingClientRect();
      above = rect.top > 80;
    }
    visible = true;
  }
  function hide() { visible = false; }
  function toggle() { visible ? hide() : show(); }
</script>

<span class="relative inline-flex items-center ml-1">
  <button
    type="button"
    class="inline-flex h-4 w-4 items-center justify-center rounded-full border border-glass-border text-[10px] text-text-muted hover:text-text-secondary hover:border-text-muted transition-colors"
    aria-label="More info"
    bind:this={iconEl}
    onmouseenter={show}
    onmouseleave={hide}
    onclick={toggle}
    onfocusin={show}
    onfocusout={hide}
  >i</button>
  {#if visible}
    <div
      role="tooltip"
      class="absolute left-1/2 z-30 w-max max-w-[250px] -translate-x-1/2 rounded-lg border border-glass-border bg-surface-overlay px-3 py-2 text-xs text-text-primary shadow-lg {above ? 'bottom-full mb-2' : 'top-full mt-2'}"
    >
      {text}
      <div class="absolute left-1/2 -translate-x-1/2 h-0 w-0 border-x-[5px] border-x-transparent {above ? 'top-full border-t-[5px] border-t-surface-overlay' : 'bottom-full border-b-[5px] border-b-surface-overlay'}"></div>
    </div>
  {/if}
</span>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/ui/Tooltip.svelte
git commit -m "feat: add reusable Tooltip component"
```

---

### Task 4: Update Display Components

**Files:**

- Modify: `src/lib/components/MedicationCard.svelte:8`
- Modify: `src/lib/components/QuickLogBar.svelte:35`
- Modify: `src/lib/components/TimelineEntry.svelte:17`

- [ ] **Step 1: Update MedicationCard**

In `src/lib/components/MedicationCard.svelte`, add the import:

```svelte
<script lang="ts">
  import type { Medication } from '$lib/types';
  import { getMedicationBackground } from '$lib/utils/medication-style';
  let { medication }: { medication: Medication } = $props();
</script>
```

Change line 8 from:

```svelte
  <div class="h-10 w-10 rounded-lg" style="background-color: {medication.colour}"></div>
```

To:

```svelte
  <div class="h-10 w-10 rounded-lg" style="background: {getMedicationBackground(medication.colour, medication.colourSecondary, medication.pattern)}"></div>
```

- [ ] **Step 2: Update QuickLogBar**

In `src/lib/components/QuickLogBar.svelte`, add the import:

```ts
import { getMedicationBackground } from "$lib/utils/medication-style";
```

Change line 35 from:

```svelte
        style="background-color: {med.colour}"
```

To:

```svelte
        style="background: {getMedicationBackground(med.colour, med.colourSecondary, med.pattern)}"
```

- [ ] **Step 3: Update TimelineEntry**

In `src/lib/components/TimelineEntry.svelte`, add the import:

```ts
import { getMedicationBackground } from "$lib/utils/medication-style";
```

Change line 17 from:

```svelte
  <div class="h-3 w-3 shrink-0 rounded-full" style="background-color: {dose.medication.colour}"></div>
```

To:

```svelte
  <div class="h-3 w-3 shrink-0 rounded-full" style="background: {getMedicationBackground(dose.medication.colour, dose.medication.colourSecondary, dose.medication.pattern, true)}"></div>
```

Note the `true` parameter for `small` — this triggers the smart fallback for geometric patterns at 12px.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/MedicationCard.svelte src/lib/components/QuickLogBar.svelte src/lib/components/TimelineEntry.svelte
git commit -m "feat: render medication patterns in card, pill, and timeline"
```

---

### Task 5: Medication Form — Dual-Colour Picker + Pattern Grid + Preview

**Files:**

- Modify: `src/lib/components/MedicationForm.svelte` (major rewrite of colour section)

- [ ] **Step 1: Add state and imports**

Add to the `<script>` block in `MedicationForm.svelte`:

```ts
import Tooltip from "$lib/components/ui/Tooltip.svelte";
import {
  getMedicationBackground,
  PATTERN_OPTIONS,
} from "$lib/utils/medication-style";
```

Add state variables after the existing `selectedColour` state:

```ts
let selectedColourSecondary = $state<string | null>(
  formValues["colourSecondary"] ?? medication?.colourSecondary ?? null,
);
let showSecondary = $state(selectedColourSecondary !== null);
let selectedPattern = $state(
  formValues["pattern"] ?? medication?.pattern ?? "solid",
);
```

- [ ] **Step 2: Replace the colour section**

Replace the entire colour `<div>` block (lines 124-139, the section starting with `<p class="mb-2 block text-sm font-medium">Colour</p>`) with:

```svelte
  <div>
    <p class="mb-2 block text-sm font-medium">
      Colour & Pattern
      <Tooltip text="Choose how this medication appears across the app — on cards, pills, and timeline entries." />
    </p>

    <!-- Primary colour row -->
    <div class="mb-2">
      {#if showSecondary}<span class="mb-1 block text-xs text-text-muted">Primary</span>{/if}
      <div class="flex flex-wrap items-center gap-2">
        {#each presetColours as colour}
          <button
            type="button"
            onclick={() => (selectedColour = colour)}
            class="h-8 w-8 rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 {selectedColour === colour ? 'ring-2 ring-accent ring-offset-2 scale-110' : ''}"
            style="background-color: {colour}"
            aria-label="Select primary colour {colour}"
          ></button>
        {/each}
        {#if !showSecondary}
          <button
            type="button"
            onclick={() => { showSecondary = true; selectedColourSecondary = presetColours[2]; }}
            class="flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-white/30 text-white/40 text-lg transition-colors hover:border-white/50 hover:text-white/60"
            aria-label="Add secondary colour"
          >+</button>
        {/if}
      </div>
    </div>

    <!-- Secondary colour row (visible when + clicked) -->
    {#if showSecondary}
      <div class="mb-3">
        <span class="mb-1 block text-xs text-text-muted">Secondary</span>
        <div class="flex flex-wrap items-center gap-2">
          {#each presetColours as colour}
            <button
              type="button"
              onclick={() => (selectedColourSecondary = colour)}
              class="h-8 w-8 rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 {selectedColourSecondary === colour ? 'ring-2 ring-accent ring-offset-2 scale-110' : ''}"
              style="background-color: {colour}"
              aria-label="Select secondary colour {colour}"
            ></button>
          {/each}
          <button
            type="button"
            onclick={() => { showSecondary = false; selectedColourSecondary = null; selectedPattern = 'solid'; }}
            class="flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-danger/50 text-danger/70 text-sm transition-colors hover:border-danger hover:text-danger"
            aria-label="Remove secondary colour"
          >&times;</button>
        </div>
      </div>

      <!-- Pattern grid -->
      <div class="mb-3">
        <span class="mb-1 block text-xs text-text-muted">Pattern</span>
        <div class="flex flex-wrap gap-2">
          {#each PATTERN_OPTIONS as pat}
            <button
              type="button"
              onclick={() => (selectedPattern = pat.id)}
              class="h-11 w-11 rounded-lg border-2 transition-transform hover:scale-105 {selectedPattern === pat.id ? 'border-white scale-105' : 'border-transparent'}"
              style="background: {getMedicationBackground(selectedColour, selectedColourSecondary, pat.id)}"
              aria-label="Select {pat.name} pattern"
              title={pat.name}
            ></button>
          {/each}
        </div>
      </div>

      <!-- Live preview -->
      <div class="flex items-center gap-3">
        <span class="text-xs text-text-muted">Preview</span>
        <div class="h-10 w-10 rounded-lg" style="background: {getMedicationBackground(selectedColour, selectedColourSecondary, selectedPattern)}"></div>
        <div class="h-3 w-3 rounded-full" style="background: {getMedicationBackground(selectedColour, selectedColourSecondary, selectedPattern, true)}"></div>
        <div class="flex h-8 items-center rounded-full px-4 text-xs font-medium text-white" style="background: {getMedicationBackground(selectedColour, selectedColourSecondary, selectedPattern)}">
          Sample Pill
        </div>
      </div>
    {/if}

    <input type="hidden" name="colour" value={selectedColour} />
    <input type="hidden" name="colourSecondary" value={selectedColourSecondary ?? ''} />
    <input type="hidden" name="pattern" value={selectedPattern} />
    {#if errors['colour']?.[0]}<p class="mt-1 text-sm text-danger">{errors['colour'][0]}</p>{/if}
  </div>
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/MedicationForm.svelte
git commit -m "feat: dual-colour picker with pattern grid and live preview"
```

---

### Task 6: Add Tooltips to Form Fields

**Files:**

- Modify: `src/lib/components/MedicationForm.svelte` (tooltips on schedule, inventory fields)
- Modify: `src/routes/(app)/settings/appearance/+page.svelte` (tooltips on density, motion)

- [ ] **Step 1: Add tooltips to MedicationForm**

The `Tooltip` import was already added in Task 5. Add tooltip components inline after label text:

**Schedule Type** (line 142 area) — change the label to:

```svelte
    <label class="mb-1 block text-sm font-medium">
      Schedule Type
      <Tooltip text="Scheduled medications have a regular interval (e.g. every 8 hours). As-needed (PRN) medications are taken only when required and won't count toward adherence." />
    </label>
```

**Schedule Interval** — replace the `<Input>` with a manual label + input so the tooltip can sit inline:

```svelte
  {#if scheduleType === 'scheduled'}
    <div>
      <label for="scheduleIntervalHours" class="mb-1 block text-sm font-medium">
        Schedule Interval (hours)
        <Tooltip text="How many hours between doses. Used to calculate adherence and send overdue reminders." />
      </label>
      <input
        id="scheduleIntervalHours"
        name="scheduleIntervalHours"
        type="number"
        value={formValues['scheduleIntervalHours'] ?? (medication?.scheduleIntervalHours ?? '')}
        placeholder="e.g. 8"
        class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
      {#if errors['scheduleIntervalHours']?.[0]}<p class="mt-1 text-sm text-danger">{errors['scheduleIntervalHours'][0]}</p>{/if}
    </div>
  {/if}
```

**Inventory Count** — replace the `<Input>` with manual label + tooltip + input:

```svelte
    <div>
      <label for="inventoryCount" class="mb-1 block text-sm font-medium">
        Inventory Count
        <Tooltip text="Track how many doses you have left. Automatically decreases when you log a dose." />
      </label>
      <input
        id="inventoryCount"
        name="inventoryCount"
        type="number"
        value={formValues['inventoryCount'] ?? (medication?.inventoryCount?.toString() ?? '')}
        placeholder="e.g. 30"
        class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
      {#if errors['inventoryCount']?.[0]}<p class="mt-1 text-sm text-danger">{errors['inventoryCount'][0]}</p>{/if}
    </div>
```

**Low Stock Alert Threshold** — same pattern:

```svelte
    <div>
      <label for="inventoryAlertThreshold" class="mb-1 block text-sm font-medium">
        Low Stock Alert Threshold
        <Tooltip text="You'll see a warning when your remaining inventory drops to this number." />
      </label>
      <input
        id="inventoryAlertThreshold"
        name="inventoryAlertThreshold"
        type="number"
        value={formValues['inventoryAlertThreshold'] ?? (medication?.inventoryAlertThreshold?.toString() ?? '')}
        placeholder="e.g. 7"
        class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
      {#if errors['inventoryAlertThreshold']?.[0]}<p class="mt-1 text-sm text-danger">{errors['inventoryAlertThreshold'][0]}</p>{/if}
    </div>
```

- [ ] **Step 2: Add tooltips to Settings Appearance page**

In `src/routes/(app)/settings/appearance/+page.svelte`, add the import:

```ts
import Tooltip from "$lib/components/ui/Tooltip.svelte";
```

**Display Density** label (line 73) — change to:

```svelte
        <label for="uiDensity" class="mb-1 block text-sm font-medium">
          Display Density
          <Tooltip text="Compact mode reduces spacing throughout the app to show more content on screen." />
        </label>
```

**Reduce motion** label (line 85) — change to:

```svelte
        <label for="reducedMotion" class="text-sm font-medium">
          Reduce motion
          <Tooltip text="Disables animations and transitions for accessibility or personal preference." />
        </label>
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/MedicationForm.svelte "src/routes/(app)/settings/appearance/+page.svelte"
git commit -m "feat: add contextual tooltips to medication form and appearance settings"
```

---

### Task 7: Verify and Push

- [ ] **Step 1: Run type check**

```bash
npx svelte-check --threshold error 2>&1 | grep -c "ERROR"
```

Verify the count hasn't increased from the baseline of 14 pre-existing errors.

- [ ] **Step 2: Run tests**

```bash
npx vitest run
```

Expected: 6 files, 34 tests, all pass.

- [ ] **Step 3: Push**

```bash
git push
```
