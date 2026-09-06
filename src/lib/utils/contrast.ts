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

/** Flatten a white-alpha overlay onto an opaque base, as the browser would. */
export function compositeOver(alpha: number, base: string): string {
  const blend = (v: number) => Math.round(255 * alpha + v * (1 - alpha));
  return (
    "#" +
    toRgb(base)
      .map((v) => blend(v).toString(16).padStart(2, "0"))
      .join("")
  );
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
