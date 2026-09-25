import { describe, it, expect } from "vitest";
import { PRESET_COLOURS } from "$lib/medications/medication-style-options";
import {
  CUSTOM_COLOUR_NAME,
  PRESET_COLOUR_NAMES,
  colourName,
  isPresetColour,
} from "$lib/medications/medication-colour-names";

// The names are what a screen reader announces for each swatch in the
// medication style picker, and what a sighted user sees on hover. Two
// swatches sharing a name would be two radios a listener cannot tell apart.
describe("PRESET_COLOUR_NAMES", () => {
  it("names every preset colour", () => {
    for (const colour of PRESET_COLOURS) {
      expect(PRESET_COLOUR_NAMES[colour], `no name for ${colour}`).toBeTruthy();
    }
  });

  it("names nothing that is not a preset, so the map cannot drift ahead of the list", () => {
    expect(Object.keys(PRESET_COLOUR_NAMES).sort()).toEqual([...PRESET_COLOURS].sort());
  });

  it("gives every preset a unique name, ignoring case", () => {
    const names = PRESET_COLOURS.map((c) => PRESET_COLOUR_NAMES[c].toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it("never reuses the custom colour's name for a preset", () => {
    for (const colour of PRESET_COLOURS) {
      expect(PRESET_COLOUR_NAMES[colour].toLowerCase()).not.toBe(CUSTOM_COLOUR_NAME.toLowerCase());
    }
  });

  it("uses words, not the hex code the picker used to announce", () => {
    for (const colour of PRESET_COLOURS) {
      expect(PRESET_COLOUR_NAMES[colour]).not.toMatch(/#|[0-9]/);
    }
  });
});

describe("colourName", () => {
  it("returns the preset's name", () => {
    expect(colourName("#6366f1")).toBe("Indigo");
    expect(colourName("#14b8a6")).toBe("Teal");
  });

  it("calls a colour outside the presets the custom colour", () => {
    expect(colourName("#123456")).toBe(CUSTOM_COLOUR_NAME);
  });

  it("matches exactly, as bind:group does, so an upper-case preset is the custom one", () => {
    // A stored "#6366F1" checks no preset radio. Naming it "Indigo" would put
    // two radios called Indigo in one group, only one of which is Indigo's.
    expect(isPresetColour("#6366F1")).toBe(false);
    expect(colourName("#6366F1")).not.toBe("Indigo");
  });

  it("still names an upper-case preset after the colour it looks like", () => {
    // It is drawn as a second indigo swatch, so "Custom colour" would
    // contradict what a sighted user can see.
    expect(colourName("#6366F1")).toBe("Indigo (custom)");
    expect(colourName("#FFFFFF")).toBe("White (custom)");
  });

  it("gives an upper-case preset a name no preset uses", () => {
    const presetNames = new Set(Object.values(PRESET_COLOUR_NAMES).map((n) => n.toLowerCase()));
    for (const colour of PRESET_COLOURS) {
      expect(presetNames.has(colourName(colour.toUpperCase()).toLowerCase())).toBe(false);
    }
  });
});
