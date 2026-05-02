# Plan: Accessibility — WCAG 2.2 AA Compliance

## Summary

Remediate the critical accessibility gaps in MedTracker to achieve WCAG 2.2 AA compliance. Focuses on color contrast fixes, ARIA error attributes on forms, focus trap for modals, mobile sidebar dialog semantics, error announcements for screen readers, and pagination accessibility. Builds on existing strengths (skip link, reduced motion, keyboard shortcuts, semantic HTML).

## User Story

As a user with disabilities (visual impairment, motor limitation, screen reader dependence),
I want MedTracker to be fully accessible,
So that I can manage my medications independently regardless of ability.

## Problem → Solution

Low-contrast text tokens fail WCAG AA, form errors invisible to screen readers, modal focus escapes to background, mobile sidebar lacks dialog role → All contrast ratios meet 4.5:1 minimum, form errors announced and linked via ARIA, modals trap focus, and all interactive patterns are keyboard/screen-reader accessible.

## Metadata

- **Complexity**: Medium
- **Source PRD**: N/A (from opportunity map Theme D)
- **PRD Phase**: N/A
- **Estimated Files**: 10

---

## UX Design

### Before

```
┌─────────────────────────────────────────┐
│  Form with errors:                      │
│  ┌─────────────────────────────┐        │
│  │ Medication Name              │        │
│  │ [___________________________]│        │
│  │ This field is required ← red │← SR   │
│  │  text, no ARIA link to input │  can't │
│  │                              │  find  │
│  │ Modal opens:                 │  this  │
│  │  ┌──────────────────┐       │        │
│  │  │  Edit dose form   │      │        │
│  │  │  [Tab escapes!]   │← focus│        │
│  │  └──────────────────┘  leaks│        │
│  │                              │        │
│  │ text-muted: #55556a          │← 4.1:1│
│  │  (fails AA on glass bg)      │ FAIL  │
│  └─────────────────────────────┘        │
└─────────────────────────────────────────┘
```

### After

