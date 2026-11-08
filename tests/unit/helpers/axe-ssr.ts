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
  // Defined, not assigned: under vitest 5's jsdom environment `window` and
  // `document` are getter-only on the global, so a plain assignment throws.
  // Own-property descriptors are saved and restored exactly, so a suite in
  // either environment gets its global back as it was.
  const saved = (["window", "document"] as const).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  const put = (key: string, value: unknown) =>
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  put("window", doc.defaultView);
  put("document", doc);
  try {
    return await axe.run(doc.body, { runOnly: { type: "rule", values: rules } });
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
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
 * Repeated until nothing changes, because removing one comment can join the
 * text either side of it into a new `<!--`.
 */
export function withoutComments(html: string): string {
  let prev: string;
  let next = html;
  do {
    prev = next;
    next = prev.replace(/<!--[\s\S]*?-->/g, "");
  } while (next !== prev);
  return next;
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
