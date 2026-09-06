/**
 * The single WCAG contrast implementation.
 *
 * This maths existed twice — privately in `utils/medication-style.ts` and
 * again as `accentFg()` in `routes/(app)/+layout.svelte` — with the same
 * formula written two different ways. The per-scheme accent derivation in a
 * later phase needs a third caller, so it lives here instead.
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
 * `overlay` defaults to white because most of the palette's translucency is
 * white-alpha (glass, hairlines), but the tinted `bg-danger/20`-style chips
 * composite a colour, so it is a parameter rather than a constant.
 */
export function compositeOver(
  alpha: number,
  base: string,
  overlay: string = READABLE_LIGHT,
): string {
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
 * Lighten `colour` toward white until it is legible as text on `backdrop`.
 *
 * This is what `--color-accent-ink` is: the user's chosen accent is a fill
 * colour, and most accents are far too dark to read as text on a dark page
 * (#4f46e5 is 1.99:1). The (app) layout sets the result inline alongside
 * --color-accent, so the 133 text/border/ring sites tint with the accent
 * instead of being frozen at one hue.
 *
 * Lightening is monotonic against a dark backdrop, so the first candidate
 * that clears `target` is also the most saturated one that does — the ink
 * stays as close to the user's colour as legibility allows.
 */
export function readableInk(colour: string, backdrop: string = INK_BACKDROP, target = 4.5): string {
  if (!HEX_RE.test(colour)) {
    if (import.meta.env.DEV) {
      console.warn(`[contrast] Invalid hex colour: "${colour}". Falling back to white ink.`);
    }
    return READABLE_LIGHT;
  }
  for (let step = 0; step <= 100; step++) {
    const candidate = compositeOver(step / 100, colour);
    if (contrastRatio(candidate, backdrop) >= target) return candidate;
  }
  return READABLE_LIGHT;
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
