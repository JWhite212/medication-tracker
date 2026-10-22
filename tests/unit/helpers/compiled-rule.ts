import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "tailwindcss";

const require = createRequire(import.meta.url);
const APP_CSS = fileURLToPath(new URL("../../../src/app.css", import.meta.url));

/**
 * The whole stylesheet Tailwind builds from the real src/app.css for these
 * candidates: the utilities they generate plus app.css's own unlayered rules,
 * such as the data-density="compact" overrides.
 */
export async function compiledCss(candidates: string[]): Promise<string> {
  const compiler = await compile(readFileSync(APP_CSS, "utf8"), {
    base: dirname(APP_CSS),
    loadStylesheet: async (id: string) => {
      if (id !== "tailwindcss") throw new Error(`unexpected @import ${id}`);
      const path = require.resolve("tailwindcss/index.css");
      return { path, base: dirname(path), content: readFileSync(path, "utf8") };
    },
  });
  return compiler.build(candidates);
}

/**
 * Compile a class name against the real src/app.css and return the rule
 * Tailwind generates for it, or null if it generates none. Reading the
 * compiled CSS rather than the class string is the point: an arbitrary
 * variant with a typo is still a perfectly good class name, it just produces
 * no CSS, and a test of the string would pass while the controls never hid.
 */
export async function compiledRule(candidate: string): Promise<string | null> {
  const css = await compiledCss([candidate]);
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
