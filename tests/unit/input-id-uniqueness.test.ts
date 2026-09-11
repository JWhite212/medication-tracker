// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SRC = path.join(ROOT, "src");
const INPUT_COMPONENT = path.join(SRC, "lib/components/ui/Input.svelte");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (p.endsWith(".svelte")) out.push(p);
  }
  return out;
}

/** Every `<Input ... />` tag in a file, including multi-line ones. */
function inputTags(text: string): string[] {
  return [...text.matchAll(/<Input\b[\s\S]*?\/>/g)].map((m) => m[0]);
}

function literalAttr(tag: string, attr: string): string | null {
  const m = tag.match(new RegExp(`\\b${attr}="([^"]*)"`));
  return m ? m[1] : null;
}

/** `id="x"` or `id={expr}` — anything that overrides the `id = name` default. */
function hasExplicitId(tag: string): boolean {
  return /\bid=(?:"[^"]*"|\{)/.test(tag);
}

describe("ui/Input.svelte id binding", () => {
  const source = readFileSync(INPUT_COMPONENT, "utf8");

  it("accepts an `id` prop that falls back to `name`", () => {
    expect(source).toMatch(/\bid\s*=\s*name\b/);
  });

  // These three are the whole point of the prop. If any reverts to `name`,
  // a caller-supplied id silently desynchronises from what it labels:
  // the <label for> would dangle and the input would keep the colliding id.
  it("labels, identifies and describes the input from `id`, never `name`", () => {
    expect(source).toMatch(/<label\s+for=\{id\}/);
    expect(source).toMatch(/<input\s+\{id\}/);
    expect(source).not.toMatch(/<label\s+for=\{name\}/);
    expect(source).not.toMatch(/\bid=\{name\}/);
    // Error text is referenced by aria-describedby, so its id must track the
    // same value or two same-named fields cross-wire their error messages.
    expect(source).not.toMatch(/\$\{name\}-error/);
    expect(source.match(/\$\{id\}-error/g) ?? []).toHaveLength(2);
  });
});

describe("no page mounts two same-named <Input> that both take the default id", () => {
  // The DOM id defaults to `name`. Two Inputs sharing a name therefore share an
  // id unless all but one override it — and `getElementById` resolves every
  // matching `<label for>` to the FIRST such input, leaving the rest with no
  // accessible name. settings/security shipped exactly that on its 2FA password
  // fields: three `currentPassword` inputs, one id, two unlabelled controls.
  //
  // This check is deliberately BRANCH-BLIND: it groups by name across the whole
  // file without asking whether two tags can actually co-render. That over-reports
  // mutually exclusive {#if}/{:else} arms — settings/security's two `code` inputs
  // are one such pair. The alternative is static branch analysis, which is far
  // more fragile than the one attribute it would save, and the cost of a false
  // positive here is an explicit id on a field that did not strictly need one.
  // Exclusivity is also not stable over time: an {:else if} can become a sibling
  // in a later refactor, and then the collision is real and silent.
  const offenders: string[] = [];

  for (const file of walk(SRC)) {
    const tags = inputTags(readFileSync(file, "utf8"));
    if (tags.length < 2) continue;

    const byName = new Map<string, string[]>();
    for (const tag of tags) {
      const name = literalAttr(tag, "name");
      if (!name) continue; // dynamic name — not statically groupable
      byName.set(name, [...(byName.get(name) ?? []), tag]);
    }

    for (const [name, group] of byName) {
      if (group.length < 2) continue;
      const defaulted = group.filter((t) => !hasExplicitId(t)).length;
      if (defaulted > 1) {
        offenders.push(
          `${path.relative(ROOT, file)}: ${defaulted} of ${group.length} <Input name="${name}"> ` +
            `rely on the default id — at most one may`,
        );
      }
    }
  }

  it("finds no collisions", () => {
    expect(offenders).toEqual([]);
  });
});
