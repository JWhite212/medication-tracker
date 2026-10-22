// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { STATUS_TOKEN, maskFieldErrors } from "./helpers/status-token";

/**
 * Status colour has one owner, `src/lib/utils/status-tone.ts`, and this scan
 * keeps it that way. Before the owner, every component chose its own amber,
 * which is how amber came to mean about twenty things and a 35% adherence
 * printed green. It is a scan rather than prose for the reason
 * server-log.test.ts gives: a rule that is only written down re-accumulates.
 *
 * What counts as a status colour, and which field-error lines the spec keeps
 * as they are, is decided by `helpers/status-token.ts`. The exemption list is
 * two-way: a file that stops matching must leave it, so a stale entry
 * fails as loudly as a new offender.
 */

/** Permanent. Each entry says which part of the spec keeps it. */
const EXEMPT: { file: string; why: string }[] = [
  {
    file: "src/lib/utils/status-tone.ts",
    why: "The owner: every status class is spelled here and nowhere else.",
  },
  {
    file: "src/lib/components/ui/Button.svelte",
    why: "The danger variant (bg-danger text-danger-fg), used only inside DestructiveConfirm.",
  },
  {
    file: "src/lib/components/ui/Toast.svelte",
    why: "Spec Non-goals: Toast is unchanged. Its colours already obey the rules and its markup is pinned.",
  },
  {
    file: "src/lib/components/ui/Input.svelte",
    why: "The field's error border and the required asterisk. Spec Non-goals keep form inputs and field errors as they are.",
  },
  {
    file: "src/lib/components/walkthrough/parts/FieldBox.svelte",
    why: "Draws Input's required asterisk on the landing stage, so it follows Input's exemption.",
  },
  {
    file: "src/lib/components/walkthrough/parts/dashboard/StageUndoOffer.svelte",
    why: "Draws Toast's Undo offer with Toast.svelte's own classes, so it follows Toast's exemption.",
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|svelte)$/.test(entry)) out.push(full.split(/[\\/]/).join("/"));
  }
  return out;
}

/** file -> the status classes it writes, field-error lines masked. */
const MATCHING = new Map(
  walk("src")
    .map(
      (file) =>
        [file, maskFieldErrors(readFileSync(file, "utf8")).match(STATUS_TOKEN) ?? []] as const,
    )
    .filter(([, found]) => found.length > 0),
);
const EXEMPT_FILES = new Set(EXEMPT.map((e) => e.file));

describe("the field-error mask", () => {
  it("hides a field-error line in each of its spellings", () => {
    for (const tag of [
      '<p id="email-error" class="text-danger-ink mt-1 text-sm" role="alert">',
      '<p\n        id="schedules-error"\n        class="text-danger-ink mt-1 text-sm"\n        role="alert"\n      >',
      '<p id={`${id}-error`} class="text-danger-ink mt-1 text-sm" role="alert">',
    ]) {
      expect(maskFieldErrors(tag).match(STATUS_TOKEN)).toBeNull();
    }
  });

  it("leaves a banner that happens to carry an -error id", () => {
    const banner =
      '<p\n  id="totp-error"\n  class="bg-danger/10 text-danger-ink mb-4 rounded-lg px-4 py-2 text-sm"\n  role="alert"\n>';
    expect(maskFieldErrors(banner).match(STATUS_TOKEN)).toEqual([
      "bg-danger/10",
      "text-danger-ink",
    ]);
  });

  it("does not hide an inline status colour, which a class regex alone would miss", () => {
    expect(
      'color: "var(--color-success)", ring: "var(--color-danger-ink)"'.match(STATUS_TOKEN),
    ).toEqual(["var(--color-success)", "var(--color-danger-ink)"]);
  });
});

/**
 * What the scan sees, pinned, so a later edit to the regex cannot quietly
 * narrow it. Each must-match row is a spelling that compiles to real CSS
 * under this app's Tailwind (app.css does not reset the default palette), so
 * a miss is a way to invent amber with the suite green. The must-not-match
 * rows are the app's own neutral and accent classes, which share words with
 * the status tokens.
 */
