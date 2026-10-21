// @vitest-environment node
//
// Button, IconButton and Toggle: the decided class recipes, the link/button
// split, the pending cell, both disabled modes, the focus ring, and the
// fixed heights that compact density cannot shrink.
import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import { createRawSnippet, type Component, type ComponentProps } from "svelte";
import Button from "$lib/components/ui/Button.svelte";
import IconButton from "$lib/components/ui/IconButton.svelte";
import Toggle from "$lib/components/ui/Toggle.svelte";
import ButtonGallery from "./helpers/ButtonGallery.svelte";
import { evaluatedRules, runAxe, ssrDocument, withoutComments } from "./helpers/axe-ssr";
import { compiledCss, compiledRule } from "./helpers/compiled-rule";
import { accessibleName, textOf } from "./helpers/dom-names";

const label = (text: string) => createRawSnippet(() => ({ render: () => text }));

function ssr<P extends Record<string, unknown>>(component: Component<P>, props: P): Element {
  const doc = ssrDocument(render(component, { props }).body);
  const el = doc.querySelector("main > *");
  expect(el, "nothing rendered").not.toBeNull();
  return el!;
}

const classes = (el: Element) => new Set(el.classList);

const RING = [
  "focus-visible:outline-2",
  "focus-visible:outline-offset-2",
  "focus-visible:outline-accent-ink",
];
const DISABLED_LOOK = [
  "disabled:cursor-not-allowed",
  "disabled:opacity-50",
  "aria-disabled:cursor-not-allowed",
  "aria-disabled:opacity-50",
];
const BASE = [
  "inline-flex",
  "items-center",
  "justify-center",
  "gap-2",
  "text-sm",
  "font-medium",
  "whitespace-nowrap",
  "transition-colors",
  ...RING,
  ...DISABLED_LOOK,
];
const SIZE = { md: ["h-11", "px-4"], sm: ["h-9", "px-3"] } as const;
const RECT = "rounded-lg";
const VARIANT = {
  primary: ["bg-accent", "text-accent-fg", "hover:opacity-90"],
  secondary: ["border", "border-border-strong", "text-text-primary", "hover:bg-surface-overlay"],
  ghost: ["text-text-secondary", "hover:bg-surface-overlay", "hover:text-text-primary"],
  danger: ["bg-danger", "text-danger-fg", "hover:brightness-110"],
} as const;

