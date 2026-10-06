<script lang="ts">
  import type { Snippet } from "svelte";
  import { enhance } from "$app/forms";
  import {
    createDoseWrite,
    type DoseWriteOptions,
  } from "$components/dose-writes/dose-write.svelte";
  import { getDashboardClock } from "./dashboard-clock";

  type Variant = "primary" | "secondary" | "quiet" | "chip" | "danger";

  let {
    action,
    fields,
    label,
    srContext,
    pendingLabel,
    variant,
    quickLog = false,
    buildToast,
    undo,
    withdrawsUndoFor,
    focusAfter,
    onSuccess,
    children,
    class: className = "",
  }: {
    /** The form action, e.g. "?/logDose". */
    action: string;
    /** Posted verbatim as hidden inputs. */
    fields: Record<string, string>;
    /** The visible label — the start of the accessible name (WCAG 2.5.3). */
    label: string;
    /** Screen-reader-only context appended to the label, e.g. ": Metformin 500mg, 11:00 dose". */
    srContext?: string;
    /** Shown with a spinner while pending: "Logging…", "Recording…", "Skipping…", "Removing…". */
    pendingLabel: string;
    variant: Variant;
    /** Marks the form `data-quick-log`: the ONLY forms the 1–9 shortcuts may submit. */
    quickLog?: boolean;
    /** Called AFTER the reload with the returned doseId and the time the response arrived; builds the toast from the reloaded data. */
    buildToast?: DoseWriteOptions["buildToast"];
    /** Offer an Undo on success: "delete" for a create, "restore" for a delete. Needs a doseId in the result. */
    undo?: DoseWriteOptions["undo"];
    /** The dose this write acts on: an Undo offer naming it is withdrawn once the write is sent. */
    withdrawsUndoFor?: string;
    /** Where focus goes after success. Never another write button. */
    focusAfter?: () => HTMLElement | null;
    /** After the reload and the toast, before focus is judged: closing a dialog here is safe (DoseWriteOptions.onSuccess). */
    onSuccess?: () => void;
    /** Rendered inside the button BEFORE the label (a chip's sr-only "Log " and its glyph). */
    children?: Snippet;
    /** Classes for the <form> (layout inside the parent); the button's look is the variant's. */
    class?: string;
  } = $props();

  // The dashboard's markup over createDoseWrite, the one client path for
  // dose writes: the lock, the reload, the toast or Undo offer, focus and
  // every failure are the primitive's. What this adds is the look, and the
  // dashboard clock as the stale guard — only dashboard controls have one.
  const clock = getDashboardClock();
  let formEl: HTMLFormElement | undefined = $state();

  // Read when the form submits, never here: the response usually re-renders
  // this row away, and the callback must not read props of a component the
  // reload has unmounted. createDoseWrite takes the values once, at submit.
  const write = createDoseWrite(() => ({
    staleGuard: clock,
    undo,
    withdrawsUndoFor,
    buildToast,
    focusAfter,
    onSuccess,
    busyContainer: () => formEl?.closest<HTMLElement>("[data-dose-card]") ?? null,
  }));

  // Fixed heights, never padding-derived: data-density="compact" rewrites only
  // .p-5, .p-6 and .py-2.5 (app.css), so none of these can shrink a target.
  const VARIANTS: Record<Variant, string> = {
    primary:
      "h-12 min-w-26 rounded-lg bg-accent px-4 text-base font-semibold text-accent-fg hover:brightness-110",
    secondary:
      "h-11 rounded-lg border border-border-strong px-3 text-sm font-medium text-text-primary hover:bg-surface-overlay",
    quiet:
      "h-11 min-w-11 rounded-lg px-3 text-sm font-medium text-text-secondary hover:bg-surface-overlay",
    chip: "h-11 rounded-full px-3 text-sm font-medium text-text-primary hover:bg-surface-overlay",
    danger: "min-h-11 rounded-lg px-3 text-sm font-medium text-danger-ink hover:bg-surface-overlay",
  };
</script>

<form
  method="POST"
  {action}
  class={className}
  data-quick-log={quickLog ? "" : undefined}
  bind:this={formEl}
  use:enhance={write.submit}
>
  {#each Object.entries(fields) as [name, value] (name)}
    <input type="hidden" {name} {value} />
  {/each}
  <!-- aria-disabled, never `disabled`: the disabled attribute drops keyboard
       focus to <body>. A busy tap is cancelled in the primitive instead. The
       label and the pending label share one grid cell, so the pressed button
       keeps its width. onkeydown: a held Enter fires once. -->
  <button
    type="submit"
    aria-disabled={write.busy ? "true" : undefined}
    onkeydown={write.onkeydown}
    class="inline-flex items-center justify-center transition-colors aria-disabled:cursor-not-allowed {VARIANTS[
      variant
    ]}"
  >
    <span class="inline-grid">
      <span
        data-part="label"
        class="col-start-1 row-start-1 inline-flex items-center justify-center gap-2 {write.pending
          ? 'invisible'
          : ''}"
        aria-hidden={write.pending ? "true" : undefined}
        >{@render children?.()}<span
          >{label}{#if srContext}<span class="sr-only">{srContext}</span>{/if}</span
        ></span
      >
      <span
        data-part="pending"
        class="col-start-1 row-start-1 inline-flex items-center justify-center gap-2 {write.pending
          ? ''
          : 'invisible'}"
        aria-hidden={write.pending ? undefined : "true"}
        ><span
          class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        ></span>{pendingLabel}</span
      >
    </span>
  </button>
</form>
