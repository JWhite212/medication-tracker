<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
  import { DISABLED_LOOK, FOCUS_RING } from "./Button.svelte";

  type Props = {
    /** The accessible name. An icon has no text, so it is required. */
    label: string;
    size?: "md" | "sm";
    variant?: "ghost" | "secondary";
    href?: string;
    type?: "button" | "submit";
    /**
     * The rendered <button> or <a>, for a caller that hands focus to it. A
     * bound variable may start undefined or null: `$bindable()` carries no
     * fallback, because a fallback makes Svelte throw props_invalid_value for
     * `bind:ref={x}` while x is undefined.
     */
    ref?: HTMLButtonElement | HTMLAnchorElement | null | undefined;
    /** Layout only: margins, shrink-0, self-*. Use `variant` and `size` for the look. */
    class?: string;
    /** The icon. The caller marks it aria-hidden; `label` names the control. */
    children: Snippet;
  } & Omit<
    HTMLButtonAttributes & HTMLAnchorAttributes,
    "type" | "href" | "class" | "children" | "aria-label"
  >;

  let {
    label,
    size = "md",
    variant = "ghost",
    href,
    type = "button",
    ref = $bindable(),
    class: className = "",
    children,
    ...rest
  }: Props = $props();

  // Fixed sizes, never padding: data-density="compact" rewrites .py-2.5 (app.css).
  const SIZES = { md: "size-11", sm: "size-9" } as const;
  const VARIANTS = {
    ghost: "text-text-secondary hover:bg-surface-overlay hover:text-text-primary",
    secondary: "border border-border-strong text-text-primary hover:bg-surface-overlay",
  } as const;

  const classes = $derived([
    "inline-flex shrink-0 items-center justify-center rounded-lg transition-colors",
    FOCUS_RING,
    DISABLED_LOOK,
    SIZES[size],
    VARIANTS[variant],
    className,
  ]);
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- a primitive renders the href its
     caller passes; resolve() belongs at the call site, which knows the route. -->
{#if href !== undefined}
  <a bind:this={ref} {...rest} {href} class={classes} aria-label={label}>{@render children()}</a>
{:else}
  <button bind:this={ref} {...rest} {type} class={classes} aria-label={label}
    >{@render children()}</button
  >
{/if}
