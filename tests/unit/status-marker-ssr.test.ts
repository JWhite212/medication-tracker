// @vitest-environment node
//
// The marker is the ONLY thing that says whether a dose was taken, skipped,
// missed, is overdue, due now or still to come, so its accessible name is
// load-bearing. An aria-label on a bare <span> is prohibited (`generic` does
// not support naming) and is DISCARDED — confirmed on production by
// Lighthouse (`aria-prohibited-attr`, nine failing nodes on /dashboard).
// `node` is load-bearing: see tests/unit/error-page-ssr.test.ts.
import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import StatusMarker from "$lib/components/dashboard/StatusMarker.svelte";
import {
  STATUS_MARKER_LABELS,
  STATUS_MARKER_STATES,
  type StatusMarkerState,
} from "$lib/components/dashboard/status-marker";
import { evaluatedRules, runAxe, ssrDocument } from "./helpers/axe-ssr";

/** The marker label table. A new state fails the first test until it is added here. */
const SPEC: Record<StatusMarkerState, { label: string; classes: string[] }> = {
  taken: { label: "Taken", classes: ["bg-success/20", "text-success"] },
  overdue: { label: "Overdue", classes: ["bg-warning/20", "text-warning"] },
  "due-now": { label: "Due now", classes: ["ring-2", "ring-accent-ink"] },
  upcoming: { label: "Upcoming", classes: ["border", "border-border-strong"] },
  skipped: { label: "Skipped", classes: ["border", "border-border-strong", "text-text-secondary"] },
  missed: { label: "Missed", classes: ["border", "border-border-strong", "text-text-secondary"] },
};

const renderMarker = (state: StatusMarkerState) => render(StatusMarker, { props: { state } }).body;
const withoutComments = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "").trim();
const outerTag = (html: string) => withoutComments(html).match(/^<span[^>]*>/)?.[0] ?? "";
const classesOf = (tag: string) => tag.match(/\bclass="([^"]*)"/)?.[1].split(/\s+/) ?? [];
const glyphOf = (html: string) =>
  withoutComments(html)
    .replace(/^<span[^>]*>/, "")
    .replace(/<\/span>$/, "")
    .trim();

describe("StatusMarker", () => {
  it("covers exactly the states in the label table, each with its label", () => {
    const labels = Object.fromEntries(
      STATUS_MARKER_STATES.map((s) => [s, STATUS_MARKER_LABELS[s]]),
    );
    const expected = Object.fromEntries(Object.entries(SPEC).map(([s, v]) => [s, v.label]));
    expect(labels).toEqual(expected);
  });

  for (const state of STATUS_MARKER_STATES) {
    it(`gives the ${state} marker a name assistive technology will actually read`, () => {
      const tag = outerTag(renderMarker(state));
      expect(tag).toContain(`aria-label="${SPEC[state].label}"`);
      expect(tag).toContain('role="img"');
    });

    it(`draws the ${state} marker with its colour and ring classes from the table`, () => {
      const classes = classesOf(outerTag(renderMarker(state)));
      expect(classes).toEqual(
        expect.arrayContaining(["h-5", "w-5", "rounded-full", ...SPEC[state].classes]),
      );
    });
  }

  it("never leaves an aria-label on an element without a role, whatever the state", () => {
    const html = STATUS_MARKER_STATES.map(renderMarker).join("");
    const bare = html.match(/<span(?![^>]*\brole=)[^>]*\saria-label=/g) ?? [];
    expect(bare, `spans carrying aria-label without a role: ${bare.join(", ")}`).toEqual([]);
  });

  it("gives every state its own shape, so status never rests on colour alone", () => {
    const glyphs = new Map(STATUS_MARKER_STATES.map((s) => [s, glyphOf(renderMarker(s))]));
    const distinct = ["taken", "overdue", "due-now", "upcoming", "skipped"] as const;
    expect(new Set(distinct.map((s) => glyphs.get(s))).size).toBe(distinct.length);
    // A missed row is rendered exactly like a skip: a decision, not a problem.
    expect(glyphs.get("missed")).toBe(glyphs.get("skipped"));
    expect(glyphs.get("due-now")).toContain("bg-accent-ink");
    expect(glyphs.get("upcoming")).toBe("");
  });

  it("passes axe's own aria-prohibited-attr rule", async () => {
    const doc = ssrDocument(`<div>${STATUS_MARKER_STATES.map(renderMarker).join("")}</div>`);
    const results = await runAxe(doc, ["aria-prohibited-attr"]);
    const offenders = results.violations.flatMap((v) => v.nodes.map((n) => n.html));
    expect(offenders, offenders.join("\n")).toEqual([]);
    expect(evaluatedRules(results).has("aria-prohibited-attr")).toBe(true);
  });
});
