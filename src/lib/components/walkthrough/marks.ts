// The camera frames real elements (a card, a pill, a form field), so the
// player needs their positions inside the fake app. Components tag those
// elements with `use:mark={"key"}` and the player measures them once the
// layout has settled. Keys starting "p." belong to the phone; everything else
// is measured relative to the desktop app shell.

import { getContext, setContext } from "svelte";
import type { Action } from "svelte/action";
import type { Rect } from "./timeline";

const CONTEXT_KEY = Symbol("walkthrough-marks");

export type MarkRegistry = Map<string, HTMLElement>;

export const SHELL_ROOT = "root.shell";
export const PHONE_ROOT = "root.phone";

/**
 * A plain, deliberately non-reactive Map: elements register once on mount
 * and are only read when the player measures, so nothing should re-render
 * because an element was added.
 */
export function createMarkRegistry(): MarkRegistry {
  return new Map();
}

export function provideMarks(registry: MarkRegistry): void {
  setContext(CONTEXT_KEY, registry);
}

/** Returns an action that registers its node under the given key. */
export function useMark(): Action<HTMLElement, string | undefined> {
  const registry = getContext<MarkRegistry | undefined>(CONTEXT_KEY);
  return (node, key) => {
    let current = key;
    if (registry && current) registry.set(current, node);
    return {
      update(next) {
        if (!registry) return;
        if (current && registry.get(current) === node) registry.delete(current);
        current = next;
        if (current) registry.set(current, node);
      },
      destroy() {
        if (registry && current && registry.get(current) === node) registry.delete(current);
      },
    };
  };
}

/**
 * Offset of `el` within `root`, walking offsetParents. offsetLeft/offsetTop
 * ignore CSS transforms, which is exactly what is wanted: the rects describe
 * the unscaled, unscrolled layout that the camera maths works in.
 */
function rectWithin(el: HTMLElement, root: HTMLElement): Rect {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

export function measureMarks(registry: MarkRegistry): Record<string, Rect> {
  const shell = registry.get(SHELL_ROOT);
  const phone = registry.get(PHONE_ROOT);
  const out: Record<string, Rect> = {};
  for (const [key, el] of registry) {
    if (key.startsWith("root.")) continue;
    const root = key.startsWith("p.") ? phone : shell;
    if (root) out[key] = rectWithin(el, root);
  }
  return out;
}
