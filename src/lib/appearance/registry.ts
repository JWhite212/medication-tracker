/**
 * Appearance option metadata — the one description of every option the
 * Appearance page renders.
 *
 * NO ZOD, and no *value* import from `$lib/server/*`. The page imports
 * this module to render its controls, and no `.svelte` file anywhere
 * reaches zod today (tests/unit/appearance-bundle-boundary.test.ts holds
 * that line) — so putting the validators here would pull zod into the
 * client bundle for the first time. The zod arities live in `./schema.ts`,
 * which imports this file and is imported only from server code.
 *
 * `import type` from `$lib/server` is fine and already has three
 * precedents in-tree: MedicationForm.svelte, utils/schedule.ts and
 * medications/medication-form-state.ts all type-import
 * $lib/server/schedules.ts, and the erasure is visible in the build output.
 *
 * There is deliberately NO `default` field. The value a real user gets is
 * the column default in `src/lib/server/db/schema.ts`; `@theme` is only
 * the logged-out fallback, because `(app)/+layout.svelte` writes the
 * accent as an inline style and inline beats every stylesheet rule.
 * Restating a default here would be a fourth hand-written restatement of
 * exactly the kind this PR deletes.
 */
import type { UserPreferences } from "$lib/types";

/** Every mutable column of `user_preferences`. */
export type PreferenceKey = keyof Omit<UserPreferences, "userId" | "updatedAt">;

export type AppearanceGroup = "colour" | "formatting" | "layout" | "motion";

/**
 * How the stored value reaches the DOM.
 *
 * The data-attribute bindings are set on the `(app)` wrapper div
 * (`(app)/+layout.svelte:34-35`) and STAY there. 1c planned to move them
 * onto the theme `<style>` block and could not: `Heatmap.svelte:123`
 * compiles to `[data-reduced-motion="true"] .heatmap-cell.svelte-<hash>`,
 * and the hash is content-derived, so no externally-emitted stylesheet can
 * target it. The invariant that replaces the move: the theme block emits
 * only colour tokens and `color-scheme`, while these rules set only spacing
 * and animation timing — disjoint, so the wrapper being a descendant of
 * `:root` does not matter.
 *
 * `css-var` records only the property the *stored* value drives.
 * `derived` names the two tokens `readableForeground` / `readableInk`
 * compute from it (`$lib/utils/contrast.ts`) — the derivation stays code,
 * the registry only names its outputs so a reader can find them.
 */
export type DomBinding =
  | {
      readonly kind: "css-var";
      readonly property: `--${string}`;
      readonly derived: readonly `--${string}`[];
    }
  | { readonly kind: "data-attribute"; readonly attribute: `data-${string}` }
  | { readonly kind: "none" };

export type SelectOption<V extends string = string> = {
  readonly value: V;
  readonly label: string;
};

type Base = {
  readonly key: PreferenceKey;
  readonly group: AppearanceGroup;
  readonly label: string;
  /** Rendered as the control's `<Tooltip text={...} />`. */
  readonly description?: string;
  readonly dom: DomBinding;
};

export type AppearanceEntry =
  | (Base & {
      readonly control: "swatch";
      /**
       * Suggested values, NOT the value domain: all three doors accept
       * any `#RRGGBB` and that stays true (spec decision 4). Turning
       * these into a zod enum would reject every stored custom accent and
       * break the /api/v1 door.
       *
       * tests/unit/theme-tokens.test.ts asserts this list against the
       * real @theme values — every preset must pair with a legible
       * foreground, because the layout derives --color-accent-fg from
       * whichever one the user picks.
       */
      readonly presets: readonly string[];
      /** `{value}` is substituted with the hex to build each swatch's label. */
      readonly optionLabelTemplate: string;
    })
  | (Base & { readonly control: "select"; readonly options: readonly SelectOption[] })
  | (Base & { readonly control: "checkbox" });

export const APPEARANCE_ENTRIES = [
  {
    key: "accentColor",
    group: "colour",
    label: "Accent Colour",
    control: "swatch",
    presets: [
      "#4f46e5",
      "#7c3aed",
      "#ec4899",
      "#ef4444",
      "#f59e0b",
      "#10b981",
      "#06b6d4",
      "#3b82f6",
      "#f97316",
      "#64748b",
    ],
    optionLabelTemplate: "Select colour {value}",
    dom: {
      kind: "css-var",
      property: "--color-accent",
      derived: ["--color-accent-fg", "--color-accent-ink"],
    },
  },
  {
    key: "theme",
    group: "colour",
    label: "Theme",
    description:
      "System follows your device's light or dark setting. Auth pages and the landing page always follow your device.",
    control: "select",
    options: [
      { value: "dark", label: "Dark" },
      { value: "light", label: "Light" },
      { value: "system", label: "System" },
    ],
    dom: { kind: "none" },
  },
  {
    key: "dateFormat",
    group: "formatting",
    label: "Date Format",
    control: "select",
    options: [
      { value: "DD/MM/YYYY", label: "DD/MM/YYYY" },
      { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
      { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
    ],
    dom: { kind: "none" },
  },
  {
    key: "timeFormat",
    group: "formatting",
    label: "Time Format",
    control: "select",
    options: [
      { value: "12h", label: "12-hour (2:30 PM)" },
      { value: "24h", label: "24-hour (14:30)" },
    ],
    dom: { kind: "none" },
  },
  {
    key: "uiDensity",
    group: "layout",
    label: "Display Density",
    description: "Compact mode reduces spacing throughout the app to show more content on screen.",
    control: "select",
    options: [
      { value: "comfortable", label: "Comfortable" },
      { value: "compact", label: "Compact" },
    ],
    dom: { kind: "data-attribute", attribute: "data-density" },
  },
  {
    key: "reducedMotion",
    group: "motion",
    label: "Reduce motion",
    description: "Disables animations and transitions for accessibility or personal preference.",
    control: "checkbox",
    dom: { kind: "data-attribute", attribute: "data-reduced-motion" },
  },
] as const satisfies readonly AppearanceEntry[];

export type AppearanceEntries = typeof APPEARANCE_ENTRIES;

/** "accentColor" | "theme" | "dateFormat" | "timeFormat" | "uiDensity" | "reducedMotion" */
export type AppearanceKey = AppearanceEntries[number]["key"];

export const APPEARANCE_KEYS = APPEARANCE_ENTRIES.map((e) => e.key) as readonly AppearanceKey[];

/** The named form action a control posts to. Derived, never restated. */
export function actionFor(key: AppearanceKey): `?/${AppearanceKey}` {
  return `?/${key}`;
}

export function entryFor<K extends AppearanceKey>(key: K) {
  return APPEARANCE_ENTRIES.find((e) => e.key === key) as Extract<
    AppearanceEntries[number],
    { key: K }
  >;
}
