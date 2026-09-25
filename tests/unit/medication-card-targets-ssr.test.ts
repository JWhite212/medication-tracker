// @vitest-environment node
//
// `@vitest-environment node` is load-bearing: the suite's default is jsdom,
// and under jsdom vite resolves `svelte` to its client entry, so `render()`
// from `svelte/server` throws `effect_orphan` before an assertion runs. Same
// reason as tests/unit/appearance-page-ssr.test.ts.
//
// Covers: the SSR'd markup of the Medications list's two per-row control
// groups, the card's quick-log button and the page's reorder arrows. Sizes
// are read off the Tailwind classes, because that is the only place they are
// decided; nothing here lays the page out, so a class that exists but loses
// the cascade would not be caught. The focus hand-off after a move and the
// toast on a failed log are client behaviour and are not exercised here; the
// Log button's in-flight state and the card's shrinkability are mounted in
// medication-card-targets-dom.test.ts instead.
import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import type { MedicationWithStats } from "$lib/types";
import MedicationCard from "../../src/lib/components/MedicationCard.svelte";
import MedicationsPage from "../../src/routes/(app)/medications/+page.svelte";
import { BASE_MEDICATION_ROW } from "./fixtures/medication-row";
import { JSDOM } from "jsdom";

type ListedMedication = MedicationWithStats & {
  sparkline: number[];
  refillSeverity: "critical" | "warning" | "watch" | "ok";
};

// Both status chips on at once ("Muted" and a critical "3d left"), because
// the widest header is the one the log button used to land on top of.
function medication(overrides: Partial<ListedMedication> = {}): ListedMedication {
  return {
    ...BASE_MEDICATION_ROW,
    lowInventoryEpisodeAt: null,
    lastTakenAt: null,
    weeklyDoseCount: 14,
    avgDailyConsumption: 2,
    daysUntilRefill: 3,
    expectedDailyDoses: 3,
    sparkline: [1, 2, 3, 2, 3, 3, 2, 3, 3, 3, 2, 3, 3, 3],
    refillSeverity: "critical",
    ...overrides,
  };
}

/** The opening tag of the first `<button>` carrying `attr`. */
function buttonTag(html: string, attr: string): string {
  const tag = html.match(new RegExp(`<button[^>]*${attr}[^>]*>`))?.[0];
  if (!tag) throw new Error(`no <button> carries ${attr}`);
  return tag;
}

/** Unprefixed class tokens only: a `hover:` or `sm:` size is not a resting size. */
function baseClasses(tag: string): string[] {
  const value = tag.match(/class="([^"]*)"/)?.[1] ?? "";
  return value.split(/\s+/).filter((t) => t.length > 0 && !t.includes(":"));
}

/**
 * The smallest box, in CSS px, the base classes guarantee along one axis.
 * Tailwind v4's spacing scale is 0.25rem per step, so `h-11` is 44px. Padding
 * is ignored on purpose: the old arrows were sized by `py-0.5` around a text
 * glyph, which is exactly how they ended up about 20px square.
 */
function guaranteedPx(classes: string[], axis: "h" | "w"): number {
  let px = 0;
  for (const token of classes) {
    const m = token.match(new RegExp(`^(?:min-${axis}|${axis}|size)-(\\d+(?:\\.5)?)$`));
    if (m) px = Math.max(px, Number(m[1]) * 4);
  }
  return px;
}

