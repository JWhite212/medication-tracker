// @vitest-environment node
import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { z } from "zod";
import { userPreferences } from "../../src/lib/server/db/schema";
import { preferenceFieldTypes } from "../../src/lib/preferences/schema";
import {
  PRESETS,
  PRESET_IDS,
  PRESET_KEYS,
  PREFERENCE_KEY_OF,
  activePreset,
  type PresetId,
  type PresetPatch,
} from "../../src/lib/dashboard/presets";
import {
  DEFAULT_ORDER,
  normaliseSectionOrder,
  resolveDashboardLayout,
  type DashboardVariant,
} from "../../src/lib/dashboard/layout";
import { DASHBOARD_LATER_MODES, DONE_TIME_DISPLAYS } from "../../src/lib/preferences/domains";

const patchOf = (id: PresetId): PresetPatch => PRESETS[id].patch;
const VARIANTS: DashboardVariant[] = ["scheduled", "as-needed-only"];

describe("PRESETS.standard is the column defaults", () => {
  const columns = getTableColumns(userPreferences) as unknown as Record<
    string,
    { default: unknown }
  >;
  for (const key of PRESET_KEYS) {
    it(`${key} equals the column default`, () => {
      // The order column has no default: null means "the variant's own order".
      const expected = key === "dashboardSectionOrder" ? null : columns[key].default;
      expect(PRESETS.standard.patch[key]).toEqual(expected);
    });
  }
});

describe("every preset", () => {
  it("has exactly the four ids", () => {
    expect([...PRESET_IDS]).toEqual(["standard", "focused", "fullDay", "justLog"]);
    expect(Object.keys(PRESETS).sort()).toEqual([...PRESET_IDS].sort());
  });

  it("states the labels and blurbs the settings page shows", () => {
    expect(PRESETS.standard).toMatchObject({
      label: "Standard",
      blurb: "The dashboard as it ships.",
    });
    expect(PRESETS.focused).toMatchObject({
      label: "Focused",
      blurb: "What you've taken and how long ago, without the rest of the day.",
    });
    expect(PRESETS.fullDay).toMatchObject({
      label: "Full day",
      blurb: "Every dose left today, listed.",
    });
    expect(PRESETS.justLog).toMatchObject({
      label: "Just log",
      blurb: "Logging buttons first, then what you've taken.",
    });
  });

  for (const id of PRESET_IDS) {
    describe(id, () => {
      it("is total over PRESET_KEYS", () => {
        expect(Object.keys(patchOf(id)).sort()).toEqual([...PRESET_KEYS].sort());
        for (const key of PRESET_KEYS) expect(patchOf(id)[key]).not.toBeUndefined();
      });

      it("parses through the real door's field types", () => {
        const door = z.strictObject(
          Object.fromEntries(PRESET_KEYS.map((key) => [key, preferenceFieldTypes[key]])),
        );
        expect(door.safeParse(patchOf(id)).success).toBe(true);
      });

      for (const variant of VARIANTS) {
        it(`keeps Done, the pin, no urgent floor and Quick log visible (${variant})`, () => {
          const p = patchOf(id);
          const layout = resolveDashboardLayout({
            order: p.dashboardSectionOrder,
            showLater: p.dashboardShowLater,
            showQuickLog: p.dashboardShowQuickLog,
            showRefills: p.dashboardShowRefills,
            variant,
            hasUrgentRefill: false,
          });
          expect(layout.sections).toContain("done");
          expect(layout.pinned).toBe(variant === "scheduled" ? "due" : "quickLog");
          expect(layout.refillsUrgentOnly).toBe(false);
          expect(layout.hidden).not.toContain("quickLog");
          expect(layout.hidden).not.toContain("refills");
        });
      }

      it("is recognised as itself", () => {
        expect(activePreset(patchOf(id))).toBe(id);
      });

      it("never lists due in its order", () => {
        expect(patchOf(id).dashboardSectionOrder ?? []).not.toContain("due");
      });
    });
  }

  it("no two patches match each other", () => {
    for (const a of PRESET_IDS) {
      for (const b of PRESET_IDS) {
        if (a !== b) expect(activePreset(patchOf(a))).not.toBe(b);
      }
    }
  });

  it("differ from Standard exactly where the table says", () => {
    const differs = (id: PresetId) =>
      PRESET_KEYS.filter(
        (k) => JSON.stringify(patchOf(id)[k]) !== JSON.stringify(PRESETS.standard.patch[k]),
      ).sort();
    expect(differs("focused")).toEqual(["dashboardDoneTime", "dashboardShowLater"]);
    expect(differs("fullDay")).toEqual(["dashboardLaterMode"]);
    expect(differs("justLog")).toEqual([
      "dashboardDoneTime",
      "dashboardSectionOrder",
      "dashboardShowLater",
    ]);
    expect(PRESETS.justLog.patch.dashboardSectionOrder).toEqual([
      "quickLog",
      "done",
      "refills",
      "later",
    ]);
  });
});

describe("activePreset", () => {
  it("matches Standard for null, [], the explicit default and a stored subset", () => {
    for (const order of [
      null,
      [],
      [...DEFAULT_ORDER.scheduled],
      ["later"],
      ["done", "refills"],
    ] as PresetPatch["dashboardSectionOrder"][]) {
      expect(activePreset({ ...PRESETS.standard.patch, dashboardSectionOrder: order })).toBe(
        "standard",
      );
    }
  });

  it("does not collide Focused and Just log on an as-needed-only account's order", () => {
    // Normalised against the account's variant, both orders would read
    // done,refills. The scheduled normalisation keeps them apart.
    expect(
      normaliseSectionOrder(PRESETS.justLog.patch.dashboardSectionOrder, "as-needed-only"),
    ).toEqual(
      normaliseSectionOrder(PRESETS.standard.patch.dashboardSectionOrder, "as-needed-only"),
    );
    expect(activePreset(PRESETS.justLog.patch)).toBe("justLog");
    expect(activePreset(PRESETS.focused.patch)).toBe("focused");
  });

  for (const id of PRESET_IDS) {
    for (const key of PRESET_KEYS) {
      // Standard and Full day differ in laterMode alone, so flipping it turns
      // one into the other. Every other single-key change is "Custom".
      const becomes =
        key === "dashboardLaterMode" && id === "standard"
          ? "fullDay"
          : key === "dashboardLaterMode" && id === "fullDay"
            ? "standard"
            : null;
      it(`${id}: changing ${key} alone gives ${becomes ?? "null"}`, () => {
        const base = patchOf(id);
        const changed: Record<string, unknown> = { ...base };
        switch (key) {
          case "dashboardSectionOrder":
            changed[key] = (base[key] ?? DEFAULT_ORDER.scheduled).slice().reverse();
            break;
          case "dashboardShowLater":
          case "dashboardShowQuickLog":
          case "dashboardShowRefills":
            changed[key] = !base[key];
            break;
          case "dashboardLaterMode":
            changed[key] = DASHBOARD_LATER_MODES.find((m) => m !== base[key]);
            break;
          case "dashboardDoneTime":
            changed[key] = DONE_TIME_DISPLAYS.find((m) => m !== base[key]);
            break;
        }
        expect(activePreset(changed as PresetPatch)).toBe(becomes);
      });
    }
  }
});

describe("PREFERENCE_KEY_OF", () => {
  it("maps six short names onto exactly the preset keys", () => {
    expect(Object.values(PREFERENCE_KEY_OF).sort()).toEqual([...PRESET_KEYS].sort());
  });
});
