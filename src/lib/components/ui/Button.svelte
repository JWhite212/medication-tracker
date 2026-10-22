<script lang="ts" module>
  /** The focus ring every button primitive draws: 2px accent-ink, offset 2px. */
  export const FOCUS_RING =
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink";
  /** A real `disabled` and an `aria-disabled` look the same: about half opacity. */
  export const DISABLED_LOOK =
    "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";

  type Props = {
    variant?: "primary" | "secondary" | "ghost" | "danger";
    size?: "md" | "sm";
    href?: string;
    type?: "button" | "submit" | "reset";
    block?: boolean;
    pending?: boolean;
    pendingLabel?: string;
    disabled?: boolean;
    ariaDisabled?: boolean;
    /** rounded-lg, or rounded-full for a pill. */
    shape?: "rect" | "pill";
    /**
     * The rendered <button> or <a>, for a caller that hands focus to it. A
     * bound variable may start undefined or null: `$bindable()` carries no
     * fallback, because a fallback makes Svelte throw props_invalid_value for
     * `bind:ref={x}` while x is undefined.
     */
    ref?: HTMLButtonElement | HTMLAnchorElement | null | undefined;
    /**
     * Layout only: margins, flex-1, self-*, shrink-0, w-*, border-dashed.
     * Appended after the recipe. Which of two clashing utilities wins is
     * Tailwind v4's utility order, not the class order: a caller's `h-12`
     * beats the recipe's `h-11`, while its `rounded-full` loses to `rounded-lg`.
     * So never restyle the variant, size or shape through `class`; use
     * `variant`, `size` and `shape`.
     */
    class?: string;
    children: Snippet;
    // `ariaDisabled` and `pending` own aria-disabled and aria-busy, which the
    // template writes after the rest props; a raw one would be overwritten.
  } & Omit<
    HTMLButtonAttributes & HTMLAnchorAttributes,
    "type" | "href" | "class" | "disabled" | "children" | "aria-disabled" | "aria-busy"
  >;

  let {
    variant = "secondary",
    size = "md",
    href,
    type = "button",
    block = false,
    pending,
    pendingLabel = "Saving…",
    disabled = false,
    ariaDisabled = false,
    shape = "rect",
    ref = $bindable(),
    class: className = "",
    children,
    ...rest
  }: Props = $props();

  // Fixed heights, never padding: data-density="compact" rewrites .py-2.5
  // (app.css), which is how "Save Changes" fell to 32px beside a 36px button.
  const SIZES = { md: "h-11 px-4", sm: "h-9 px-3" } as const;
  const SHAPES = { rect: "rounded-lg", pill: "rounded-full" } as const;
  const VARIANTS = {
    primary: "bg-accent text-accent-fg hover:opacity-90",
    secondary: "border border-border-strong text-text-primary hover:bg-surface-overlay",
    ghost: "text-text-secondary hover:bg-surface-overlay hover:text-text-primary",
    danger: "bg-danger text-danger-fg hover:brightness-110",
  } as const;

  const classes = $derived([
    "inline-flex items-center justify-center gap-2 text-sm font-medium whitespace-nowrap transition-colors",
    FOCUS_RING,
    DISABLED_LOOK,
    SIZES[size],
    SHAPES[shape],
    VARIANTS[variant],
    block && "w-full",
    className,
  ]);
  const CELL = "col-start-1 row-start-1 inline-flex items-center justify-center gap-2";
</script>

<!-- Without `pending` the children sit directly in the element, with no
     wrapper. With it, the label and the pending label share one grid cell,
     so a pressed button keeps its width (DoseActionForm's technique). The
     branch is INSIDE the element: a caller that starts with pending
     undefined and later sets it keeps the same focused element. -->
{#snippet content()}
  {#if pending === undefined}
    {@render children()}
  {:else}
    <span class="inline-grid">
      <span
        data-part="label"
        class={[CELL, pending && "invisible"]}
        aria-hidden={pending ? "true" : undefined}>{@render children()}</span
      >
      <span
        data-part="pending"
        class={[CELL, !pending && "invisible"]}
        aria-hidden={pending ? undefined : "true"}
        ><span
          class="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        ></span>{pendingLabel}</span
      >
    </span>
  {/if}
{/snippet}

<!-- eslint-disable svelte/no-navigation-without-resolve -- a primitive renders the href its
     caller passes; resolve() belongs at the call site, which knows the route. -->
{#if href !== undefined}
  <a
    bind:this={ref}
    {...rest}
    {href}
    class={classes}
    aria-disabled={ariaDisabled ? "true" : undefined}
    aria-busy={pending ? "true" : undefined}>{@render content()}</a
  >
{:else}
  <button
    bind:this={ref}
    {...rest}
    {type}
    {disabled}
    class={classes}
    aria-disabled={ariaDisabled ? "true" : undefined}
    aria-busy={pending ? "true" : undefined}>{@render content()}</button
  >
{/if}
