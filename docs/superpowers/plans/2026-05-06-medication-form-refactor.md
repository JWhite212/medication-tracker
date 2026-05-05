# P7 - MedicationForm Decomposition

> **Status:** in progress
> **Branch:** `feat/medication-form-refactor`
> **Owner:** Jamie

**Goal:** Break the 635-line `MedicationForm.svelte` into focused subcomponents and extract reusable state/style helpers. Behaviour, accessibility, validation, and the interaction-warning feature flag stay identical.

**Architecture:** A thin orchestrator (`MedicationForm.svelte`) keeps the form-level state (mode, fixedTimes, selectedColour) and binds it to subcomponents via props. Each subcomponent owns one section's markup, renders the underlying `name=...` inputs unchanged so the existing form-action consumers (`/medications/new`, `/medications/[id]`) keep working without changes. Shared options (preset colours, form/category options, day labels) and initial-state derivation move into `src/lib/medications/`.

---

## Decomposition

The brief lists 13 components. Several map cleanly to single sections; some are tightly coupled and live better together. The split below preserves the spec's intent (every named section has a clear home) while avoiding prop drilling between fragments that share state. For example, the colour picker, pattern picker, and live preview all read `selectedColour`/`selectedColourSecondary`/`selectedPattern`, so splitting them into 3 files would force three-way binds with no readability win.

### Components (8 svelte files)

- `src/lib/components/MedicationForm.svelte` (orchestrator; same path so importers do not change)
- `src/lib/components/medication-form/MedicationIdentityFields.svelte` (name input + onblur interaction probe)
- `src/lib/components/medication-form/InteractionWarningPanel.svelte` (the warning ribbon)
- `src/lib/components/medication-form/MedicationDosageFields.svelte` (dosageAmount + dosageUnit grid)
- `src/lib/components/medication-form/MedicationCategoryFields.svelte` (form + category selects)
- `src/lib/components/medication-form/MedicationStylePicker.svelte` (colour primary/secondary, pattern grid, live preview combined)
- `src/lib/components/medication-form/MedicationScheduleSection.svelte` (mode tabs plus the per-mode editor inline)
- `src/lib/components/medication-form/MedicationInventoryFields.svelte` (inventoryCount + inventoryAlertThreshold + notes)

### Utility modules (3 .ts files)

- `src/lib/medications/medication-form-errors.ts` (`FormErrors` type alias)
- `src/lib/medications/medication-form-state.ts` (`ScheduleMode` type, `isScheduleMode`, `DAY_LABELS`, plus pure `deriveInitialMode` / `deriveInitialFixedTimes` / `deriveInitialDaysOfWeek` helpers, testable in vitest)
- `src/lib/medications/medication-style-options.ts` (`PRESET_COLOURS`, `FORM_OPTIONS`, `CATEGORY_OPTIONS`)

### Tests

- `tests/unit/medication-form-state.test.ts` pins the `deriveInitial*` helpers' behaviour for new medications, schedules-only, mixed schedule kinds, and PRN.

## Risks / notes

- All form fields keep their `name="..."` attributes verbatim so the existing Zod schema and form-action consumers keep working unchanged.
- Hidden fields (`scheduleMode`, `schedules`, `scheduleType`, `scheduleIntervalHours`, `colour`, `colourSecondary`, `pattern`) stay in the orchestrator alongside the legacy compatibility shim, since they encode form-level state, not section-local state.
- ARIA attributes (`aria-pressed` for day pickers, `aria-label` for colour swatches, etc.) are preserved 1:1.
- The interaction-warning feature flag is gated server-side by `INTERACTIONS_ENABLED` reaching the `/api/interactions` endpoint; the client-side fetch behaviour is unchanged.
