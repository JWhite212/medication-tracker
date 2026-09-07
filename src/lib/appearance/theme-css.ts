/**
 * The theme `<style>` block emitted from `(app)/+layout.svelte`.
 *
 * NO ZOD — a `.svelte` file imports this, so it is bound by
 * tests/unit/appearance-bundle-boundary.test.ts along with `registry.ts`.
 *
 * Why a string and not a component: the literal characters `</style>` in a
 * `.svelte` file break `npm run check` ("<script> was left open"), and in
 * dev vite-plugin-svelte's `code.lastIndexOf('</style>')` HMR hack appends a
 * stray ` *{}` to the CSS. Built here with the closing tag split instead.
 *
 * Why `:root:root` and not `:root`: specificity (0,2,0) beats the unlayered
 * `prefers-contrast` overrides in app.css regardless of head order. Measured
 * on the real build, SSR puts this block at head index 24 and the stylesheet
 * link at 25, while a client-side navigation appends it at 41 against a
 * stylesheet at 23 — so at equal specificity the winner FLIPS between a hard
 * load and a client nav, and a plain F5 changes the palette.
 *
 * The tables below carry only the tokens that DIFFER between schemes, and
 * both carry the same key set. `theme: "dark"` still emits them, because a
 * dark-preferring user on a light OS would otherwise be left on the layered
 * light arm. tests/unit/theme-css.test.ts pins every value against app.css.
 */
import {
  readableInk,
  INK_BACKDROP,
  INK_BACKDROP_LIGHT,
  READABLE_LIGHT,
  READABLE_DARK,
} from "$lib/utils/contrast";

export type ThemeName = "light" | "dark" | "system";

export const DARK_TOKENS: Record<string, string> = {
  "--color-glass": "rgba(255, 255, 255, 0.08)",
  "--color-glass-border": "rgba(255, 255, 255, 0.12)",
  "--color-glass-hover": "rgba(255, 255, 255, 0.14)",
  "--color-border-strong": "rgba(255, 255, 255, 0.34)",
  "--color-surface": "#0a0a0f",
  "--color-surface-raised": "#12121a",
  "--color-surface-overlay": "#1a1a25",
  "--color-text-primary": "#f0f0f5",
  "--color-text-secondary": "#c3c3d4",
  "--color-text-muted": "#9a9aac",
  "--color-accent-hover": "#4338ca",
  "--color-success": "#10b981",
  "--color-success-fg": "#111111",
  "--color-warning": "#f59e0b",
  "--color-warning-fg": "#111111",
  "--color-danger": "#ef4444",
  "--color-danger-fg": "#111111",
  "--color-danger-ink": "#f98686",
  "--color-info": "#a5a8f8",
  "--color-heatmap-0": "#1b2b2e",
  "--color-heatmap-1": "#1e5a56",
  "--color-heatmap-2": "#22867c",
  "--color-heatmap-3": "#2bb3a0",
  "--color-heatmap-4": "#54e0c4",
};

export const LIGHT_TOKENS: Record<string, string> = {
  "--color-glass": "rgba(255, 255, 255, 0.72)",
  "--color-glass-border": "rgba(0, 0, 0, 0.14)",
  "--color-glass-hover": "rgba(255, 255, 255, 0.4)",
  "--color-border-strong": "rgba(0, 0, 0, 0.46)",
  "--color-surface": "#eef0f6",
  "--color-surface-raised": "#ffffff",
  "--color-surface-overlay": "#e2e5ee",
  "--color-text-primary": "#14141c",
  "--color-text-secondary": "#4c4c63",
  "--color-text-muted": "#5c5c72",
  "--color-accent-hover": "#4338ca",
  "--color-success": "#036b4e",
  "--color-success-fg": "#ffffff",
  "--color-warning": "#7f5300",
  "--color-warning-fg": "#ffffff",
  "--color-danger": "#b41f17",
  "--color-danger-fg": "#ffffff",
  "--color-danger-ink": "#b41f17",
  "--color-info": "#3a44c4",
  "--color-heatmap-0": "#e4e7ee",
  "--color-heatmap-1": "#8fd0c1",
  "--color-heatmap-2": "#4fb3a0",
  "--color-heatmap-3": "#22907c",
  "--color-heatmap-4": "#0c6455",
};

