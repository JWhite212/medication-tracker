import type { AxeResults } from "axe-core";
import { JSDOM } from "jsdom";
import { expect } from "vitest";

/** Parse SSR markup into a standalone document, inside a <main> as the page nests it. */
export function ssrDocument(bodyHtml: string): Document {
  return new JSDOM(`<!doctype html><html lang="en"><body><main>${bodyHtml}</main></body></html>`)
    .window.document;
}

/**
 * Run the named axe rules against a JSDOM document. axe reads `window` and
 * `document` off the global at run time and SSR tests run in the `node`
 * environment, so they are put there for the run and taken back off.
 */
export async function runAxe(doc: Document, rules: string[]): Promise<AxeResults> {
  const axe = (await import("axe-core")).default;
  const g = globalThis as unknown as Record<string, unknown>;
  const [prevWindow, prevDocument] = [g.window, g.document];
  g.window = doc.defaultView;
  g.document = doc;
  try {
    return await axe.run(doc.body, { runOnly: { type: "rule", values: rules } });
  } finally {
    g.window = prevWindow;
    g.document = prevDocument;
  }
}

/**
 * The rules that actually evaluated something. An empty violations list is
 * vacuous if a rule found no candidate, so every caller asserts its rules
 * appear here.
 */
export function evaluatedRules(results: AxeResults): Set<string> {
  return new Set([...results.passes, ...results.violations].map((rule) => rule.id));
}

/**
 * SSR markup with Svelte's hydration comments removed. A rendered snippet
 * arrives bracketed by them (`<a …><!---->Clear filters<!----></a>`), so a
 * regex that means "the label is this element's direct text" reads this.
 */
export function withoutComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Run the named axe rules and fail on any violation, listing each offending
 * node. Also fails when a rule evaluated nothing: an empty violations list
 * is vacuous if the page never gave the rule a candidate.
 */
export async function expectAxeClean(doc: Document, rules: string[]): Promise<void> {
  const results = await runAxe(doc, rules);
  const offenders = results.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html}`));
  expect(offenders, offenders.join("\n")).toEqual([]);
  for (const rule of rules) {
    expect(evaluatedRules(results).has(rule), `${rule} evaluated nothing`).toBe(true);
  }
}
