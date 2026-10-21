/**
 * What counts as a hand-written status colour, in one place.
 *
 * `status-colour-owner.test.ts` scans `src/` with it, and the tests that check
 * a migrated file import it too, so "is this a status colour?" has one answer
 * and a regex tuned in one test cannot drift from the scan.
 *
 * A status token is `warning`, `success`, `danger`, `danger-ink`, `danger-fg`
 * or `info` behind any colour utility, with any variant prefix and any
 * opacity, or the same token read inline as `var(--color-…)`, which is how a
 * style attribute escapes a class regex.
 *
 * It is global, so read it with `String.prototype.match` or `matchAll`. Calling
 * `.test()` or `.exec()` on it keeps `lastIndex` between calls and skips
 * matches.
 */
export const STATUS_TOKEN =
  /\b(?:(?:text|bg|border|ring|fill|stroke|from|to|outline|divide|decoration)-(?:warning|success|danger-ink|danger-fg|danger|info)(?:\/\d+)?\b|var\(--color-(?:warning|success|danger-ink|danger-fg|danger|info)\))/g;

/**
 * A field-error line, `<p id="{name}-error" …>`, which the spec keeps as it is
 * (Non-goals). Three spellings exist: a quoted id, a template-literal id
 * (`id={`${id}-error`}`), and either one on a line of its own after `<p`.
 * A tag that carries a `bg-` fill is a banner that happens to have an -error
 * id (`settings/security`'s `totp-error`), not a field line, so it is NOT
 * masked and still has to be migrated.
 */
const FIELD_ERROR_OPEN = /<p\s[^>]*?\bid=(?:"[^"]*-error"|\{`[^`]*-error`\})[^>]*>/g;

/** `source` with every field-error line's opening tag removed, so its colours are not read as status colour. */
export function maskFieldErrors(source: string): string {
  return source.replace(FIELD_ERROR_OPEN, (tag) => (/\bbg-/.test(tag) ? tag : ""));
}
