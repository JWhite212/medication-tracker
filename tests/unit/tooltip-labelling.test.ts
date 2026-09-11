// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SRC = path.join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (p.endsWith(".svelte")) out.push(p);
  }
  return out;
}

/**
 * Comments are stripped before any matching. They routinely contain tag names as
 * prose — the comment explaining why one heading became a <span> rather than the
 * other thing contains that other tag name literally, which otherwise opens a
 * match running to the next real closing tag and reports the file as an offender.
 */
const stripComments = (text: string) => text.replace(/<!--[\s\S]*?-->/g, "");

const files = walk(SRC).map((f) => ({
  rel: path.relative(ROOT, f),
  text: stripComments(readFileSync(f, "utf8")),
}));
const tooltipTag = /<Tooltip\b[\s\S]*?\/>/g;

describe("Tooltip is named after the field it explains", () => {
  it("every call site passes `label`", () => {
    const missing: string[] = [];
    for (const { rel, text } of files) {
      for (const tag of text.match(tooltipTag) ?? []) {
        if (!/\blabel=/.test(tag)) missing.push(`${rel}: ${tag.replace(/\s+/g, " ").slice(0, 60)}`);
      }
    }
    // Without this every instance announces as the same bare "More info" —
    // there are twelve of them, eight on one page.
    expect(missing).toEqual([]);
  });
});

describe("Tooltip never contributes to another control's accessible name", () => {
  // A <button> inside a <label> folds its own accessible name into the labelled
  // control's. That is how `intervalHours` came to compute as "Every N hours
  // More info", along with Inventory Count, Low Stock Alert Threshold, Remind
  // me after, Then repeat, Theme and Display Density. The fix is structural —
  // the Tooltip sits BESIDE the <label>, never inside it — so the regression
  // guard has to be structural too.
  it("sits outside every <label>", () => {
    const offenders: string[] = [];
    for (const { rel, text } of files) {
      for (const label of text.match(/<label\b[^>]*>[\s\S]*?<\/label>/g) ?? []) {
        if (/<Tooltip\b/.test(label)) {
          offenders.push(`${rel}: <Tooltip> nested inside a <label>`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // A <fieldset> is named by its entire <legend> subtree, so a Tooltip in the
  // legend folds in too — and after the rename it folds in a LONGER string
  // ("Notifications More info about Notifications"). Scoping the name to a span
  // via aria-labelledby is what keeps the group's name to just its text.
  it("does not leak into a fieldset's group name via <legend>", () => {
    const offenders: string[] = [];
    for (const { rel, text } of files) {
      for (const legend of text.match(/<legend\b[^>]*>[\s\S]*?<\/legend>/g) ?? []) {
        if (!/<Tooltip\b/.test(legend)) continue;
        if (!/<span\s+id=/.test(legend)) {
          offenders.push(`${rel}: <legend> holds a <Tooltip> but no id'd <span> to name the group`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
