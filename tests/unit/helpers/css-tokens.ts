/**
 * The body of the first block whose header matches `opener`, brace-balanced.
 *
 * A regex cannot do this once the light arm nests a `prefers-contrast` block
 * inside a `prefers-color-scheme` block — the lazy `[\s\S]*?` stops at the
 * first inner `}`.
 */
export function blockBody(css: string, opener: RegExp, label: string): string {
  const m = opener.exec(css);
  if (!m) throw new Error(`Could not find ${label} in src/app.css`);
  const start = css.indexOf("{", m.index + m[0].length - 1);
  let depth = 0;
  for (let i = start; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start + 1, i);
  }
  throw new Error(`Unbalanced braces in ${label}`);
}

export function parseDeclarations(body: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const m = line.match(/^\s*(--[\w-]+):\s*(.+?);\s*$/);
    if (m) tokens[m[1]] = m[2].trim();
  }
  return tokens;
}
