/**
 * Value domains that client code needs. This file imports nothing at runtime,
 * so a component can read a bound without pulling zod into the bundle (the
 * zod-bearing schemas live in `schema.ts`, which re-exports `NumericBound`).
 */

/** An inclusive integer range. */
export type NumericBound = { readonly min: number; readonly max: number };

/** Hours before "time since" switches from "26h 3m ago" to "2d ago". */
export const TIME_SINCE_DAYS_FROM_HOURS_BOUNDS = {
  min: 24,
  max: 168,
} as const satisfies NumericBound;

/** The thresholds the settings UI offers as one-tap choices. */
export const TIME_SINCE_PRESETS = [24, 48, 72, 168] as const;
