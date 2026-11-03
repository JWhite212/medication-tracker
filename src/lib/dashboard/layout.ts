/**
 * The dashboard sections an account can reorder. Zod-free and import-free on
 * purpose: the settings page, the dashboard page and the database schema's
 * `$type<>` all reach it, and none of them may pull zod into a bundle.
 */
export const DASHBOARD_SECTIONS = ["done", "later", "quickLog", "refills"] as const;

export type DashboardSectionId = (typeof DASHBOARD_SECTIONS)[number];

/** "scheduled" has a Due region; "as-needed-only" pins Quick log instead. */
export type DashboardVariant = "scheduled" | "as-needed-only";

/** Today's two pages, expressed as data. */
export const DEFAULT_ORDER: Record<DashboardVariant, readonly DashboardSectionId[]> = {
  scheduled: ["done", "later", "quickLog", "refills"],
  "as-needed-only": ["done", "refills"],
};

/** Done is always shown; the rest can be turned off. */
export const HIDEABLE_SECTIONS = ["later", "quickLog", "refills"] as const;

export const SECTION_LABELS: Record<DashboardSectionId, string> = {
  done: "Done today",
  later: "Later today",
  quickLog: "Quick log",
  refills: "Refills",
};

/** The shorter names the settings page's Reset label lists ("Default: Done, Later, …"). */
export const SHORT_SECTION_LABELS: Record<DashboardSectionId, string> = {
  done: "Done",
  later: "Later",
  quickLog: "Quick log",
  refills: "Refills",
};

/**
 * Reads a stored order tolerantly: it never throws. Non-strings, ids that are
 * not in `defaults` and repeats are dropped; each missing id is inserted after
 * its nearest present default predecessor (or at the front if none is present),
 * so a section added to the product later lands where the defaults put it.
 */
export function normaliseAgainst(raw: unknown, defaults: readonly string[]): string[] {
  if (!Array.isArray(raw)) return [...defaults];
  const known = new Set(defaults);
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && known.has(item) && !result.includes(item)) {
      result.push(item);
    }
  }
  defaults.forEach((id, index) => {
    if (result.includes(id)) return;
    let at = 0;
    for (let p = index - 1; p >= 0; p--) {
      const found = result.indexOf(defaults[p]);
      if (found !== -1) {
        at = found + 1;
        break;
      }
    }
    result.splice(at, 0, id);
  });
  return result;
}

/**
 * Reads a stored single-choice option tolerantly: anything outside `values`
 * (a value a newer build wrote, null, a number) reads as `fallback`. Never
 * throws, like `normaliseSectionOrder`.
 */
export function normaliseOption<T extends string>(
  raw: unknown,
  values: readonly T[],
  fallback: T,
): T {
  return values.find((value) => value === raw) ?? fallback;
}

export function normaliseSectionOrder(
  raw: unknown,
  variant: DashboardVariant,
): DashboardSectionId[] {
  return normaliseAgainst(raw, DEFAULT_ORDER[variant]) as DashboardSectionId[];
}

export type DashboardLayoutInput = {
  order: unknown;
  showLater: boolean;
  showQuickLog: boolean;
  showRefills: boolean;
  variant: DashboardVariant;
  hasUrgentRefill: boolean;
};

export type DashboardLayout = {
  pinned: "due" | "quickLog";
  sections: DashboardSectionId[];
  /** Sections a preference suppresses. Never one the variant excludes, and never refills while the urgent floor forces it in. */
  hidden: DashboardSectionId[];
  /** Refills is showing only because an urgent refill forces it in. */
  refillsUrgentOnly: boolean;
};

export function resolveDashboardLayout(input: DashboardLayoutInput): DashboardLayout {
  const { variant, hasUrgentRefill } = input;
  const ordered = normaliseSectionOrder(input.order, variant);
  const refillsUrgentOnly = !input.showRefills && hasUrgentRefill;
  const shown: Record<DashboardSectionId, boolean> = {
    done: true,
    later: input.showLater,
    quickLog: input.showQuickLog,
    refills: input.showRefills || hasUrgentRefill,
  };
  return {
    pinned: variant === "scheduled" ? "due" : "quickLog",
    sections: ordered.filter((id) => shown[id]),
    hidden: ordered.filter((id) => !shown[id]),
    refillsUrgentOnly,
  };
}

/** Swaps a section with its neighbour; at either end the order is returned unchanged (as a copy). */
export function moveSection(
  order: readonly DashboardSectionId[],
  id: DashboardSectionId,
  direction: "up" | "down",
): DashboardSectionId[] {
  const next = [...order];
  const from = next.indexOf(id);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= next.length) return next;
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export function orderValue(order: readonly DashboardSectionId[]): string {
  return order.join(",");
}

/**
 * Writes a reordering of the ids a page can see back into the full order
 * without moving the ids it cannot. The slots `full` gives to ids in `visible`
 * are refilled with `visible` in its new order, and every other id keeps its
 * index. An as-needed-only account sees only Done and Refills, but its stored
 * order still places Later and Quick log, and posting just the visible ids
 * would discard those places. When every id is visible the result is
 * `visible` itself, so a scheduled account posts exactly what it would
 * without this.
 *
 * `visible` must be a repeat-free subset of `full`.
 */
export function mergeVisibleOrder(
  visible: readonly DashboardSectionId[],
  full: readonly DashboardSectionId[],
): DashboardSectionId[] {
  const shown = new Set(visible);
  let next = 0;
  return full.map((id) => (shown.has(id) ? visible[next++] : id));
}