/**
 * Four tokens, where `app.css`'s block overrides five.
 *
 * `--color-accent` is deliberately absent from both HC tables. Inside (app)
 * the layout sets it inline on the wrapper from the user's stored hex, and
 * an inline style beats this block — so a high-contrast override here would
 * be dead code. The app.css copy keeps it because that copy is what serves
 * the logged-out routes, where nothing is set inline.
 */
export const HC_DARK_TOKENS: Record<string, string> = {
  "--color-text-muted": "#ababba",
  "--color-text-secondary": "#d4d4e0",
  "--color-glass-border": "rgba(255, 255, 255, 0.24)",
  "--color-border-strong": "rgba(255, 255, 255, 0.5)",
};

export const HC_LIGHT_TOKENS: Record<string, string> = {
  "--color-text-muted": "#43435a",
  "--color-text-secondary": "#3a3a4d",
  "--color-glass-border": "rgba(0, 0, 0, 0.26)",
  "--color-border-strong": "rgba(0, 0, 0, 0.66)",
};

/**
 * Re-validated AT the interpolation site, not only at the form door.
 * Deliberately stricter than `contrast.ts`'s HEX_RE, which also accepts the
 * 3-digit form, and stricter than the column, which is a bare `text()` with
 * no CHECK — a row written by a pre-1b import can hold anything.
 */
const STRICT_HEX = /^#[0-9a-f]{6}$/i;
const FALLBACK_ACCENT = "#4f46e5";

const SCHEMES = {
  dark: {
    colorScheme: "dark",
    tokens: DARK_TOKENS,
    contrast: HC_DARK_TOKENS,
    inkBackdrop: INK_BACKDROP,
    inkOverlay: READABLE_LIGHT,
  },
  light: {
    colorScheme: "light",
    tokens: LIGHT_TOKENS,
    contrast: HC_LIGHT_TOKENS,
    inkBackdrop: INK_BACKDROP_LIGHT,
    inkOverlay: READABLE_DARK,
  },
} as const;

function declarations(tokens: Record<string, string>, indent: string): string {
  return Object.entries(tokens)
    .map(([k, v]) => `${indent}${k}: ${v};`)
    .join("\n");
}

/** One scheme's `:root:root` rule plus its high-contrast override. */
function arm(scheme: keyof typeof SCHEMES, accent: string, indent: string): string {
  const s = SCHEMES[scheme];
  const ink = readableInk(accent, { backdrop: s.inkBackdrop, overlay: s.inkOverlay });
  const body = [
    `${indent}  color-scheme: ${s.colorScheme};`,
    declarations(s.tokens, `${indent}  `),
    `${indent}  --color-accent-ink: ${STRICT_HEX.test(ink) ? ink : s.inkOverlay};`,
  ].join("\n");
  return [
    `${indent}:root:root {`,
    body,
    `${indent}}`,
    `${indent}@media (prefers-contrast: more) {`,
    `${indent}  :root:root {`,
    declarations(s.contrast, `${indent}    `),
    `${indent}  }`,
    `${indent}}`,
  ].join("\n");
}

/**
 * The whole `<style>` element, ready for `{@html}`.
 *
 * Only the whole-element `{@html}` form works — `<style>{@html css}</style>`
 * emits the literal text `{@html css}` into the stylesheet. Measured.
 */
export function buildThemeStyle(theme: ThemeName, accentColor: string): string {
  const accent = STRICT_HEX.test(accentColor) ? accentColor : FALLBACK_ACCENT;
  const css =
    theme === "system"
      ? [
          "@media (prefers-color-scheme: dark) {",
          arm("dark", accent, "  "),
          "}",
          "@media (prefers-color-scheme: light) {",
          arm("light", accent, "  "),
          "}",
        ].join("\n")
      : arm(theme, accent, "");
  return `<style id="theme-tokens">\n${css}\n</` + `style>`;
}
