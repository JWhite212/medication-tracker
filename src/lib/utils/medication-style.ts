const GEOMETRIC_PATTERNS = new Set(["stripes", "h-stripes", "dots", "checkerboard"]);

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
