/**
 * What counts as a hand-written status colour, in one place.
 *
 * `status-colour-owner.test.ts` scans `src/` with it, and the tests that check
 * a migrated file import it too, so "is this a status colour?" has one answer
 * and a regex tuned in one test cannot drift from the scan. The pieces below
 * are strings; `STATUS_TOKEN` is the one regex built from them.
 *
 * It is global, so read it with `String.prototype.match` or `matchAll`. Calling
 * `.test()` or `.exec()` on it keeps `lastIndex` between calls and skips
 * matches.
 */

/**
 * A status colour: a status token (`warning`, `success`, `danger`,
 * `danger-ink`, `danger-fg`, `info`), or a status hue from Tailwind's default
 * palette with a two- or three-digit shade (`amber-500`). app.css does not
 * reset the default palette, so `text-amber-500` compiles to a real amber.
 */
const STATUS = String.raw`(?:warning|success|danger-ink|danger-fg|danger|info|(?:red|rose|orange|amber|yellow|lime|green|emerald)-\d{2,3})`;

/** Every utility that takes a colour, including one side or axis of a border (`border-l`, `border-x`, `border-s`). */
const UTILITY = String.raw`(?:text|bg|border(?:-[lrtbxyse])?|ring(?:-offset)?|inset-ring|fill|stroke|from|via|to|outline|divide|decoration|shadow|inset-shadow|drop-shadow|text-shadow|accent|caret|placeholder)`;

/** An optional opacity: `/15`, `/[0.15]` or `/(--alpha)`. */
const OPACITY = String.raw`(?:\/(?:\d+(?:\.\d+)?|\[[^\]\s]+\]|\([^)\s]+\)))?`;

/**
 * A status colour in any of three spellings, with any variant prefix:
 *
 * - a class: `text-warning`, `border-l-danger-ink/50`, `bg-amber-500/[0.1]`;
 * - Tailwind v4's variable shorthand behind any utility:
 *   `text-(--color-warning)`, `bg-(color:--color-danger)/40`;
 * - an inline read, `var(--color-warning)`, which is how a style attribute
 *   escapes a class regex.
 *
 * Not caught: an arbitrary colour literal such as `bg-[#f59e0b]`. The landing
 * walkthrough draws its browser frame that way (`ChromeWindow`'s greys and
 * macOS window buttons, `WalkthroughVideo`'s backdrop) — browser chrome and
 * a stage backdrop, not app status — so that arm is deliberately left out.
 */
export const STATUS_TOKEN = new RegExp(
  String.raw`\b${UTILITY}-${STATUS}${OPACITY}(?!\w)` +
    String.raw`|\b[a-z][\w-]*-\((?:color:)?--color-${STATUS}\)${OPACITY}` +
    String.raw`|var\(--color-${STATUS}\)`,
  "g",
);

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
