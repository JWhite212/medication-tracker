# Appearance 1a — Accessibility and Token Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the dark palette's measured WCAG failures, split the accent into fill and ink roles, and retire every hardcoded colour that would break a second palette — with no new user-facing options.

**Architecture:** All colour decisions move behind `@theme` tokens in `src/app.css`. The WCAG luminance maths, currently implemented twice, collapses into one `src/lib/utils/contrast.ts` consumed by both call sites. A table-driven unit test parses the real `@theme` block and asserts every foreground/surface pair, so the palette can never silently regress. No behaviour changes, no schema changes, no new dependencies.

**Tech Stack:** SvelteKit 2.57, Svelte 5.55.4 (runes), Tailwind CSS v4.2.2 (`@theme`), Vitest 4, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-06-appearance-customization-design.md` (PR 1a section, plus Decisions 1, 4 and 5)

## Global Constraints

- **Svelte 5 runes only.** `$props()`, `$state()`, `$derived()`, `$effect()`. No `export let`.
- **Never hand-edit `drizzle/` migrations.** This PR touches no schema at all.
- **`npm run check` must stay clean.** It reports 3 pre-existing errors from `@electric-sql/pglite` being absent from this worktree's `node_modules`. That is the baseline — 3 errors, not 0. Any 4th is yours.
- **Prettier runs on commit** via husky + lint-staged. Do not fight it; run `npx prettier --write` on files you touch if a commit reformats them.
- **`--color-accent` and `--color-accent-fg` are set as inline styles** on a wrapper div at `src/routes/(app)/+layout.svelte:37-42`. Inline beats every stylesheet rule. Any token you expect to override the accent inside the `(app)` group will not work — this is why Task 4 exists.
- **Tailwind v4 generates utilities from `@theme` names.** Adding `--color-accent-ink` generates `text-accent-ink`, `bg-accent-ink`, `border-accent-ink` automatically. You do not register anything.
- **Tailwind v4 tree-shakes `@theme` variables** — only tokens referenced by a generated utility are emitted to `:root`. A token used exclusively from hand-written CSS has no base value. Every token added here is consumed by a utility class.
- Run all commands from the worktree root: `/Users/jamiewhite/Documents/Personal/Projects/medication-tracker/.claude/worktrees/appearance-customization-analysis-d18682`.

---

## File Structure

**Created**

| File                              | Responsibility                                                                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/utils/contrast.ts`       | The only WCAG luminance/contrast/compositing implementation. In `utils/` not `server/` because both consumers are client-reachable. |
| `tests/unit/contrast.test.ts`     | Unit tests for the above.                                                                                                           |
| `tests/unit/theme-tokens.test.ts` | Parses the real `@theme` block from `src/app.css` and asserts every foreground/surface pair. The palette's regression guard.        |

**Modified**

| File                                        | Change                                                                                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app.css`                               | Token values fixed; 9 tokens added; dead `count-up` keyframe removed; compact-mode `padding` shorthand fixed; `color-scheme: dark` added. |
| `src/lib/utils/medication-style.ts`         | Drops its private luminance maths, imports `contrast.ts`. Public API unchanged.                                                           |
| `src/routes/(app)/+layout.svelte`           | Drops its private `accentFg()`, imports `contrast.ts`. Mounts `<Toast/>`. Loses the inert `transition-transform`.                         |
| `src/lib/components/Heatmap.svelte`         | Hardcoded emerald ramp and `bg-gray-900` tooltip move onto tokens; reduced-motion rule gets `:global()`.                                  |
| `src/lib/components/ui/Toast.svelte`        | `browser` guard on `showToast`; comment recording the single-mount rule.                                                                  |
| `src/routes/(app)/dashboard/+page.svelte`   | `<Toast/>` mount removed; hand-rolled empty-state card replaced with `EmptyState`.                                                        |
| 13 files with `text-white`                  | Routed to `text-accent-fg` / `text-danger-fg`.                                                                                            |
| ~40 files with `text-accent`                | Text and border uses routed to the new ink token.                                                                                         |
| `src/app.html`, `src/routes/+layout.svelte` | Document-shell tokens and `theme-color` media variants.                                                                                   |

---

## Verified values used in this plan

Computed with the same WCAG relative-luminance formula this PR extracts into `contrast.ts`, against all six real surfaces — `#0a0a0f`, `#12121a`, `#1a1a25`, and the three white-alpha glass composites `#1e1e22`, `#25252c`, `#33333a`. `min` is the worst of the six.

| Token                      | Current   | min now         | New       | min after           |
| -------------------------- | --------- | --------------- | --------- | ------------------- |
| `--color-text-secondary`   | `#8888a0` | 3.63            | `#c3c3d4` | **7.21**            |
| `--color-text-muted`       | `#71718a` | 2.64            | `#9a9aac` | **4.53**            |
| `--color-danger` (as text) | `#ef4444` | 3.33            | `#f37474` | **4.51**            |
| `--color-accent` (as fill) | `#6366f1` | white-on = 4.47 | `#4f46e5` | white-on = **6.29** |
| `--color-accent-ink` (new) | —         | —               | `#8f92f5` | **4.54**            |

The accent row is the empirical proof of the spec's Decision 4: `#4f46e5` scores **1.99:1 used as text**, and `#8f92f5` scores **2.76:1 with white on it**. No single value satisfies both roles — the split is forced, not stylistic.

Text ramp hierarchy is preserved and improved: the secondary:muted luminance ratio goes from 1.48× to **1.68×**.

---

### Task 1: Shared contrast module

**Files:**

- Create: `src/lib/utils/contrast.ts`
- Create: `tests/unit/contrast.test.ts`
- Modify: `src/lib/utils/medication-style.ts:1-32` (delete private maths, import instead)
- Modify: `src/routes/(app)/+layout.svelte:14-30` (delete `accentFg`, import instead)

**Interfaces:**

- Consumes: nothing.
- Produces: `relativeLuminance(hex: string): number`, `contrastRatio(a: string, b: string): number`, `compositeOver(alpha: number, base: string): string`, `readableForeground(background: string): { color: string; ratio: number }`, and the constants `READABLE_DARK = "#111111"`, `READABLE_LIGHT = "#ffffff"`. Tasks 2 and 3 depend on these names.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/contrast.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  relativeLuminance,
  contrastRatio,
  compositeOver,
  readableForeground,
  READABLE_DARK,
  READABLE_LIGHT,
} from "$lib/utils/contrast";

describe("relativeLuminance", () => {
  it("returns 0 for black and 1 for white", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });

  it("expands three-digit hex", () => {
    expect(relativeLuminance("#fff")).toBeCloseTo(relativeLuminance("#ffffff"), 10);
  });

  it("returns 0 for an invalid hex rather than NaN", () => {
    expect(relativeLuminance("not-a-colour")).toBe(0);
  });
});

