// Accessible names for the preset medication colours.
//
// The style picker used to name each swatch by its hex code ("Select primary
// colour #6366f1"), which tells a screen-reader user nothing about what they
// are choosing and gives a sighted user no word for two swatches they cannot
// tell apart. The map is keyed by the preset union, so adding a colour to
// `PRESET_COLOURS` without naming it here is a type error; uniqueness is the
// half a type cannot hold, so tests/unit/accessible-pickers-colour-names.test.ts
// holds it instead.

import { PRESET_COLOURS } from "./medication-style-options";

export type PresetColour = (typeof PRESET_COLOURS)[number];

export const PRESET_COLOUR_NAMES: Readonly<Record<PresetColour, string>> = {
  "#6366f1": "Indigo",
  "#8b5cf6": "Violet",
  "#a855f7": "Purple",
  "#ec4899": "Pink",
  "#f43f5e": "Rose",
  "#ef4444": "Red",
  "#f97316": "Orange",
  "#f59e0b": "Amber",
  "#84cc16": "Lime",
  "#10b981": "Emerald",
  "#14b8a6": "Teal",
  "#06b6d4": "Cyan",
  "#0ea5e9": "Sky blue",
  "#3b82f6": "Blue",
  "#64748b": "Slate grey",
  "#ffffff": "White",
};

/**
 * What a stored colour outside the presets is called. The picker cannot make
 * one, but the `/api/v1` and import doors accept any six-digit hex, so it can
 * be handed one and has to be able to say that it is holding it.
 */
export const CUSTOM_COLOUR_NAME = "Custom colour";

/**
 * Matched exactly rather than case-folded because it has to agree with the
 * picker's `bind:group`, which compares strictly: a stored `#6366F1` checks
 * no preset radio, so it is the custom one, not a second "Indigo".
 */
export function isPresetColour(colour: string): colour is PresetColour {
  return (PRESET_COLOURS as readonly string[]).includes(colour);
}

export function colourName(colour: string): string {
  return isPresetColour(colour) ? PRESET_COLOUR_NAMES[colour] : CUSTOM_COLOUR_NAME;
}
