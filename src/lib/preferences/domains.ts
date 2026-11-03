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

/**
 * How much of the dashboard's Later section is drawn on first render. There is
 * deliberately no "off": `dashboardShowLater` is the only owner of whether
 * Later is shown at all.
 */
export const DASHBOARD_LATER_MODES = ["next", "all"] as const;
export type DashboardLaterMode = (typeof DASHBOARD_LATER_MODES)[number];

/** Which time fields a taken row in the dashboard's Done section shows. */
export const DONE_TIME_DISPLAYS = ["both", "since", "clock"] as const;
export type DoneTimeDisplay = (typeof DONE_TIME_DISPLAYS)[number];