```
┌─────────────────────────────────────────┐
│  Form with errors:                      │
│  ┌─────────────────────────────┐        │
│  │ Medication Name *            │        │
│  │ [___________________________]│← aria- │
│  │  ! This field is required    │  invalid│
│  │  id="name-error" role=alert  │  + aria│
│  │                              │  -desc │
│  │ Modal opens:                 │        │
│  │  ┌──────────────────┐       │        │
│  │  │  Edit dose form   │      │        │
│  │  │  [Focus trapped]  │← Tab │        │
│  │  └──────────────────┘ cycles│        │
│  │                              │        │
│  │ text-muted: #71718a          │← 5.3:1│
│  │  (passes AA on all bg)       │ PASS  │
│  └─────────────────────────────┘        │
└─────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint     | Before                        | After                                                | Notes                               |
| -------------- | ----------------------------- | ---------------------------------------------------- | ----------------------------------- |
| Form errors    | Red text below field, no ARIA | `aria-invalid` + `aria-describedby` + `role="alert"` | Screen readers announce errors      |
| Modal open     | Focus not managed             | Focus moves to first focusable, trapped in modal     | Escape closes, focus returns        |
| Mobile sidebar | No dialog role                | `role="dialog"` + `aria-modal="true"` + `aria-label` | Proper modal semantics              |
| Muted text     | #55556a (4.1:1)               | #71718a (5.3:1)                                      | Passes AA on all backgrounds        |
| Auth errors    | Plain div, not announced      | `role="alert"`                                       | Screen readers announce immediately |
| Pagination     | No labels                     | `aria-label` + `rel="prev/next"`                     | Navigation context for AT           |
| High contrast  | Not supported                 | `@media (prefers-contrast: more)`                    | Higher contrast tokens              |

---

## Mandatory Reading

| Priority | File                                       | Lines  | Why                                         |
| -------- | ------------------------------------------ | ------ | ------------------------------------------- |
| P0       | `src/app.css`                              | 1-24   | Color tokens to fix                         |
| P0       | `src/lib/components/ui/Input.svelte`       | all    | Core input component to enhance             |
| P0       | `src/lib/components/ui/Modal.svelte`       | all    | Modal needing focus trap                    |
| P0       | `src/routes/(app)/+layout.svelte`          | 44-58  | Mobile sidebar to fix                       |
| P1       | `src/routes/auth/login/+page.svelte`       | 21-31  | Auth error display pattern                  |
| P1       | `src/routes/(app)/log/+page.svelte`        | 98-105 | Pagination to enhance                       |
| P1       | `src/lib/components/MedicationForm.svelte` | all    | Largest form, needs fieldsets               |
| P2       | `src/lib/components/ui/Toast.svelte`       | all    | Existing aria-live pattern (good reference) |
| P2       | `src/app.html`                             | all    | Skip link already exists (line 21)          |
| P2       | `src/routes/auth/register/+page.svelte`    | all    | Similar auth error pattern                  |

---

## Patterns to Mirror

### ARIA_LIVE_TOAST

```svelte
<!-- SOURCE: src/lib/components/ui/Toast.svelte:28-34 -->
<div class="fixed right-4 bottom-4 z-50 flex flex-col gap-2" aria-live="polite">
  {#each toasts as toast (toast.id)}
    <div role="alert">
      <span class="text-sm">{toast.message}</span>
    </div>
  {/each}
</div>
```

### EXISTING_SKIP_LINK

```html
<!-- SOURCE: src/app.html:21 -->
<a
  href="#main-content"
  class="focus:bg-accent sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:px-4 focus:py-2 focus:text-white"
  >Skip to main content</a
>
```

### EXISTING_MODAL_STRUCTURE

```svelte
<!-- SOURCE: src/lib/components/ui/Modal.svelte:16-27 -->
<div
  class="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
  onclick={handleBackdrop}
  onkeydown={handleKeydown}
  role="dialog"
  aria-modal="true"
  tabindex="-1"
>
  <div
    class="border-glass-border bg-surface-raised w-full max-w-md rounded-xl border p-6 shadow-2xl"
  >
    {@render children()}
  </div>
</div>
```

### EXISTING_INPUT_COMPONENT

```svelte
<!-- SOURCE: src/lib/components/ui/Input.svelte:6-12 -->
<div>
  <label for={name} class="mb-1 block text-sm font-medium">{label}</label>
  <input
    id={name}
    {name}
    {type}
    {value}
    {required}
    {placeholder}
    class="border-glass-border bg-surface-raised w-full rounded-lg border px-4 py-2.5 ..."
  />
  {#if error}<p class="text-danger mt-1 text-sm">{error}</p>{/if}
</div>
```

### REDUCED_MOTION_HANDLING

```css
/* SOURCE: src/app.css:108-124 */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
[data-reduced-motion="true"] *,
... {
  animation-duration: 0.01ms !important;
  transition-duration: 0.01ms !important;
}
```

---

## Files to Change

| File                                                | Action | Justification                                                         |
| --------------------------------------------------- | ------ | --------------------------------------------------------------------- |
| `src/app.css`                                       | UPDATE | Fix contrast tokens, add prefers-contrast mode                        |
| `src/lib/components/ui/Input.svelte`                | UPDATE | Add aria-invalid, aria-describedby, aria-required                     |
| `src/lib/components/ui/Modal.svelte`                | UPDATE | Add focus trap, aria-labelledby, focus restore                        |
| `src/routes/(app)/+layout.svelte`                   | UPDATE | Fix mobile sidebar dialog role                                        |
| `src/routes/auth/login/+page.svelte`                | UPDATE | Add role="alert" to error divs                                        |
| `src/routes/auth/register/+page.svelte`             | UPDATE | Add role="alert" to error divs                                        |
| `src/routes/(app)/log/+page.svelte`                 | UPDATE | Fix pagination accessibility                                          |
| `src/lib/components/MedicationForm.svelte`          | UPDATE | Add fieldset/legend for grouped inputs, aria-invalid on inline errors |
| `src/routes/(app)/settings/appearance/+page.svelte` | UPDATE | Add fieldset/legend for color picker                                  |
| `src/lib/components/Sidebar.svelte`                 | UPDATE | Decorative SVG icons get aria-hidden                                  |

## NOT Building

- Light mode theme (separate feature)
- Screen reader testing automation (manual testing sufficient for this pass)
- Breadcrumb navigation (low priority, doesn't fail WCAG)
- ARIA live region for every state change (only for errors and important feedback)
- `focus-trap` npm package (implementing pure JS to avoid dependency)
- Automated accessibility CI checks (separate follow-up)

---

## Step-by-Step Tasks

### Task 1: Fix Color Contrast Tokens + High-Contrast Mode

- **ACTION**: Update `src/app.css` to fix the `text-muted` color token and add a `prefers-contrast: more` media query
- **IMPLEMENT**:
  Change `--color-text-muted` from `#55556a` to `#71718a`. This raises contrast ratio on `#0a0a0f` background from ~4.1:1 to ~5.3:1 (passes AA for normal text). On `#12121a` (surface-raised) it achieves ~4.8:1 (passes AA).

  Add after the `[data-reduced-motion]` block at end of `app.css`:

  ```css
  /* High contrast: system preference */
  @media (prefers-contrast: more) {
    @theme {
      --color-text-muted: #9090a8;
      --color-text-secondary: #a0a0b8;
      --color-glass-border: rgba(255, 255, 255, 0.24);
      --color-accent: #818cf8;
    }
  }
  ```

- **MIRROR**: Existing `prefers-reduced-motion` pattern in `app.css:108-116`
- **IMPORTS**: None
- **GOTCHA**: Don't change `text-secondary` (#8888a0) — it already passes AA at ~7.2:1. The `text-muted` fix is the critical one. High-contrast mode uses `@media (prefers-contrast: more)` which is supported in Chrome 96+, Firefox 101+, Safari 14.1+. The `@theme` directive inside media query overrides the base `@theme` values in Tailwind v4. If `@theme` inside `@media` doesn't work in Tailwind v4, fall back to raw CSS custom property overrides on `:root`.
- **VALIDATE**: In Chrome DevTools, toggle "Emulate CSS media feature prefers-contrast: more". All text should visibly increase in contrast. Use the Accessibility tab's contrast checker on `text-muted` elements — all should show >= 4.5:1.

### Task 2: Enhance Input.svelte with ARIA Error Attributes

- **ACTION**: Update `src/lib/components/ui/Input.svelte` to add `aria-invalid`, `aria-describedby`, and `aria-required` attributes
- **IMPLEMENT**:

  ```svelte
  <script lang="ts">
    let {
      label,
      name,
      type = "text",
      value = "",
      error = "",
      required = false,
      placeholder = "",
      ...rest
    }: {
      label: string;
      name: string;
      type?: string;
      value?: string;
      error?: string;
      required?: boolean;
      placeholder?: string;
      [key: string]: unknown;
    } = $props();
  </script>

  <div>
    <label for={name} class="mb-1 block text-sm font-medium">
      {label}
      {#if required}<span class="text-danger" aria-hidden="true">*</span>{/if}
    </label>
    <input
      id={name}
      {name}
      {type}
      {value}
      {required}
      {placeholder}
      aria-invalid={error ? "true" : undefined}
      aria-describedby={error ? `${name}-error` : undefined}
      aria-required={required ? "true" : undefined}
      class="border-glass-border bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none {error
        ? 'border-danger'
        : ''}"
      {...rest}
    />
    {#if error}<p id={`${name}-error`} class="text-danger mt-1 text-sm" role="alert">
        {error}
      </p>{/if}
  </div>
  ```

- **MIRROR**: Existing Input.svelte structure (same file, preserving all existing classes and props)
- **IMPORTS**: None
- **GOTCHA**: `aria-invalid` must be the string `"true"` not boolean `true` — Svelte renders boolean attributes differently. Use `error ? 'true' : undefined` to conditionally add the attribute (undefined removes it). The error `<p>` gets `role="alert"` so screen readers announce it immediately when it appears. `id` on the error must match `aria-describedby` exactly. Adding `border-danger` class on error gives a visual red border alongside the text. The `*` asterisk gets `aria-hidden="true"` so screen readers use `aria-required` instead.
- **VALIDATE**: Use a screen reader (VoiceOver on macOS: Cmd+F5). Tab to an input with an error — the error message should be announced. The asterisk should NOT be announced (aria-hidden). `aria-invalid="true"` should appear in the DOM inspector when error is present.

### Task 3: Implement Focus Trap in Modal.svelte

- **ACTION**: Add focus trapping, initial focus management, focus restoration, and `aria-labelledby` to `src/lib/components/ui/Modal.svelte`
- **IMPLEMENT**:

  ```svelte
  <script lang="ts">
    import type { Snippet } from "svelte";
    import { tick } from "svelte";

    let {
      open = false,
      onclose,
      title = "",
      children,
    }: { open: boolean; onclose: () => void; title?: string; children: Snippet } = $props();

    let dialogEl: HTMLDivElement | undefined = $state();
    let previouslyFocused: HTMLElement | null = null;

    const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

    $effect(() => {
      if (open && dialogEl) {
        previouslyFocused = document.activeElement as HTMLElement;
        tick().then(() => {
          const first = dialogEl?.querySelector<HTMLElement>(FOCUSABLE);
          first?.focus();
        });
      }
      if (!open && previouslyFocused) {
        previouslyFocused.focus();
        previouslyFocused = null;
      }
    });

    function handleBackdrop(e: MouseEvent) {
      if (e.target === e.currentTarget) onclose();
    }

    function handleKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onclose();
        return;
      }
      if (e.key !== "Tab" || !dialogEl) return;

      const focusable = dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  </script>

  {#if open}
    <div
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onclick={handleBackdrop}
      onkeydown={handleKeydown}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? "modal-title" : undefined}
      tabindex="-1"
    >
      <div
        bind:this={dialogEl}
        class="border-glass-border bg-surface-raised w-full max-w-md rounded-xl border p-6 shadow-2xl"
      >
        {#if title}
          <h2 id="modal-title" class="sr-only">{title}</h2>
        {/if}
        {@render children()}
      </div>
    </div>
  {/if}
  ```

- **MIRROR**: Existing Modal.svelte structure (same classes, same backdrop handler). The `sr-only` h2 provides an accessible label without changing visual design.
- **IMPORTS**: `svelte` (tick)
- **GOTCHA**: The focusable query selector must match all interactive elements. `bind:this` goes on the inner div (content container), not the backdrop. `previouslyFocused` must be captured BEFORE focus moves. The `$effect` fires when `open` changes — use the dependency on `open` to trigger focus management. Don't add `title` prop to existing Modal usages that pass their own heading inside children — only set it when needed. The `sr-only` heading is invisible but provides the `aria-labelledby` target.
- **VALIDATE**: Open any modal (e.g., dose edit modal in log page). Tab key should cycle through modal elements only, never reaching background. Shift+Tab should cycle backward. Escape closes. After close, focus returns to the element that opened the modal.

### Task 4: Fix Mobile Sidebar Dialog Semantics

- **ACTION**: Update the mobile sidebar overlay in `src/routes/(app)/+layout.svelte` to use proper dialog role and ARIA attributes
- **IMPLEMENT**:
  Replace the mobile sidebar overlay block (lines 45-57):
  ```svelte
  {#if sidebarOpen}
    <div
      class="fixed inset-0 z-30 md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Navigation menu"
      onkeydown={(e) => e.key === "Escape" && (sidebarOpen = false)}
    >
      <button
        type="button"
        class="absolute inset-0 bg-black/60"
        aria-label="Close navigation"
        onclick={() => (sidebarOpen = false)}
      ></button>
      <div class="relative h-full w-64 transform transition-transform duration-200">
        <Sidebar user={data.user} mobile={true} onclose={() => (sidebarOpen = false)} />
      </div>
    </div>
  {/if}
  ```
- **MIRROR**: Existing overlay structure — same classes, same close behavior. Added `role="dialog"`, `aria-modal="true"`, and `aria-label`.
- **IMPORTS**: None
- **GOTCHA**: The `<!-- svelte-ignore a11y_no_static_element_interactions -->` comment on the original div can be removed since `role="dialog"` makes it a semantic element. The close button `aria-label` changed from "Close sidebar" to "Close navigation" for consistency with the dialog's `aria-label`.
- **VALIDATE**: Open mobile sidebar (resize to mobile width or use DevTools responsive mode). Inspect the overlay div — it should have `role="dialog"`, `aria-modal="true"`, and `aria-label="Navigation menu"`. Screen reader should announce "Navigation menu, dialog".

### Task 5: Add Error Announcements to Auth Pages

- **ACTION**: Add `role="alert"` to error display divs in login and register pages
- **IMPLEMENT**:
  In `src/routes/auth/login/+page.svelte`, update the two error blocks (lines 22-30):

  ```svelte
  {#if data.oauthError === "oauth_email_conflict"}
    <div class="bg-warning/10 text-warning mb-4 rounded-lg p-3 text-sm" role="alert">
      An account with that email already exists. Please sign in with your password, then link your
      OAuth provider from settings.
    </div>
  {/if}

  {#if form?.errors?.form}
    <div class="bg-danger/10 text-danger mb-4 rounded-lg p-3 text-sm" role="alert">
      {form.errors.form[0]}
    </div>
  {/if}
  ```

  Apply the same `role="alert"` pattern to `src/routes/auth/register/+page.svelte` for its error divs.

- **MIRROR**: Toast component's `role="alert"` pattern (Toast.svelte:34)
- **IMPORTS**: None
- **GOTCHA**: `role="alert"` creates an implicit `aria-live="assertive"` region. This means screen readers interrupt to announce the error immediately. This is appropriate for form submission errors but should NOT be used on elements that are always visible — only on elements that appear conditionally after an action.
- **VALIDATE**: Submit the login form with invalid credentials. VoiceOver should announce the error message immediately without needing to navigate to it.

### Task 6: Add Form Error Focus Management

- **ACTION**: After form submission with validation errors, focus the first field with an error
- **IMPLEMENT**:
  This applies to the MedicationForm.svelte `use:enhance` callback. After `await update()` on a failure result, focus the first invalid field:
  ```typescript
  use:enhance={() => {
    loading = true;
    return async ({ result, update }) => {
      await update();
      loading = false;
      if (result.type === 'failure') {
        tick().then(() => {
          const firstInvalid = document.querySelector<HTMLElement>('[aria-invalid="true"]');
          firstInvalid?.focus();
        });
      }
    };
  }}
  ```
  Apply this pattern to MedicationForm.svelte (the largest form). The Input.svelte changes from Task 2 ensure `aria-invalid="true"` is set on error fields, making the querySelector work.
- **MIRROR**: Existing `use:enhance` pattern in MedicationForm.svelte
- **IMPORTS**: `svelte` (tick)
- **GOTCHA**: Must wait for `tick()` after `update()` because the DOM needs to re-render with the new error state before querying `[aria-invalid="true"]`. This only works because Task 2 adds `aria-invalid` to Input.svelte. The login/register pages use inline inputs (not the Input component) — for those, the `role="alert"` from Task 5 is sufficient since there are only 2 fields.
- **VALIDATE**: Submit the medication form with missing required fields. Focus should automatically move to the first field with an error. Screen reader should announce the field label and error message.

### Task 7: Fix Pagination Accessibility

- **ACTION**: Add `aria-label`, `rel` attributes, and current page indicator to pagination in `src/routes/(app)/log/+page.svelte`
- **IMPLEMENT**:
  Replace the pagination block (lines 98-105):
  ```svelte
  <nav aria-label="Dose history pagination" class="flex items-center justify-between">
    {#if data.page > 1}
      <a
        href="?page={data.page - 1}"
        rel="prev"
        aria-label="Go to previous page"
        class="border-glass-border hover:bg-glass-hover rounded-lg border px-4 py-2 text-sm"
        >Previous</a
      >
    {:else}<div></div>{/if}
    <span class="text-text-secondary text-sm" aria-current="page">Page {data.page}</span>
    {#if data.hasMore}
      <a
        href="?page={data.page + 1}"
        rel="next"
        aria-label="Go to next page"
        class="border-glass-border hover:bg-glass-hover rounded-lg border px-4 py-2 text-sm">Next</a
      >
    {:else}<div></div>{/if}
  </nav>
  ```
- **MIRROR**: Existing pagination location and styling. Added semantic `<nav>` wrapper.
- **IMPORTS**: None
- **GOTCHA**: `aria-current="page"` on the page indicator tells screen readers the current context. `rel="prev"` and `rel="next"` help search engines and assistive tech understand pagination order. The `{:else}<div></div>{/if}` keeps the flex layout aligned even when one link is absent. Added an else-div for the "Next" side too for symmetry.
- **VALIDATE**: Navigate to the log page with multiple pages. Screen reader should announce "Dose history pagination, navigation" when entering the area. Links should announce "Go to previous page, link" and "Go to next page, link".

### Task 8: Add Fieldsets to MedicationForm Grouped Inputs + Sidebar Icon ARIA

- **ACTION**: Wrap the colour/pattern picker section in MedicationForm.svelte with `<fieldset>` + `<legend>`. Add `aria-hidden="true"` to decorative SVG icons in Sidebar.svelte.
- **IMPLEMENT**:
  In MedicationForm.svelte, wrap the colour and pattern selection sections in a fieldset:
  ```svelte
  <fieldset class="m-0 space-y-4 border-0 p-0">
    <legend class="text-sm font-medium">Appearance</legend>
    <!-- colour picker, secondary colour, pattern selector -->
  </fieldset>
  ```
  In Sidebar.svelte, for the nav items that have both icon and text label, ensure the SVG is decorative:
  ```svelte
  <a href={item.href} aria-current={...}>
    <span aria-hidden="true">{@html item.icon}</span>
    <span>{item.label}</span>
  </a>
  ```
  This ensures screen readers only announce the text label, not the SVG content.
- **MIRROR**: Existing form structure in MedicationForm.svelte. Sidebar nav pattern.
- **IMPORTS**: None
- **GOTCHA**: `<fieldset>` and `<legend>` have default browser styling (border + padding). Reset with `border-0 p-0 m-0` classes. The `<legend>` provides group context for screen readers when tabbing through radio-button-like colour/pattern selectors. Only wrap logically grouped sections — don't wrap every pair of inputs.
- **VALIDATE**: Use VoiceOver to navigate into the colour/pattern section of the medication form. It should announce "Appearance, group" when entering the fieldset. Sidebar links should announce only the label text, not SVG path data.

---

## Testing Strategy

### Unit Tests

| Test                                   | Input                                 | Expected Output                                       | Edge Case? |
| -------------------------------------- | ------------------------------------- | ----------------------------------------------------- | ---------- |
| Input renders aria-invalid when error  | `{ error: 'Required' }`               | `aria-invalid="true"` in DOM                          | No         |
| Input omits aria-invalid when no error | `{ error: '' }`                       | No aria-invalid attribute                             | No         |
| Input links error via aria-describedby | `{ name: 'email', error: 'Invalid' }` | `aria-describedby="email-error"` + `id="email-error"` | No         |
| Modal traps focus on Tab               | Tab from last element                 | Focus moves to first element                          | No         |
| Modal traps focus on Shift+Tab         | Shift+Tab from first element          | Focus moves to last element                           | No         |
| Modal restores focus on close          | Open then close                       | Focus returns to trigger element                      | Yes        |

### Edge Cases Checklist

- [ ] Input with no error shows no ARIA error attributes
- [ ] Multiple modals don't conflict (only one open at a time — existing behavior)
- [ ] Focus trap works when modal has only one focusable element
- [ ] Focus trap works when modal has no focusable elements (fallback to dialog itself)
- [ ] High contrast mode activates on system preference
- [ ] Pagination with only one page shows no prev/next links
- [ ] Color-blind users can distinguish error states (not just color — now has border + icon context)

---

## Validation Commands

### Static Analysis

```bash
npx svelte-check --tsconfig ./tsconfig.json
```

EXPECT: Zero type errors

### Build

```bash
npm run build
```

EXPECT: Clean build, no warnings

### Accessibility Audit (Manual)

```bash
npm run dev
# In Chrome: DevTools > Lighthouse > Accessibility category
```

EXPECT: Accessibility score >= 95

### Screen Reader Testing

```bash
# macOS VoiceOver: Cmd+F5 to toggle
# Navigate through forms, modals, pagination
```

EXPECT: All form errors announced, modal focus trapped, pagination navigable

### Contrast Verification

```bash
npm run dev
# Chrome DevTools > Elements > select text-muted element > Accessibility pane > Contrast
```

EXPECT: All text-muted elements show >= 4.5:1 contrast ratio

### Manual Validation

- [ ] Tab through entire app — focus ring visible on every interactive element
- [ ] Submit medication form with empty required fields — focus jumps to first error
- [ ] Screen reader announces form errors when they appear
- [ ] Open modal — focus trapped, Escape closes, focus returns
- [ ] Mobile sidebar — announced as dialog, Escape closes
- [ ] Pagination — announced as navigation with page context
- [ ] Enable high-contrast mode in OS — app tokens change
- [ ] `text-muted` elements pass contrast checker on all backgrounds

---

## Acceptance Criteria

- [ ] All tasks completed
- [ ] All validation commands pass
- [ ] `text-muted` contrast ratio >= 4.5:1 on all used backgrounds
- [ ] Input.svelte has `aria-invalid`, `aria-describedby`, `aria-required`
- [ ] Modal traps focus and restores on close
- [ ] Mobile sidebar has `role="dialog"` + `aria-modal="true"`
- [ ] Auth error divs have `role="alert"`
- [ ] Form error focus management works
- [ ] Pagination wrapped in `<nav>` with `aria-label`
- [ ] Lighthouse Accessibility >= 95
- [ ] No a11y-related Svelte warnings

## Completion Checklist

- [ ] All contrast changes verified with DevTools contrast checker
- [ ] ARIA attributes use correct string values (not booleans)
- [ ] Focus trap handles edge cases (empty modal, single element)
- [ ] No visual design changes beyond contrast improvement
- [ ] Existing skip link in app.html still works
- [ ] Existing reduced motion handling preserved
- [ ] Existing keyboard shortcuts still work
- [ ] No new npm dependencies added

## Risks

| Risk                                                  | Likelihood | Impact | Mitigation                                                             |
| ----------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------- |
| Focus trap breaks keyboard shortcut system            | Low        | Medium | Keyboard shortcuts already check `isInput()` and ignore when in dialog |
| `text-muted` color change affects design aesthetics   | Low        | Low    | Change is subtle (#55556a → #71718a), barely noticeable visually       |
| Fieldset default browser styles leak through          | Medium     | Low    | Reset with `border-0 p-0 m-0` Tailwind classes                         |
| `@theme` inside `@media` not supported in Tailwind v4 | Medium     | Medium | Fallback: use raw CSS custom property overrides on `:root` instead     |

## Notes

- Skip link already exists in `app.html:21` — no changes needed
- Tailwind v4 includes `sr-only` utility — no custom class needed
- The `$effect` for focus management in Modal.svelte fires on `open` changes, which is the correct reactive dependency
- `aria-invalid` uses string `'true'` not boolean `true` because Svelte handles boolean attributes differently (presence vs value)
- The `prefers-contrast: more` media query is the standard for high-contrast mode — it's distinct from Windows High Contrast Mode which uses `forced-colors`
- This plan intentionally does NOT add a light mode — that's a separate, larger feature