describe("Button", () => {
  for (const variant of ["primary", "secondary", "ghost", "danger"] as const) {
    for (const size of ["md", "sm"] as const) {
      it(`draws ${variant} at ${size} with exactly the decided classes`, () => {
        const el = ssr(Button, { variant, size, children: label("Save") });
        expect(classes(el)).toEqual(new Set([...BASE, ...SIZE[size], RECT, ...VARIANT[variant]]));
      });
    }
  }

  it("defaults to a secondary, md <button type=button>", () => {
    const el = ssr(Button, { children: label("Save") });
    expect(el.tagName).toBe("BUTTON");
    expect(el.getAttribute("type")).toBe("button");
    expect(classes(el)).toEqual(new Set([...BASE, ...SIZE.md, RECT, ...VARIANT.secondary]));
  });

  it("draws shape=pill as rounded-full in place of rounded-lg", () => {
    const el = ssr(Button, { shape: "pill", size: "sm", children: label("Headache") });
    expect(classes(el)).toEqual(
      new Set([...BASE, ...SIZE.sm, "rounded-full", ...VARIANT.secondary]),
    );
  });

  it("passes type=submit and rest attributes through to the button", () => {
    const el = ssr(Button, {
      type: "submit",
      name: "intent",
      value: "archive",
      "aria-describedby": "hint",
      children: label("Archive"),
    });
    expect(el.getAttribute("type")).toBe("submit");
    expect(el.getAttribute("name")).toBe("intent");
    expect(el.getAttribute("value")).toBe("archive");
    expect(el.getAttribute("aria-describedby")).toBe("hint");
  });

  it("renders an <a href> with no type and no disabled when given href", () => {
    const el = ssr(Button, { href: "/log", type: "submit", disabled: true, children: label("Go") });
    expect(el.tagName).toBe("A");
    expect(el.getAttribute("href")).toBe("/log");
    expect(el.hasAttribute("type")).toBe(false);
    expect(el.hasAttribute("disabled")).toBe(false);
  });

  it("appends w-full for block and the caller's class, keeping the recipe", () => {
    const el = ssr(Button, { block: true, class: "mt-4", children: label("Sign in") });
    expect(classes(el)).toEqual(
      new Set([...BASE, ...SIZE.md, RECT, ...VARIANT.secondary, "w-full", "mt-4"]),
    );
  });

  it("puts a label with no pending state directly in the element", () => {
    // A real .svelte caller, because a page's label is a compiled snippet, and
    // Svelte 5.57's SSR brackets a rendered snippet in hydration comments:
    // <a href="/log" class="…"><!--[0--><!---->Clear filters<!----><!--]--><!----></a>.
    // Comments, never an element: the label is still the anchor's only content.
    const html = render(ButtonGallery).body;
    const link = ssrDocument(html).querySelector('[data-case="link"]')!;
    expect(link.tagName).toBe("A");
    expect(link.childElementCount).toBe(0);
    expect(textOf(link)).toBe("Clear filters");
    // log-pagination-ssr.test.ts's own pattern, once the comments are gone.
    expect(withoutComments(html)).toMatch(/<a\b[^>]*href="\/log"[^>]*>\s*Clear filters\s*<\/a>/);
  });

  it("with pending=false, holds both labels in one grid cell and hides the pending one", () => {
    const el = ssr(Button, { pending: false, children: label("Save changes") });
    expect(el.hasAttribute("aria-busy")).toBe(false);
    const idle = el.querySelector('[data-part="label"]')!;
    const busy = el.querySelector('[data-part="pending"]')!;
    expect(idle.parentElement).toBe(busy.parentElement);
    expect([...idle.parentElement!.classList]).toContain("inline-grid");
    for (const part of [idle, busy]) {
      expect([...part.classList]).toEqual(expect.arrayContaining(["col-start-1", "row-start-1"]));
    }
    expect(idle.classList.contains("invisible")).toBe(false);
    expect(idle.hasAttribute("aria-hidden")).toBe(false);
    expect(busy.classList.contains("invisible")).toBe(true);
    expect(busy.getAttribute("aria-hidden")).toBe("true");
    expect(accessibleName(el)).toBe("Save changes");
  });

  it("with pending=true, shows the spinner and pendingLabel, aria-busy, and keeps the label's width", () => {
    const el = ssr(Button, {
      variant: "danger",
      pending: true,
      pendingLabel: "Deleting…",
      children: label("Delete permanently"),
    });
    expect(el.getAttribute("aria-busy")).toBe("true");
    const idle = el.querySelector('[data-part="label"]')!;
    const busy = el.querySelector('[data-part="pending"]')!;
    expect(idle.classList.contains("invisible")).toBe(true);
    expect(idle.getAttribute("aria-hidden")).toBe("true");
    expect(textOf(idle)).toBe("Delete permanently");
    expect(busy.classList.contains("invisible")).toBe(false);
    expect(busy.hasAttribute("aria-hidden")).toBe(false);
    const spinner = busy.querySelector(".animate-spin");
    expect(spinner?.getAttribute("aria-hidden")).toBe("true");
    expect(accessibleName(el)).toBe("Deleting…");
  });

  it("says Saving… (one character, U+2026) when no pendingLabel is given", () => {
    const el = ssr(Button, { pending: true, children: label("Save") });
    expect(accessibleName(el)).toBe("Saving…");
  });

  it("disabled is the real attribute and nothing else", () => {
    const el = ssr(Button, { disabled: true, children: label("Save") });
    expect(el.hasAttribute("disabled")).toBe(true);
    expect(el.hasAttribute("aria-disabled")).toBe(false);
  });

  it("ariaDisabled is aria-disabled=true and never disabled, so focus stays", () => {
    for (const href of [undefined, "/log"]) {
      const el = ssr(Button, { href, ariaDisabled: true, children: label("Delete") });
      expect(el.getAttribute("aria-disabled")).toBe("true");
      expect(el.hasAttribute("disabled")).toBe(false);
    }
  });

  it("renders neither disabled mode by default", () => {
    const el = ssr(Button, { children: label("Save") });
    expect(el.hasAttribute("disabled")).toBe(false);
    expect(el.hasAttribute("aria-disabled")).toBe(false);
    expect(el.hasAttribute("aria-busy")).toBe(false);
  });

  it("will not compile with a raw aria-disabled or aria-busy", () => {
    // The component writes both itself, after the rest props, so a raw one
    // would be silently overwritten. `npm run check` enforces these lines.
    const disabled: ComponentProps<typeof Button> = {
      // @ts-expect-error use ariaDisabled: aria-disabled is owned by that prop.
      "aria-disabled": "true",
      children: label("Save"),
    };
    const busy: ComponentProps<typeof Button> = {
      // @ts-expect-error use pending: aria-busy is owned by that prop.
      "aria-busy": "true",
      children: label("Save"),
    };
    expect([disabled, busy]).toHaveLength(2);
  });
});

