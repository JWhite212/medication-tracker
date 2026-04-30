const GEOMETRIC_PATTERNS = new Set(["stripes", "h-stripes", "dots", "checkerboard"]);

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function relativeLuminance(hex: string): number {
  if (!HEX_RE.test(hex)) {
    if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
      console.warn(`[relativeLuminance] Invalid hex colour: "${hex}". Defaulting to 0.`);
    }
    return 0;
  }
  let h = hex.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const r = lin(parseInt(h.slice(0, 2), 16));
  const g = lin(parseInt(h.slice(2, 4), 16));
  const b = lin(parseInt(h.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(L1: number, L2: number): number {
  const [hi, lo] = L1 >= L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

const READABLE_DARK = "#111111";
const READABLE_LIGHT = "#ffffff";
const DARK_LUM = relativeLuminance(READABLE_DARK);
const LIGHT_LUM = 1;

/**
 * Pick a foreground colour with the best worst-case contrast against
 * one or two background colours (for split/gradient patterns). The
 * `textShadow` is a multi-directional 1px outline in the opposite tone
 * so text stays readable across pattern boundaries (stripes, dots, etc.)
 * regardless of which side of the boundary a glyph crosses.
 */
export function getReadableTextColor(
  c1: string,
  c2?: string | null,
): { color: string; textShadow: string } {
  const colours = c2 && c2 !== c1 ? [c1, c2] : [c1];
  const lums = colours.map(relativeLuminance);
  const whiteMin = Math.min(...lums.map((L) => contrastRatio(LIGHT_LUM, L)));
  const darkMin = Math.min(...lums.map((L) => contrastRatio(DARK_LUM, L)));
  const useDark = darkMin >= whiteMin;
  const outline = useDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.6)";
  return {
    color: useDark ? READABLE_DARK : READABLE_LIGHT,
    textShadow: `-1px -1px 0 ${outline}, 1px -1px 0 ${outline}, -1px 1px 0 ${outline}, 1px 1px 0 ${outline}`,
  };
}

export function getMedicationBackground(
  colour: string,
  colourSecondary: string | null | undefined,
  pattern: string,
  small = false,
): string {
  const c1 = colour;
  const c2 = colourSecondary || colour;

  if (!colourSecondary || pattern === "solid") return c1;

  // Smart fallback: geometric patterns render as gradient at small sizes (<20px)
  const effectivePattern = small && GEOMETRIC_PATTERNS.has(pattern) ? "gradient" : pattern;

  switch (effectivePattern) {
    case "split":
      return `linear-gradient(90deg, ${c1} 50%, ${c2} 50%)`;
    case "gradient":
      return `linear-gradient(135deg, ${c1}, ${c2})`;
    case "stripes":
      return `repeating-linear-gradient(45deg, ${c1}, ${c1} 4px, ${c2} 4px, ${c2} 8px)`;
    case "h-stripes":
      return `repeating-linear-gradient(0deg, ${c1}, ${c1} 4px, ${c2} 4px, ${c2} 8px)`;
    case "dots":
      return `radial-gradient(circle 3px, ${c2} 100%, transparent 100%) 0 0/10px 10px, ${c1}`;
    case "checkerboard":
      return `conic-gradient(${c1} 25%, ${c2} 25% 50%, ${c1} 50% 75%, ${c2} 75%) 0 0/14px 14px`;
    case "radial":
      return `radial-gradient(circle at 30% 30%, ${c2}, ${c1})`;
    default:
      return c1;
  }
}

export const PATTERN_OPTIONS = [
  { id: "solid", name: "Solid" },
  { id: "split", name: "Split" },
  { id: "gradient", name: "Gradient" },
  { id: "stripes", name: "Diagonal Stripes" },
  { id: "h-stripes", name: "Horizontal Stripes" },
  { id: "dots", name: "Polka Dots" },
  { id: "checkerboard", name: "Checkerboard" },
  { id: "radial", name: "Radial" },
] as const;
