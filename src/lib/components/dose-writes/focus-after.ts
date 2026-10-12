/**
 * Where focus goes after a dose write resolves a row, and the rule for when
 * to move it at all. Shared by every dose-write surface: the dashboard's Due
 * cards, /log's rows and the Undo offer, and by Modal when the control that
 * opened it has gone.
 */

export interface FocusTargetOptions {
  /**
   * Which row identity to look up. "cardKey" (the default) is a Due card's
   * `[data-card-key]`; "doseId" is a dose row's `[data-dose-id]` (/log, Done).
   */
  attr?: "cardKey" | "doseId";
  /**
   * Keys rendered ABOVE the row at the tap, nearest first. They are tried
   * only after every following key is gone. DueCard passes none, because a
   * card above is never its target.
   */
  precedingKeys?: readonly string[];
  /**
   * Narrows a found row to the element that should take focus (/log: the
   * row's ✎, never its ×). A row it returns null for is skipped.
   */
  pick?: (row: HTMLElement) => HTMLElement | null;
}

const ROW_SELECTOR = { cardKey: "[data-card-key]", doseId: "[data-dose-id]" } as const;

/**
 * The same row if it survived the reload, else the first row that was
 * rendered BELOW it and still exists, else (with `precedingKeys`) the nearest
 * surviving row that was ABOVE it, else null. On null the caller uses its
 * own fallback, the page's h1 (`pageHeading`).
 *
 * `followingKeys` and `precedingKeys` must be captured at the moment of the
 * tap: after the reload the resolved row is gone and the DOM can no longer
 * say what surrounded it. DueCard snapshots them in `onsubmitcapture`.
 */
export function focusTargetAfterResolve(
  key: string,
  followingKeys: readonly string[],
  opts: FocusTargetOptions = {},
  root: ParentNode = document,
): HTMLElement | null {
  const attr = opts.attr ?? "cardKey";
  const rows = new Map<string, HTMLElement>();
  for (const el of root.querySelectorAll<HTMLElement>(ROW_SELECTOR[attr])) {
    const rowKey = el.dataset[attr];
    if (rowKey) rows.set(rowKey, el);
  }
  const pick = opts.pick ?? ((row: HTMLElement) => row);
  for (const candidate of [key, ...followingKeys, ...(opts.precedingKeys ?? [])]) {
    const row = rows.get(candidate);
    const target = row ? pick(row) : null;
    if (target) return target;
  }
  return null;
}

/**
 * Whether keyboard focus has nowhere useful to be: on <body>, on a node a
 * reload removed, or inside the toast stack (whose Undo offer is about to go
 * away). Every dose write follows one rule with it: move focus only if it
 * was lost, and never onto a different dose's write button.
 */
export function isFocusLost(): boolean {
  const active = document.activeElement;
  if (active === null || active === document.body || !active.isConnected) return true;
  return active.closest("[data-toast-stack]") !== null;
}

/**
 * The page's h1: where focus PARKS when nothing nearer to what the user was
 * doing survives. Every h1 a signed-in page renders has tabindex="-1": the
 * Undo offer survives navigation, so this can be reached on any (app) page,
 * and an h1 without it cannot take focus(). This is the one
 * spelling of the lookup (tests/unit/page-heading-owner.test.ts): a caller
 * names `pageHeading`, never its own `querySelector("h1")`.
 */
export function pageHeading(): HTMLElement | null {
  return document.querySelector<HTMLElement>("h1");
}

/**
 * If focus is lost, focus the first candidate that returns an element still
 * in the document.
 *
 * The page heading is focused WITHOUT scrolling, and every other element with
 * a plain focus(). The heading is a parking spot, not a place the user was:
 * Chrome focuses a button on a mouse click, so a mouse user who clicked
 * Dismiss with nothing to return to, or whose kept Undo expired ten minutes
 * later, had a long /log jump to its top. Anything else — the caller's
 * focusAfter, the control the tap came from, where focus was before the toast
 * stack, a dialog's opener — is a return to where the user was, and scrolling
 * it into view is the point. Decided by WHICH element it is, not by which
 * candidate named it, so a caller whose own fallback ends at the heading
 * (/log's row, the dashboard's Due cards) parks it the same way.
 */
export function focusIfLost(...candidates: Array<() => HTMLElement | null | undefined>): void {
  if (!isFocusLost()) return;
  for (const candidate of candidates) {
    const el = candidate();
    if (el?.isConnected) {
      if (el === pageHeading()) el.focus({ preventScroll: true });
      else el.focus();
      return;
    }
  }
}