const ICON_BASE = [
  "inline-flex",
  "shrink-0",
  "items-center",
  "justify-center",
  "rounded-lg",
  "transition-colors",
  ...RING,
  ...DISABLED_LOOK,
];

describe("IconButton", () => {
  const icon = createRawSnippet(() => ({ render: () => `<svg aria-hidden="true"></svg>` }));

  it("names itself with aria-label from the required label, ghost at size-11 by default", () => {
    const el = ssr(IconButton, { label: "Close menu", children: icon });
    expect(el.tagName).toBe("BUTTON");
    expect(el.getAttribute("type")).toBe("button");
    expect(el.getAttribute("aria-label")).toBe("Close menu");
    expect(classes(el)).toEqual(new Set([...ICON_BASE, "size-11", ...VARIANT.ghost]));
  });

  it("draws sm secondary at size-9", () => {
    const el = ssr(IconButton, {
      label: "Remove colour",
      size: "sm",
      variant: "secondary",
      children: icon,
    });
    expect(classes(el)).toEqual(new Set([...ICON_BASE, "size-9", ...VARIANT.secondary]));
  });

  it("renders a named link with no type when given href", () => {
    const el = ssr(IconButton, { label: "Settings", href: "/settings", children: icon });
    expect(el.tagName).toBe("A");
    expect(el.getAttribute("aria-label")).toBe("Settings");
    expect(el.hasAttribute("type")).toBe(false);
  });

  it("will not compile without a label", () => {
    // @ts-expect-error label is required: an icon has no text to name it.
    const props: ComponentProps<typeof IconButton> = { children: icon };
    expect(props).toBeDefined();
  });
});

describe("Toggle", () => {
  const ON = ["border", "border-accent-ink", "bg-accent/15", "text-accent-ink"];
  const OFF = ["border", "border-border-strong", "text-text-secondary", "hover:bg-surface-overlay"];
  const TOGGLE_BASE = [
    "inline-flex",
    "items-center",
    "justify-center",
    "gap-2",
    "px-3",
    "text-sm",
    "font-medium",
    "whitespace-nowrap",
    "transition-colors",
    ...RING,
    ...DISABLED_LOOK,
  ];

  it("pressed: aria-pressed=true, type=button, the on recipe, sm rect by default", () => {
    const el = ssr(Toggle, { pressed: true, children: label("Interval") });
    expect(el.tagName).toBe("BUTTON");
    expect(el.getAttribute("type")).toBe("button");
    expect(el.getAttribute("aria-pressed")).toBe("true");
    expect(classes(el)).toEqual(new Set([...TOGGLE_BASE, "h-9", "rounded-lg", ...ON]));
  });

  it("not pressed: aria-pressed=false and the off recipe", () => {
    const el = ssr(Toggle, { pressed: false, children: label("Fixed time") });
    expect(el.getAttribute("aria-pressed")).toBe("false");
    expect(classes(el)).toEqual(new Set([...TOGGLE_BASE, "h-9", "rounded-lg", ...OFF]));
  });

  it("stays type=button even when a type reaches it through a spread", () => {
    // Inside a <form>, a toggle that became a submit would post the form.
    const stray = { type: "submit" } as Record<string, unknown>;
    const props = { pressed: false, children: label("Interval"), ...stray };
    const el = ssr(Toggle, props as ComponentProps<typeof Toggle>);
    expect(el.getAttribute("type")).toBe("button");
  });

  it("draws md at h-11 and pill as rounded-full", () => {
    const el = ssr(Toggle, {
      pressed: false,
      size: "md",
      shape: "pill",
      children: label("Nausea"),
    });
    expect([...el.classList]).toEqual(expect.arrayContaining(["h-11", "rounded-full"]));
    expect(el.classList.contains("rounded-lg")).toBe(false);
  });
});