describe("the medication card's quick-log button", () => {
  const html = render(MedicationCard, { props: { medication: medication() } }).body;
  const LABEL = 'aria-label="Log a dose of Paracetamol"';

  it("names the action and the medication it acts on", () => {
    // "Quick log X" was the old name. Starting with the visible word keeps
    // voice control working (WCAG 2.5.3): saying "click Log" has to match.
    expect(() => buttonTag(html, LABEL)).not.toThrow();
  });

  it("is visible at rest, not only on hover or focus", () => {
    // It was opacity-0 until the card was hovered or focused. A touch screen
    // has no hover, so the button was invisible there yet still tappable,
    // a live 32px target laid over the status chips.
    const classes = buttonTag(html, LABEL)
      .match(/class="([^"]*)"/)![1]
      .split(/\s+/);
    expect(classes).not.toContain("opacity-0");
    expect(classes.filter((t) => /opacity/.test(t) && !t.startsWith("disabled:"))).toEqual([]);

    // The button being visible is not enough on its own: the "Log" span in
    // it hides while a log is in flight, and the same class on the resting
    // branch would leave an empty bordered box. So every element inside the
    // button is checked as well, prefixed variants aside.
    const inner = html.match(
      /<button[^>]*aria-label="Log a dose of Paracetamol"[^>]*>([\s\S]*?)<\/button>/,
    )![1];
    const innerClasses = [...inner.matchAll(/class="([^"]*)"/g)].flatMap((m) => baseClasses(m[0]));
    for (const hiding of ["opacity-0", "invisible", "hidden", "sr-only"]) {
      expect(innerClasses).not.toContain(hiding);
    }
  });

  it("leaves the whole card opening the medication, not only the link's own box", () => {
    // Taking the button out of the <a> narrowed the link to its own column,
    // so the strip beside and below the button highlighted on hover and did
    // nothing on click. The link's ::after is stretched over the card
    // instead, which needs the card positioned to contain it and the button
    // positioned above it to keep its own clicks.
    const link = html.match(/<a[^>]*href="\/medications\/m1"[^>]*>/)?.[0] ?? "";
    const linkClasses = link.match(/class="([^"]*)"/)?.[1].split(/\s+/) ?? [];
    expect(linkClasses).toEqual(expect.arrayContaining(["after:absolute", "after:inset-0"]));

    const card = html.match(/<div[^>]*>/)![0];
    expect(baseClasses(card)).toContain("relative");
    expect(html.indexOf(card)).toBeLessThan(html.indexOf(link));

    const button = baseClasses(buttonTag(html, LABEL));
    expect(button).toContain("relative");
    expect(button).toContain("z-10");
  });

  it("says Log in text, not with a bare plus glyph that reads as add", () => {
    const inner = html.match(
      /<button[^>]*aria-label="Log a dose of Paracetamol"[^>]*>([\s\S]*?)<\/button>/,
    )![1];
    // A real parser for the text content: a tag-stripping regex is the
    // incomplete sanitiser CodeQL flags, even in a test.
    expect(new JSDOM(inner).window.document.body.textContent?.trim()).toBe("Log");
  });

  it("sits in the flow beside the card's link, so it cannot cover the status chips", () => {
    // Absolutely positioned, it was painted over whatever the header put in
    // the top-right corner, which is where the chips live.
    const tag = buttonTag(html, LABEL);
    expect(baseClasses(tag)).not.toContain("absolute");
    // And outside the <a>: a button inside a link is invalid HTML, and the
    // chips it must not collide with are still inside the link.
    const linkEnd = html.indexOf("</a>");
    expect(html.indexOf("Muted")).toBeLessThan(linkEnd);
    expect(html.indexOf("3d left")).toBeLessThan(linkEnd);
    expect(html.indexOf(tag)).toBeGreaterThan(linkEnd);
  });

  it("is a 44px touch target in both directions", () => {
    const classes = baseClasses(buttonTag(html, LABEL));
    expect(guaranteedPx(classes, "h")).toBeGreaterThanOrEqual(44);
    expect(guaranteedPx(classes, "w")).toBeGreaterThanOrEqual(44);
  });

  it("draws its resting boundary with the control border, not the decorative hairline", () => {
    const classes = baseClasses(buttonTag(html, LABEL));
    expect(classes).toContain("border");
    expect(classes).toContain("border-border-strong");
    expect(classes).not.toContain("border-glass-border");
  });
});

describe("the medications list's reorder buttons", () => {
  const medications = [
    medication({ id: "m1", name: "Paracetamol" }),
    medication({ id: "m2", name: "Ibuprofen" }),
    medication({ id: "m3", name: "Cetirizine" }),
  ];
  const user = {
    id: "u1",
    email: "person@example.com",
    name: "Test Person",
    avatarUrl: null,
    timezone: "UTC",
    twoFactorEnabled: false,
    emailVerified: true,
  };
  const preferences = {
    userId: "u1",
    accentColor: "#6366f1",
    theme: "system",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "12h",
    uiDensity: "comfortable",
    reducedMotion: false,
    overdueEmailReminders: true,
    overduePushReminders: true,
    lowInventoryEmailAlerts: true,
    lowInventoryPushAlerts: true,
    doseLogPageSize: 20,
    heatmapPeriod: 90,
    exportFormat: "csv",
    updatedAt: new Date("2026-08-01T00:00:00Z"),
  };
  // `user` and `preferences` come from the (app) layout load; svelte-check
  // enforces the merged PageData even though this page reads neither.
  const html = render(MedicationsPage, {
    props: { data: { user, preferences, medications, archived: [] } },
  }).body;

  const buttons = medications.flatMap((m, i) => [
    {
      id: `move-${m.id}-up`,
      name: `Move ${m.name} up`,
      disabled: i === 0,
    },
    {
      id: `move-${m.id}-down`,
      name: `Move ${m.name} down`,
      disabled: i === medications.length - 1,
    },
  ]);

  for (const { id, name, disabled } of buttons) {
    describe(id, () => {
      it("keeps the id the post-move focus hand-off looks up, and its name", () => {
        const tag = buttonTag(html, `id="${id}"`);
        expect(tag).toContain(`aria-label="${name}"`);
        expect(/\sdisabled(?:=""|\s|>)/.test(tag)).toBe(disabled);
      });

      it("meets the 24px minimum target size (WCAG 2.5.8) and is 44px tall", () => {
        // They were px-1.5 py-0.5 around a text-xs glyph, roughly 20px square
        // and stacked 2px apart, so their 24px spacing circles overlapped too.
        const classes = baseClasses(buttonTag(html, `id="${id}"`));
        expect(guaranteedPx(classes, "w")).toBeGreaterThanOrEqual(24);
        expect(guaranteedPx(classes, "h")).toBeGreaterThanOrEqual(44);
      });
    });
  }

  it("still has the live region the move is announced through", () => {
    expect(html).toMatch(/<p class="sr-only" role="status">/);
  });
});
