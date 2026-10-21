// Button and Toggle mounted for real (jsdom, client svelte). A `.svelte.test.ts`
// so props are a `$state` the test can change: a pending flip must keep the
// same element, and so the same focus, or a keyboard user's Save loses focus
// the moment it is pressed.
import { describe, it, expect, afterEach, vi } from "vitest";
import { createRawSnippet, flushSync, mount, unmount, type ComponentProps } from "svelte";
import Button from "$lib/components/ui/Button.svelte";
import IconButton from "$lib/components/ui/IconButton.svelte";
import Toggle from "$lib/components/ui/Toggle.svelte";

const label = (text: string) => createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));

let app: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  document.body.innerHTML = "";
});

describe("Button, mounted", () => {
  it("keeps the same focused element while pending flips, and moves aria-busy with it", () => {
    const props = $state({ pending: false, children: label("Save changes") });
    app = mount(Button, { target: document.body, props });
    flushSync();
    const button = document.querySelector("button")!;
    button.focus();

    props.pending = true;
    flushSync();
    expect(document.querySelector("button")).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-busy")).toBe("true");

    props.pending = false;
    flushSync();
    expect(document.querySelector("button")).toBe(button);
    expect(button.hasAttribute("aria-busy")).toBe(false);
  });

  it("keeps the same element when pending goes from undefined to a boolean", () => {
    // A caller that only starts passing pending once a submit begins must not
    // swap the element out from under the keyboard focus.
    const props: ComponentProps<typeof Button> = $state({
      children: label("Delete permanently"),
    });
    app = mount(Button, { target: document.body, props });
    flushSync();
    const button = document.querySelector("button")!;
    button.focus();

    props.pending = true;
    flushSync();
    expect(document.querySelector("button")).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("forwards onclick, and a real disabled button never fires it", () => {
    const onclick = vi.fn();
    const props = $state({ disabled: false, onclick, children: label("Save") });
    app = mount(Button, { target: document.body, props });
    flushSync();
    const button = document.querySelector("button")!;
    button.click();
    expect(onclick).toHaveBeenCalledTimes(1);

    props.disabled = true;
    flushSync();
    button.click();
    expect(onclick).toHaveBeenCalledTimes(1);
  });
});

describe("ref", () => {
  // bind:this on a component yields the instance, not its element. These
  // hand the element back for the focus moves MobileHeader, the colour
  // picker's + and SideEffectPicker's chips make.
  for (const href of [undefined, "/log"]) {
    it(`binds Button's rendered ${href ? "<a>" : "<button>"}`, () => {
      const props: ComponentProps<typeof Button> = $state({
        href,
        ref: null,
        children: label("Save"),
      });
      app = mount(Button, { target: document.body, props });
      flushSync();
      expect(props.ref).toBe(document.querySelector(href ? "a" : "button"));
    });
  }

  it("binds IconButton's rendered <button>", () => {
    const props: ComponentProps<typeof IconButton> = $state({
      label: "Toggle menu",
      ref: null,
      children: label("≡"),
    });
    app = mount(IconButton, { target: document.body, props });
    flushSync();
    expect(props.ref).toBe(document.querySelector('button[aria-label="Toggle menu"]'));
  });
});

describe("Toggle, mounted", () => {
  it("reports the caller's pressed state through aria-pressed as it changes", () => {
    const props = $state({
      pressed: false,
      onclick: () => {
        props.pressed = !props.pressed;
      },
      children: label("Interval"),
    });
    app = mount(Toggle, { target: document.body, props });
    flushSync();
    const toggle = document.querySelector("button")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    toggle.click();
    flushSync();
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.classList.contains("text-accent-ink")).toBe(true);
  });
});