describe("every primitive in the gallery", () => {
  const gallery = () => ssrDocument(render(ButtonGallery).body);

  it("draws the focus-visible ring, and every ring class compiles to a rule", async () => {
    const cases = [...gallery().querySelectorAll("[data-case]")];
    expect(cases.length).toBe(22);
    for (const el of cases) {
      expect([...el.classList], el.getAttribute("data-case")!).toEqual(
        expect.arrayContaining(RING),
      );
    }
    expect(await compiledRule("focus-visible:outline-2")).toMatch(
      /&:focus-visible \{[^}]*outline-width: 2px/,
    );
    expect(await compiledRule("focus-visible:outline-offset-2")).toMatch(
      /&:focus-visible \{[^}]*outline-offset: 2px/,
    );
    expect(await compiledRule("focus-visible:outline-accent-ink")).toMatch(
      /&:focus-visible \{[^}]*outline-color: var\(--color-accent-ink\)/,
    );
    expect(await compiledRule("aria-disabled:opacity-50")).toMatch(
      /&\[aria-disabled="true"\] \{[^}]*opacity: 50%/,
    );
    expect(await compiledRule("disabled:opacity-50")).toMatch(/&:disabled \{[^}]*opacity: 50%/);
  });

  // `class` is appended after the recipe, but which of two clashing utilities
  // wins is Tailwind v4's utility order (the later rule), not the class order.
  // So it is not a way to restyle the variant, size or shape. Both directions
  // are pinned, because the claim is only true if a caller can win AND lose.
  it("a caller's h-12 beats the recipe's h-11, because Tailwind emits it later", async () => {
    const el = ssr(Button, { class: "h-12", children: label("Save") });
    expect([...el.classList]).toEqual(expect.arrayContaining(["h-11", "h-12"]));
    expect(await compiledRule("h-12")).toMatch(/height: calc\(var\(--spacing\) \* 12\)/);
    const css = await compiledCss(["h-11", "h-12"]);
    expect(css.indexOf(".h-11 {")).toBeGreaterThan(-1);
    expect(css.indexOf(".h-12 {")).toBeGreaterThan(css.indexOf(".h-11 {"));
  });

  it("a caller's rounded-full loses to the recipe's rounded-lg, only because Tailwind emits it earlier", async () => {
    const el = ssr(Button, { class: "rounded-full", children: label("Save") });
    expect([...el.classList]).toEqual(expect.arrayContaining(["rounded-lg", "rounded-full"]));
    const css = await compiledCss(["rounded-lg", "rounded-full"]);
    expect(css.indexOf(".rounded-full {")).toBeGreaterThan(-1);
    expect(css.indexOf(".rounded-full {")).toBeLessThan(css.indexOf(".rounded-lg {"));
  });

  it("keeps a fixed height under compact density, which rewrites py-2.5 but none of these", async () => {
    const css = await compiledCss(["py-2.5", "h-11", "h-9", "size-11", "size-9"]);
    const rewritten = new Set(
      [...css.matchAll(/\[data-density="compact"\]([^{]*)\{/g)].flatMap(([, selector]) =>
        [...selector.matchAll(/\.((?:[\w-]|\\.)+)/g)].map(([, c]) => c.replace(/\\(.)/g, "$1")),
      ),
    );
    // The mechanism this guards against is real: compact rewrites py-2.5.
    expect(rewritten).toContain("py-2.5");
    for (const el of gallery().querySelectorAll("[data-case]")) {
      const list = [...el.classList];
      expect(
        list.filter((t) => rewritten.has(t)),
        el.getAttribute("data-case")!,
      ).toEqual([]);
      expect(
        list.filter((t) => /^p[ytb]?-/.test(t)),
        el.getAttribute("data-case")!,
      ).toEqual([]);
      expect(
        list.filter((t) => /^(h|size)-(9|11)$/.test(t)),
        el.getAttribute("data-case")!,
      ).toHaveLength(1);
    }
    expect(await compiledRule("h-11")).toMatch(/height: calc\(var\(--spacing\) \* 11\)/);
    expect(await compiledRule("h-9")).toMatch(/height: calc\(var\(--spacing\) \* 9\)/);
    expect(await compiledRule("size-11")).toMatch(/height: calc\(var\(--spacing\) \* 11\)/);
    expect(await compiledRule("size-9")).toMatch(/height: calc\(var\(--spacing\) \* 9\)/);
  });

  it("passes axe: button-name, link-name, aria-allowed-attr, aria-valid-attr-value, aria-prohibited-attr, aria-hidden-focus, nested-interactive", async () => {
    const rules = [
      "button-name",
      "link-name",
      "aria-allowed-attr",
      "aria-valid-attr-value",
      "aria-prohibited-attr",
      "aria-hidden-focus",
      "nested-interactive",
    ];
    const results = await runAxe(gallery(), rules);
    expect(results.violations).toEqual([]);
    const ran = evaluatedRules(results);
    for (const rule of rules) expect(ran, `${rule} evaluated nothing`).toContain(rule);
  });
});
