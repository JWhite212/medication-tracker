<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";
  import { DISABLED_LOOK, FOCUS_RING } from "./Button.svelte";

  type Props = {
    /** Whether the option is on. Rendered as aria-pressed; the caller owns the state. */
    pressed: boolean;
    size?: "md" | "sm";
    /** rounded-lg, or rounded-full for a pill. */
    shape?: "rect" | "pill";
    /** Layout only: margins, flex-1, self-*. Use `size` and `shape` for the look. */
    class?: string;
    /**
     * Opt in to submitting the enclosing form with this field. Without it the
     * toggle is always `type="button"`; with it, `type="submit"` carrying
     * exactly this name and value. The look does not change.
     */
    submit?: { name: string; value: string };
    children: Snippet;
  } & Omit<HTMLButtonAttributes, "type" | "class" | "children" | "aria-pressed">;

  let {
    pressed,
    size = "sm",
    shape = "rect",
    class: className = "",
    submit,
    children,
    ...rest
  }: Props = $props();

  // Fixed heights, never padding: data-density="compact" rewrites .py-2.5 (app.css).
  const SIZES = { md: "h-11", sm: "h-9" } as const;
  const SHAPES = { rect: "rounded-lg", pill: "rounded-full" } as const;

  const classes = $derived([
    "inline-flex items-center justify-center gap-2 px-3 text-sm font-medium whitespace-nowrap transition-colors",
    FOCUS_RING,
    DISABLED_LOOK,
    SIZES[size],
    SHAPES[shape],
    pressed
      ? "border border-accent-ink bg-accent/15 text-accent-ink"
      : "border border-border-strong text-text-secondary hover:bg-surface-overlay",
    className,
  ]);
</script>

<!--
  `type`, `name` and `value` come after the rest props, so only `submit` can
  turn a toggle into a submit, and nothing in a spread can change what it posts.
-->
{#if submit}
  <button
    {...rest}
    type="submit"
    name={submit.name}
    value={submit.value}
    class={classes}
    aria-pressed={pressed ? "true" : "false"}>{@render children()}</button
  >
{:else}
  <button {...rest} type="button" class={classes} aria-pressed={pressed ? "true" : "false"}
    >{@render children()}</button
  >
{/if}
