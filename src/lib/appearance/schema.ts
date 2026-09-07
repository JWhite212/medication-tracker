/**
 * The zod arities for the appearance options. SERVER-ONLY: this module
 * imports zod, and no `.svelte` file may reach it.
 *
 * The bound belongs to the ARITY, not to the option (spec decision 7), so
 * the three doors get three shapes and never share one object schema.
 *
 * Two facts, both measured, that decide the shapes below:
 *
 *  - Making the form door all-optional does not merely turn a mistyped
 *    field name into a silent no-op. `checkboxField`'s transform still
 *    fires, so `{ acentColor: "..." }` parses as
 *    `{ reducedMotion: false }` -- a typo that WRITES over the user's
 *    setting and audits it as a real change.
 *  - A plain `z.object` strips unknown keys, so today's required schema
 *    already fails to notice a typo alongside a full valid payload.
 *    `z.strictObject` is what actually closes that, and it exists in
 *    zod 4.3.6.
 */
import { z } from "zod";
import {
  APPEARANCE_KEYS,
  entryFor,
  type AppearanceEntries,
  type AppearanceKey,
  type SelectOption,
} from "$lib/appearance/registry";

/** Map a readonly tuple of `{ value, label }` to a tuple of its literal values. */
type OptionValues<E> = E extends { options: infer O extends readonly SelectOption[] }
  ? { -readonly [I in keyof O]: O[I] extends SelectOption<infer V> ? V : never }
  : never;

/**
 * The registry's option values as a tuple `z.enum` can consume, with the
 * literals preserved. The single `as never` is the only cast here:
 * `.map()` widens to `string[]` at the type level while producing exactly
 * the right tuple at runtime.
 *
 * The `satisfies` clauses below only catch drift in ONE direction: a call
 * site that accepts a value the registry disallows (e.g. hand-writing
 * `z.enum(["12h", "24h", "36h"])`) is a compile error, because the
 * resulting `_output` widens past `Pick<AppearanceValues, K>` /
 * `AppearanceValues[K] | undefined`. An arity that OMITS one of the
 * registry's option values (e.g. `z.enum(["12h"])`) does not -- a narrower
 * enum still satisfies the wider `ZodType`, so that direction compiles
 * clean. Every arity here is safe only because it calls `optionValues(key)`
 * rather than hand-typing a literal list; that is code discipline, not a
 * type guarantee. The missing-option-value direction is covered instead by
 * the runtime test in `tests/unit/appearance-schema.test.ts` that parses
 * every value in `entry.options` against each arity and derives its
 * expectations from `APPEARANCE_ENTRIES`, not by this function's types.
 * (A missing KEY -- an entire entry dropped from an arity's object -- is a
 * separate, compiler-enforced case: TS1360.)
 */
function optionValues<K extends AppearanceKey>(
  key: K,
): OptionValues<Extract<AppearanceEntries[number], { key: K }>> {
  const entry = entryFor(key);
  if (!("options" in entry)) throw new Error(`${key} is not a select`);
  return entry.options.map((o) => o.value) as never;
}

/**
 * The stored value type of every appearance option, derived from the
 * registry. Narrower than `Pick<UserPreferences, AppearanceKey>`, whose
 * enum columns are all plain `string`.
 */
export type AppearanceValues = {
  [K in AppearanceKey]: Extract<AppearanceEntries[number], { key: K }> extends infer E
    ? E extends { control: "select" }
      ? OptionValues<E>[number]
      : E extends { control: "checkbox" }
        ? boolean
        : // swatch: any #RRGGBB, not just the presets -- the guard is advisory
          string
    : never;
};

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex colour");

/**
 * ARITY 1 — the appearance form. One schema per named action, each with
 * exactly one REQUIRED registry entry and `strictObject` so a mistyped
 * field name is a 400 rather than a silent no-op.
 *
 * `reducedMotion` is a required `"on" | "off"` rather than the shared
 * `checkboxField`: an unchecked box posts nothing, and under
 * one-field-per-action an absent field is indistinguishable from a typo.
 * The page emits a hidden `value="off"` immediately before the checkbox
 * so the key is always present -- `Object.fromEntries` keeps the last
 * duplicate, so "on" wins whenever the box is checked. The same
 * hidden-pair pattern is already used and commented at
 * `MedicationNotificationFields.svelte:44-59`.
 */
export const appearanceFieldSchemas = {
  accentColor: z.strictObject({ accentColor: hexColour }),
  dateFormat: z.strictObject({ dateFormat: z.enum(optionValues("dateFormat")) }),
  timeFormat: z.strictObject({ timeFormat: z.enum(optionValues("timeFormat")) }),
  uiDensity: z.strictObject({ uiDensity: z.enum(optionValues("uiDensity")) }),
  reducedMotion: z.strictObject({
    reducedMotion: z.enum(["on", "off"]).transform((v) => v === "on"),
  }),
} satisfies { [K in AppearanceKey]: z.ZodType<Pick<AppearanceValues, K>> };

/** ARITY 2 — /api/v1 `update_preferences`: all optional, JSON-native types. */
export const appearancePayloadShape = {
  accentColor: hexColour.optional(),
  dateFormat: z.enum(optionValues("dateFormat")).optional(),
  timeFormat: z.enum(optionValues("timeFormat")).optional(),
  uiDensity: z.enum(optionValues("uiDensity")).optional(),
  reducedMotion: z.boolean().optional(),
} satisfies { [K in AppearanceKey]: z.ZodType<AppearanceValues[K] | undefined> };

/**
 * ARITY 3 — backup import: all optional, bounded. Identical to arity 2
 * for these five today, because no appearance option carries a numeric
 * bound. It stays a separate object anyway: the doors are allowed to
 * diverge, and `heatmapPeriod` proved they already had.
 */
export const appearanceImportShape = {
  accentColor: hexColour.optional(),
  dateFormat: z.enum(optionValues("dateFormat")).optional(),
  timeFormat: z.enum(optionValues("timeFormat")).optional(),
  uiDensity: z.enum(optionValues("uiDensity")).optional(),
  reducedMotion: z.boolean().optional(),
} satisfies { [K in AppearanceKey]: z.ZodType<AppearanceValues[K] | undefined> };

/**
 * The named actions the appearance page must define. Re-exported from the
 * registry rather than `Object.keys(appearanceFieldSchemas)`: that would
 * need a second `as` cast (`Object.keys` widens to `string[]`), in a module
 * whose stated rule is that `optionValues`'s `as never` is the only one.
 * The `satisfies` clause on `appearanceFieldSchemas` above already proves
 * the two key sets are identical -- a key dropped from that object is
 * TS1360 -- so this is not a second source of truth, just a re-export.
 */
export const APPEARANCE_ACTION_KEYS = APPEARANCE_KEYS;
