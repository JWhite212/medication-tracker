/**
 * The look of the app's buttons and toggles, for the landing-page walkthrough.
 *
 * The stage draws pages; it never mounts them, and `Button`, `IconButton` and
 * `Toggle` are focusable components that the stage must not import. So their
 * resting classes are copied here, once, and every scene that draws a button
 * or a toggle takes its classes from this file instead of writing its own.
 *
 * What is copied is the look at rest, and only that. No interactive token
 * (`hover:`, `focus-visible:`, `disabled:`, `aria-disabled:`) is copied,
 * because nothing on the stage is interactive, and no `transition-*` is
 * copied, because nothing on the stage moves by CSS: its motion comes from
 * `Frame` values alone.
 *
 * `tests/unit/walkthrough-demo-facts.test.ts` renders each primitive and
 * fails if a copy here drifts from what the primitive draws at rest. It also
 * holds every control a scene draws to the variant and size its page passes.
 *
 * No imports: the scenes read this module, so it pulls nothing into the stage.
 */

export type StageButtonVariant = "primary" | "secondary" | "ghost";
export type StageControlSize = "md" | "sm";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium whitespace-nowrap";
const BUTTON_SIZES: Record<StageControlSize, string> = { md: "h-11 px-4", sm: "h-9 px-3" };
const BUTTON_VARIANTS: Record<StageButtonVariant, string> = {
  primary: "bg-accent text-accent-fg",
  secondary: "border border-border-strong text-text-primary",
  ghost: "text-text-secondary",
};

/** Button's classes for these props at rest: no variant-prefixed (hover:, focus-visible:, disabled:, aria-disabled:) or transition token. */
export function stageButton(variant: StageButtonVariant, size: StageControlSize = "md"): string {
  return `${BUTTON_BASE} ${BUTTON_SIZES[size]} ${BUTTON_VARIANTS[variant]}`;
}

const TOGGLE_BASE =
  "inline-flex items-center justify-center gap-2 px-3 text-sm font-medium whitespace-nowrap rounded-lg";
const TOGGLE_SIZES: Record<StageControlSize, string> = { sm: "h-9", md: "h-11" };
const TOGGLE_ON = "border border-accent-ink bg-accent/15 text-accent-ink";
const TOGGLE_OFF = "border border-border-strong text-text-secondary";

/** Toggle's classes for these props at rest, by the same rule. */
export function stageToggle(pressed: boolean, size: StageControlSize = "sm"): string {
  return `${TOGGLE_BASE} ${TOGGLE_SIZES[size]} ${pressed ? TOGGLE_ON : TOGGLE_OFF}`;
}
