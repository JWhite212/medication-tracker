import type { DashboardSectionId } from "./layout";

/**
 * The element id to focus after a section move: the arrow just pressed, or
 * the opposite one when the move took the section to an end and made the
 * pressed arrow inert. Pure id arithmetic; each surface keeps its own DOM
 * work (tick, lookup, focus) and its own `prefix` ("settings-move",
 * "editor-move").
 */
export function moveFocusTarget(
  prefix: string,
  id: DashboardSectionId,
  direction: "up" | "down",
  isEnd: boolean,
): string {
  const next = isEnd ? (direction === "up" ? "down" : "up") : direction;
  return `${prefix}-${id}-${next}`;
}
