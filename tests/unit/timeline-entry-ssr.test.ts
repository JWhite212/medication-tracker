// @vitest-environment node
//
// `@vitest-environment node` is load-bearing: the suite's default is jsdom,
// and under jsdom vite resolves `svelte` to its client entry, so `render()`
// from `svelte/server` throws `effect_orphan` before an assertion runs. Same
// reason as tests/unit/my-day-timeline-ssr.test.ts.
//
// Covers the dose row's static markup: what a skipped or missed row dims, when
// the hover-revealed controls are allowed to hide, and how big they are. The
// two-step delete is interactive and lives in
// tests/unit/timeline-entry-delete-confirm.test.ts.
import { describe, it, expect, vi } from "vitest";
import { render } from "svelte/server";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { compile } from "tailwindcss";
import type { DoseLogWithMedication } from "$lib/types";

// The delete form imports `enhance` and the toast store; neither is reachable
// on the server and neither is what these assertions are about.
vi.mock("$app/forms", () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock("$components/ui/Toast.svelte", () => ({ showToast: () => {} }));

const { default: TimelineEntry } = await import("../../src/lib/components/TimelineEntry.svelte");

type Status = DoseLogWithMedication["status"];

function makeDose(status: Status): DoseLogWithMedication {
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
  };
}

function renderRow(status: Status): Document {
  const { body } = render(TimelineEntry, {
    props: {
      dose: makeDose(status),
      timezone: "UTC",
      timeFormat: "24h" as const,
      onedit: () => {},
    },
  });
  return new JSDOM(`<!doctype html><html><body>${body}</body></html>`).window.document;
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

/**
 * Compile a class name against the real src/app.css and return the rule
 * Tailwind generates for it, or null if it generates none. Reading the
 * compiled CSS rather than the class string is the point: an arbitrary
 * variant with a typo is still a perfectly good class name, it just produces
 * no CSS, and a test of the string would pass while the controls never hid.
 */
const require = createRequire(import.meta.url);
const APP_CSS = fileURLToPath(new URL("../../src/app.css", import.meta.url));
async function compiledRule(candidate: string): Promise<string | null> {
  const compiler = await compile(readFileSync(APP_CSS, "utf8"), {
    base: dirname(APP_CSS),
    loadStylesheet: async (id: string) => {
      if (id !== "tailwindcss") throw new Error(`unexpected @import ${id}`);
      const path = require.resolve("tailwindcss/index.css");
      return { path, base: dirname(path), content: readFileSync(path, "utf8") };
    },
  });
  const css = compiler.build([candidate]);
  const selector = "." + candidate.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return null;
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  return null;
}

const HOVER_MEDIA = /@media \(hover: ?hover\)/;

describe("the row's controls hide only on devices that can hover to reveal them", () => {
  const controls = () => {
    const doc = renderRow("taken");
    const x = doc.querySelector('button[aria-label^="Delete dose of"]');
    expect(x, "no delete button rendered").not.toBeNull();
    return x!.parentElement!;
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
    const re = new RegExp(`^${prefix.replace(/[-:]/g, "\\$&")}size-(\\d+(?:\\.5)?)$`);
    const sizes = list.map((t) => t.match(re)?.[1]).filter((n): n is string => n !== undefined);
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
});
