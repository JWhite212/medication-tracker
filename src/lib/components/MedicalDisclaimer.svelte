<script lang="ts" module>
  // Exported so surfaces that cannot use this component's markup (the
  // landing-page walkthrough draws it at video scale) still share the wording.
  export const DISCLAIMER_TEXT =
    "MedTracker is a personal tracking tool. It does not provide medical advice, dosage recommendations, diagnosis, or emergency guidance. Always follow advice from a qualified healthcare professional.";
</script>

<script lang="ts">
  // Reusable medical disclaimer surface. Single source of truth for the
  // wording so it stays consistent across landing, register, medication
  // form, analytics, and exports.

  let {
    variant = "panel",
  }: {
    /**
     * panel  — bordered card, default. Use on standalone pages.
     * inline — flat, smaller text. Use inside other panels.
     * compact — single-line, muted. Use in dense places like the
     *   register form footer.
     */
    variant?: "panel" | "inline" | "compact";
  } = $props();
</script>

{#if variant === "panel"}
  <div
    class="border-glass-border bg-glass rounded-lg border px-4 py-3 backdrop-blur-xl"
    role="note"
    aria-label="Medical disclaimer"
  >
    <p class="text-text-muted text-xs tracking-wider uppercase">Important</p>
    <p class="text-text-secondary mt-1 text-sm">{DISCLAIMER_TEXT}</p>
  </div>
{:else if variant === "inline"}
  <p class="text-text-muted text-xs" role="note">{DISCLAIMER_TEXT}</p>
{:else}
  <p class="text-text-muted text-[11px] leading-snug" role="note">
    By continuing you acknowledge MedTracker is a personal tracking tool — not medical advice.
  </p>
{/if}
