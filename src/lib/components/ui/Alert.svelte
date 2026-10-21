<script lang="ts">
  import type { Snippet } from "svelte";
  import { toneClass, type Tone } from "$lib/utils/status-tone";

  let {
    tone,
    title,
    id,
    live,
    tabindex,
    class: className = "",
    children,
    action,
  }: {
    tone: Tone;
    /** The headline. A one-sentence message is a title and nothing else. */
    title: string;
    /** Rendered as the FIRST attribute: tests match `<div id="form-error" … role="alert">`. */
    id?: string;
    /** Errors interrupt; every other tone is polite. */
    live?: "assertive" | "off";
    /** -1 only: focusable by script (MedicationForm focuses its crash error), never by Tab. */
    tabindex?: -1;
    /** The call site owns outer margin; Alert has none. */
    class?: string;
    /** Optional body, in secondary text. */
    children?: Snippet;
    /** Optional action, e.g. the Resend form. */
    action?: Snippet;
  } = $props();

  // Assertive is role="alert". needs-you is never an alert: MedicationForm's
  // focus fallback looks for [role="alert"], and a warning must not catch it.
  // happened and needs-you are announced by the caller's persistent
  // role="status" wrapper, which exists before its content changes. A wrong
  // Alert must never sit inside that wrapper: it announces itself, and nested
  // in a polite region it is read twice.
  const role = $derived(
    (live ?? (tone === "wrong" ? "assertive" : "off")) === "assertive"
      ? "alert"
      : tone === "neutral"
        ? "note"
        : undefined,
  );
</script>

<!-- tabindex is typed -1: focusable by script, never a Tab stop. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  {id}
  class={[
    "flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-sm",
    toneClass(tone, "alert"),
    className,
  ]}
  {role}
  {tabindex}
>
  <svg
    class={["mt-px shrink-0", toneClass(tone, "text")]}
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {#if tone === "happened"}
      <path d="M20 6 9 17l-5-5" />
    {:else if tone === "wrong"}
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16.5v.01" />
    {:else if tone === "needs-you"}
      <path d="M12 3 2.5 20h19L12 3Z" />
      <path d="M12 10v4M12 17v.01" />
    {:else}
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8v.01" />
    {/if}
  </svg>
  <div class="min-w-0 flex-1">
    <p
      class={["font-semibold", tone === "neutral" ? "text-text-primary" : toneClass(tone, "text")]}
    >
      {title}
    </p>
    {#if children}
      <div class="text-text-secondary mt-0.5 text-[13px]">{@render children()}</div>
    {/if}
    {#if action}
      <div class="mt-2">{@render action()}</div>
    {/if}
  </div>
</div>
