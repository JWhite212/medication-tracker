/**
 * The single WCAG contrast implementation.
 *
 * This maths existed twice — privately in `utils/medication-style.ts` and
 * again as `accentFg()` in `routes/(app)/+layout.svelte` — with the same
 * formula written two different ways. The per-scheme accent derivation
 * (theme light/dark/system) is a third caller, so it lives here instead.
 *
 * It sits in `utils/` and not `server/` because both existing consumers are
 * client-reachable.
 */
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export const READABLE_DARK = "#111111";
export const READABLE_LIGHT = "#ffffff";

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function toRgb(hex: string): [number, number, number] {
  let h = hex.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function relativeLuminance(hex: string): number {
  if (!HEX_RE.test(hex)) {
    if (import.meta.env.DEV) {
      console.warn(`[contrast] Invalid hex colour: "${hex}". Defaulting to 0.`);
    }
    return 0;
  }
  const [r, g, b] = toRgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Flatten an alpha overlay onto an opaque base, as the browser would.
 *
 * Throws rather than degrading: an unguarded bad input returns a string like
 * "#23c1NaN", which `relativeLuminance` scores as 0 and `contrastRatio` then
 * reports as ~21:1 — a silent PASS in exactly the tests that exist to catch
 * an unreadable palette.
 */
export function compositeOver(
  alpha: number,
  base: string,
  overlay: string = READABLE_LIGHT,
): string {
  if (!HEX_RE.test(base)) throw new Error(`compositeOver: base is not a hex colour: "${base}"`);
  if (!HEX_RE.test(overlay)) {
    throw new Error(`compositeOver: overlay is not a hex colour: "${overlay}"`);
  }
  const top = toRgb(overlay);
  return (
    "#" +
    toRgb(base)
      .map((v, i) =>
        Math.round(top[i] * alpha + v * (1 - alpha))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

/**
 * The LIGHTEST of the six opaque surfaces a foreground is rendered on
 * (`--color-glass-hover` flattened onto `--color-surface-raised`).
 *
 * Light-on-dark contrast is worst against the lightest backdrop, so an ink
 * that clears the threshold here clears it on all six. Solving against the
 * darkest surface would be the easy end of the range and would ship an ink
 * that fails on glass.
 */
export const INK_BACKDROP = "#33333a";

/**
 * The DARKEST of the six opaque surfaces the light scheme renders on
 * (`--color-surface-overlay`).
 *
 * The operator inverts against the dark scheme's rule and for the same
 * reason: dark-on-light contrast is worst against the darkest backdrop, so
 * an ink that clears the threshold here clears it on all six.
 */
export const INK_BACKDROP_LIGHT = "#e2e5ee";

/**
 * Shift `colour` toward `overlay` until it is legible as text on `backdrop`.
 *
 * Exists for `--color-accent-ink`: a user-chosen accent is a fill colour,
 * not text, and roughly 133 text/border/ring sites depend on a legible
 * derivative of it. `accent` and `accent-ink` cannot be the same token —
 * `#4f46e5` measures 1.99:1 as text, nowhere near AA — which is the one
 * fact that stops someone "simplifying" the two back into one.
 *
 * Dark scheme: lighten toward white against the lightest surface.
 * Light scheme: darken toward black against the darkest surface.
 * Monotonic in both directions, so the first candidate that clears `target`
 * is also the closest one to the user's chosen colour.
 */
export function readableInk(
  colour: string,
  {
    backdrop = INK_BACKDROP,
    overlay = READABLE_LIGHT,
    target = 4.5,
  }: { backdrop?: string; overlay?: string; target?: number } = {},
): string {
  if (!HEX_RE.test(colour)) {
    if (import.meta.env.DEV) {
      console.warn(`[contrast] Invalid hex colour: "${colour}". Falling back to ${overlay}.`);
    }
    return overlay;
  }
  for (let step = 0; step <= 100; step++) {
    const candidate = compositeOver(step / 100, colour, overlay);
    if (contrastRatio(candidate, backdrop) >= target) return candidate;
  }
  return overlay;
}

/**
 * Pick whichever of near-black / white contrasts better against `background`,
 * and report the ratio achieved. Callers that care whether the winner is
 * actually legible must check `ratio` — the better of two failing options is
 * still a failing option.
 */
export function readableForeground(background: string): { color: string; ratio: number } {
  const light = contrastRatio(READABLE_LIGHT, background);
  const dark = contrastRatio(READABLE_DARK, background);
  return dark >= light
    ? { color: READABLE_DARK, ratio: dark }
    : { color: READABLE_LIGHT, ratio: light };
}
