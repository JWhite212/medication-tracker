// WalkthroughStage, mounted for real (jsdom, client svelte), to hold the
// contract between the scenes and the timeline that no other test can see.
//
// computeFrame (timeline.ts) frames its shots on elements it knows only by
// mark key, and every way of getting a key wrong is silent:
//   - a key nobody registers sends the camera to the wide shot and the cursor
//     to the window centre;
//   - a key registered on two elements is overwritten by whichever mounted
//     last (marks.ts);
//   - a key under the wrong root is measured from the wrong origin
//     (measureMarks walks offsetParents until it meets its root);
//   - the player measures while T is still on the title card, so a mark that
//     appears only later is never measured at all.
//
// So ONE mount, its props moved through the loop the way WalkthroughVideo
// moves them, is checked at seven moments:
//   - the registered keys are the same set every time, and that set is
//     exactly REQUIRED_MARKS, the two roots and UNREAD_MARKS;
//   - no key is ever registered against two different elements;
//   - every "p." key sits inside the phone root, and every other key inside
//     the shell root;
//   - nothing in the stage can take focus, and nothing adds a heading,
//     landmark or list: the whole stage is aria-hidden decoration.
//
// One `it`, deliberately: split up, an assertion over an empty registry
// could pass on its own.
//
// Does NOT cover geometry. jsdom has no layout, so every rect is zero; whether
// a framing looks right is the browser check's job (spec Section 5).
import { describe, it, expect, afterEach } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { TimeFormat } from "$lib/utils/time";
import {
  CUES,
  REQUIRED_MARKS,
  T_LOG,
  T_TAP,
  computeFrame,
  type Frame,
} from "$lib/components/walkthrough/timeline";
import { MARKS_CONTEXT, PHONE_ROOT, SHELL_ROOT } from "$lib/components/walkthrough/marks";
import WalkthroughStage from "$lib/components/walkthrough/WalkthroughStage.svelte";

/**
 * Keys a scene registers that computeFrame never reads, by name rather than
 * by pattern, so a new unread key fails here until someone decides it
 * belongs. MedicationsScene marks all five cards and their stats rows; the
 * Medications and Timers shots frame only cards 0 to 3.
 */
const UNREAD_MARKS: readonly string[] = [
  "m.card4",
  "m.stats0",
  "m.stats1",
  "m.stats2",
  "m.stats3",
  "m.stats4",
];

/** Anything a keyboard or a screen reader could land on (spec Section 5). */
const FOCUSABLE =
  "a[href], area[href], button, input, select, textarea, summary, details, iframe, " +
  "audio[controls], video[controls], [contenteditable], [tabindex]";

/**
 * The headings, landmarks, lists and controls the real dashboard components
 * render and the stage parts must not copy, by element or by role
 * (Global Constraints). `role="img"` is not here: StatusMarker and Sparkline
 * carry it, and the stage may show them.
 */
const SEMANTIC = [
  "form, h1, h2, h3, h4, h5, h6, section, nav, main, aside, header, footer, article",
  "ul, ol, li, dl, table, dialog",
  "[role='heading'], [role='banner'], [role='navigation'], [role='main'], [role='region']",
  "[role='complementary'], [role='contentinfo'], [role='form'], [role='search']",
  "[role='list'], [role='listitem'], [role='dialog'], [role='button'], [role='link']",
].join(", ");

/** When production measures, then through both log beats, in loop order. */
const MOMENTS: ReadonlyArray<readonly [string, number]> = [
  ["the title card, when the player measures", 0],
  ["the Today pan", CUES.Today + 1],
  ["just before Log now", T_LOG - 0.1],
  ["Log now pending", T_LOG + 0.2],
  ["the Undo offer", T_LOG + 1.0],
  ["the phone before its tap", CUES.Reminders + 1],
  ["the phone after its tap", T_TAP + 0.5],
];

/** The registry WalkthroughVideo provides, recording every registration. */
class RecordingRegistry extends Map<string, HTMLElement> {
  readonly writes: Array<readonly [string, HTMLElement]> = [];

  override set(key: string, el: HTMLElement): this {
    this.writes.push([key, el]);
    return super.set(key, el);
  }
}

const teardown: Array<() => void> = [];

afterEach(() => {
  while (teardown.length) teardown.pop()!();
});

