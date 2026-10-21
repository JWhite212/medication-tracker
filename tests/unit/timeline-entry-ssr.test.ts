// @vitest-environment node
//
// `@vitest-environment node` is load-bearing: the suite's default is jsdom,
// and under jsdom the component is compiled for the client, so `render()`
// from `svelte/server` runs client code and throws `effect_orphan` before an
// assertion runs. How the `svelte` specifier itself resolves there is
// explained in vite.config.ts.
//
// Covers the dose row's static markup: what a skipped or missed row dims, when
// the hover-revealed controls are allowed to hide, how big they are, and what
// × is before the page is live. The one-tap delete, its Undo and focus are
// interactive and live in tests/unit/timeline-entry-delete.test.ts.
import { describe, it, expect, vi } from "vitest";
import { render } from "svelte/server";
import { JSDOM } from "jsdom";
import type { DoseLogWithMedication } from "$lib/types";
import { toneClass } from "$lib/utils/status-tone";
import { evaluatedRules, runAxe, ssrDocument } from "./helpers/axe-ssr";
import { compiledRule } from "./helpers/compiled-rule";
import { accessibleName, textOf } from "./helpers/dom-names";

// The delete form imports `enhance` and the toast store; neither is reachable
// on the server and neither is what these assertions are about.
vi.mock("$app/forms", () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock("$components/ui/Toast.svelte", () => ({ showToast: () => {} }));
// The dose-write primitive's reload path imports these; nothing here reloads.
vi.mock("$app/navigation", () => ({ invalidateAll: async () => {} }));
vi.mock("$app/state", () => ({
  page: { data: {} },
  navigating: { from: null, to: null, type: null, willUnload: null, delta: null, complete: null },
  updated: { current: false, check: async () => false },
}));

const { default: TimelineEntry } = await import("../../src/lib/components/TimelineEntry.svelte");
// × is a dose write, and every dose write reads the (app) layout's lock.
const { doseWriteContext } = await import("./helpers/dashboard-context");

type Status = DoseLogWithMedication["status"];

function makeDose(
  status: Status,
  overrides: Partial<DoseLogWithMedication> = {},
): DoseLogWithMedication {
  return {
    id: `dose-${status}`,
    userId: "user-1",
    medicationId: "med-1",
    quantity: 1,
    takenAt: new Date("2026-04-16T08:00:00Z"),
    loggedAt: new Date("2026-04-16T08:00:00Z"),
    updatedAt: new Date("2026-04-16T08:00:00Z"),
    notes: null,
    sideEffects: null,
    status,
    medication: {
      name: "Vitamin D",
      dosageAmount: "1000",
      dosageUnit: "IU",
      form: "tablet",
      colour: "#6366f1",
      colourSecondary: null,
      pattern: "solid",
    },
    ...overrides,
  };
}

function renderRowHtml(status: Status, overrides: Partial<DoseLogWithMedication> = {}): string {
  return render(TimelineEntry, {
    props: {
      dose: makeDose(status, overrides),
      timezone: "UTC",
      timeFormat: "24h" as const,
      day: null,
      onedit: () => {},
    },
    context: doseWriteContext(),
  }).body;
}

function renderRow(status: Status, overrides: Partial<DoseLogWithMedication> = {}): Document {
  return new JSDOM(`<!doctype html><html><body>${renderRowHtml(status, overrides)}</body></html>`)
    .window.document;
}

function tokens(el: Element): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

/** Unprefixed `opacity-N` below 100: dimming that applies at rest, in every state. */
function restingOpacity(el: Element): number | null {
  for (const token of tokens(el)) {
    const m = token.match(/^opacity-(\d+)$/);
    if (m && Number(m[1]) < 100) return Number(m[1]);
  }
  return null;
}

describe("a skipped or missed dose row stays legible (WCAG 1.4.3)", () => {
  // opacity-60 on the whole row composited the badges, dosage and time down to
  // roughly 3:1. theme-tokens.test.ts validates those tokens at full strength
  // over the row's glass, which is only true if nothing between them and the
  // row thins them out.
  for (const status of ["taken", "skipped", "missed"] as const) {
    it(`dims no element that carries text on a ${status} row`, () => {
      const doc = renderRow(status);
      const row = doc.querySelector('[role="listitem"]');
      expect(row, "no row rendered").not.toBeNull();

      const dimmedText = [row!, ...row!.querySelectorAll("*")].filter(
        (el) => restingOpacity(el) !== null && (el.textContent ?? "").trim() !== "",
      );
      expect(
        dimmedText.map((el) => `<${el.tagName.toLowerCase()} class="${el.getAttribute("class")}">`),
      ).toEqual([]);
    });
  }

  it("still marks a skipped row with its badge and line-through, and a missed row with its badge", () => {
    const skipped = renderRow("skipped");
    expect(skipped.body.textContent).toContain("Skipped");
    expect(skipped.querySelector(".line-through")?.textContent).toContain("Vitamin D");

    expect(renderRow("missed").body.textContent).toContain("Missed");
  });

  it("dims only the decorative colour dot, and only when the dose was not taken", () => {
    const dot = (doc: Document) =>
      [...doc.querySelectorAll('[role="listitem"] *')].find((el) =>
        (el.getAttribute("style") ?? "").startsWith("background:"),
      );
    expect(restingOpacity(dot(renderRow("taken"))!)).toBeNull();
    expect(restingOpacity(dot(renderRow("skipped"))!)).not.toBeNull();
    expect(restingOpacity(dot(renderRow("missed"))!)).not.toBeNull();
  });
});

const HOVER_MEDIA = /@media \(hover: ?hover\)/;

describe("the row's controls hide only on devices that can hover to reveal them", () => {
  const controls = () => {
    const doc = renderRow("taken");
    const x = doc.querySelector('button[aria-label^="Delete dose of"]');
    expect(x, "no delete button rendered").not.toBeNull();
    return x!.closest("form")!.parentElement!;
  };

  // A touch tablet is md-wide and cannot hover. Hidden at md by width alone,
  // its controls were invisible with nothing that could reveal them.
  it("gates every rule that hides them on (hover: hover)", async () => {
    const hiding = tokens(controls()).filter((t) => /(^|:)opacity-0$/.test(t));
    expect(hiding, "the controls no longer hide at all; update this test").not.toEqual([]);

    for (const token of hiding) {
      const rule = await compiledRule(token);
      expect(rule, `${token} generates no CSS`).not.toBeNull();
      expect(rule, `${token} hides without asking whether the device can hover`).toMatch(
        HOVER_MEDIA,
      );
    }
  });

  it("keeps the hover reveal on the same query, and the focus reveal on none", async () => {
    const list = tokens(controls());
    const hover = list.find((t) => t.endsWith("group-hover:opacity-100"));
    const focus = list.find((t) => t.endsWith("group-focus-within:opacity-100"));
    expect(hover).toBeDefined();
    expect(focus).toBeDefined();

    // Tailwind v4 wraps group-hover in (hover: hover). That is the premise of
    // gating the hide on it: the two must be the same condition, or some
    // device hides the controls without being able to hover them back.
    expect(await compiledRule(hover!)).toMatch(HOVER_MEDIA);
    // Keyboard focus reveals them on every device (WCAG 2.4.7).
    const focusRule = await compiledRule(focus!);
    expect(focusRule).not.toBeNull();
    expect(focusRule).not.toMatch(HOVER_MEDIA);
  });

  // Guard the guard: the width-only class that shipped must fail the check
  // above, or the check proves nothing.
  it("would have caught the width-only hide", async () => {
    const rule = await compiledRule("md:opacity-0");
    expect(rule).not.toBeNull();
    expect(rule).not.toMatch(HOVER_MEDIA);
  });
});

describe("the row's controls are real targets (WCAG 2.5.8, and 2.5.5 on touch)", () => {
  /** The px size a `size-N` token sets, for any variant prefix given. */
  function sizePx(list: string[], prefix: string): number {
    // startsWith rather than a RegExp built from the prefix: no escaping to get
    // wrong, and an unprefixed lookup cannot match a variant's token.
    const sizes = list
      .filter((t) => t.startsWith(`${prefix}size-`))
      .map((t) => t.slice(prefix.length + "size-".length).match(/^(\d+(?:\.5)?)$/)?.[1])
      .filter((n): n is string => n !== undefined);
    return sizes.length ? Math.max(...sizes.map((n) => Number(n) * 4)) : 0;
  }

  for (const label of ["Edit dose of", "Delete dose of"]) {
    it(`gives "${label}…" at least 24px, and 44px on a coarse pointer`, () => {
      const button = renderRow("taken").querySelector(`button[aria-label^="${label}"]`);
      expect(button, `no "${label}" button rendered`).not.toBeNull();
      const list = tokens(button!);
      expect(sizePx(list, "")).toBeGreaterThanOrEqual(24);
      expect(sizePx(list, "pointer-coarse:")).toBeGreaterThanOrEqual(44);
    });
  }

  // Below sm on touch the 44px targets overhang the time's line beneath them.
  // That line is in flow and painted after them, so it took the taps on their
  // lower edge and the row opened the edit modal instead. Positioned, the
  // controls paint, and take taps, above it.
  it("positions the controls so their overhang sits above the line below", async () => {
    const x = renderRow("taken").querySelector('button[aria-label^="Delete dose of"]');
    expect(x, "no delete button rendered").not.toBeNull();
    const atRest = tokens(x!.closest("form")!.parentElement!).filter((t) => !t.includes(":"));
    const rules = await Promise.all(atRest.map(compiledRule));
    expect(rules.some((r) => /position: ?(relative|absolute|sticky)/.test(r ?? ""))).toBe(true);
  });
});

describe("a long one-word medication name wraps before it reaches the controls", () => {
  // The name's column is min-w-0, so it can be narrower than the word; without
  // a break opportunity inside the word it ran on underneath ✎ at 320px.
  it("lets the name break inside a word", async () => {
    const doc = renderRow("taken");
    const name = [...doc.querySelectorAll('[role="listitem"] p')].find((p) =>
      p.textContent?.includes("Vitamin D"),
    );
    expect(name, "no name rendered").not.toBeUndefined();
    const atRest = tokens(name!).filter((t) => !t.includes(":"));
    const rules = await Promise.all(atRest.map(compiledRule));
    expect(rules.some((r) => /overflow-wrap: ?(break-word|anywhere)/.test(r ?? ""))).toBe(true);
  });
});

describe("× before the page is live", () => {
  // onMount never runs during SSR, so this is exactly what a tap meets before
  // hydration. A native POST then would delete with no Undo toast to take it
  // back, so × must not be a submit yet.
  it("is an inert type=button inside the delete form, and never `disabled`", () => {
    const doc = renderRow("taken");
    const x = doc.querySelector<HTMLButtonElement>('button[aria-label^="Delete dose of"]');
    expect(x, "no delete button rendered").not.toBeNull();
    expect(x!.getAttribute("type")).toBe("button");
    expect(x!.hasAttribute("disabled")).toBe(false);

    const form = x!.closest("form");
    expect(form, "× is not inside a form").not.toBeNull();
    expect(form!.getAttribute("action")).toBe("?/deleteDose");
    expect(form!.getAttribute("method")?.toUpperCase()).toBe("POST");
    const doseId = form!.querySelector<HTMLInputElement>('input[type="hidden"][name="doseId"]');
    expect(doseId?.value).toBe("dose-taken");
  });

  it("marks the row with its dose id and its ✎ as the focus target", () => {
    const doc = renderRow("taken");
    const row = doc.querySelector('[role="listitem"]');
    expect(row?.getAttribute("data-dose-id")).toBe("dose-taken");
    const edit = row?.querySelector("[data-edit]");
    expect(edit?.tagName).toBe("BUTTON");
    expect(edit?.getAttribute("aria-label")).toBe("Edit dose of Vitamin D at 8:00");
  });

  it("asks nothing: no confirmation group, no 'can't be undone', no disclosure state on ×", () => {
    const doc = renderRow("taken");
    expect(doc.querySelector('[role="group"]')).toBeNull();
    expect(doc.body.textContent).not.toMatch(/can't be undone/i);
    const x = doc.querySelector('button[aria-label^="Delete dose of"]');
    expect(x?.hasAttribute("aria-expanded")).toBe(false);
    expect(x?.hasAttribute("aria-controls")).toBe(false);
  });
});

describe("status and severity chips say what they mean in words, coloured by the status owner", () => {
  const chipNamed = (doc: Document, name: string) =>
    [...doc.querySelectorAll('[role="listitem"] span')].find((s) => accessibleName(s) === name);
  const has = (el: Element, recipe: string) =>
    expect(tokens(el)).toEqual(expect.arrayContaining(recipe.split(" ")));

  it("draws a skipped dose as a neutral '– Skipped' chip, with the dash hidden from screen readers", () => {
    const chip = chipNamed(renderRow("skipped"), "Skipped");
    expect(chip, "no Skipped chip").toBeDefined();
    expect(textOf(chip!)).toBe("– Skipped");
    expect(chip!.querySelector('[aria-hidden="true"]')?.textContent).toBe("–");
    has(chip!, toneClass("neutral", "chip"));
    expect(tokens(chip!)).not.toContain("uppercase");
  });

  it("draws a missed dose as a red '✕ Missed' chip", () => {
    const chip = chipNamed(renderRow("missed"), "Missed");
    expect(chip, "no Missed chip").toBeDefined();
    expect(textOf(chip!)).toBe("✕ Missed");
    expect(chip!.querySelector('[aria-hidden="true"]')?.textContent).toBe("✕");
    has(chip!, toneClass("wrong", "chip"));
  });

  it("names each side effect's severity in words: mild and moderate neutral, severe red", () => {
    const doc = renderRow("taken", {
      sideEffects: [
        { name: "Nausea", severity: "mild" },
        { name: "Dizziness", severity: "moderate" },
        { name: "Headache", severity: "severe" },
      ],
    });
    const chips = [...doc.querySelectorAll('[role="listitem"] span')].filter((s) =>
      / · (Mild|Moderate|Severe)$/.test(textOf(s)),
    );
    expect(chips.map(textOf)).toEqual([
      "Nausea · Mild",
      "Dizziness · Moderate",
      "Headache · Severe",
    ]);
    has(chips[0], toneClass("neutral", "chip"));
    has(chips[1], toneClass("neutral", "chip"));
    has(chips[2], toneClass("wrong", "chip"));
    expect(chips[1].className).not.toMatch(/warning/);
  });

  it("prints the relative time since in neutral text, not the accent", () => {
    const since = renderRow("taken").querySelector('[role="listitem"] time')!.parentElement!;
    expect(tokens(since)).toContain("text-text-secondary");
    expect(tokens(since)).not.toContain("text-accent-ink");
  });

  it("gives × a neutral hover: removing a dose is undoable, so it is not red", () => {
    const x = renderRow("taken").querySelector('button[aria-label^="Delete dose of"]')!;
    expect(tokens(x)).toContain("hover:text-text-primary");
    expect(x.getAttribute("class")).not.toMatch(/danger/);
  });

  it("passes axe: button-name, aria-required-parent, aria-hidden-focus, aria-prohibited-attr", async () => {
    const rows = (["taken", "skipped", "missed"] as const).map((status) =>
      renderRowHtml(status, {
        sideEffects: [
          { name: "Nausea", severity: "mild" },
          { name: "Headache", severity: "severe" },
        ],
      }),
    );
    const rules = [
      "button-name",
      "aria-required-parent",
      "aria-hidden-focus",
      "aria-prohibited-attr",
    ];
    const results = await runAxe(ssrDocument(`<div role="list">${rows.join("")}</div>`), rules);
    const offenders = results.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html}`));
    expect(offenders, offenders.join("\n")).toEqual([]);
    for (const rule of rules) expect(evaluatedRules(results).has(rule), rule).toBe(true);
  });
});
