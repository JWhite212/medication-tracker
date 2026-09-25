/**
 * Accessible-name reading for components that name their buttons with visible
 * text plus an sr-only suffix and NEVER with aria-label (callers assert that).
 * JSDOM has no CSS, so "visible" means "not aria-hidden and not .sr-only".
 */
const squash = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

function textWithout(el: Element, selector: string): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(selector).forEach((node) => node.remove());
  return squash(clone.textContent);
}

export const textOf = (el: Element) => squash(el.textContent);
export const accessibleName = (el: Element) => textWithout(el, '[aria-hidden="true"]');
export const visibleLabel = (el: Element) => textWithout(el, '[aria-hidden="true"], .sr-only');

export function buttonNamed(root: ParentNode, name: string): HTMLButtonElement {
  const buttons = [...root.querySelectorAll("button")];
  const found = buttons.find((b) => accessibleName(b) === name);
  if (!found) {
    throw new Error(`no button named "${name}"; found: ${buttons.map(accessibleName).join(" | ")}`);
  }
  return found;
}

export function hiddenFields(form: HTMLFormElement): Record<string, string> {
  return Object.fromEntries(
    [...form.querySelectorAll<HTMLInputElement>('input[type="hidden"]')].map((i) => [
      i.name,
      i.value,
    ]),
  );
}