describe("WalkthroughStage marks", () => {
  it("registers exactly the marks the timeline reads, from T = 0, once each, under the right root, with nothing focusable", () => {
    // Not vacuous: the list holds the marks both log beats are framed on.
    expect(REQUIRED_MARKS).toEqual(expect.arrayContaining(["d.logNow", "o.offer", "p.vitdLog"]));
    // And the unread list cannot excuse a mark the timeline does read.
    expect(UNREAD_MARKS.filter((key) => REQUIRED_MARKS.includes(key))).toEqual([]);
    const expected = [
      ...new Set([...REQUIRED_MARKS, SHELL_ROOT, PHONE_ROOT, ...UNREAD_MARKS]),
    ].sort();

    const registry = new RecordingRegistry();
    const target = document.body.appendChild(document.createElement("div"));
    const props = $state<{ frame: Frame; time: number; full: boolean; timeFormat: TimeFormat }>({
      frame: computeFrame(0, {}),
      time: 0,
      full: true,
      timeFormat: "24h",
    });
    const app = mount(WalkthroughStage, {
      target,
      props,
      context: new Map([[MARKS_CONTEXT, registry]]),
    });
    teardown.push(() => {
      unmount(app);
      target.remove();
    });

    for (const [moment, T] of MOMENTS) {
      props.frame = computeFrame(T, {});
      props.time = T;
      // Actions run only when effects flush, so without this the registry is
      // empty and every check below compares nothing.
      flushSync();
      const at = `at ${moment} (T = ${T.toFixed(2)})`;

      expect([...registry.keys()].sort(), `registered marks ${at}`).toEqual(expected);

      const elementsByKey = new Map<string, Set<HTMLElement>>();
      for (const [key, el] of registry.writes) {
        const elements = elementsByKey.get(key) ?? new Set<HTMLElement>();
        elements.add(el);
        elementsByKey.set(key, elements);
      }
      expect(
        [...elementsByKey].filter(([, elements]) => elements.size > 1).map(([key]) => key),
        `keys registered on more than one element ${at}`,
      ).toEqual([]);

      const shell = registry.get(SHELL_ROOT)!;
      const phone = registry.get(PHONE_ROOT)!;
      expect(shell.contains(phone) || phone.contains(shell), "the two roots overlap").toBe(false);
      expect(
        [...registry]
          .filter(([key]) => !key.startsWith("root."))
          .filter(([key, el]) => !(key.startsWith("p.") ? phone : shell).contains(el))
          .map(([key]) => key),
        `marks outside their root ${at}`,
      ).toEqual([]);

      expect(
        [...target.querySelectorAll(FOCUSABLE)].map((el) => el.outerHTML.slice(0, 120)),
        `focusable elements in the stage ${at}`,
      ).toEqual([]);
      expect(
        [...target.querySelectorAll(SEMANTIC)].map((el) => el.outerHTML.slice(0, 120)),
        `headings, landmarks or lists in the stage ${at}`,
      ).toEqual([]);
    }
  });
});

// The stage re-renders on every animation frame, and a frame changes only
// `time` and the Frame values computed from it. So nothing that depends on T
// alone may build a formatter: formatUserTime constructs an Intl.DateTimeFormat
// per call, and StageDashboardHeader once recomputed both header copies (the
// caught-up one through formatUserTime) on every frame, because its prop
// getter read the per-tick frame even while `logged` held still: twice per
// frame across the desktop and phone headers for the whole loop. The copy
// depends on the payload, never on T; only each layer's opacity follows
// `logged`.
describe("WalkthroughStage per-frame work", () => {
  it("builds no date formatter while the frames step through both log beats", () => {
    const target = document.body.appendChild(document.createElement("div"));
    const props = $state<{ frame: Frame; time: number; full: boolean; timeFormat: TimeFormat }>({
      frame: computeFrame(0, {}),
      time: 0,
      full: true,
      timeFormat: "24h",
    });
    const app = mount(WalkthroughStage, {
      target,
      props,
      context: new Map([[MARKS_CONTEXT, new Map()]]),
    });
    teardown.push(() => {
      unmount(app);
      target.remove();
    });

    const step = (T: number) => {
      props.frame = computeFrame(T, {});
      props.time = T;
      flushSync();
    };

    const Real = Intl.DateTimeFormat;
    let counting = false;
    let constructed = 0;
    const Counting = function (...args: ConstructorParameters<typeof Real>) {
      if (counting) constructed += 1;
      return new Real(...args);
    } as unknown as typeof Intl.DateTimeFormat;
    Counting.supportedLocalesOf = Real.supportedLocalesOf;
    Object.defineProperty(Counting, "prototype", { value: Real.prototype });
    Intl.DateTimeFormat = Counting;
    teardown.push(() => {
      Intl.DateTimeFormat = Real;
    });

    // Each beat's first frame is reached uncounted: arriving from another
    // scene may legitimately build a formatter once (HistoryScene's story
    // clock moves with its scene). What is counted is the steady state, ten
    // frames a tenth of a second apart, across which `logged` goes 0 → 1.
    for (const beat of [T_LOG, T_TAP]) {
      counting = false;
      step(beat);
      counting = true;
      for (let i = 1; i <= 10; i++) step(beat + 0.1 * i);
    }
    counting = true;
    const perFrame = constructed;
    // Not vacuous: the spy counts a construction where one happens.
    expect(new Intl.DateTimeFormat("en-GB")).toBeInstanceOf(Real);
    expect(constructed).toBe(perFrame + 1);
    expect(perFrame, "Intl.DateTimeFormat constructions across the beats").toBe(0);
  });
});