describe("what counts as a status colour", () => {
  const MUST_MATCH: [source: string, found: string[]][] = [
    // The six tokens behind the colour utilities, with variants and opacities.
    ["text-warning", ["text-warning"]],
    ["bg-danger/10", ["bg-danger/10"]],
    ["md:hover:text-danger-fg", ["text-danger-fg"]],
    ["border-danger-ink/35", ["border-danger-ink/35"]],
    ["ring-success fill-info", ["ring-success", "fill-info"]],
    ["stroke-warning outline-danger", ["stroke-warning", "outline-danger"]],
    ["divide-success decoration-warning", ["divide-success", "decoration-warning"]],
    ["from-warning via-danger to-success", ["from-warning", "via-danger", "to-success"]],
    // One side or one axis of a border.
    ["border-l-warning", ["border-l-warning"]],
    ["border-t-danger-ink/50", ["border-t-danger-ink/50"]],
    ["border-x-success border-y-info", ["border-x-success", "border-y-info"]],
    ["border-r-danger border-b-warning", ["border-r-danger", "border-b-warning"]],
    ["border-s-warning border-e-danger", ["border-s-warning", "border-e-danger"]],
    // A side letter that is also a token's first letter is not a side.
    ["border-success border-emerald-500", ["border-success", "border-emerald-500"]],
    ["border-red-500 border-r-red-500", ["border-red-500", "border-r-red-500"]],
    // Shadows, rings and form-control colours.
    ["shadow-warning/20", ["shadow-warning/20"]],
    ["inset-shadow-danger drop-shadow-warning", ["inset-shadow-danger", "drop-shadow-warning"]],
    ["text-shadow-success", ["text-shadow-success"]],
    ["ring-offset-danger inset-ring-warning", ["ring-offset-danger", "inset-ring-warning"]],
    ["accent-warning caret-danger", ["accent-warning", "caret-danger"]],
    ["placeholder-warning", ["placeholder-warning"]],
    // Arbitrary and variable opacities.
    ["hover:bg-warning/[0.08]", ["bg-warning/[0.08]"]],
    ["text-warning/[0.15]", ["text-warning/[0.15]"]],
    ["bg-danger/(--alpha)", ["bg-danger/(--alpha)"]],
    // Tailwind v4's variable shorthand, behind any utility.
    ["text-(--color-warning)", ["text-(--color-warning)"]],
    ["bg-(color:--color-danger)/40", ["bg-(color:--color-danger)/40"]],
    ["border-l-(--color-success)/[0.2]", ["border-l-(--color-success)/[0.2]"]],
    ["hover:shadow-(--color-danger-ink)", ["shadow-(--color-danger-ink)"]],
    // An inline read, which a class regex alone would miss.
    ['style="color: var(--color-warning)"', ["var(--color-warning)"]],
    // Tailwind's default palette, in the status hues.
    ["text-amber-500 bg-red-600", ["text-amber-500", "bg-red-600"]],
    ["text-green-500 border-rose-300/50", ["text-green-500", "border-rose-300/50"]],
    ["from-orange-50 fill-yellow-400", ["from-orange-50", "fill-yellow-400"]],
    ["ring-emerald-700 hover:bg-lime-950", ["ring-emerald-700", "bg-lime-950"]],
    ["text-(--color-amber-500)", ["text-(--color-amber-500)"]],
    ["fill: var(--color-red-500)", ["var(--color-red-500)"]],
  ];

  const MUST_NOT_MATCH = [
    "text-dangerous",
    "bg-accent",
    "bg-accent/15",
    "text-accent-ink ring-accent-ink accent-accent",
    "text-text-secondary text-text-primary text-text-muted",
    "border-border-strong border-l-border-strong border-glass-border",
    "bg-surface bg-surface-raised placeholder-text-muted",
    "shadow-2xl drop-shadow-lg caret-transparent",
    "border-l-4 border-x",
    "text-red bg-amber text-green-5000",
    'variant="danger" tone="wrong"',
    "var(--color-text-secondary)",
  ];

  it.each(MUST_MATCH)("finds %s", (source, found) => {
    expect(source.match(STATUS_TOKEN)).toEqual(found);
  });

  it.each(MUST_NOT_MATCH)("ignores %s", (source) => {
    expect(source.match(STATUS_TOKEN)).toBeNull();
  });
});

describe("status colour is written only by its owner", () => {
  it("every file that writes a status class is exempt", () => {
    const offenders = [...MATCHING]
      .filter(([file]) => !EXEMPT_FILES.has(file))
      .map(([file, found]) => `${file}: ${[...new Set(found)].join(" ")}`);
    expect(offenders).toEqual([]);
  });

  it("every exemption still writes one, so the list cannot rot", () => {
    expect(EXEMPT.map((e) => e.file).filter((file) => !MATCHING.has(file))).toEqual([]);
  });

  it("each exemption says why", () => {
    expect(EXEMPT.filter((e) => e.why.trim() === "")).toEqual([]);
  });
});
