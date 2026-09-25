<script lang="ts">
  import { tick, type Snippet } from "svelte";
  import type { ActionResult, SubmitFunction } from "@sveltejs/kit";
  import { deserialize, enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import { showToast } from "$components/ui/Toast.svelte";
  import { actionErrorMessage } from "$lib/utils/form-errors";
  import { getDashboardClock } from "./dashboard-clock";
  import { getDoseWriteLock } from "./dose-write-lock.svelte";
  import {
    STALE_TAP_MESSAGE,
    SUCCESS_FALLBACK_TOAST,
    UNDO_ACTION,
    UNDONE_TOAST,
  } from "./dose-action";

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
    undoable = false,
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
    /** Called AFTER the reload with the returned doseId; builds the toast from the reloaded data. */
    buildToast?: (doseId: string | null) => string | null;
    /** Attach an Undo to the success toast (needs a doseId in the result). */
    undoable?: boolean;
    /** Where focus goes after success. Never another write button. */
    focusAfter?: () => HTMLElement | null;
    onSuccess?: () => void;
    /** Rendered inside the button BEFORE the label (a chip's sr-only "Log " and its glyph). */
    children?: Snippet;
    /** Classes for the <form> (layout inside the parent); the button's look is the variant's. */
    class?: string;
  } = $props();

  const lock = getDoseWriteLock();
  const clock = getDashboardClock();

  let pending = $state(false);

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

  /** invalidateAll, but a failed reload leaves the page as it was instead of throwing out of the callback. */
  async function reload(): Promise<void> {
    try {
      await invalidateAll();
    } catch {
      // The data stays as it was; the next tap is re-checked on the server.
    }
  }

  async function undoDose(doseId: string): Promise<void> {
    // Undo is a dose write like any other — it must hold the page-wide lock
    // across its fetch and reload, or a tap during that window (or on the
    // list right after the removed row reappears) lands on whatever slid
    // under the finger. Unlike every other write, Undo must never be
    // refused: `hold()` takes the lock even if the write it is undoing is
    // still cooling down, and `extend()` afterward starts a fresh cooldown
    // so that earlier write's deadline cannot cut this one short.
    lock.hold();
    try {
      const body = new FormData();
      body.set("doseId", doseId);
      try {
        const response = await fetch(UNDO_ACTION, {
          method: "POST",
          body,
          headers: { accept: "application/json" },
        });
        const result = deserialize(await response.text()) as ActionResult;
        if (result.type === "success") showToast(UNDONE_TOAST, "success");
        else showToast(actionErrorMessage(result), "error");
      } catch (error) {
        // A network failure never reaches `deserialize`.
        showToast(actionErrorMessage({ type: "error", error }), "error");
      }
      await reload();
    } finally {
      lock.extend();
    }
  }

  const submit: SubmitFunction = ({ cancel, formElement }) => {
    if (!lock.acquire()) {
      cancel();
      return;
    }
    // Server-relative: comparing with raw Date.now() would refuse every tap
    // near a boundary on a device whose clock runs fast.
    if (clock.serverNow().getTime() >= clock.nextRefreshAt().getTime()) {
      cancel();
      showToast(STALE_TAP_MESSAGE, "error");
      // Hold the lock through the reload, so nothing is tapped on the old list.
      clock.refresh().then(
        () => lock.release(),
        () => lock.release(),
      );
      return;
    }

    // Read every caller-supplied value NOW. The response usually re-renders
    // this row away, and the callback must not read props of a component the
    // reload has unmounted.
    const build = buildToast;
    const withUndo = undoable;
    const focusTarget = focusAfter;
    const afterSuccess = onSuccess;
    const card = formElement.closest<HTMLElement>("[data-dose-card]");
    pending = true;
    card?.setAttribute("aria-busy", "true");

    return async ({ result, update }) => {
      try {
        if (result.type === "success") {
          const doseId = typeof result.data?.doseId === "string" ? result.data.doseId : null;
          try {
            await update();
            await tick();
          } catch {
            // The write succeeded; only the reload failed. The builder falls back.
          }
          const message = build?.(doseId) ?? SUCCESS_FALLBACK_TOAST;
          showToast(
            message,
            "success",
            withUndo && doseId ? () => void undoDose(doseId) : undefined,
          );
          focusTarget?.()?.focus();
          afterSuccess?.();
        } else if (result.type === "failure") {
          showToast(actionErrorMessage(result), "error");
          // update() does not re-run the load for a failure, and a 409 means
          // the button that failed is stale.
          if (result.status === 409) await reload();
          else await update();
        } else if (result.type === "error") {
          // Outcome unknown: reload BEFORE releasing, so any retry acts on fresh data.
          showToast(actionErrorMessage(result), "error");
          await reload();
        } else {
          await update();
        }
      } finally {
        pending = false;
        card?.removeAttribute("aria-busy");
        lock.release();
      }
    };
  };
</script>

<form
  method="POST"
  {action}
  class={className}
  data-quick-log={quickLog ? "" : undefined}
  use:enhance={submit}
>
  {#each Object.entries(fields) as [name, value] (name)}
    <input type="hidden" {name} {value} />
  {/each}
  <!-- aria-disabled, never `disabled`: the disabled attribute drops keyboard
       focus to <body>. A busy tap is cancelled in `submit` instead. The label
       and the pending label share one grid cell, so the pressed button keeps
       its width. -->
  <button
    type="submit"
    aria-disabled={lock.busy ? "true" : undefined}
    class="inline-flex items-center justify-center transition-colors aria-disabled:cursor-not-allowed {VARIANTS[
      variant
    ]}"
  >
    <span class="inline-grid">
      <span
        data-part="label"
        class="col-start-1 row-start-1 inline-flex items-center justify-center gap-2 {pending
          ? 'invisible'
          : ''}"
        aria-hidden={pending ? "true" : undefined}
        >{@render children?.()}<span
          >{label}{#if srContext}<span class="sr-only">{srContext}</span>{/if}</span
        ></span
      >
      <span
        data-part="pending"
        class="col-start-1 row-start-1 inline-flex items-center justify-center gap-2 {pending
          ? ''
          : 'invisible'}"
        aria-hidden={pending ? undefined : "true"}
        ><span
          class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        ></span>{pendingLabel}</span
      >
    </span>
  </button>
</form>
