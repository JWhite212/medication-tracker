/**
 * The value domain of every mutable preference the appearance registry does
 * NOT own, written once, with the two API-door arities derived from it.
 * SERVER-ONLY: this module imports zod, and no `.svelte` file may reach it.
 *
 * Why this exists, and why it is not just a second copy of
 * `$lib/appearance/schema.ts`:
 *
 * These seven keys were hand-restated at both API doors in `validation.ts`.
 * `heatmapPeriod` proved what that costs — it was `z.number().int()` at the
 * `/api/v1` door and `z.number().int().min(1).max(3650)` on import, and the
 * unbounded value reached the activity heatmap's per-day render loop. The
 * six appearance options never drifted that way because they are derived
 * from one registry shape.
 *
 * The appearance module's `satisfies` clause would NOT have caught it.
 * `z.ZodType<number | undefined>` is satisfied by `z.number().int()` and by
 * `z.number().int().min(1).max(3650)` alike: a `satisfies` clause pins the
 * KEY SET and the OUTPUT TYPE, never a bound. The appearance six are safe
 * from bound drift only because none of them carries a numeric bound.
 *
 * So the guarantee here is structural rather than nominal. Each domain is
 * written once, as data, and both arities are `optionalise()` of the same
 * object — a divergence is not caught after the fact, it is unrepresentable
 * unless someone writes an explicit override line and means it.
 *
 * The doors are still ALLOWED to diverge (spec decision 7: the bound belongs
 * to the arity, not the option). Divergence just costs a visible line:
 *
 *     export const preferenceImportShape = {
 *       ...optionalise(preferenceFieldTypes),
 *       // import tolerates <x> because <reason>
 *       someKey: z.number().int().optional(),
 *     };
 *
 * and `tests/unit/preference-door-conformance.test.ts` names it when it
 * appears, so a deliberate difference is documented and an accidental one
 * cannot be typed by mistake.
 *
 * ARITY 1 — the form doors — is deliberately absent. `notificationSchema`
 * takes `checkboxField` (an optional `"on"` string transformed to a boolean)
 * and `dataSchema` takes a required enum, which are different INPUT types,
 * not different bounds; the compiler already fails loudly on those, exactly
 * as it does for `appearanceFieldSchemas`. `doseLogPageSize` and
 * `heatmapPeriod` have no form door at all.
 */
import { z } from "zod";
import type { AppearanceKey, PreferenceKey } from "$lib/appearance/registry";
import type { UserPreferences } from "$lib/types";

/**
 * The seven mutable `user_preferences` columns the appearance registry does
 * not own, derived by subtraction rather than listed. A column added to the
 * table is therefore a compile error in `preferenceFieldTypes` below unless
 * it is also added to the appearance registry — neither door can be left
 * behind by a migration.
 */
export type NonAppearancePreferenceKey = Exclude<PreferenceKey, AppearanceKey>;

/** An inclusive integer range. */
export type NumericBound = { readonly min: number; readonly max: number };

/**
 * The numeric domains, as data rather than as method calls, so the doors and
 * the read-side clamp in `server/analytics/page-data.ts` can share one
 * source and a test can derive its probe values from the same place.
 */
export const DOSE_LOG_PAGE_SIZE_BOUNDS = { min: 5, max: 100 } as const satisfies NumericBound;

/**
 * `heatmapPeriod` reaches `Heatmap.svelte`'s per-day render loop, so the
 * ceiling is a real self-DoS guard and not cosmetic — see the door-agreement
 * case in the conformance test.
 */
export const HEATMAP_PERIOD_BOUNDS = { min: 1, max: 3650 } as const satisfies NumericBound;

export const EXPORT_FORMATS = ["pdf", "csv"] as const;

const boundedInt = (bound: NumericBound) => z.number().int().min(bound.min).max(bound.max);

/**
 * The domain of each key, once. Required here; the arities below add their
 * own optionality.
 *
 * The `satisfies` clause pins the key set (a dropped key is TS1360) and the
 * output type (`z.string()` for `doseLogPageSize` is an error). It does NOT
 * pin bounds or enum membership — nothing at the type level can, which is
 * the whole reason the arities are derived rather than restated. Enum
 * membership is held instead by the runtime coverage test, which derives its
 * expectations from `EXPORT_FORMATS`.
 */
export const preferenceFieldTypes = {
  overdueEmailReminders: z.boolean(),
  overduePushReminders: z.boolean(),
  lowInventoryEmailAlerts: z.boolean(),
  lowInventoryPushAlerts: z.boolean(),
  doseLogPageSize: boundedInt(DOSE_LOG_PAGE_SIZE_BOUNDS),
  heatmapPeriod: boundedInt(HEATMAP_PERIOD_BOUNDS),
  exportFormat: z.enum(EXPORT_FORMATS),
} satisfies { [K in NonAppearancePreferenceKey]: z.ZodType<UserPreferences[K]> };

export const NON_APPEARANCE_PREFERENCE_KEYS = Object.keys(
  preferenceFieldTypes,
) as readonly NonAppearancePreferenceKey[];

/**
 * `Record<string, z.ZodType>` and not `z.ZodRawShape`: in zod 4 the latter's
 * value type is the core `$ZodType`, which carries no `.optional()` method.
 * Measured against the installed 4.3.6.
 */
type PreferenceShape = Record<string, z.ZodType>;

type Optionalised<T extends PreferenceShape> = { [K in keyof T]: z.ZodOptional<T[K]> };

/**
 * Make every field of a shape optional, preserving each field's schema type.
 *
 * The `as` is the only cast in this module: `Object.fromEntries` widens to
 * `{ [k: string]: ... }` at the type level while producing exactly the right
 * object at runtime. Same single-cast discipline as `optionValues`'s
 * `as never` in `$lib/appearance/schema.ts`.
 */
function optionalise<T extends PreferenceShape>(shape: T): Optionalised<T> {
  return Object.fromEntries(
    Object.entries(shape).map(([key, schema]) => [key, schema.optional()]),
  ) as Optionalised<T>;
}

/** ARITY 2 — `/api/v1` `update_preferences`: all optional, JSON-native. */
export const preferencePayloadShape = optionalise(preferenceFieldTypes);

/**
 * ARITY 3 — backup import: all optional. Identical to arity 2 for all seven
 * today. It stays its own `optionalise()` call rather than an alias of arity
 * 2 so that a deliberate divergence has somewhere to be written, in the same
 * shape as `appearanceImportShape`.
 */
export const preferenceImportShape = optionalise(preferenceFieldTypes);
