/**
 * Dashboard presets: named, total patches over the six dashboard layout and
 * option preferences. Zod-free on purpose (the settings page imports it): its
 * imports are a type import from `$lib/types` and `normaliseSectionOrder`
 * from the zod-free `./layout`.
 *
 * A patch is total over `PRESET_KEYS`, so applying a preset gives the same
 * result from any starting state and matching is exact. The active preset is
 * never stored: `activePreset` derives it from the stored values.
 *
 * `timeSinceDaysFromHours` is deliberately not a preset key. It is a reading
 * preference shared with /log, /medications and reminder copy, and a dashboard
 * preset must not silently change those.
 */
import type { UserPreferences } from "$lib/types";
import { normaliseSectionOrder } from "./layout";

export const PRESET_KEYS = [
  "dashboardSectionOrder",
  "dashboardShowLater",
  "dashboardShowQuickLog",
  "dashboardShowRefills",
  "dashboardLaterMode",
  "dashboardDoneTime",
] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];
export type PresetPatch = { [K in PresetKey]: UserPreferences[K] };

export const PRESET_IDS = ["standard", "focused", "fullDay", "justLog"] as const;
export type PresetId = (typeof PRESET_IDS)[number];

/**
 * No preset hides Quick log (the 1-9 shortcuts keep working), none hides
 * Refills (the urgent-floor note never appears), none touches Done, and none
 * lists `due`, which is pinned by construction.
 */
export const PRESETS: Record<PresetId, { label: string; blurb: string; patch: PresetPatch }> = {
  standard: {
    label: "Standard",
    blurb: "The dashboard as it ships.",
    patch: {
      dashboardSectionOrder: null,
      dashboardShowLater: true,
      dashboardShowQuickLog: true,
      dashboardShowRefills: true,
      dashboardLaterMode: "next",
      dashboardDoneTime: "both",
    },
  },
  focused: {
    label: "Focused",
    blurb: "What you've taken and how long ago, without the rest of the day.",
    patch: {
      dashboardSectionOrder: null,
      dashboardShowLater: false,
      dashboardShowQuickLog: true,
      dashboardShowRefills: true,
      dashboardLaterMode: "next",
      dashboardDoneTime: "since",
    },
  },
  fullDay: {
    label: "Full day",
    blurb: "Every dose left today, listed.",
    patch: {
      dashboardSectionOrder: null,
      dashboardShowLater: true,
      dashboardShowQuickLog: true,
      dashboardShowRefills: true,
      dashboardLaterMode: "all",
      dashboardDoneTime: "both",
    },
  },
  justLog: {
    label: "Just log",
    blurb: "Logging buttons first, then what you've taken.",
    patch: {
      // Later is stored last, so re-showing it lands somewhere sensible.
      dashboardSectionOrder: ["quickLog", "done", "refills", "later"],
      dashboardShowLater: false,
      dashboardShowQuickLog: true,
      dashboardShowRefills: true,
      dashboardLaterMode: "next",
      dashboardDoneTime: "since",
    },
  },
};

/**
 * The preset whose every key matches `stored`, else null ("Custom").
 *
 * Orders are compared normalised against the SCHEDULED defaults, not the
 * account's variant: as-needed-only normalisation drops `later` and
 * `quickLog`, which would make Just log's order equal Standard's.
 */
export function activePreset(stored: PresetPatch): PresetId | null {
  const storedOrder = normaliseSectionOrder(stored.dashboardSectionOrder, "scheduled").join(",");
  return (
    PRESET_IDS.find((id) => {
      const patch = PRESETS[id].patch;
      return PRESET_KEYS.every((key) =>
        key === "dashboardSectionOrder"
          ? normaliseSectionOrder(patch[key], "scheduled").join(",") === storedOrder
          : patch[key] === stored[key],
      );
    }) ?? null
  );
}

/** The one place a layout field's short name meets its preference key (Phase 3 posts by it). */
export const PREFERENCE_KEY_OF = {
  order: "dashboardSectionOrder",
  showLater: "dashboardShowLater",
  showQuickLog: "dashboardShowQuickLog",
  showRefills: "dashboardShowRefills",
  laterMode: "dashboardLaterMode",
  doneTime: "dashboardDoneTime",
} as const satisfies Record<string, PresetKey>;
