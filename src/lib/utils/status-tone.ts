/**
 * The single owner of status colour.
 *
 * Amber ("needs-you") means something you should act on. Red ("wrong") means
 * something went wrong, or this cannot be undone. Green ("happened") only
 * confirms that something happened; it never judges a number as good.
 * Everything else (counts, percentages, trends, current states, reversible
 * "turn it off" actions) is neutral. The accent keeps "due now" and
 * "selected" and is not a status colour, so it is not here.
 *
 * STATUS_TONE encodes the table in
 * docs/superpowers/specs/2026-10-16-status-colours-button-alert-design.md
 * ("Every status, and its tone"). TONE_CLASSES turns a tone into token classes
 * for each kind of element. A component asks `toneClass(toneOf(status), el)`
 * and never writes `text-warning` itself; tests/unit/status-colour-owner.test.ts
 * fails the suite if it does.
 *
 * Every class is one whole string literal: Tailwind v4 finds utilities by
 * scanning source text, so a class assembled at runtime is never generated.
 *
 * No runtime imports. Components and the landing-page walkthrough both read
 * this module, so it must pull nothing into either bundle.
 *
 * The opacities are decided by tests/unit/theme-tokens.test.ts, which reads
 * this table and measures every tone over each backdrop its element is drawn
 * on, in both schemes. That is why the happened chip is /10 where the other
 * tinted chips are /15: at /15 it measures 4.33:1 on a hovered card in dark.
 */
import type { RefillSeverity } from "$lib/types";

export type Tone = "needs-you" | "wrong" | "happened" | "neutral";

export type StatusKey =
  | "dose-overdue"
  | "dose-taken"
  | "dose-skipped"
  | "dose-missed"
  | "refill-critical"
  | "refill-warning"
  | "refill-watch"
  | "refill-ok"
  | "stock-low"
  | "side-effect-mild"
  | "side-effect-moderate"
  | "side-effect-severe"
  | "insight-needs-you"
  | "insight-info"
  | "needs-you"
  | "action-failed"
  | "action-done"
  | "state";

export const STATUS_TONE: Record<StatusKey, Tone> = {
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
};

export function toneOf(status: StatusKey): Tone {
  return STATUS_TONE[status];
}

/**
 * text   a status word.
 * chip   a tinted pill holding a word and a glyph.
 * marker the 20px status circle (StatusMarker).
 * bar    a breakdown-bar segment.
 * alert  the Alert box only; its headline takes `text` (neutral's headline is
 *        text-text-primary).
 * border a card's status edge, colour only; the card carries the `border`
 *        width itself (DueCard's overdue edge).
 */
export type ToneElement = "text" | "chip" | "marker" | "bar" | "alert" | "border";

export const TONE_CLASSES: Record<Tone, Record<ToneElement, string>> = {
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
};

export function toneClass(tone: Tone, element: ToneElement): string {
  return TONE_CLASSES[tone][element];
}

const REFILL_STATUS: Record<RefillSeverity, StatusKey> = {
  critical: "refill-critical",
  warning: "refill-warning",
  watch: "refill-watch",
  ok: "refill-ok",
};

/**
 * The tier's status. The thresholds stay with `classifyRefillSeverity`
 * (`src/lib/server/inventory.ts`); this only names the tier.
 * Implemented as a `Record<RefillSeverity, StatusKey>` lookup, so a new tier
 * is a compile error here rather than an uncoloured row.
 */
export function refillStatus(severity: RefillSeverity): StatusKey {
  return REFILL_STATUS[severity];
}
