/**
 * Where focus goes after a Due row resolves: the same card if it survived
 * the reload, else the first card that was rendered BELOW it and still
 * exists, else null (the caller then uses its fallback, the page's h1).
 *
 * `followingKeys` must be captured at the moment of the tap: after the
 * reload the resolved card is gone and the DOM can no longer say what came
 * after it. DueCard snapshots it in `onsubmitcapture`.
 */
export function focusTargetAfterResolve(
  cardKey: string,
  followingKeys: readonly string[],
  root: ParentNode = document,
): HTMLElement | null {
  const cards = new Map<string, HTMLElement>();
  for (const el of root.querySelectorAll<HTMLElement>("[data-card-key]")) {
    const key = el.dataset.cardKey;
    if (key) cards.set(key, el);
  }
  const same = cards.get(cardKey);
  if (same) return same;
  for (const key of followingKeys) {
    const next = cards.get(key);
    if (next) return next;
  }
  return null;
}
