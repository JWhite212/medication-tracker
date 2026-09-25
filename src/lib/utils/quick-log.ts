/**
 * The chip form that logs `medicationId` now, or null.
 *
 * It matches `form[data-quick-log]` only. The dashboard also renders
 * `?/logDose` forms on its Due cards, and one of them, "Took it at HH:MM",
 * records a PAST instant. Matching on the action alone let a number key submit
 * whichever logDose form for that medication came first in the DOM, and the
 * Due cards render above the chips, so that was a Due card's form.
 */
export function findQuickLogForm(root: ParentNode, medicationId: string): HTMLFormElement | null {
  for (const form of root.querySelectorAll<HTMLFormElement>("form[data-quick-log]")) {
    const input = form.querySelector<HTMLInputElement>('input[name="medicationId"]');
    if (input?.value === medicationId) return form;
  }
  return null;
}
