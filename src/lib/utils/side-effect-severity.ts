/**
 * How a side effect's severity is said and coloured, in one place.
 *
 * A severity chip carries the word as well as the tone, so the grade never
 * rests on colour alone. Mild and moderate are both neutral and differ only by
 * their word; severe is the one that reads as something gone wrong. The
 * statuses resolve to a tone in `status-tone.ts`, which stays the only place a
 * tone becomes a class.
 *
 * TimelineEntry draws the chips from this table and so does the landing-page
 * walkthrough, which draws the log row without mounting it. A copy of the
 * table on either side would be a second owner.
 *
 * Type-only imports: the walkthrough reads this module, so it pulls nothing
 * into the bundle.
 */
import type { SideEffect } from "$lib/types";
import type { StatusKey } from "./status-tone";

export const SEVERITY: Record<SideEffect["severity"], { word: string; status: StatusKey }> = {
  mild: { word: "Mild", status: "side-effect-mild" },
  moderate: { word: "Moderate", status: "side-effect-moderate" },
  severe: { word: "Severe", status: "side-effect-severe" },
};
