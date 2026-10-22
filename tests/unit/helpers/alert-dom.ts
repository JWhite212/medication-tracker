import { expect } from "vitest";

/**
 * The `Alert` (src/lib/components/ui/Alert.svelte) whose headline contains
 * `title`. Its root is a <div> whose FIRST element child is the aria-hidden
 * icon, so the root is the innermost such div whose text holds the title.
 */
export function alertTitled(root: ParentNode, title: string): HTMLElement | null {
  const roots = [...root.querySelectorAll<HTMLElement>("div")].filter((el) => {
    const icon = el.firstElementChild;
    return (
      icon?.localName === "svg" &&
      icon.getAttribute("aria-hidden") === "true" &&
      (el.textContent ?? "").includes(title)
    );
  });
  return roots.at(-1) ?? null;
}

/** Every class in the space-separated `classes` is on `el`. */
export function expectClasses(el: Element, classes: string): void {
  for (const c of classes.split(/\s+/).filter(Boolean)) {
    expect(
      el.classList.contains(c),
      `no "${c}" on <${el.localName} class="${el.getAttribute("class")}">`,
    ).toBe(true);
  }
}
