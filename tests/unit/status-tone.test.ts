// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  STATUS_TONE,
  TONE_CLASSES,
  toneOf,
  toneClass,
  refillStatus,
  type StatusKey,
  type Tone,
  type ToneElement,
} from "$lib/utils/status-tone";

const SOURCE = readFileSync(
  fileURLToPath(new URL("../../src/lib/utils/status-tone.ts", import.meta.url)),
  "utf8",
);

describe("STATUS_TONE is the spec's status table", () => {
  it("gives every status the tone the spec gives it", () => {
    expect(STATUS_TONE).toEqual({
      "dose-overdue": "needs-you",
      "dose-taken": "happened",
      "dose-skipped": "neutral",
      "dose-missed": "wrong",
      "refill-critical": "needs-you",
      "refill-warning": "needs-you",
      "refill-watch": "neutral",
      "refill-ok": "neutral",
      "stock-low": "needs-you",
      "side-effect-mild": "neutral",
      "side-effect-moderate": "neutral",
      "side-effect-severe": "wrong",
      "insight-needs-you": "needs-you",
      "insight-info": "neutral",
      "needs-you": "needs-you",
      "action-failed": "wrong",
      "action-done": "happened",
      state: "neutral",
    });
  });

  it("toneOf reads the table", () => {
    for (const [status, tone] of Object.entries(STATUS_TONE)) {
      expect(toneOf(status as StatusKey)).toBe(tone);
    }
  });
});

describe("refillStatus", () => {
  it("names each tier's status, so both urgent tiers are amber and watch is neutral", () => {
    const tiers = ["critical", "warning", "watch", "ok"] as const;
    expect(tiers.map(refillStatus)).toEqual([
      "refill-critical",
      "refill-warning",
      "refill-watch",
      "refill-ok",
    ]);
    expect(tiers.map((t) => toneOf(refillStatus(t)))).toEqual([
      "needs-you",
      "needs-you",
      "neutral",
      "neutral",
    ]);
  });
});

describe("TONE_CLASSES", () => {
  it("spells every tone for every element", () => {
    expect(TONE_CLASSES).toEqual({
      "needs-you": {
        text: "text-warning",
        chip: "border border-warning/35 bg-warning/15 text-warning",
        marker: "bg-warning/20 text-warning",
        bar: "bg-warning",
        alert: "border border-warning/35 bg-warning/10",
        border: "border-warning/50",
      },
      wrong: {
        text: "text-danger-ink",
        chip: "border border-danger-ink/35 bg-danger/15 text-danger-ink",
        marker: "bg-danger/20 text-danger-ink",
        bar: "bg-danger",
        alert: "border border-danger-ink/35 bg-danger/10",
        border: "border-danger-ink/50",
      },
      happened: {
        text: "text-success",
        // /10, not the /15 the other tinted chips use: see theme-tokens.test.ts.
        chip: "border border-success/30 bg-success/10 text-success",
        marker: "bg-success/20 text-success",
        bar: "bg-success",
        alert: "border border-success/30 bg-success/10",
        border: "border-success/50",
      },
      neutral: {
        text: "text-text-secondary",
        chip: "border border-border-strong text-text-secondary",
        marker: "border border-border-strong text-text-secondary",
        bar: "bg-border-strong",
        alert: "border border-glass-border bg-surface-raised",
        border: "border-border-strong",
      },
    });
  });

  it("toneClass reads the table", () => {
    for (const tone of Object.keys(TONE_CLASSES) as Tone[]) {
      for (const element of Object.keys(TONE_CLASSES[tone]) as ToneElement[]) {
        expect(toneClass(tone, element)).toBe(TONE_CLASSES[tone][element]);
      }
    }
  });

  // Tailwind v4 generates a utility only if its whole name appears in source
  // text. A class assembled at runtime renders as nothing, silently.
  it("writes every class string as one literal, so Tailwind's source scan sees it", () => {
    for (const byElement of Object.values(TONE_CLASSES)) {
      for (const classes of Object.values(byElement)) {
        expect(SOURCE).toContain(JSON.stringify(classes));
      }
    }
  });
});

describe("status-tone.ts is safe to import from anywhere", () => {
  // Client-reachable, and the landing-page walkthrough reads it.
  // `import { type X }` is flagged too: under verbatimModuleSyntax it leaves a
  // bare side-effect import behind.
  it("has no runtime import", () => {
    const imports = SOURCE.match(/^import\b.*$/gm) ?? [];
    expect(imports.filter((line) => !/^import type\b/.test(line))).toEqual([]);
  });
});