describe("contrastRatio", () => {
  it("is 21:1 for black on white and symmetric", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 2);
  });

  it("is 1:1 for a colour against itself", () => {
    expect(contrastRatio("#6366f1", "#6366f1")).toBeCloseTo(1, 10);
  });

  it("reproduces the measured accent-fg failure this PR fixes", () => {
    // #6366f1 is the pre-1a accent; neither foreground clears 4.5:1.
    expect(contrastRatio("#ffffff", "#6366f1")).toBeLessThan(4.5);
    expect(contrastRatio(READABLE_DARK, "#6366f1")).toBeLessThan(4.5);
  });
});

describe("compositeOver", () => {
  it("composites white alpha over a base colour", () => {
    // --color-glass is rgba(255,255,255,0.08) over --color-surface-raised.
    expect(compositeOver(0.08, "#12121a")).toBe("#25252c");
  });

  it("returns the base unchanged at zero alpha", () => {
    expect(compositeOver(0, "#12121a")).toBe("#12121a");
  });

  it("returns white at full alpha", () => {
    expect(compositeOver(1, "#12121a")).toBe("#ffffff");
  });
});

describe("readableForeground", () => {
  it("picks dark text on a light background", () => {
    expect(readableForeground("#f59e0b").color).toBe(READABLE_DARK);
  });

  it("picks light text on a dark background", () => {
    expect(readableForeground("#0a0a0f").color).toBe(READABLE_LIGHT);
  });

  it("reports the achieved ratio so callers can warn on a failure", () => {
    const { ratio } = readableForeground("#6366f1");
    expect(ratio).toBeGreaterThan(4);
    expect(ratio).toBeLessThan(4.5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/contrast.test.ts`
Expected: FAIL — `Failed to resolve import "$lib/utils/contrast"`.

- [ ] **Step 3: Write the module**

Create `src/lib/utils/contrast.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/contrast.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Point `medication-style.ts` at the shared module**

In `src/lib/utils/medication-style.ts`, delete lines 3-32 (the `HEX_RE`, `relativeLuminance`, `contrastRatio`, `READABLE_DARK`, `READABLE_LIGHT`, `DARK_LUM`, `LIGHT_LUM` block) and replace with:

```ts
import {
  relativeLuminance,
  contrastRatio,
  READABLE_DARK,
  READABLE_LIGHT,
} from "$lib/utils/contrast";
```

Then in `getReadableTextColor`, replace the two luminance comparisons. The existing code compares against pre-computed luminance constants; the shared `contrastRatio` takes hex strings, so change:

```ts
const lums = colours.map(relativeLuminance);
const whiteMin = Math.min(...lums.map((L) => contrastRatio(LIGHT_LUM, L)));
const darkMin = Math.min(...lums.map((L) => contrastRatio(DARK_LUM, L)));
```

to:

```ts
const whiteMin = Math.min(...colours.map((c) => contrastRatio(READABLE_LIGHT, c)));
const darkMin = Math.min(...colours.map((c) => contrastRatio(READABLE_DARK, c)));
```

`relativeLuminance` is no longer called directly here; drop it from the import if your editor flags it unused.

- [ ] **Step 6: Verify the existing medication-style tests still pass**

Run: `npx vitest run tests/unit/medication-style.test.ts`
Expected: PASS with no changes to the test file. This is the regression gate for the refactor — `getReadableTextColor`'s behaviour must be identical.

- [ ] **Step 7: Point the layout at the shared module**

In `src/routes/(app)/+layout.svelte`, delete the `accentFg` function (lines 14-27) and change the imports and derivations:

```svelte
<script lang="ts">
  import Sidebar from "$components/Sidebar.svelte";
  import MobileHeader from "$components/MobileHeader.svelte";
  import { readableForeground } from "$lib/utils/contrast";

  let { data, children } = $props();
  let sidebarOpen = $state(false);

  // No service worker registration here on purpose. SvelteKit registers
  // src/service-worker.ts app-wide (kit.serviceWorker.register defaults
  // to true), so registering a second script at the same scope from this
  // layout made the two evict each other on every load.

  const accentColor = $derived(data.preferences.accentColor);
  const accentFgColor = $derived(readableForeground(accentColor).color);
</script>
```

The unused `SessionUser` type import on line 4 is already unused — leave it alone if it is referenced elsewhere in the file; remove it only if `npm run check` flags it.

- [ ] **Step 8: Verify the whole suite and the type check**

Run: `npx vitest run && npm run check`
Expected: all tests pass; `npm run check` reports exactly the 3 pre-existing pglite errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/utils/contrast.ts tests/unit/contrast.test.ts src/lib/utils/medication-style.ts "src/routes/(app)/+layout.svelte"
git commit -m "refactor(contrast): single WCAG implementation for both call sites"
```

---

### Task 2: Token contrast test — the red phase

Writes the guard **before** fixing the palette, so the fix has a real red phase. This test will fail on six pairs; Task 3 makes it green.

**Files:**

- Create: `tests/unit/theme-tokens.test.ts`
- Reads: `src/app.css` (not modified in this task)

**Interfaces:**

- Consumes: `contrastRatio`, `compositeOver` from Task 1.
- Produces: nothing importable. Task 3 is verified by this file.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/theme-tokens.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { contrastRatio, compositeOver } from "$lib/utils/contrast";

/**
 * Parses the real @theme block rather than duplicating the palette, so this
 * test cannot drift from the stylesheet it is guarding. If someone edits a
 * token in app.css and breaks a pair, this goes red.
 */
function readThemeTokens(): Record<string, string> {
  const cssPath = fileURLToPath(new URL("../../src/app.css", import.meta.url));
  const css = readFileSync(cssPath, "utf8");
  const block = css.match(/@theme\s*\{([\s\S]*?)\n\}/);
  if (!block) throw new Error("Could not find the @theme block in src/app.css");
  const tokens: Record<string, string> = {};
  for (const line of block[1].split("\n")) {
    const m = line.match(/^\s*(--[\w-]+):\s*(.+?);\s*$/);
    if (m) tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

/** rgba(255,255,255,A) -> A. Throws on anything else, so a token that stops
 *  being white-alpha fails loudly instead of being silently skipped. */
function whiteAlpha(value: string): number {
  const m = value.match(/^rgba\(255,\s*255,\s*255,\s*([\d.]+)\)$/);
  if (!m) throw new Error(`Expected a white-alpha token, got: ${value}`);
  return Number(m[1]);
}

const T = readThemeTokens();

/** Every opaque surface a foreground token is actually rendered on. */
function surfaces(): Record<string, string> {
  const raised = T["--color-surface-raised"];
  return {
    surface: T["--color-surface"],
    "surface-raised": raised,
    "surface-overlay": T["--color-surface-overlay"],
    "glass-on-surface": compositeOver(whiteAlpha(T["--color-glass"]), T["--color-surface"]),
    "glass-on-raised": compositeOver(whiteAlpha(T["--color-glass"]), raised),
    "glass-hover": compositeOver(whiteAlpha(T["--color-glass-hover"]), raised),
  };
}

/**
 * Pairs knowingly shipping below threshold. Every entry needs a reason and an
 * owner. An empty list is the goal; an entry is a decision, not a shrug.
 */
const ALLOWED_BELOW_THRESHOLD: { token: string; surface: string; why: string }[] = [];

describe("@theme parsing", () => {
  it("finds the tokens it is about to assert on", () => {
    expect(T["--color-surface"]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(T["--color-text-primary"]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(Object.keys(T).length).toBeGreaterThan(15);
  });
});

describe("text tokens meet 4.5:1 on every surface they render on", () => {
  const TEXT_TOKENS = [
    "--color-text-primary",
    "--color-text-secondary",
    "--color-text-muted",
    "--color-accent-ink",
    "--color-danger",
  ];

  for (const token of TEXT_TOKENS) {
    for (const [name, bg] of Object.entries(surfaces())) {
      const allowed = ALLOWED_BELOW_THRESHOLD.some((a) => a.token === token && a.surface === name);
      it.skipIf(allowed)(`${token} on ${name}`, () => {
        expect(T[token], `${token} is not defined in @theme`).toBeDefined();
        const ratio = contrastRatio(T[token], bg);
        expect(ratio, `${T[token]} on ${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe("solid fills carry a legible foreground", () => {
  const PAIRS: [fill: string, fg: string][] = [
    ["--color-accent", "--color-accent-fg"],
    ["--color-danger", "--color-danger-fg"],
    ["--color-success", "--color-success-fg"],
    ["--color-warning", "--color-warning-fg"],
  ];

  for (const [fill, fg] of PAIRS) {
    it(`${fg} on ${fill}`, () => {
      expect(T[fill], `${fill} is not defined`).toBeDefined();
      expect(T[fg], `${fg} is not defined`).toBeDefined();
      const ratio = contrastRatio(T[fg], T[fill]);
      expect(ratio, `${T[fg]} on ${T[fill]} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("control boundaries meet the 3:1 non-text minimum (WCAG 1.4.11)", () => {
  for (const [name, bg] of Object.entries(surfaces())) {
    if (name.startsWith("glass")) continue; // a control never sits on its own hover state
    it(`--color-border-strong on ${name}`, () => {
      expect(T["--color-border-strong"], "--color-border-strong is not defined").toBeDefined();
      const border = compositeOver(whiteAlpha(T["--color-border-strong"]), bg);
      const ratio = contrastRatio(border, bg);
      expect(ratio, `composites to ${border}, ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    });
  }
});

describe("the heatmap ramp is distinguishable step to step", () => {
  it("holds at least 1.35:1 between adjacent steps", () => {
    const ramp = [0, 1, 2, 3, 4].map((i) => {
      const v = T[`--color-heatmap-${i}`];
      expect(v, `--color-heatmap-${i} is not defined`).toBeDefined();
      return v;
    });
    for (let i = 1; i < ramp.length; i++) {
      const ratio = contrastRatio(ramp[i], ramp[i - 1]);
      expect(ratio, `step ${i - 1}->${i} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(1.35);
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails for the right reasons**

Run: `npx vitest run tests/unit/theme-tokens.test.ts`

Expected: FAIL. Read the output and confirm you see, at minimum:

- `--color-text-secondary on glass-hover` — 3.63:1
- `--color-text-muted on glass-hover` — 2.64:1 (and four more `--color-text-muted` failures)
- `--color-danger on glass-hover` — 3.33:1
- `--color-accent-fg on --color-accent` — 4.47:1
- Several `is not defined` failures for `--color-accent-ink`, `--color-border-strong`, `--color-danger-fg`, `--color-success-fg`, `--color-warning-fg`, `--color-heatmap-0..4`

If you do **not** see `glass-hover` failures, the composite maths or the parse is wrong — fix that before proceeding, because a test that passes here proves nothing.

- [ ] **Step 3: Commit the red test**

Committing a failing test is deliberate: it is the red phase, and it makes Task 3 reviewable as a pure green transition.

```bash
git add tests/unit/theme-tokens.test.ts
git commit -m "test(theme): assert token contrast pairs (currently failing)" --no-verify
```

`--no-verify` is required only if a pre-commit hook runs the test suite. Check first — if the hook only runs prettier and eslint (per `.lintstagedrc.json`, it does), drop the flag.

---

### Task 3: Fix the dark palette

**Files:**

- Modify: `src/app.css:3-24` (the `@theme` block)

**Interfaces:**

- Consumes: the assertions from Task 2.
- Produces: the tokens `--color-accent-ink`, `--color-border-strong`, `--color-danger-fg`, `--color-success-fg`, `--color-warning-fg`, `--color-info`, `--color-scrim`, `--color-heatmap-0` … `--color-heatmap-4`. Tasks 4-8 consume these by name.

- [ ] **Step 1: Replace the `@theme` block**

In `src/app.css`, replace lines 3-24 entirely with:

```css
@theme {
  --color-glass: rgba(255, 255, 255, 0.08);
  --color-glass-border: rgba(255, 255, 255, 0.12);
  --color-glass-hover: rgba(255, 255, 255, 0.14);
  /* Control boundaries need 3:1 against their surface (WCAG 1.4.11); the
     decorative hairline above is 1.33:1 and cannot serve both roles. */
  --color-border-strong: rgba(255, 255, 255, 0.34);
  --color-surface: #0a0a0f;
  --color-surface-raised: #12121a;
  --color-surface-overlay: #1a1a25;
  --color-text-primary: #f0f0f5;
  --color-text-secondary: #c3c3d4;
  --color-text-muted: #9a9aac;
  /* accent = fills. accent-ink = the same accent, legible as text. These
     cannot be one token: #4f46e5 scores 1.99:1 as text, and #8f92f5 scores
     2.76:1 with white on it. The layout sets --color-accent inline from the
     user's stored hex; --color-accent-ink is derived. */
  --color-accent: #4f46e5;
  --color-accent-hover: #6366f1;
  --color-accent-fg: #ffffff;
  --color-accent-ink: #8f92f5;
  --color-success: #10b981;
  --color-success-fg: #111111;
  --color-warning: #f59e0b;
  --color-warning-fg: #111111;
  --color-danger: #f37474;
  --color-danger-fg: #111111;
  /* Neutral/informational. Previously `accent` did this job, which collides
     with warning/danger the moment a user picks an amber accent. */
  --color-info: #8f92f5;
  --color-scrim: rgba(0, 0, 0, 0.6);
  /* Accent-neutral so the activity heatmap does not fight the user's accent. */
  --color-heatmap-0: #1b2b2e;
  --color-heatmap-1: #1e5a56;
  --color-heatmap-2: #22867c;
  --color-heatmap-3: #2bb3a0;
  --color-heatmap-4: #54e0c4;
  --font-sans: system-ui, -apple-system, sans-serif;
  --radius-xs: 0.25rem;
  --radius-sm: 0.5rem;
  --radius-md: 0.75rem;
  --radius-lg: 1rem;
  --radius-xl: 1.5rem;
}
```

Note `--radius-xs: 0.25rem` is new — it names the tier that 30-odd sites currently reach via the bare `rounded` class, which is Tailwind's untouched default and sits below the declared scale. Task 13 migrates them.

- [ ] **Step 2: Run the token test**

Run: `npx vitest run tests/unit/theme-tokens.test.ts`
Expected: PASS, all pairs green.

If `--color-danger` now fails a _fill_ assertion, note `#f37474` with `--color-danger-fg: #111111` measures 5.02:1 — it passes. If you see a failure, re-read the ratio in the message rather than adjusting the threshold.

- [ ] **Step 3: Add `color-scheme` to the base layer**

Still in `src/app.css`, inside the existing `@layer base` block, add to the `body` rule's neighbours:

```css
@layer base {
  :root {
    /* Makes native checkboxes, radios, scrollbars and the date-picker glyph
       render dark. There are 14 native checkbox/radio inputs in the app with
       no appearance:none and no accent-color, so today they paint as bright
       white widgets on a near-black page. This does NOT restyle a closed
       <select> — that needs appearance:none plus a drawn chevron. */
    color-scheme: dark;
  }

  body {
    @apply bg-surface text-text-primary font-sans antialiased;
  }
  /* … existing button cursor rule unchanged … */
}
```

- [ ] **Step 4: Verify the build and the full suite**

Run: `npm run build && npx vitest run`
Expected: build succeeds; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app.css
git commit -m "fix(a11y): raise the dark palette to WCAG AA and split accent into fill and ink"
```

---

### Task 4: Route accent and control borders to their new tokens

Two mechanical migrations onto tokens Task 3 added. Both must land, and the second is not optional bookkeeping: **Tailwind v4 tree-shakes `@theme` variables that no utility references**, so a `--color-border-strong` that nothing consumes is never emitted to `:root` at all. Task 2's test parses `app.css` directly and would still pass — a silent hole.

67 `text-accent` occurrences plus `border-accent` and `ring-accent` move to the ink token. `bg-accent` stays as it is — that is the fill role.

**Files:**

- Modify: every `.svelte` file matching the greps below (~40 files for accent, ~26 for borders).

**Interfaces:**

- Consumes: `--color-accent-ink` and `--color-border-strong` from Task 3.
- Produces: nothing importable.

- [ ] **Step 1: List the sites**

Run:

```bash
grep -rn "text-accent\b\|border-accent\b\|ring-accent\b\|focus:border-accent\|focus:ring-accent" src --include="*.svelte" | tee /tmp/accent-sites.txt | wc -l
```

Expected: roughly 90 lines across ~40 files. Keep the file; Step 4 diffs against it.

- [ ] **Step 2: Apply the rule**

The rule is mechanical:

| Before                                               | After                     | Why                            |
| ---------------------------------------------------- | ------------------------- | ------------------------------ |
| `text-accent`                                        | `text-accent-ink`         | foreground — needs 4.5:1       |
| `border-accent`                                      | `border-accent-ink`       | a visible boundary — needs 3:1 |
| `ring-accent` / `focus:ring-accent`                  | `ring-accent-ink`         | focus indicator — needs 3:1    |
| `focus:border-accent`                                | `focus:border-accent-ink` | same                           |
| `bg-accent`, `bg-accent/10`, `hover:bg-accent-hover` | **unchanged**             | fill role                      |
| `text-accent-fg`                                     | **unchanged**             | already the paired foreground  |

Do not use a blind `sed`: `text-accent-fg` contains `text-accent` as a prefix and must not be rewritten. Use a word-boundary-anchored replacement:

```bash
grep -rl "text-accent\b\|border-accent\b\|ring-accent\b" src --include="*.svelte" \
  | xargs sed -i '' -E 's/\b(text|border|ring)-accent\b/\1-accent-ink/g'
```

On Linux drop the `''` after `-i`.

- [ ] **Step 3: Verify nothing over-matched**

Run:

```bash
grep -rn "accent-fg-ink\|accent-ink-fg\|accent-hover-ink\|bg-accent-ink" src --include="*.svelte" || echo "clean"
```

Expected: `clean`. Any hit is an over-match — revert that line by hand.

- [ ] **Step 4: Confirm the fill sites survived**

Run: `grep -rc "bg-accent\b" src --include="*.svelte" | grep -v ":0" | wc -l`
Expected: a non-zero count, unchanged from before the edit. `bg-accent` must not have been touched.

- [ ] **Step 5: List the control boundaries**

`border-glass-border` appears in 42 files and serves two incompatible roles: a decorative hairline on cards and dividers (fine at 1.33:1), and the resting boundary of a form control (needs 3:1 under WCAG 1.4.11). Only the second moves.

Run:

```bash
grep -rn "border-glass-border" src --include="*.svelte" \
  | grep -E "bg-surface-raised|focus:border-|<input|<select|<textarea" \
  | tee /tmp/control-borders.txt | wc -l
```

Expected: roughly 70 lines across ~26 files.

- [ ] **Step 6: Migrate only the controls**

Go through `/tmp/control-borders.txt` **by hand**. Change `border-glass-border` to `border-border-strong` only where the element is a focusable form control — an `<input>`, `<select>`, `<textarea>`, or a button styled to look like one.

Leave it alone on: `GlassCard`'s own border, `EmptyState.svelte:14`, `Modal.svelte`, `Sidebar.svelte`, `MobileHeader.svelte`, `KeyboardShortcuts.svelte`, card wrappers, section dividers, and the settings hub's nav rows (`settings/+page.svelte`) — those are surfaces and separators, not controls, and thickening them would make the UI noticeably heavier for no accessibility gain.

The grep is a candidate list, not an instruction. Two files it flags are ambiguous and both keep the hairline: `MedicationFilterSelect.svelte`'s dropdown _panel_ (the trigger button is the control, not the panel) and `analytics/+page.svelte`'s chart card wrappers.

- [ ] **Step 7: Confirm the token is actually referenced**

Run: `grep -rn "border-border-strong" src --include="*.svelte" | wc -l`
Expected: non-zero. If this is 0, the token is tree-shaken out of the build and this task did nothing.

Then confirm it survives compilation:

```bash
npm run build && grep -ro "border-strong" .svelte-kit/output/client/_app/immutable/assets/*.css | head -1
```

Expected: a match. An empty result means Tailwind pruned the token.

- [ ] **Step 8: Verify the build and type check**

Run: `npm run build && npm run check`
Expected: build succeeds; 3 pre-existing pglite errors only.

- [ ] **Step 9: Commit**

```bash
git add src
git commit -m "fix(a11y): accent text to the ink token, control borders to a 3:1 boundary"
```

---

### Task 5: Replace hardcoded `text-white` with semantic foregrounds

Thirteen sites bypass the contrast-aware foreground the app already computes. Two are destructive confirm buttons at 3.76:1.

**Files:**

- Modify: `src/app.html:30`
- Modify: `src/lib/components/Heatmap.svelte:84`
- Modify: `src/routes/+page.svelte:37,64`
- Modify: `src/routes/(app)/analytics/+page.svelte:78`
- Modify: `src/routes/(app)/settings/data/+page.svelte:140`
- Modify: `src/routes/(app)/settings/data/import/+page.svelte:380`
- Modify: `src/routes/auth/login/+page.svelte:93`
- Modify: `src/routes/auth/register/+page.svelte:116`
- Modify: `src/routes/auth/2fa/+page.svelte:58`
- Modify: `src/routes/auth/reset-password/+page.svelte:63`
- Modify: `src/routes/auth/reset-password/confirm/+page.svelte:66`
- Modify: `src/lib/components/medication-form/MedicationStylePicker.svelte:60`

**Interfaces:**

- Consumes: `--color-accent-fg`, `--color-danger-fg` from Task 3.
- Produces: nothing importable.

- [ ] **Step 1: Swap accent-backed buttons**

In each of `src/routes/+page.svelte:37`, `:64`, `src/routes/(app)/analytics/+page.svelte:78`, `src/routes/auth/login/+page.svelte:93`, `src/routes/auth/register/+page.svelte:116`, `src/routes/auth/2fa/+page.svelte:58`, `src/routes/auth/reset-password/+page.svelte:63`, `src/routes/auth/reset-password/confirm/+page.svelte:66`, and `src/app.html:30` (`focus:text-white`), replace `text-white` with `text-accent-fg` (and `focus:text-white` with `focus:text-accent-fg`).

The five auth pages and the landing page sit outside the `(app)` group, so `--color-accent-fg` there resolves to the `@theme` default `#ffffff` — visually identical today. The change is that they now follow the token when a later phase makes it vary, instead of being permanently white.

- [ ] **Step 2: Swap danger-backed buttons**

`src/routes/(app)/settings/data/+page.svelte:140` — `bg-danger … text-white` becomes `bg-danger … text-danger-fg`.
`src/routes/(app)/settings/data/import/+page.svelte:380` — `'bg-danger text-white'` becomes `'bg-danger text-danger-fg'`.

With Task 3's `--color-danger: #f37474` and `--color-danger-fg: #111111` this moves from 3.76:1 to 5.02:1.

- [ ] **Step 3: Fix the style picker's dashed button**

`src/lib/components/medication-form/MedicationStylePicker.svelte:60` uses white-alpha for a control that must survive a palette change. Replace the class string's colour parts:

```
border-white/30 text-lg text-white/40 transition-colors hover:border-white/50 hover:text-white/60
```

with:

```
border-glass-border text-lg text-text-muted transition-colors hover:border-border-strong hover:text-text-secondary
```

- [ ] **Step 4: Verify no `text-white` remains outside the Heatmap tooltip**

Run: `grep -rn "text-white" src --include="*.svelte" --include="*.html"`
Expected: exactly one hit, `src/lib/components/Heatmap.svelte:84` — Task 6 owns that line.

- [ ] **Step 5: Build and commit**

```bash
npm run build
git add src
git commit -m "fix(a11y): replace hardcoded white foregrounds with contrast-aware tokens"
```

---

### Task 6: Move the Heatmap onto tokens

**Files:**

- Modify: `src/lib/components/Heatmap.svelte:32-39` (intensity ramp), `:84` (tooltip)

**Interfaces:**

- Consumes: `--color-heatmap-0` … `--color-heatmap-4`, `--color-surface-overlay`, `--color-text-primary`, `--color-glass-border` from Task 3.
- Produces: nothing importable.

- [ ] **Step 1: Replace the intensity function**

In `src/lib/components/Heatmap.svelte`, replace lines 32-39:

```ts
function intensity(count: number): string {
  if (count === 0) return "bg-heatmap-0";
  const ratio = count / maxCount;
  if (ratio < 0.25) return "bg-heatmap-1";
  if (ratio < 0.5) return "bg-heatmap-2";
  if (ratio < 0.75) return "bg-heatmap-3";
  return "bg-heatmap-4";
}
```

The previous ramp used `bg-emerald-500` at four opacities plus `bg-white/10` for empty cells. Opacity is gone deliberately: an alpha ramp over a themed surface produces different effective colours per theme, which is exactly what the token ramp exists to prevent.

- [ ] **Step 2: Replace the tooltip**

Replace line 84's class attribute:

```svelte
class="border-glass-border text-text-primary pointer-events-none absolute z-30 rounded-sm border
px-2 py-1 text-xs shadow-lg backdrop-blur-xl" style="background-color: var(--color-surface-overlay)"
```

This matches `Tooltip.svelte`'s existing treatment (`bg-surface-overlay` + `border-glass-border`), which the Heatmap's hand-rolled tooltip diverged from.

- [ ] **Step 3: Verify visually**

Run: `npm run dev` and open the Analytics page. The heatmap should now be teal rather than emerald, with empty cells a dark slate rather than a white wash. Hover a cell and confirm the tooltip matches other tooltips in the app.

If you have no database available, skip the visual check and rely on Step 4 — but say so in the PR description rather than claiming it was verified.

- [ ] **Step 4: Confirm no hardcoded palette colours remain**

Run: `grep -rn "bg-emerald-\|bg-gray-\|bg-slate-\|bg-white/" src --include="*.svelte" || echo "clean"`
Expected: `clean`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/Heatmap.svelte
git commit -m "fix(heatmap): move the intensity ramp and tooltip onto theme tokens"
```

---

### Task 7: Make the Heatmap honour the in-app reduced-motion toggle

The current rule honours the OS media query but ignores `data-reduced-motion`. The naive fix compiles to nothing — Svelte scopes component `<style>`, so a selector rooted at an ancestor attribute is dead. `npm run check` does not pass `--fail-on-warnings`, so it would ship green.

**Files:**

- Modify: `src/lib/components/Heatmap.svelte:92-98` (the `<style>` block)
- Create: `tests/unit/heatmap-motion.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: nothing importable.

- [ ] **Step 1: Write the failing test**

There is no runtime attach point (jsdom will not apply a scoped stylesheet meaningfully here), so assert on the **compiled output** instead. Create `tests/unit/heatmap-motion.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compile } from "svelte/compiler";

/**
 * Svelte scopes component <style>. A selector rooted at an ancestor attribute
 * — `[data-reduced-motion="true"] .heatmap-cell` — is unreachable from the
 * component's own scope, so the compiler emits it commented out as an unused
 * selector and the rule silently does nothing. `npm run check` runs
 * svelte-check without --fail-on-warnings, so that ships green.
 *
 * This test asserts on the compiled CSS because there is nothing else to
 * assert on. Prove it by mutation: drop the :global() wrapper and watch it go
 * red.
 */
function compileHeatmapCss(): string {
  const path = fileURLToPath(new URL("../../src/lib/components/Heatmap.svelte", import.meta.url));
  const source = readFileSync(path, "utf8");
  const { css } = compile(source, { name: "Heatmap", css: "external" });
  return css?.code ?? "";
}

describe("Heatmap reduced-motion", () => {
  it("emits a live rule for the in-app data-reduced-motion toggle", () => {
    const css = compileHeatmapCss();
    expect(css).toMatch(/\[data-reduced-motion="true"\]/);
  });

  it("does not emit that rule as an unused selector", () => {
    const css = compileHeatmapCss();
    // Svelte writes dead selectors as `/* (unused) ... */`.
    const dead = css.match(/\/\*\s*\(unused\)[^*]*data-reduced-motion[^*]*\*\//);
    expect(dead, `selector was compiled away as unused:\n${dead?.[0]}`).toBeNull();
  });

  it("still honours the OS-level media query", () => {
    const css = compileHeatmapCss();
    expect(css).toMatch(/prefers-reduced-motion/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/heatmap-motion.test.ts`
Expected: FAIL on the first assertion — the selector does not exist yet.

- [ ] **Step 3: Add the rule, wrapped in `:global()`**

Replace the `<style>` block at the end of `src/lib/components/Heatmap.svelte`:

```svelte
<style>
  /* Two independent switches. The media query is the OS setting; the
     attribute is the app's own preference, set on a wrapper in
     (app)/+layout.svelte. The attribute selector MUST be :global() — it
     targets an ancestor outside this component's scope, and without it
     Svelte compiles the rule away as an unused selector and the toggle
     silently does nothing. See tests/unit/heatmap-motion.test.ts. */
  @media (prefers-reduced-motion: reduce) {
    .heatmap-cell {
      animation-delay: 0ms !important;
    }
  }

  :global([data-reduced-motion="true"]) .heatmap-cell {
    animation-delay: 0ms !important;
  }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/heatmap-motion.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Prove it by mutation**

Temporarily delete `:global(` and its closing `)` from the new rule, re-run the test, and confirm the second assertion goes red with the `(unused)` comment in the message. Then restore it. This is the repo's stated rule: a test that has never failed proves nothing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/Heatmap.svelte tests/unit/heatmap-motion.test.ts
git commit -m "fix(heatmap): honour the in-app reduced-motion toggle, not just the OS one"
```

---

### Task 8: One Toast, mounted once

`<Toast/>` renders the `aria-live` container. It is mounted only on the dashboard, while `showToast()` is called from five modules — so dose deletion on `/log` and the push toggles on `/settings/notifications` produce no visible confirmation at all.

**This task is atomic.** Toast's state is module-level, so two mounted instances render every toast twice inside two `aria-live` regions and screen readers announce it twice. The dashboard mount must be removed in the same commit that adds the layout mount.

**Files:**

- Modify: `src/lib/components/ui/Toast.svelte:1-26`
- Modify: `src/routes/(app)/+layout.svelte` (add the mount)
- Modify: `src/routes/(app)/dashboard/+page.svelte:8,43` (remove import and mount)

**Interfaces:**

- Consumes: nothing.
- Produces: nothing importable. `showToast` keeps its signature.

- [ ] **Step 1: Guard the store and document the rule**

In `src/lib/components/ui/Toast.svelte`, replace the module block:

```svelte
<script lang="ts" module>
  import { browser } from "$app/environment";

  type ToastItem = {
    id: string;
    message: string;
    type: "success" | "error";
    undoAction?: () => void;
  };

  /**
   * Module-level state, so EXACTLY ONE <Toast /> may be mounted — it now
   * lives in (app)/+layout.svelte. Mount a second and every toast renders
   * twice in two aria-live regions, and screen readers announce it twice.
   *
   * The `browser` guard exists because the layout mount means this module is
   * evaluated during SSR on every authenticated page. Module state is
   * per-process on the server, so a showToast() reached during SSR would be
   * visible to whichever user rendered next.
   */
  let toasts = $state<ToastItem[]>([]);

  export function showToast(
    message: string,
    type: "success" | "error" = "success",
    undoAction?: () => void,
  ) {
    if (!browser) return;
    const id = crypto.randomUUID();
    toasts.push({ id, message, type, undoAction });
    setTimeout(() => {
      toasts = toasts.filter((t) => t.id !== id);
    }, 5000);
  }

  export function dismissToast(id: string) {
    toasts = toasts.filter((t) => t.id !== id);
  }
</script>
```

- [ ] **Step 2: Remove the dashboard mount**

In `src/routes/(app)/dashboard/+page.svelte`, delete the import on line 8 (`import Toast from "$components/ui/Toast.svelte";`) and the `<Toast />` element on line 43.

- [ ] **Step 3: Add the layout mount**

In `src/routes/(app)/+layout.svelte`, add the import alongside the others:

```ts
import Toast from "$components/ui/Toast.svelte";
```

and render it as the last child inside the outer themed `<div>`, after the `flex h-screen` block:

```svelte
    <main id="main-content" class="flex-1 overflow-y-auto p-4 pt-18 md:p-6 md:pt-6 lg:p-8">
      {@render children()}
    </main>
  </div>

  <Toast />
</div>
```

- [ ] **Step 4: Verify exactly one mount exists**

Run: `grep -rn "<Toast" src --include="*.svelte"`
Expected: exactly one line, in `src/routes/(app)/+layout.svelte`.

- [ ] **Step 5: Verify the build and the suite**

Run: `npm run build && npx vitest run && npm run check`
Expected: build succeeds, tests pass, 3 pre-existing pglite errors only.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/ui/Toast.svelte "src/routes/(app)/+layout.svelte" "src/routes/(app)/dashboard/+page.svelte"
git commit -m "fix(toast): mount once in the app layout so /log and settings toasts render"
```

---

### Task 9: Dashboard empty state uses the shared component

`dashboard/+page.svelte:110-115` hand-rolls a card duplicating `GlassCard`'s exact class string, for what is an empty state that `EmptyState.svelte` exists to render.

**Files:**

- Modify: `src/routes/(app)/dashboard/+page.svelte:110-115`

**Interfaces:**

- Consumes: `EmptyState.svelte`'s props, verified against `src/lib/components/EmptyState.svelte:2-10` — `title: string` is the only required one; `illustration?`, `illustrationAlt?` (defaults to `""`), `body?` and `action?: { href?: string; label: string; onclick?: () => void }` are all optional.
- Produces: nothing importable.

- [ ] **Step 1: Add the import**

In `src/routes/(app)/dashboard/+page.svelte`, add alongside the existing component imports:

```ts
import EmptyState from "$components/EmptyState.svelte";
```

- [ ] **Step 2: Replace the hand-rolled card**

Replace lines 110-115 — the `{#if data.doses.length === 0 && overdueMeds.length === 0}` branch and its `<div class="border-glass-border bg-glass rounded-xl border p-8 text-center backdrop-blur-xl">` wrapper — with:

```svelte
      {#if data.doses.length === 0 && overdueMeds.length === 0}
        <EmptyState
          title="No doses logged today"
          body="Use Quick Log above to record one."
        />
```

No `illustration` here, deliberately. This mirrors the Log page's _filtered_-empty variant (`log/+page.svelte:205-208`), which also omits it — an illustration is right for a first-run page with nothing at all, but this branch appears every morning before the first dose, and a full illustration each day would be noise. No `action` either: Quick Log is already directly above it.

- [ ] **Step 3: Verify no hand-rolled GlassCard clones remain on this page**

Run: `grep -n "bg-glass rounded-xl border p-" "src/routes/(app)/dashboard/+page.svelte" || echo "clean"`
Expected: `clean`.

- [ ] **Step 4: Build and commit**

```bash
npm run build
git add "src/routes/(app)/dashboard/+page.svelte"
git commit -m "refactor(dashboard): use EmptyState instead of a hand-rolled card"
```

---

### Task 10: Fix the compact-mode mobile header overlap

`src/app.css:45-48` sets the `padding` **shorthand** on `main`. Because the rule is unlayered it beats Tailwind's `pt-18`, so in compact mode on mobile the top ~3.7rem of every page slides under the `fixed` MobileHeader. This is live today.

**Files:**

- Modify: `src/app.css:45-52`

**Interfaces:**

- Consumes: nothing.
- Produces: nothing importable.

- [ ] **Step 1: Reproduce the bug first**

Run `npm run dev`, set Display Density to Compact in Settings → Appearance, then narrow the browser below 768px. Confirm the page heading is partly hidden behind the fixed header. If you cannot reach a database, read `src/app.css:45-48` and `src/routes/(app)/+layout.svelte:76` together and confirm the shorthand-vs-`pt-18` conflict by inspection, then say so in the PR.

- [ ] **Step 2: Replace the shorthand with longhands that preserve the top offset**

In `src/app.css`, replace the `main` rules:

```css
/* padding-inline/bottom only. The `padding` shorthand here also reset
   padding-top, and because this rule is unlayered it beat Tailwind's
   `pt-18` on <main> — so compact mode on mobile pushed the top of every
   page under the fixed MobileHeader. */
[data-density="compact"] main {
  padding-inline: 0.75rem;
  padding-bottom: 0.75rem;
}
@media (min-width: 768px) {
  [data-density="compact"] main {
    padding-inline: 1rem;
    padding-bottom: 1rem;
  }
}
```

- [ ] **Step 3: Verify the fix**

Repeat Step 1's reproduction. The heading should now clear the header in compact mode at mobile width, and comfortable mode should be unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/app.css
git commit -m "fix(density): stop compact mode pushing page content under the mobile header"
```

---

### Task 11: Document-shell tokens

Four surfaces outside `src/lib` and `src/routes` are hardcoded and reach places the `(app)` wrapper never does.

**Files:**

- Modify: `src/app.html:11` (Apple status bar)
- Modify: `src/routes/+layout.svelte:14` (`theme-color`)

**Interfaces:**

- Consumes: nothing.
- Produces: nothing importable.

- [ ] **Step 1: Pair the `theme-color` meta tags**

In `src/routes/+layout.svelte`, replace line 14:

```svelte
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0a0a0f" />
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#0a0a0f" />
```

Both are the dark surface for now — the light value is decided in 1c, when a light palette exists. The pairing lands here so 1c is a one-line value change rather than a structural one. The old value `#6366f1` was the pre-1a accent, which was never the page background and made mobile browser chrome disagree with the app.

- [ ] **Step 2: Fix the iOS status bar style**

In `src/app.html`, replace line 11:

```html
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
```

with:

```html
<!-- `black-translucent` paints light glyphs over page content, which is
     unreadable over a light surface. `default` follows the theme-color meta
     above and stays correct when 1c adds a light palette. -->
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
```

- [ ] **Step 3: Verify the skip link now uses a token**

Task 5 already changed `src/app.html:30` from `focus:text-white` to `focus:text-accent-fg`. Confirm:

Run: `grep -n "focus:text-accent-fg" src/app.html`
Expected: one hit on line 30. If it is still `focus:text-white`, Task 5 was applied incompletely — fix it here.

- [ ] **Step 4: Build and commit**

`static/manifest.json` is deliberately untouched — `background_color` cannot vary per user and is decided in 1c.

```bash
npm run build
git add src/app.html "src/routes/+layout.svelte"
git commit -m "fix(shell): pair theme-color metas and stop the iOS status bar assuming dark"
```

---

### Task 12: Adopt the remaining tokens, drop dead code, close the radius scale

Three of Task 3's tokens — `--color-scrim`, `--color-info`, `--radius-xs` — have no consumer yet. Tailwind v4 tree-shakes unreferenced `@theme` variables, so until something uses them they are never emitted. This task wires them up and clears out what is genuinely dead.

- [ ] **Step 0a: Route the three scrims to the token**

All three overlay backdrops hardcode `bg-black/60`. A black scrim is wrong the moment a light palette exists, and they must agree with each other.

- `src/lib/components/ui/Modal.svelte:61` — `bg-black/60` → `bg-scrim`
- `src/lib/components/KeyboardShortcuts.svelte:70` — `bg-black/60` → `bg-scrim`
- `src/routes/(app)/+layout.svelte:60` — `bg-black/60` → `bg-scrim`

Verify: `grep -rn "bg-black/" src --include="*.svelte" || echo "clean"` → `clean`.

- [ ] **Step 0b: Give neutral-informational status its own token**

Refill severity's `watch` tier and the neutral insight dot currently borrow the accent. That was safe when the accent was a fixed indigo; it is not now, because a user who picks amber makes "watch" (informational) visually indistinguishable from `warning` and `danger` (urgent).

After Task 4 these read `accent-ink` for text and borders and `accent` for fills. Change them to `info`:

- `src/lib/components/RefillsCard.svelte:10` — `border-accent-ink/30 bg-accent/5` → `border-info/30 bg-info/5`
- `src/lib/components/RefillsCard.svelte:17` — `text-accent-ink` → `text-info`
- `src/lib/components/MedicationCard.svelte:13` — `bg-accent/15 text-accent-ink` → `bg-info/15 text-info`
- `src/lib/components/InsightsCard.svelte:11` — `return "bg-accent"` → `return "bg-info"`

`--color-info` is `#8f92f5`, the same value as `--color-accent-ink`, so this is visually identical **today** and diverges the moment the user changes their accent — which is the entire point. Do not "simplify" it back to one token.

Leave `MedicationCard.svelte:138` (`hover:bg-accent hover:text-accent-fg`) alone — that is an interactive affordance, not a status.

Verify: `grep -rn "text-info\|bg-info\|border-info" src --include="*.svelte" | wc -l` → at least 5.

**Files:**

- Modify: `src/app.css` (remove the `count-up` keyframe)
- Modify: `src/routes/(app)/+layout.svelte:64` (remove the inert transition)
- Modify: `src/lib/components/Heatmap.svelte:65` (arbitrary radius → token)
- Modify: ~10 files using the bare `rounded` class

**Interfaces:**

- Consumes: `--radius-xs` from Task 3.
- Produces: nothing importable.

- [ ] **Step 1: Confirm `count-up` is genuinely unreferenced**

Run: `grep -rn "animate-count-up\|count-up" src || echo "only the keyframe"`
Expected: only the `@keyframes count-up` definition in `src/app.css`. If a component does use it, stop and leave it alone.

- [ ] **Step 2: Delete the keyframe**

Remove the `@keyframes count-up { … }` block from `src/app.css` (currently lines 71-80).

- [ ] **Step 3: Remove the inert transition**

`src/routes/(app)/+layout.svelte:64` reads:

```svelte
      <div class="relative h-full w-64 transform transition-transform duration-200">
```

The element is mounted by `{#if sidebarOpen}` with no Svelte transition directive, and nothing ever changes its transform — so the transition classes never fire. Replace with:

```svelte
      <div class="relative h-full w-64">
```

Leave a note in the PR description that adding a real slide-in is a follow-up, not a regression.

- [ ] **Step 4: Close the radius scale**

`src/lib/components/Heatmap.svelte:65` uses `rounded-[2px]`, an arbitrary value with no tier. Replace with `rounded-xs` (Task 3 defines `--radius-xs: 0.25rem`).

Then migrate the bare `rounded` class, which resolves to Tailwind's untouched 0.25rem default rather than anything in the theme:

```bash
grep -rn 'class="[^"]*\brounded\b[^-]' src --include="*.svelte" | tee /tmp/bare-rounded.txt | wc -l
```

Replace each `rounded` (with no suffix) with `rounded-xs`. Do this by hand, not with `sed` — `rounded` is a prefix of `rounded-lg`, `rounded-full` and eight other classes, and a careless substitution will corrupt them.

- [ ] **Step 5: Verify nothing was corrupted**

Run:

```bash
grep -rn "rounded-xs-\|rounded--\|rounded-xslg\|rounded-xsfull" src --include="*.svelte" || echo "clean"
```

Expected: `clean`.

- [ ] **Step 6: Full verification**

Run: `npm run build && npx vitest run && npm run check && npm run lint`
Expected: build succeeds, all tests pass, 3 pre-existing pglite errors, lint clean.

- [ ] **Step 7: Commit**

```bash
git add src
git commit -m "chore(css): drop dead keyframe and inert transition, close the radius scale"
```

---

### Task 13: Verify the accessibility suite and update the changelog

**Files:**

- Modify: `CHANGELOG.md` (the `[Unreleased]` section)
- Read: `tests/e2e/accessibility.test.ts`

**Interfaces:**

- Consumes: everything above.
- Produces: nothing importable.

- [ ] **Step 1: Surface what axe has been hiding**

`scan()` at `tests/e2e/accessibility.test.ts:20-30` reads `results.violations` and discards `results.incomplete` — which is where axe puts contrast it cannot resolve behind a `backdrop-filter`ed parent, i.e. every `bg-glass` card. That is why the suite passed against a palette with six measured failures.

Add a diagnostic log so the next person can see it, without changing what gates the build:

```ts
async function scan(page: import("@playwright/test").Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();

  // `incomplete` is where axe puts checks it could not resolve — notably
  // colour-contrast behind a semi-transparent, backdrop-filtered parent,
  // which is every glass card in this app. It is not a gate (axe genuinely
  // cannot decide these), but it must be visible: this suite passed for
  // months against a palette with six measured contrast failures.
  const contrastUnknown = results.incomplete.filter((r) => r.id === "color-contrast");
  if (contrastUnknown.length > 0) {
    const nodes = contrastUnknown.reduce((n, r) => n + r.nodes.length, 0);
    console.log(`[axe] ${label}: ${nodes} node(s) with undetermined colour contrast`);
  }

  const blocking = results.violations.filter((v) => isBlocking(v.impact));
  if (blocking.length > 0) {
    const lines = blocking.map(
      (v) => `  - [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} nodes)`,
    );
    throw new Error(`${label} has accessibility violations:\n${lines.join("\n")}`);
  }
}
```

- [ ] **Step 2: Add the settings routes to the scan**

The suite has never visited `/settings/*`, including the appearance page this whole programme is about. In the authenticated test, after the existing `/analytics` block, add:

```ts
await page.goto("/settings/appearance");
await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
await scan(page, "/settings/appearance");
```

- [ ] **Step 3: Run the e2e suite if it is runnable here**

Run: `npm run test:e2e -- accessibility`

Note the CI job is gated on `vars.RUN_E2E == 'true'` — check whether that is set before treating a green CI as coverage. If the suite cannot run locally (it needs a seeded database via `scripts/seed-e2e.ts`), say so explicitly in the PR description rather than implying it passed.

- [ ] **Step 4: Update the changelog**

Add to the `### Fixed` list under `## [Unreleased]` in `CHANGELOG.md`:

```markdown
- Dark palette raised to WCAG AA. `--color-text-secondary` (3.63:1 → 7.21:1) and `--color-text-muted` (2.64:1 → 4.53:1) now clear 4.5:1 on all six surfaces including the glass composites; `--color-danger` moves to `#f37474`; a new `--color-border-strong` gives form inputs a 3:1 boundary (WCAG 1.4.11), which the 1.33:1 decorative hairline never provided.
- The accent splits into two tokens. `--color-accent` (`#4f46e5`) is the fill, and white on it now measures 6.29:1 rather than 4.47:1; `--color-accent-ink` (`#8f92f5`) is the text and border variant at 4.54:1. No single value satisfies both roles — the fill scores 1.99:1 as text.
- Toast notifications render outside the dashboard. `<Toast />` is mounted once in the app layout; it was previously mounted only on `/dashboard`, so dose deletion on `/log` and the push toggles in settings produced no visible confirmation at all.
- Compact display density no longer pushes page content under the fixed mobile header — the rule used the `padding` shorthand, which reset `padding-top`.
- The activity heatmap honours the in-app "Reduce motion" setting, not just the OS one. The rule was compiled away as an unused selector because it targets an ancestor from inside a scoped `<style>` block.
- Heatmap colours, the Heatmap tooltip, and thirteen hardcoded `text-white` foregrounds now come from theme tokens.
- Native checkboxes, radios, scrollbars and date-picker glyphs render dark via `color-scheme`, instead of as bright white OS widgets on a near-black page.
```

- [ ] **Step 5: Final full verification**

Run: `npm run build && npx vitest run && npm run check && npm run lint && npx prettier --check .`
Expected: build succeeds; all unit tests pass; 3 pre-existing pglite errors; lint clean; prettier clean.

- [ ] **Step 6: Commit**

```bash
git add CHANGELOG.md tests/e2e/accessibility.test.ts
git commit -m "test(a11y): surface axe's undetermined contrast and scan the settings routes"
```

---

## Definition of done

- `npx vitest run tests/unit/theme-tokens.test.ts` passes with an empty `ALLOWED_BELOW_THRESHOLD`.
- `grep -rn "text-white\|bg-emerald-\|bg-gray-\|bg-white/\|bg-black/" src --include="*.svelte" --include="*.html"` returns nothing.
- `grep -rn "<Toast" src --include="*.svelte"` returns exactly one line.
- **Every token Task 3 adds has at least one consumer.** Tailwind v4 tree-shakes unreferenced `@theme` variables, and `theme-tokens.test.ts` parses `app.css` directly — so an unused token passes its test while never reaching the browser. Check each:

  ```bash
  for t in accent-ink border-strong scrim info heatmap-0 heatmap-4 danger-fg success-fg warning-fg radius-xs; do
    printf "%-14s %s\n" "$t" "$(grep -rc "\-$t\|$t" src --include='*.svelte' --include='*.html' | grep -v ':0' | wc -l)"
  done
  ```

  Every row must be non-zero.

- `npm run build && npx vitest run && npm run check && npm run lint` is clean, modulo the 3 pre-existing pglite errors.
- No file under `drizzle/` changed. No file under `src/lib/server/db/` changed.
- The PR description states explicitly which checks were run in a browser and which were not.
