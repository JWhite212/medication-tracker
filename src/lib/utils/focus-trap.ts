/**
 * Focus-trap primitives for `ui/Modal.svelte`.
 *
 * Extracted from the component for the same reason `buildSparklineShape` lives
 * in utils/sparkline.ts: the component itself has no unit-test attach point
 * (its focus behaviour is a client-only `$effect`, and jsdom's focus model
 * diverges from a real browser), but the selector and the wrap arithmetic are
 * both deterministic and are where the bugs actually were.
 */

/**
 * Elements inside a dialog that can actually take focus.
 *
 * Two exclusions, both of which were real defects:
 *
 * - `input` unqualified matches `input[type="hidden"]`. DoseEditForm opens with
 *   two hidden inputs, so they were the first match — `.focus()` on a hidden
 *   input is a silent no-op, so focus never entered the dose-edit dialog, and
 *   the backward Tab wrap could never fire because `first` was never the active
 *   element.
 * - `:disabled` elements can never be `document.activeElement`. The delete-account
 *   dialog's submit button stays disabled until the confirmation text matches, and
 *   it was the trap's last element, so the forward wrap never fired either and Tab
 *   walked out of the dialog — during the normal, pre-confirmation case.
 */
export const FOCUSABLE_SELECTOR = [
  "button:not(:disabled)",
  "[href]",
  'input:not([type="hidden"]):not(:disabled)',
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/** `Node.DOCUMENT_POSITION_FOLLOWING`, inlined so this module needs no DOM global. */
const DOCUMENT_POSITION_FOLLOWING = 4;

/**
 * Every focusable descendant, in document order.
 *
 * The sort is not decoration. `querySelectorAll` is specified to return document
 * order and real browsers do, but jsdom's selector engine (nwsapi) returns a
 * selector LIST grouped by fragment — for our selector it yields every matching
 * button, then every matching input, and so on. `items[0]` under jsdom is
 * therefore the first button rather than the first focusable element.
 *
 * The trap's whole contract is first/last in document order, so sorting makes the
 * two environments agree: a no-op in any conformant engine, and the only way this
 * property can be covered by the jsdom suite at all.
 */
export function collectFocusable(container: ParentNode): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].sort((a, b) =>
    a.compareDocumentPosition(b) & DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
}

/**
 * Where Tab should send focus inside a trap, or `null` to let the browser move
 * focus naturally.
 *
 * `activeIndex` is the index of the focused element within the trap's focusable
 * list, or -1 when focus is outside the dialog entirely. That -1 case is not
 * hypothetical: focus starts outside on every open, and until the selector was
 * fixed it stayed there, so a trap that only handled the two edge indices was
 * inert for the whole lifetime of the dialog.
 */
export function nextTrapIndex(
  count: number,
  activeIndex: number,
  shiftKey: boolean,
): number | null {
  if (count <= 0) return null;
  // Focus is outside the dialog — pull it back to whichever end Tab is heading for.
  if (activeIndex < 0) return shiftKey ? count - 1 : 0;
  if (shiftKey && activeIndex === 0) return count - 1;
  if (!shiftKey && activeIndex === count - 1) return 0;
  return null;
}
