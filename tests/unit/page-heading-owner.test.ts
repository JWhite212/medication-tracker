// The page's h1 as the last resort for focus has ONE owner: `pageHeading` in
// focus-after.ts, which `focusIfLost` focuses without scrolling. It used to
// be spelled `document.querySelector("h1")` in three places (the Undo
// registry twice, /log's row) and reached by id in a fourth (the dashboard),
// each focusing it with a plain focus() that scrolled a long page to its top,
// and there was nowhere to fix that once. Written as a scan, in the style of
// begin-dose-write.test.ts, because a single owner that is only written down
// re-accumulates copies.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const OWNER = join("src", "lib", "components", "dose-writes", "focus-after.ts");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|js|svelte)$/.test(entry)) out.push(full);
  }
  return out;
}

const sources = walk("src").map((file) => ({ file, text: readFileSync(file, "utf8") }));
const filesMatching = (pattern: RegExp) =>
  sources.filter((s) => pattern.test(s.text)).map((s) => s.file);

/**
 * A DOM lookup whose selector names an h1 element: `querySelector("h1")`,
 * with or without a type argument or quotes of either kind, a descendant
 * selector such as `"main h1"`, `querySelectorAll`, `closest`, or a tag-name
 * lookup — but not an attribute or class that merely contains "h1".
 * No file in src/ looks an h1 up for anything but focus, so there is no
 * legitimate use to exempt; one added later fails here and has to say why.
 */
const H1_LOOKUP =
  /\b(?:querySelector(?:All)?|closest)\s*(?:<[^>()]*>)?\(\s*["'`](?:[^"'`]*[\s>+~,(])?h1(?![\w-])|getElementsByTagName\(\s*["'`]h1["'`]/i;

describe("the page heading as the last resort for focus has one owner", () => {
  it("the scan recognises every way of spelling the lookup, so an empty result means something", () => {
    for (const spelling of [
      `document.querySelector<HTMLElement>("h1")`,
      `document.querySelector('h1')`,
      "document.querySelector(`h1`)",
      `root.querySelector("main h1")`,
      `document.querySelectorAll<HTMLElement>("h1")[0]`,
      `el.closest("h1")`,
      `document.getElementsByTagName("h1")[0]`,
    ]) {
      expect(H1_LOOKUP.test(spelling), spelling).toBe(true);
    }
    for (const unrelated of [
      `document.querySelector("h2")`,
      `document.querySelector("[data-h1]")`,
      `document.querySelector(".h1-title")`,
      `document.getElementById(DONE_HEADING_ID)`,
    ]) {
      expect(H1_LOOKUP.test(unrelated), unrelated).toBe(false);
    }
  });

  it("only focus-after.ts looks up the page's h1", () => {
    expect(filesMatching(H1_LOOKUP)).toEqual([OWNER]);
  });

  it("the dashboard's h1 is reached as the page heading, never by its id: the id only names it", () => {
    expect(filesMatching(/\bDASHBOARD_HEADING_ID\b/).sort()).toEqual(
      [
        join("src", "lib", "components", "dashboard", "dom-ids.ts"),
        join("src", "lib", "components", "dashboard", "DashboardHeader.svelte"),
      ].sort(),
    );
  });
});
